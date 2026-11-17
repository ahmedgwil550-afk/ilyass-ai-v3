import { getAiConfig, tierOf } from "./ai-provider";
import { adaptiveTokenBudget } from "./tokenBudget";
import { arabicPromptFor } from "./arabicPrompt";
import { opinionPromptFor } from "./opinionPrompt";
import { frenchPromptFor } from "./frenchPrompt";
import { philosophyPromptFor } from "./philosophyPrompt";


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const FRENCH_SUBJECTS = new Set(["math", "physics", "chemistry", "biology", "french"]);
const ARABIC_SUBJECTS = new Set(["arabic", "islamic", "philosophy", "history"]);

const systemPrompt = `أنت ILYASS AI، مساعد تعليمي ذكي لطلاب الثانوية التأهيلية في المغرب.

تم إرسال صفحة/صفحات من امتحان أو واجب بصيغة PDF. مهمتك:

1. اقرأ كل سؤال بدقة من الصورة
2. رقّم كل سؤال
3. أجب على كل سؤال بالتنسيق التالي:

---
## السؤال X:
**نص السؤال:** [أعد كتابة السؤال كما هو]

**الجواب:**
[الحل خطوة بخطوة]

**التفسير:**
[شرح مختصر للطريقة المستخدمة]

---

## قواعد:
- إذا وجدت رسومات أو أشكال أو جداول في الصورة، فسّرها قبل الإجابة
- استخدم $...$ و $$...$$ لـ LaTeX
- استخدم \\text{} للوحدات
- إذا طُلب أو وُجد أي جدول (إشارات، تغيرات، تناسب، بيانات، ملء فراغات...)، استخدم جدول Markdown قياسياً فقط، ولا تستخدم HTML أو كتلة كود للجدول.
- حافظ على عدد الصفوف والأعمدة وترتيبها. الخلايا الفارغة المطلوب ملؤها = ....................................؛ استعمل $...$ للمعادلات داخل الخلايا.
- إذا كان الجدول نفسه هو المطلوب، فلا تضف قبله أو بعده عنوان «الجواب النهائي» أو شرحاً يكرر محتواه.
- إذا طُلب رسم أو تمثيل بياني، أنشئ SVG داخل \`\`\`svg
- كن دقيقاً ومنظماً كأنك تحل امتحاناً حقيقياً`;

function getLanguageInstruction(subject: string): string {
  if (FRENCH_SUBJECTS.has(subject)) return "\n\n## لغة الإجابة:\nأجب دائماً بالفرنسية مهما كانت لغة السؤال.";
  if (ARABIC_SUBJECTS.has(subject)) return "\n\n## لغة الإجابة:\nأجب دائماً بالعربية.";
  if (subject === "english") return "\n\n## لغة الإجابة:\nأجب دائماً بالإنجليزية.";
  return "\n\n## لغة الإجابة:\nأجب بنفس لغة السؤال.";
}

export async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { pageImages, subject, modelMode, pageNumbers } = await req.json();
    const ai = getAiConfig(tierOf(modelMode));
    if (!ai) throw new Error("AI provider is not configured (set AI_API_KEY)");

    const selectedModel = ai.model(tierOf(modelMode));
    const budget = adaptiveTokenBudget({ mode: modelMode, text: `PDF exam ${subject || ""}`, imageCount: Array.isArray(pageImages) ? pageImages.length : 0, subject, stage: "solve" });

    // Build content array with all page images
    const content: any[] = [];

    for (let i = 0; i < pageImages.length; i++) {
      const pageNum = pageNumbers?.[i] ?? (i + 1);
      content.push({
        type: "text",
        text: `--- الصفحة ${pageNum} / Page ${pageNum} ---`,
      });
      content.push({
        type: "image_url",
        image_url: { url: `data:image/jpeg;base64,${pageImages[i]}` },
      });
    }

    content.push({
      type: "text",
      text: subject
        ? `المادة: ${subject}. حلّ جميع الأسئلة الموجودة في هذه الصفحات خطوة بخطوة.`
        : "حلّ جميع الأسئلة الموجودة في هذه الصفحات خطوة بخطوة.",
    });

    const response = await fetch(ai.chatUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ai.key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: selectedModel,
        messages: [
          { role: "system", content: systemPrompt + getLanguageInstruction(subject || "other") + opinionPromptFor(subject) + arabicPromptFor(subject) + frenchPromptFor(subject) + philosophyPromptFor(subject) },
          { role: "user", content },
        ],
        stream: true,
        ...(selectedModel.startsWith("gpt-") || selectedModel.startsWith("openai/gpt-") ? { max_completion_tokens: budget.maxOutputTokens } : { max_tokens: budget.maxOutputTokens }),
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Payment required" }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const text = await response.text();
      console.error("AI gateway error:", response.status, text);
      return new Response(JSON.stringify({ error: "AI gateway error" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" },
    });
  } catch (e) {
    console.error("solve-pdf error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}
