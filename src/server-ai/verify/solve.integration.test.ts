import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { splitThinking } from "../../lib/thinking";
import { handle } from "../solve";

const ENV = ["AI_API_KEY", "OPENAI_API_KEY", "LOVABLE_API_KEY", "VERIFY_LEVEL", "AI_BASE_URL"];
let saved: Record<string, string | undefined> = {};
let realFetch: typeof fetch;
let verifierCalls: { role: string; model: string }[] = [];

const sse = (parts: string[], finish = "stop") =>
  parts.map((p, i) => `data: ${JSON.stringify({ choices: [{ delta: { content: p }, ...(i === parts.length - 1 ? { finish_reason: finish } : {}) }] })}\n\n`).join("") + "data: [DONE]\n\n";

const roleOf = (system: string) =>
  system.includes("extract machine-checkable") ? "extract"
  : system.includes("independent exam solver") ? "solve"
  : system.includes("independent OCR engine") ? "reread"
  : system.includes("meticulous OCR") ? "transcribe"
  : system.includes("review the METHOD") ? "method"
  : "compare";

/** يحاكي المزوّد: الطلبات المتدفقة = جواب النموذج، وغير المتدفقة = المحقِّق. */
function mockProvider(answer: string[], verifierReply: (system: string) => string | null, finish = "stop") {
  (globalThis as any).fetch = async (_url: string, init: any) => {
    const body = JSON.parse(init.body);
    if (body.stream) return new Response(sse(answer, finish), { status: 200, headers: { "Content-Type": "text/event-stream" } });
    const system = body.messages[0].content as string;
    verifierCalls.push({ role: roleOf(system), model: body.model });
    const reply = verifierReply(system);
    return reply === null ? new Response("x", { status: 500 }) : new Response(JSON.stringify({ choices: [{ message: { content: reply } }] }), { status: 200 });
  };
}

async function ask(subject: string, modelMode: string, content = "حل المعادلة x^2-4x+3=0", imageBase64?: string) {
  const res = await handle(new Request("http://x/api/solve", { method: "POST", body: JSON.stringify({ subject, modelMode, messages: [{ role: "user", content, ...(imageBase64 ? { imageBase64s: [imageBase64] } : {}) }] }) }));
  const text = await res.text();
  const content_ = [...text.matchAll(/^data: (.*)$/gm)].map((m) => m[1]).filter((d) => d !== "[DONE]").map((d) => JSON.parse(d)?.choices?.[0]?.delta?.content ?? "").join("");
  return { status: res.status, raw: text, ...splitThinking(content_) };
}

beforeEach(() => {
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  for (const k of ENV) delete process.env[k];
  process.env["AI_API_KEY"] = "test-key";
  verifierCalls = [];
  realFetch = globalThis.fetch;
});
afterEach(() => {
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  (globalThis as any).fetch = realFetch;
});

const WRONG = ["<thinking>\n- معادلة\n</thinking>\n", "نحل المعادلة: $x^2 - 4x + 3 = 0$ ", "فنجد $x = 1$ أو $x = 4$ وهي مجموعة الحلول كاملة."];
const claims = JSON.stringify({ claims: [{ type: "equation", q: "1", lhs: "x^2-4*x+3", rhs: "0", variable: "x", solutions: ["1", "4"], quote: "x = 1$ أو $x = 4" }] });

