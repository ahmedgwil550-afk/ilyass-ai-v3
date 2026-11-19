/**
 * وضع Pananachi: فريق نماذج يمر عليه الامتحان عبر مراحل:
 *  1) Gemini  — قراءة الصورة واستخراج الأسئلة
 *  2) GPT (Astra) — الحل الرئيسي خطوة بخطوة
 *  3) Claude  — صياغة الإجابة بأسلوب تلميذ متفوق ومنهجية مغربية
 *  4) Gemini  — حل مستقل (دون رؤية الحل الأول) + مدقق حسابي برمجي
 *  5) GPT (Astra) — مراجعة نهائية ومراجعة نهائية، ثم يُبث الجواب النهائي
 * كل مرحلة تتدهور بهدوء: إن فشل نموذج يُستعمل البديل أو تُتخطى المرحلة، ويظهر ذلك في لوحة "التفكير".
 *
 * متغيرات البيئة (كلها اختيارية):
 *  PANACHE_MODEL_VISION   نموذج Gemini للقراءة والحل المستقل (افتراضي gemini-4-argon)
 *  PANACHE_MODEL_SOLVER   الحل الرئيسي (افتراضي gpt-6-astra)
 *  PANACHE_MODEL_FINAL    المراجع النهائي (افتراضي gpt-6-astra)
 *  PANACHE_MODEL_WRITER   معرّف Claude في بوابة Lovable (افتراضي anthropic/claude-opus-5-5، عبر /v1/messages)
 *  ANTHROPIC_API_KEY, ANTHROPIC_MODEL   اختياري: مفتاح Anthropic مباشر. بدون أي منهما تُنفَّذ الصياغة بنموذج GPT ويُذكر ذلك.
 *  OPENAI_API_KEY / AI_API_KEY / LOVABLE_API_KEY  مفاتيح المزوّدين كما في ai-provider.
 */
import { transcribeImages, transcriptionBlock } from "./read-image";
import { arithmeticReport } from "./numberCheck";
import { adaptiveTokenBudget } from "./tokenBudget";
import { codeFindingsForReviewer, resolveVerifyLevel, verifyAnswer } from "./verify/pipeline";
import type { LlmFn } from "./verify/llm";
import { encodeVerification } from "../lib/verification";

interface Route { chatUrl: string; key: string; model: string; label: string }

class InsufficientLovableCreditsError extends Error {
  constructor() { super("Lovable AI Gateway returned 402 Payment Required"); this.name = "InsufficientLovableCreditsError"; }
}
const isInsufficientCredits = (error: unknown) => error instanceof InsufficientLovableCreditsError || (error as any)?.code === "INSUFFICIENT_CREDITS";
type Role = "vision" | "solver" | "final";
type Msg = { role: string; content: any };

const OPENAI_CHAT = "https://api.openai.com/v1/chat/completions";
const LOVABLE_CHAT = "https://ai.gateway.lovable.dev/v1/chat/completions";
const GEMINI_CHAT = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const LOVABLE_MESSAGES = "https://ai.gateway.lovable.dev/v1/messages";

const env = (k: string) => process.env[k] || undefined;

function ownRoute(model: string): Route | null {
  const key = env("AI_API_KEY");
  if (!key) return null;
  const base = env("AI_BASE_URL")?.replace(/\/+$/, "");
  const chatUrl = base ? (base.endsWith("/chat/completions") ? base : `${base}/chat/completions`) : GEMINI_CHAT;
  return { chatUrl, key, model, label: model };
}

