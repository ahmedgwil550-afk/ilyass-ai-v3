import { getAiConfig } from "./ai-provider";

/**
 * خطوة قراءة مستقلة قبل الحل: صحة الإجابة تعتمد كلياً على قراءة الصورة، لذلك
 * يقرأ نموذج أقوى الورقة أولاً ويكتب ما فيها حرفياً (دون حل)، ثم يُحَلّ السؤال من هذه القراءة.
 */
const TRANSCRIBE_PROMPT = `You are a meticulous OCR + figure-reading engine for Moroccan high-school exam sheets (maths, physics, chemistry, SVT, Arabic language and literature; French/Arabic).
Your ONLY job is to transcribe what is actually visible. Do NOT solve anything, do NOT explain, do NOT correct the sheet.

Output (Markdown, nothing else):

## Texte
Copy every statement, data line and numbered question EXACTLY as printed, keeping the numbering (1), a), 2.1 …) and marks.
- Write all mathematics in LaTeX between $...$ (exponents, indices, roots, fractions, vectors, units such as $\\mathrm{m\\cdot s^{-1}}$). Keep numbers EXACTLY, with their decimal commas and units.
- Tables → Markdown tables, cell by cell.
- Arabic text: copy it exactly, right-to-left, KEEPING every diacritic (tashkeel: fatha, damma, kasra, sukun, shadda, tanwin) that is printed; never add diacritics that are not printed and never "correct" spelling or grammar. For a poem, put each verse on its own line, keep both hemistichs in their printed order separated by " … ", and keep the verse numbers and the author/source line if printed. Keep Arabic question numbering as printed (أ- ب- ج-, 1- 2-, السؤال الأول …).
- If a character, digit, sign, exponent or index is not clearly legible, write [?] in its place. NEVER guess a value to make a formula "look right". Distinguish decimal comma from decimal point, minus sign from dash, and 0 from O. Preserve significant zeros and scientific notation. Re-read every numerical value once before returning.

## Figures
For EACH graph, curve, circuit, diagram or document, one block:
- Where it is and its caption/number.
- Graph: axis names + units, the printed scale (tick values and spacing), the curve type (line, parabola, exponential, decay…), and key readable points as (x ; y) with an honest precision (e.g. "≈ (2,0 ; 3,5) ± 0,1"). Mention intercepts, asymptotes, extrema, intersections when visible, and any construction already drawn (tangent, dashed projections).
- Circuit/diagram: components, their values, how they are connected, labelled points.
- If something is cut off, blurred, too small or hidden, say exactly what. For each figure, separate directly visible labels/values from approximate visual readings; never present an estimate as an exact printed value.

## Lisibilité
One line: READABILITY: ok | partial | poor — then, if not ok, list precisely what cannot be read. Add a short confidence note for each uncertain question or figure, and identify the exact page/region if possible.
If a question refers to a figure/graph/document/table that is NOT visible in the images, write on its own line: FIGURE_MISSING: <which one and for which question>.`;

export interface Transcription {
  text: string;
  figureMissing: boolean;
}