describe("solve + verification (تكامل)", () => {
  it("accurate: الإجابة كما بثّها النموذج، والكود يثبت أن x=4 ليس جذراً", async () => {
    mockProvider(WRONG, () => claims);
    const r = await ask("math", "accurate");
    expect(r.status).toBe(200);
    expect(r.answer).toBe("نحل المعادلة: $x^2 - 4x + 3 = 0$ فنجد $x = 1$ أو $x = 4$ وهي مجموعة الحلول كاملة.");
    expect(r.verification?.state).toBe("done");
    expect(r.verification?.level).toBe("error");
    const issue = r.verification!.issues.find((i) => i.kind === "claim_equation")!;
    expect(issue.source).toBe("code");
    expect(issue.ar).toContain("x = 4");
    expect(verifierCalls.map((c) => c.role)).toEqual(["extract"]);
    expect(r.raw.trimEnd().endsWith("data: [DONE]")).toBe(true);
  });

  it("fast: فحوص برمجية فقط ولا استدعاء لأي نموذج محقِّق", async () => {
    mockProvider(["نحسب: $2 \\times 4 = 9$ إذن القيمة هي تسعة وهذا جواب خاطئ حسابياً."], () => claims);
    const r = await ask("physics", "fast");
    expect(verifierCalls).toHaveLength(0);
    expect(r.verification?.level).toBe("error");
    expect(r.verification?.issues[0].kind).toBe("arithmetic");
  });

  it("المحقِّق معطَّل أو متعطل: الإجابة سليمة والحكم لا يتهمها", async () => {
    mockProvider(["فنجد $x = 1$ أو $x = 3$ وهما حلا المعادلة الأولى كما هو مطلوب في التمرين."], () => null);
    const r = await ask("math", "accurate");
    expect(r.answer).toContain("x = 1");
    expect(r.verification?.issues.filter((i) => i.severity === "error")).toHaveLength(0);
    expect(r.raw.trimEnd().endsWith("data: [DONE]")).toBe(true);
  });

  it("VERIFY_LEVEL=off: لا كتلة تحقق إطلاقاً", async () => {
    process.env["VERIFY_LEVEL"] = "off";
    mockProvider(WRONG, () => claims);
    const r = await ask("math", "accurate");
    expect(r.verification).toBeNull();
    expect(r.raw).not.toContain("verification");
    expect(verifierCalls).toHaveLength(0);
  });

  it("إجابة مقطوعة (finish_reason=length) تُعلَن خطأً صريحاً", async () => {
    mockProvider(["بداية جواب طويل يتحدث عن المعادلة ثم ينقطع فجأة قبل أن يكتمل ويصل إلى النتيجة"], () => null, "length");
    const r = await ask("math", "fast");
    expect(r.verification?.issues.some((i) => i.kind === "truncated" && i.severity === "error")).toBe(true);
  });

  it("تحية قصيرة: لا شارة", async () => {
    mockProvider(["مرحباً بك! كيف أساعدك اليوم؟"], () => claims);
    const r = await ask("math", "accurate", "مرحبا");
    expect(r.verification?.level).toBe("unchecked");
    expect(verifierCalls).toHaveLength(0);
  });

  it("strict (advanced + تعقيد): يحل بنموذج مستقل ثم يقارن", async () => {
    process.env["VERIFY_LEVEL"] = "strict";
    mockProvider(
      ["فنجد $x = 1$ أو $x = 3$ حسب ما هو مطلوب في السؤال الأول من التمرين المعروض."],
      (system) => system.includes("independent exam solver") ? "x=1 or x=3"
        : roleOf(system) === "compare" ? JSON.stringify({ results: [{ q: "1", status: "agree" }] })
        : roleOf(system) === "method" ? JSON.stringify({ notes: [] })
        : JSON.stringify({ claims: [] }),
    );
    const r = await ask("math", "advanced");
    expect(verifierCalls.map((c) => c.role).sort()).toEqual(["compare", "extract", "solve"]); // الإجابة قصيرة فلا تُفحص مطابقة المنهج
    expect(r.verification?.checks.find((c) => c.id === "independent")?.status).toBe("pass");
    expect(r.verification?.level).toBe("verified");
  });
});

describe("solve + قراءة الصورة (تكامل)", () => {
  const SHEET = (n: string) => `## Texte\n1) Soit $f(x) = \\frac{1}{3}x^{2} + ${n}$ sur $[0 ; 4]$.\n2) On donne $m = 5 \\mathrm{mL}$ et $x \\leq 3$.\n\n## Figures\nRien\n\n## Lisibilité\nREADABILITY: ok`;
  const ANSWER = ["1) On trouve $x = 1$ ou $x = 3$ comme solutions de l'équation donnée dans l'énoncé de ce premier exercice.", "\n\n2) La suite est alors immédiate."];

  it("accurate + صورة: قراءة ثانية مستقلة تكشف رقماً قُرئ بشكلين، دون المساس بالإجابة", async () => {
    let transcribed = 0;
    mockProvider(ANSWER, (system) => {
      const role = roleOf(system);
      if (role === "transcribe") { transcribed++; return SHEET("15"); }
      if (role === "reread") return SHEET("16");
      return JSON.stringify({ claims: [] });
    });
    const r = await ask("math", "accurate", "حل التمرين", "AAAA");
    expect(transcribed).toBe(1);
    expect(r.answer).toContain("1) On trouve $x = 1$");
    const issue = r.verification?.issues.find((i) => i.kind === "reading_numbers");
    expect(issue?.source).toBe("reading");
    expect(issue?.ar).toContain("15");
    expect(issue?.ar).toContain("16");
    expect(verifierCalls.map((c) => c.role)).toEqual(expect.arrayContaining(["transcribe", "reread", "extract"]));
    expect(r.raw.trimEnd().endsWith("data: [DONE]")).toBe(true);
  });

  it("fast + صورة: لا قراءة ثانية، وتُعلَن «تعذر التحقق» من قراءة الصورة", async () => {
    mockProvider(ANSWER, () => null);
    const r = await ask("french", "fast", "حل التمرين", "AAAA");
    expect(verifierCalls).toHaveLength(0);
    expect(r.verification?.unverified.some((u) => u.ar.includes("قراءة الصورة"))).toBe(true);
  });

  it("فشل القراءة الثانية: لا اتهام، بل تعذر التحقق", async () => {
    mockProvider(ANSWER, (system) => (roleOf(system) === "transcribe" ? SHEET("15") : roleOf(system) === "reread" ? null : JSON.stringify({ claims: [] })));
    const r = await ask("math", "accurate", "حل التمرين", "AAAA");
    expect(r.verification?.issues.filter((i) => i.source === "reading")).toHaveLength(0);
    expect(r.verification?.checks.find((c) => c.id === "reading")?.status).toBe("skip");
    expect(r.verification?.unverified.length).toBeGreaterThan(0);
  });
});