/** قائمة مسارات مرتبة حسب الأفضلية لكل دور. */
export function routesFor(role: Role): Route[] {
  const out: Route[] = [];
  const lov = env("LOVABLE_API_KEY");
  const oai = env("OPENAI_API_KEY");
  const accurate = env("AI_MODEL_ACCURATE") || "gemini-2.5-pro";
  const add = (r: Route | null) => { if (r) out.push(r); };
  const L = (model: string): Route | null => lov ? { chatUrl: LOVABLE_CHAT, key: lov, model, label: model } : null;
  if (role === "vision") {
    const m = env("PANACHE_MODEL_VISION");
    add(m ? ownRoute(m) : null);
    add(ownRoute(accurate));
    add(L(m && m.includes("/") ? m : "google/gemini-4-argon"));
    add(L("google/gemini-3.1-pro-preview"));
  } else {
    const m = env(role === "solver" ? "PANACHE_MODEL_SOLVER" : "PANACHE_MODEL_FINAL") || "gpt-6-astra";
    if (oai) out.push({ chatUrl: OPENAI_CHAT, key: oai, model: m.replace(/^openai\//, ""), label: m });
    add(L(m.includes("/") ? m : `openai/${m}`));
    add(ownRoute(accurate));
  }
  return out.filter((r, i, a) => a.findIndex((x) => x.chatUrl === r.chatUrl && x.model === r.model) === i);
}

const combineSignals = (signals: AbortSignal[]): AbortSignal => {
  const any = (AbortSignal as any).any;
  if (typeof any === "function") return any(signals);
  const controller = new AbortController();
  for (const source of signals) {
    const abort = () => controller.abort(source.reason);
    if (source.aborted) abort();
    else source.addEventListener("abort", abort, { once: true });
  }
  return controller.signal;
};

const withTimeout = (outer?: AbortSignal, ms = 150_000): AbortSignal => {
  const timeout = AbortSignal.timeout(ms);
  const any = (AbortSignal as any).any;
  if (!outer) return timeout;
  if (typeof any === "function") return any([outer, timeout]);
  const controller = new AbortController();
  const abortOuter = () => controller.abort(outer.reason);
  const abortTimeout = () => controller.abort(timeout.reason);
  if (outer.aborted) abortOuter(); else outer.addEventListener("abort", abortOuter, { once: true });
  timeout.addEventListener("abort", abortTimeout, { once: true });
  return controller.signal;
};

function body(model: string, messages: Msg[], stream: boolean, maxOutputTokens = 2400) {
  return JSON.stringify({
    model, messages, stream,
    ...(model.startsWith("gpt-") || model.startsWith("openai/gpt-") ? { max_completion_tokens: maxOutputTokens } : { max_tokens: maxOutputTokens }),
    ...(/gpt-6/.test(model) ? { reasoning_effort: maxOutputTokens >= 4000 ? "high" : maxOutputTokens >= 2200 ? "medium" : "low" } : {}),
  });
}

async function chatOnce(routes: Route[], messages: Msg[], signal?: AbortSignal, maxOutputTokens = 2400): Promise<{ text: string; route: Route } | null> {
  for (const r of routes) {
    try {
      const res = await fetch(r.chatUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${r.key}`, "Content-Type": "application/json" },
        body: body(r.model, messages, false, maxOutputTokens),
        signal: withTimeout(signal),
      });
      if (res.status === 402) throw new InsufficientLovableCreditsError();
      if (!res.ok) { console.error("panache stage", r.model, res.status, (await res.text()).slice(0, 200)); continue; }
      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content;
      if (typeof text === "string" && text.trim().length > 5) return { text: text.trim(), route: r };
    } catch (e) {
      if (signal?.aborted || isInsufficientCredits(e)) throw e;
      console.error("panache stage failed", r.model, e);
    }
  }
  return null;
}

async function claudeOnce(system: string, user: string, signal?: AbortSignal, maxOutputTokens = 1800): Promise<{ text: string; model: string } | null> {
  // 1) مفتاح Anthropic مباشر إن وُجد، 2) بوابة Lovable عبر مسار Messages (anthropic/*)
  const targets: { url: string; headers: Record<string, string>; model: string }[] = [];
  const direct = env("ANTHROPIC_API_KEY");
  if (direct) targets.push({ url: ANTHROPIC_URL, headers: { "x-api-key": direct }, model: env("ANTHROPIC_MODEL") || "claude-opus-5-5" });
  const lov = env("LOVABLE_API_KEY");
  if (lov) {
    const m = env("PANACHE_MODEL_WRITER");
    for (const model of [m, "anthropic/claude-opus-5-5", "anthropic/claude-opus-5"].filter(Boolean) as string[]) {
      targets.push({ url: LOVABLE_MESSAGES, headers: { Authorization: `Bearer ${lov}`, "x-api-key": lov }, model });
    }
  }
  for (const t of targets) {
    try {
      const res = await fetch(t.url, {
        method: "POST",
        headers: { ...t.headers, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: t.model, max_tokens: Math.max(700, Math.min(maxOutputTokens, 3200)), system, messages: [{ role: "user", content: user }] }),
        signal: withTimeout(signal),
      });
      if (res.status === 402) throw new InsufficientLovableCreditsError();
      if (!res.ok) { console.error("claude stage", t.model, res.status, (await res.text()).slice(0, 200)); continue; }
      const data = await res.json();
      const text = (data?.content ?? []).map((c: any) => c?.text ?? "").join("").trim();
      if (text.length > 5) return { text, model: t.model };
    } catch (e) {
      if (signal?.aborted || isInsufficientCredits(e)) throw e;
      console.error("claude stage failed", t.model, e);
    }
  }
  return null;
}

const stripThink = (t: string) => t.replace(/<thinking>[\s\S]*?<\/thinking>/g, "").trim();

function lastUser(messages: Msg[]): Msg | undefined {
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === "user") return messages[i];
  return undefined;
}
function textOf(m?: Msg): string {
  if (!m) return "";
  if (typeof m.content === "string") return m.content;
  return (m.content as any[]).filter((p) => p.type === "text").map((p) => p.text).join("\n");
}
function imagesOf(m?: Msg): any[] {
  return m && Array.isArray(m.content) ? m.content.filter((p: any) => p.type === "image_url") : [];
}
/** نسخة من الرسائل مع إلحاق نص بالرسالة الأخيرة للمستخدم. */
function appendToLastUser(messages: Msg[], extra: string): Msg[] {
  const out = messages.map((m) => ({ ...m }));
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i].role !== "user") continue;
    const c = out[i].content;
    if (typeof c === "string") out[i].content = c + extra;
    else {
      const parts = (c as any[]).map((p) => ({ ...p }));
      const ti = parts.map((p) => p.type).lastIndexOf("text");
      if (ti >= 0) parts[ti].text += extra; else parts.push({ type: "text", text: extra });
      out[i].content = parts;
    }
    break;
  }
  return out;
}

const NO_THINK = "\nلا تكتب كتلة <thinking> في هذه المرحلة، ولا تذكر المراحل أو النماذج.";

const SOLVER_TASK = `

[مرحلة الحل الرئيسي — مسودة للمراجعة، لا تُعرض للتلميذ كما هي]
حلّ كل الأسئلة بدقة تامة وبالترتيب، خطوة بخطوة: القانون المستعمل، التعويض بالقيم والوحدات، النتيجة العددية الدقيقة. تحقق من الإشارات والوحدات. لا تتخطَّ أي سؤال، واذكر ترقيم الورقة كما هو.${NO_THINK}`;

const WRITER_SYSTEM_EXTRA = `

[مرحلة صياغة الإجابة]
أنت أستاذ منهجية مغربي. ستُعطى سؤال الامتحان ومسودة حل. أعد كتابتها كما يكتبها تلميذ متفوق في ورقة الامتحان الوطني: الترقيم نفسه، العبارات العلمية الصحيحة، منهجية الإجابة المعتمدة في المغرب (القانون ثم التعويض ثم النتيجة بالوحدة في المواد العلمية؛ أما في مادة العربية فمنهجيتها الخاصة في الإعراب والصرف والبلاغة وتحليل النص، وبالعربية الفصحى دون قوالب فرنسية)، مختصرة وواضحة ومناسبة لسلم التنقيط. لا تغيّر أي نتيجة عددية إلا إذا أعدت حسابها من معطيات السؤال وتأكدت من التصحيح. لا تضف معلومة غير مطلوبة ولا تحذف سؤالاً. اكتب الإجابة فقط.${NO_THINK}`;

const REVIEWER_SYSTEM = `You are an independent exam solver (Moroccan baccalaureate: maths, physics, chemistry, SVT, Arabic language). You have NOT seen anyone else's solution.
Solve every question from scratch, carefully. Be concise: for each numbered question give the key steps and the FINAL RESULT (with units). For Arabic-language questions (parsing/إعراب, morphology, rhetoric, text analysis), give the exact grammatical case and sign, the exact rhetorical device with its justification, and quote evidence only from the given text — answer in Arabic. For French-language questions (étude de texte, langue, production écrite), name the exact figure of speech or grammatical nature and function, quote only from the given text, and answer in simple, correct French of a good 2ème Bac student. Flag explicitly anything ambiguous, unreadable or that you are unsure of with "UNSURE:". Do not write <thinking>.`;

const FINAL_TASK = (student: string, independent: string, arith: string) => `

[المرحلة الأخيرة — المراجعة والإصدار النهائي]
<student_answer>
${student}
</student_answer>

<independent_solution>
(حل أنجزه مراجع آخر دون أن يرى النسخة أعلاه)
${independent}
</independent_solution>

<arithmetic_check>
${arith}
</arithmetic_check>

المطلوب بالترتيب:
1) قارن النتيجة النهائية لكل سؤال بين النسختين.
2) عند أي اختلاف أعد حلّ ذلك الجزء بنفسك وحدّد الصحيح بالحساب؛ لا تفترض أن إحداهما صحيحة ولا تحسم بالأغلبية. تعامل مع تقرير <arithmetic_check> كمؤشر يحتاج إلى تحقق مستقل؛ أعد الحساب ولا تعتمد عليه وحده.
3) تأكد من الوحدات والإشارات والأرقام المعنوية، ومن أن كل سؤال في الورقة له جواب، وأن الترقيم مطابق للورقة. وفي مادة العربية: تأكد من علامات الإعراب وحالاتها، ومن تسمية الصور البلاغية وأثرها، ومن أن كل شاهد منقول حرفياً من النص. وفي مادة الفرنسية: تأكد من طبيعة ووظيفة كل عنصر محلَّل، ومن حرفية الاقتباسات، ومن الإملاء والمطابقة، ومن احترام عدد الأسطر، وخلو الجواب من قوالب الرياضيات.
4) أصدر النسخة النهائية فقط، بصياغة تلميذ متفوق جاهزة للنقل، دون ملاحظات مراجعة، ودون ذكر المراحل أو النماذج أو هذه الوسوم، ودون كتلة <thinking>.
5) إذا بقي شك جوهري لم تستطع حسمه، فاكتب في آخر الإجابة سطراً قصيراً يبدأ بـ «⚠️ تنبيه:» يحدد الجزء المشكوك فيه فقط. لا تُظهر جواباً جازماً لجزء تعرف أن فيه خطأً.`;

/** يقرأ بث SSE ويعيد نص كل delta. */
async function* sseDeltas(res: Response): AsyncGenerator<string> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl).replace(/\r$/, "");
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") return;
      try {
        const c = JSON.parse(data)?.choices?.[0]?.delta?.content;
        if (typeof c === "string") yield c;
        else if (Array.isArray(c)) for (const p of c) if (typeof p?.text === "string") yield p.text;
      } catch { /* حدث ناقص */ }
    }
  }
}

export interface PanacheInput {
  systemPrompt: string;
  /** المادة المختارة (تحدد فحوص التحقق: اقتباسات، لغة، ادعاءات رياضية) */
  subject?: string;
  /** رسائل بصيغة OpenAI: system أولاً، والمحادثة كاملة بعده (الصور بصيغة image_url). */
  aiMessages: Msg[];
  /** الصور (base64) في آخر رسالة مستخدم لمرحلة القراءة. */
  images: string[];
  /** User-confirmed preflight transcription; avoids a duplicate first-pass OCR call. */
  reviewedTranscript?: string;
  signal?: AbortSignal;
  /** يُستعمل إن فشلت مرحلة الحل الرئيسي كلياً: ينفذ الطلب العادي ويعيد استجابة SSE. */
  fallback: () => Promise<Response>;
}

export function panacheResponse(input: PanacheInput): Response {
  const enc = new TextEncoder();
  const streamAbort = new AbortController();
  const signal = withTimeout(input.signal ? combineSignals([input.signal, streamAbort.signal]) : streamAbort.signal, 240_000);
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const emit = (t: string) => {
        if (closed || !t) return;
        try { controller.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`)); } catch { closed = true; }
      };
      const step = (t: string) => emit(`- ${t}\n`);
      const end = () => { if (closed) return; closed = true; try { controller.enqueue(enc.encode("data: [DONE]\n\n")); controller.close(); } catch { /* مغلق */ } };
      // </thinking> is written once. A second copy would appear as literal text in the answer.
      let thinkingClosed = false;
      const closeThinking = () => { if (thinkingClosed) return; thinkingClosed = true; emit("</thinking>\n"); };
      // نص الإجابة الذي وصل التلميذ فعلاً (دون كتلة التفكير)
      let finalText = "";
      const emitA = (t: string) => { finalText += t; emit(t); };
      // أفضل إجابة كاملة أنتجتها المراحل المدفوعة حتى الآن؛ تُسلَّم إن تعذّر إكمال المراجعة بدل رميها
      let bestAnswer = "";
      try {
        emit("<thinking>\n");
        step("فريق Pananachi: 5 مراحل — قراءة، حل، صياغة، حل مستقل ومدقق حسابي، مراجعة نهائية");

        // ---- 1) القراءة (Gemini)
        let messages = input.aiMessages;
        let questionText = textOf(lastUser(messages));
        let readingOk = false; // هل قُرئ نص الصورة نصياً؟ (مصدر فحص الاقتباسات)
        let readingTranscript = ""; // القراءة الأولى كما هي: تُقارَن بقراءة ثانية مستقلة في طبقة التحقق
        if (input.images.length && input.reviewedTranscript?.trim()) {
          const reading = {
            text: input.reviewedTranscript.trim().slice(0, 14_000),
            figureMissing: /FIGURE_MISSING\s*:/i.test(input.reviewedTranscript),
          };
          messages = appendToLastUser(messages, transcriptionBlock(reading));
          questionText = reading.text;
          readingOk = true;
          readingTranscript = reading.text;
          step("تم اعتماد القراءة التي راجعها الطالب");
        } else if (input.images.length) {
          const v = routesFor("vision")[0];
          step(`1/5 قراءة الورقة بـ Gemini${v ? ` (${v.label})` : ""}…`);
          let reading = null as Awaited<ReturnType<typeof transcribeImages>>;
          for (const r of routesFor("vision")) {
            reading = await transcribeImages(input.images, r, { signal, failOnInsufficientCredits: true, maxOutputTokens: adaptiveTokenBudget({ mode: "panache", text: questionText, imageCount: input.images.length, stage: "vision" }).maxOutputTokens });
            if (reading) break;
          }
          if (!reading) reading = await transcribeImages(input.images, undefined, { signal, failOnInsufficientCredits: true, maxOutputTokens: adaptiveTokenBudget({ mode: "panache", text: questionText, imageCount: input.images.length, stage: "vision" }).maxOutputTokens });
          if (reading) {
            messages = appendToLastUser(messages, transcriptionBlock(reading));
            questionText = reading.text;
            readingOk = true;
            readingTranscript = reading.text;
            step(reading.figureMissing ? "تنبيه: شكل أو منحنى مطلوب غير ظاهر في الصورة" : "تمت قراءة النص والمعطيات والأشكال");
          } else step("تعذرت القراءة المستقلة؛ سيُكمَل بالصورة مباشرة");
        } else step("1/5 لا توجد صورة: النص مكتوب مباشرة");
        if (signal?.aborted) return end();
        const budget = adaptiveTokenBudget({ mode: "panache", text: questionText, imageCount: input.images.length, stage: "solve" });
        const writerBudget = adaptiveTokenBudget({ mode: "panache", text: questionText, imageCount: input.images.length, stage: "writer" });
        const reviewBudget = adaptiveTokenBudget({ mode: "panache", text: questionText, imageCount: input.images.length, stage: "review" });
        const finalBudget = adaptiveTokenBudget({ mode: "panache", text: questionText, imageCount: input.images.length, stage: "final" });
        const runWriter = budget.complexity >= 3;
        const runIndependent = budget.complexity >= 2;

        // ---- 2) الحل الرئيسي (GPT Astra)
        const solverRoutes = routesFor("solver");
        step(`2/5 الحل الرئيسي بـ GPT${solverRoutes[0] ? ` (${solverRoutes[0].label})` : ""}…`);
        const solved = await chatOnce(solverRoutes, appendToLastUser(messages, SOLVER_TASK), signal, budget.maxOutputTokens);
        if (!solved) {
          step("تعذر الحل الرئيسي؛ تحويل إلى الوضع المتقدم العادي");
          closeThinking();
          const fb = await input.fallback();
          if (fb.status === 402) throw new InsufficientLovableCreditsError();
          if (fb.ok && fb.body) { for await (const d of sseDeltas(fb)) emit(d); }
          else emit("حدث خطأ في الاتصال بنموذج الحل. حاول مرة أخرى.");
          return end();
        }
        const draft = stripThink(solved.text);
        bestAnswer = draft;
        step(`تم الحل الأولي (${solved.route.label})`);
        if (signal?.aborted) return end();

        // ابدأ المراجع المستقل بالتوازي مع صياغة Claude لتقليل زمن الانتظار.
        const visionRoutes = routesFor("vision");
        const imgs = imagesOf(lastUser(messages));

        // ---- طبقة التحقق (راجع server-ai/verify): المحقِّق من عائلة Gemini لأن المراجعة النهائية بـ GPT
        const vLevel = resolveVerifyLevel("panache", budget.complexity);
        const verifierLlm: LlmFn = async (r) => {
          try {
            const content = r.images?.length ? [...r.images, { type: "text", text: r.user }] : r.user;
            // القراءة الأولى كانت بـ Gemini، فتُعاد القراءة بمسار الحل (GPT) ليكون القارئ الثاني من عائلة مختلفة
            const routes = r.role === "reread" && solverRoutes.length ? solverRoutes : visionRoutes;
            const out = await chatOnce(routes, [{ role: "system", content: r.system }, { role: "user", content }], r.signal, r.maxTokens);
            return out?.text ?? null;
          } catch { return null; } // فشل المحقِّق = لم يُفحص، ولا يُفسد الإجابة
        };
        const verifyContext = (answer: string, independentSolution: string | null, level = vLevel) => ({
          subject: input.subject, mode: "panache", question: questionText, answer, images: imgs,
          sourceComplete: input.images.length === 0 || readingOk,
          transcript: readingTranscript,
          level, llm: level === "basic" || level === "off" ? null : verifierLlm, independentSolution, signal,
        });
        /** يتحقق من الإجابة المعروضة ويُلحق الحكم ثم ينهي البث (نبضات حياة أثناء الانتظار). */
        const finishWithVerdict = async (answer: string, independentSolution: string | null) => {
          if (vLevel === "off" || signal?.aborted || !answer.trim()) return end();
          const beat = setInterval(() => { try { controller.enqueue(enc.encode(": keep-alive\n\n")); } catch { /* مغلق */ } }, 8000);
          try {
            const verdict = await verifyAnswer({ ...verifyContext(answer, independentSolution), onProgress: (v) => emit(encodeVerification(v)) });
            if (!signal?.aborted) emit(encodeVerification(verdict));
          } catch (e) { if (!signal?.aborted) console.error("panache verification failed", e); }
          finally { clearInterval(beat); }
          end();
        };

        const indUser: any[] = [...imgs, { type: "text", text: `<exam_question>\n${questionText}\n</exam_question>\nSolve independently.` }];
        const independentPromise = runIndependent
          ? chatOnce(visionRoutes, [{ role: "system", content: REVIEWER_SYSTEM }, { role: "user", content: indUser }], signal, reviewBudget.maxOutputTokens)
          : Promise.resolve(null);
        // A credit error here is awaited only after the writer stage; without this the rejection
        // is reported as unhandled while the writer is still running.
        independentPromise.catch(() => {});

        // ---- 3) الصياغة (Claude)
        step(runWriter ? "3/5 صياغة الإجابة بأسلوب تلميذ متفوق…" : "3/5 لا حاجة لمرحلة صياغة إضافية؛ الحفاظ على الحل المباشر لتقليل التكلفة");
        const writerUser = `<exam_question>\n${questionText}\n</exam_question>\n\n<draft_solution>\n${draft}\n</draft_solution>`;
        let student = draft;
        const claude = runWriter ? await claudeOnce(input.systemPrompt + WRITER_SYSTEM_EXTRA, writerUser, signal, writerBudget.maxOutputTokens) : null;
        if (claude) { student = stripThink(claude.text); step(`تمت الصياغة بـ Claude (${claude.model})`); }
        else {
          const w = runWriter ? await chatOnce(solverRoutes, [
            { role: "system", content: input.systemPrompt + WRITER_SYSTEM_EXTRA },
            { role: "user", content: writerUser },
          ], signal, writerBudget.maxOutputTokens) : null;
          if (w) { student = stripThink(w.text); step(`Claude غير متاح (فشل الطلب في البوابة ولا يوجد مفتاح Anthropic)؛ صيغت الإجابة بـ ${w.route.label}`); }
          else step(runWriter ? "تعذرت الصياغة؛ سيُستعمل الحل الأولي" : "تم تجاوز الصياغة الإضافية لتقليل التكلفة");
        }
        bestAnswer = student;
        if (signal?.aborted) return end();

        // ---- 4) الحل المستقل (Gemini) + المدقق الحسابي
        step(runIndependent ? "4/5 حل مستقل بـ Gemini (دون رؤية الحل الأول) + تدقيق حسابي برمجي…" : "4/5 تدقيق حسابي برمجي؛ لا حاجة لاستدعاء نموذج مستقل لهذا السؤال");
        // تحقق مسبق على المسودة: الكود يعيد حساب المعادلات والمشتقات والنهايات، وما يثبته يُمرَّر للمراجع النهائي ليصحّحه
        const preCheckPromise = vLevel === "off" ? Promise.resolve(null) : verifyAnswer(verifyContext(student, null, vLevel === "basic" ? "basic" : "standard")).catch(() => null);
        const ind = await independentPromise;
        const pre = await preCheckPromise;
        const arith0 = arithmeticReport(`${student}\n\n${draft}`);
        const findings = pre ? codeFindingsForReviewer(pre) : "";
        const arith = findings ? `${arith0}\n\n${findings}` : arith0;
        const independent = ind ? stripThink(ind.text) : "(لم يُشغّل المراجع المستقل لتقليل التكلفة)";
        step(ind ? `تم الحل المستقل (${ind.route.label})` : runIndependent ? "تعذر الحل المستقل" : "تم تجاوز المراجعة المستقلة للسؤال المباشر");
        step(/أخطاء عددية/.test(arith) ? "المدقق الحسابي وجد أخطاء عددية وسيُصحَّح ما يلزم" : "المدقق الحسابي: لا أخطاء عددية صريحة");
        if (vLevel !== "off") step(findings ? "التحقق البرمجي (معادلات، مشتقات، نهايات…) وجد ما يحتاج مراجعة وسيُمرَّر للمراجع النهائي" : "التحقق البرمجي: لا أخطاء مثبتة في النتائج القابلة لإعادة الحساب");
        if (signal?.aborted) return end();

        // لا نطلب مراجعة LLM إضافية عندما يكون السؤال بسيطاً ولا تظهر مؤشرات خطأ.
        const needsFinalReview = runIndependent || /أخطاء عددية/.test(arith) || !!findings;
        if (!needsFinalReview) {
          step("تم اجتياز الفحوص الأولية؛ إصدار الحل دون استدعاء نموذج إضافي");
          closeThinking();
          emitA(student);
          return await finishWithVerdict(student, null);
        }

        // ---- 5) المراجعة النهائية (GPT Astra) — يُبث الجواب
        const finalRoutes = routesFor("final");
        step(`5/5 المراجعة النهائية بـ GPT${finalRoutes[0] ? ` (${finalRoutes[0].label})` : ""}…`);
        const finalMessages = appendToLastUser(messages, FINAL_TASK(student, independent, arith));
        let streamed = false;
        for (const r of finalRoutes) {
          try {
            const res = await fetch(r.chatUrl, {
              method: "POST",
              headers: { Authorization: `Bearer ${r.key}`, "Content-Type": "application/json" },
              body: body(r.model, finalMessages, true, finalBudget.maxOutputTokens),
              signal: withTimeout(signal, 240_000),
            });
            if (res.status === 402) throw new InsufficientLovableCreditsError();
            if (!res.ok || !res.body) { console.error("panache final", r.model, res.status); continue; }
            closeThinking();
            // نتجاهل أي كتلة thinking يكتبها النموذج بنفسه
            let head = ""; let decided = false; let skipping = false;
            for await (const d of sseDeltas(res)) {
              if (decided && !skipping) { emitA(d); continue; }
              head += d;
              if (!decided) {
                const t = head.trimStart();
                if (t.length < 10 && "<thinking>".startsWith(t)) continue;
                decided = true; skipping = t.startsWith("<thinking>");
                if (!skipping) { emitA(head); head = ""; continue; }
              }
              if (skipping) {
                const i = head.indexOf("</thinking>");
                if (i !== -1) { skipping = false; emitA(head.slice(i + 11).trimStart()); head = ""; }
              }
            }
            if (!decided || skipping) emitA(head.replace(/^\s*<thinking>/, "").trim());
            streamed = true;
            break;
          } catch (e) {
            if (signal?.aborted) return end();
            if (isInsufficientCredits(e)) throw e;
            console.error("panache final failed", r.model, e);
            // Part of the answer already reached the student: never append a second
            // full copy from another route. Say so, and finish with what was delivered.
            if (finalText.trim()) {
              emit("\n\n⚠️ تنبيه: انقطع بث المراجعة النهائية قبل اكتماله، فقد تكون نهاية الإجابة ناقصة.");
              streamed = true;
              break;
            }
          }
        }
        if (!streamed) {
          step("تعذرت المراجعة النهائية؛ عرض النسخة المصاغة");
          closeThinking();
          emitA(student);
        }
        await finishWithVerdict(finalText, ind ? independent : null);
      } catch (e) {
        if (!signal?.aborted) console.error("panache error", e);
        try {
          closeThinking();
          // ما أنتجته المراحل السابقة دُفعت تكلفته: إن لم يصل التلميذ أي جواب بعد، نسلّم أفضل نسخة كاملة
          // مع تنبيه صريح بأنها لم تُراجَع، بدل رميها وإظهار خطأ فقط.
          const deliverBest = (reason: string): boolean => {
            if (finalText.trim() || !bestAnswer.trim() || signal?.aborted) return false;
            emitA(bestAnswer);
            emit(`\n\n⚠️ تنبيه: ${reason} راجعها بنفسك قبل الاعتماد عليها.`);
            return true;
          };
          if (isInsufficientCredits(e)) {
            deliverBest("نفد الرصيد قبل المراجعة النهائية، فهذه النسخة المصاغة لم تُراجَع وقد تحتوي أخطاء.");
            controller.enqueue(enc.encode(`data: ${JSON.stringify({ error: { code: "INSUFFICIENT_CREDITS", message: "تعذر تنفيذ الطلب: رصيد Lovable AI غير كافٍ (402). أوقفنا بقية مراحل Pananachi ولم نُجرِ محاولات إضافية." } })}\n\n`));
          } else if (!deliverBest("وقع خطأ قبل اكتمال المراجعة النهائية، فهذه النسخة لم تُراجَع وقد تحتوي أخطاء.")) {
            emit("حدث خطأ غير متوقع أثناء معالجة الامتحان. حاول مرة أخرى.");
          }
        } catch { /* مغلق */ }
        end();
      }
    },
    cancel() { streamAbort.abort(new Error("Client cancelled stream")); },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Access-Control-Allow-Origin": "*", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" } });
}