/** يعيد null إذا فشلت الخطوة (يُكمل الحل بالطريقة القديمة بصمت). */
export async function transcribeImages(
  images: string[],
  override?: { chatUrl: string; key: string; model: string },
  options: { signal?: AbortSignal; maxOutputTokens?: number; failOnInsufficientCredits?: boolean } = {},
): Promise<Transcription | null> {
  if (images.length === 0) return null;
  try {
    // نموذج "accurate" للقراءة حتى في الوضع السريع (أو مسار محدد، كوضع Pananachi)
    const base = getAiConfig("accurate");
    const cfg = override
      ? { chatUrl: override.chatUrl, key: override.key, model: () => override.model }
      : base;
    if (!cfg) return null;
    const timeout = AbortSignal.timeout(50_000);
    const anySignal = (AbortSignal as any).any;
    const signal = options.signal && typeof anySignal === "function" ? anySignal([options.signal, timeout]) : options.signal || timeout;
    const res = await fetch(cfg.chatUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.key}`, "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        model: cfg.model("accurate"),
        temperature: 0,
        max_tokens: Math.max(900, Math.min(options.maxOutputTokens || 3200, 5200)),
        stream: false,
        messages: [
          { role: "system", content: TRANSCRIBE_PROMPT },
          {
            role: "user",
            content: [
              ...images.map((img) => ({ type: "image_url", image_url: { url: img.startsWith("data:") ? img : `data:image/jpeg;base64,${img}` } })),
              { type: "text", text: images.length > 1 ? "Transcribe all these images in order (the pages/parts of one sheet)." : "Transcribe this sheet." },
            ],
          },
        ],
      }),
    });
    if (!res.ok) {
      if (res.status === 402 && options.failOnInsufficientCredits) {
        throw Object.assign(new Error("Lovable AI Gateway returned 402 Payment Required"), { code: "INSUFFICIENT_CREDITS" });
      }
      console.error("transcribe status", res.status);
      return null;
    }
    const data = await res.json();
    const text: string | undefined = data?.choices?.[0]?.message?.content;
    if (!text || text.trim().length < 10) return null;
    return { text: text.trim().slice(0, 14_000), figureMissing: /FIGURE_MISSING\s*:/i.test(text) };
  } catch (e) {
    if (options.failOnInsufficientCredits && (e as any)?.code === "INSUFFICIENT_CREDITS") throw e;
    console.error("transcribe failed:", e);
    return null;
  }
}

/** يُلحق بنص رسالة المستخدم: الحل يُبنى من هذه القراءة، ومعها الصورة للتحقق. */
export function transcriptionBlock(t: Transcription): string {
  return `

<image_transcription>
${t.text}
</image_transcription>

قواعد استعمال القراءة أعلاه:
- هذه قراءة مستقلة للصورة. ابنِ الحل على القيم المكتوبة فيها، وتحقق منها على الصورة المرفقة؛ وإن تعارضتا في رقم أو إشارة أو أسّ فاعتمد ما تراه بوضوح في الصورة ونبّه على ذلك بجملة قصيرة.
- لا تخمّن أي قيمة تحمل [?] أو وُصفت بأنها غير واضحة. إن كان المطلوب يتوقف عليها فتوقف عن الحل، وقل بوضوح ما الذي لم تتمكن من قراءته، واطلب من المستخدم صورة أوضح أو مقرّبة لذلك الجزء فقط.${t.figureMissing ? "\n- القراءة تشير إلى FIGURE_MISSING: السؤال يحتاج شكلاً/منحنى غير ظاهر في الصورة. لا تحلّ ما يعتمد عليه؛ أخبر المستخدم أن الشكل غير ظاهر واطلب منه صورة تُظهره كاملاً." : ""}`;
}

/** قواعد الأسئلة البيانية والرسم على المنحنى (فيزياء/كيمياء/رياضيات). */
export const GRAPH_RULES_PROMPT = `

## الأسئلة المرتبطة بشكل أو منحنى في الورقة (قاعدة صارمة)
1) أسئلة الاستخراج البياني (graphiquement، par lecture graphique، à partir du graphe/de la courbe/du document، استنتج مبيانياً، من خلال الشكل/المنحنى، حدّد بيانياً):
   - الجواب يُستخرج من الشكل أو المنحنى الموجود في الورقة نفسها، لا من قانون أو حساب بديل، إلا إذا طُلب الحساب صراحة.
   - اكتب القراءة كما يفعل التلميذ: المحور والمقياس المستعمل، النقطة المقروءة، ثم القيمة مع الوحدة وبدقة معقولة (مثال: « On lit sur la courbe : pour t = 4,0 s, i ≈ 1,2 A »). أشِر إلى الإسقاطات المتقطعة على المحورين عند الحاجة.
   - إذا لم يكن الشكل/المنحنى ظاهراً في الصورة، أو كان غير واضح بحيث لا تُقرأ النقطة المطلوبة، فتوقف عن حل هذا السؤال ولا تخترع قيماً: اكتب بوضوح أن الشكل غير ظاهر (أو غير واضح) واطلب من المستخدم صورة تُظهر الشكل كاملاً وواضحاً، مع ذكر السؤال المعني.
2) أسئلة الرسم على المنحنى/الوثيقة (tracer، construire، représenter، ارسم، مثّل، أنشئ، ماسّ، مقارب، مستقيم… في فيزياء/كيمياء/رياضيات):
   - الجواب رسم وليس وصفاً كتابياً. أعد رسم المحورين والمنحنى (أو الجزء اللازم منه) في كتلة \`\`\`svg مع العناصر المطلوبة (الماسّ، المستقيم، النقاط بإحداثياتها، الإسقاطات المتقطعة) وعنوان قصير تحته.
   - بعد الرسم اذكر في سطر واحد كيف حُدِّد (النقطتان أو الميل) ليبقى قابلاً للتحقق، وأخبر المستخدم أنه يستطيع الضغط على «حل على الورقة» ليُرسم الحل مباشرة فوق صورة ورقته.
   - لا تكتفِ بشرح الطريقة بالكلمات.
3) رسم الميتوكوندري (mitochondrie): لا تعِد رسمه بـ SVG ولا بالوصف؛ الواجهة تعرض صورة الكتاب المدرسي الجاهزة تلقائياً (![Schéma annoté d’une mitochondrie](/media/diagrams/mitochondrie.jpg)). اكتب فقط تعليقاً قصيراً للأجزاء الخمسة: membrane externe، membrane interne، crête، matrice، espace intermembranaire.
4) في كل الأحوال: لا تعتمد على قيمة غير مقروءة من الصورة، ولا تكمل الحل بتخمين.`;
