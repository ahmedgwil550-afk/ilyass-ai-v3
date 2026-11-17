import { describe, expect, it } from "vitest";
import { COMPARE_SYSTEM, EXTRACT_SYSTEM, INDEPENDENT_SOLVER_SYSTEM, METHOD_SYSTEM, REREAD_SYSTEM, methodRubric } from "./prompts";
import { parseJsonLoose, sanitizeClaims, sanitizeComparison, sanitizeMethodNotes, type LlmFn, type LlmRequest } from "./llm";
import { buildVerdict, codeFindingsForReviewer, resolveVerifyLevel, stripThinkBlock, verifyAnswer } from "./pipeline";

/** نموذج وهمي: يردّ حسب الدور ويسجّل الاستدعاءات. */
function fakeLlm(replies: Partial<Record<LlmRequest["role"], string | null | Error>>) {
  const calls: LlmRequest[] = [];
  const llm: LlmFn = async (req) => {
    calls.push(req);
    const r = replies[req.role];
    if (r instanceof Error) throw r;
    return r === undefined ? null : r;
  };
  return { llm, calls };
}

const ANSWER = "نشتق: $f(x) = x e^{x}$ إذن $f'(x) = x e^{x}$ ثم نحل $x^2 - 4x + 3 = 0$ فنجد $x = 1$ أو $x = 4$.";
const claimsJson = (claims: unknown[]) => JSON.stringify({ claims });
/** جواب نصي طويل بما يكفي ليُفحص (أطول من حدّ الرد القصير) */
const LONG = "هذه إجابة نصية طويلة نسبياً تتضمن شرحاً كافياً لتتجاوز حد الرد القصير الذي لا يُفحص أصلاً.";

describe("prompts", () => {
  it("آمنة داخل قوالب النص: لا backtick ولا ${ ولا شرطة مائلة عكسية", () => {
    const rubrics = ["math", "physics", "chemistry", "biology", "arabic", "french", "english", "philosophy", "history", "islamic", "other"].map(methodRubric);
    for (const p of [EXTRACT_SYSTEM, INDEPENDENT_SOLVER_SYSTEM, COMPARE_SYSTEM, REREAD_SYSTEM, METHOD_SYSTEM, ...rubrics]) {
      expect(p).not.toContain("`");
      expect(p).not.toContain("${");
      expect(p).not.toContain("\\");
    }
  });
});

describe("resolveVerifyLevel", () => {
  it("حسب الوضع", () => {
    expect(resolveVerifyLevel("fast", 0, undefined)).toBe("basic");
    expect(resolveVerifyLevel("accurate", 5, undefined)).toBe("standard");
    expect(resolveVerifyLevel("advanced", 1, undefined)).toBe("standard");
    expect(resolveVerifyLevel("advanced", 4, undefined)).toBe("strict");
    expect(resolveVerifyLevel("panache", 0, undefined)).toBe("strict");
    expect(resolveVerifyLevel("???", 0, undefined)).toBe("standard");
  });
  it("المتغير يفرض مستوى واحداً", () => {
    expect(resolveVerifyLevel("panache", 6, "off")).toBe("off");
    expect(resolveVerifyLevel("fast", 0, "STRICT")).toBe("strict");
    expect(resolveVerifyLevel("fast", 0, "garbage")).toBe("basic");
  });
});

describe("llm helpers", () => {
  it("parseJsonLoose يتحمل السياج والكلام الزائد", () => {
    expect(parseJsonLoose('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonLoose('تفضل: {"a":2} شكراً')).toEqual({ a: 2 });
    expect(parseJsonLoose("لا json هنا")).toBeNull();
  });
  it("sanitizeClaims يحذف الادعاء الذي اقتباسه ليس في الإجابة", () => {
    const { claims, discarded } = sanitizeClaims({
      claims: [
        { type: "derivative", f: "x*exp(x)", df: "x*exp(x)", variable: "x", quote: "f'(x) = x e^{x}" },
        { type: "derivative", f: "x^2", df: "3*x", variable: "x", quote: "f'(x) = 3x" },
        { type: "value", expr: "1+1", value: "2", quote: "" },
        { type: "wizard", quote: "x = 1" },
        { type: "equation", lhs: "x", rhs: "1", variable: "xx", solutions: ["1"], quote: "x = 1" },
      ],
    }, ANSWER);
    expect(claims).toHaveLength(1);
    expect(discarded).toBe(4);
  });
  it("يحوّل الأرقام إلى نصوص ويقيّد الأنواع", () => {
    const { claims } = sanitizeClaims({ claims: [{ type: "equation", lhs: "x-1", rhs: 0, variable: "x", solutions: [1], quote: "x = 1", q: "2-1" }] }, ANSWER);
    expect(claims[0]).toMatchObject({ type: "equation", rhs: "0", solutions: ["1"], q: "2-1" });
  });
  it("sanitizeComparison يتجاهل الحالات الغريبة", () => {
    const r = sanitizeComparison({ results: [{ q: "1", status: "agree" }, { status: "maybe" }, { q: "2", status: "disagree", answer_value: "3", independent_value: "4" }] });
    expect(r.map((x) => x.status)).toEqual(["agree", "disagree"]);
  });
});

describe("verifyAnswer", () => {
  it("basic: لا يستدعي أي نموذج", async () => {
    const { llm, calls } = fakeLlm({});
    const v = await verifyAnswer({ subject: "math", question: "", answer: ANSWER, level: "basic", llm });
    expect(calls).toHaveLength(0);
    expect(v.state).toBe("done");
  });

  it("standard: مشتقة خاطئة وجذر خاطئ يحسمهما الكود، والادعاء المختلَق يسقط", async () => {
    const { llm, calls } = fakeLlm({
      extract: claimsJson([
        { type: "derivative", q: "1", f: "x*exp(x)", df: "x*exp(x)", variable: "x", quote: "f'(x) = x e^{x}" },
        { type: "equation", q: "2", lhs: "x^2-4*x+3", rhs: "0", variable: "x", solutions: ["1", "4"], quote: "x = 1$ أو $x = 4" },
        { type: "derivative", f: "x^2", df: "5*x", variable: "x", quote: "هذا غير موجود في الجواب" },
      ]),
    });
    const v = await verifyAnswer({ subject: "math", question: "Étudier f", answer: ANSWER, level: "standard", llm });
    expect(calls.map((c) => c.role)).toEqual(["extract"]);
    expect(v.level).toBe("error");
    const kinds = v.issues.map((i) => i.kind);
    expect(kinds).toContain("claim_derivative");
    expect(kinds).toContain("claim_equation");
    expect(v.issues.filter((i) => i.kind.startsWith("claim_")).every((i) => i.source === "code" && i.severity === "error")).toBe(true);
    expect(v.checks.find((c) => c.id === "claims")?.status).toBe("fail");
  });

  it("ادعاءات صحيحة تعطي verified وعدّاً حقيقياً", async () => {
    const good = "لدينا $f(x) = x e^{x}$ و $f'(x) = (x+1) e^{x}$ وحلا المعادلة $x = 1$ و $x = 3$.";
    const { llm } = fakeLlm({
      extract: claimsJson([
        { type: "derivative", f: "x*exp(x)", df: "(x+1)*exp(x)", variable: "x", quote: "f'(x) = (x+1) e^{x}" },
        { type: "equation", lhs: "x^2-4*x+3", rhs: "0", variable: "x", solutions: ["1", "3"], quote: "x = 1$ و $x = 3" },
      ]),
    });
    const v = await verifyAnswer({ subject: "math", question: "", answer: good, level: "standard", llm });
    expect(v.level).toBe("verified");
    expect(v.verifiedCount).toBe(2);
    expect(v.issues).toHaveLength(0);
  });

  it("فشل النموذج أو رده التالف = لم يُفحص، لا خطأ في الإجابة", async () => {
    for (const reply of [null, "ليس json", new Error("boom"), claimsJson([])]) {
      const { llm } = fakeLlm({ extract: reply as any });
      const v = await verifyAnswer({ subject: "math", question: "", answer: "إذن $x = 2$ هو الحل.", level: "standard", llm });
      expect(v.level).not.toBe("error");
      expect(v.issues.filter((i) => i.severity === "error")).toHaveLength(0);
      expect(v.state).toBe("done");
    }
  });

  it("مواد النصوص لا تُستخرج منها ادعاءات رياضية", async () => {
    const { llm, calls } = fakeLlm({ extract: claimsJson([]) });
    await verifyAnswer({ subject: "french", question: "", answer: "Le narrateur écrit $x$ ici.", level: "standard", llm });
    expect(calls).toHaveLength(0);
  });

  it("strict: يقارن مع حل مستقل جاهز دون إعادة حلّه", async () => {
    const { llm, calls } = fakeLlm({
      compare: JSON.stringify({ results: [
        { q: "1", status: "agree" },
        { q: "2", status: "disagree", answer_value: "x=4", independent_value: "x=3", note: "الجذر الثاني" },
        { q: "3", status: "unsure" },
      ] }),
    });
    const v = await verifyAnswer({ subject: "math", question: "Q", answer: LONG, level: "strict", llm, independentSolution: "1) ... 2) x=3" });
    expect(calls.map((c) => c.role)).toEqual(["compare"]);
    const i = v.issues.find((x) => x.kind === "independent")!;
    expect(i.severity).toBe("warn");
    expect(i.source).toBe("model");
    expect(i.ar).toContain("السؤال 2");
    expect(v.level).toBe("warning");
    expect(v.verifiedCount).toBe(1);
  });

  it("strict: يحل بنموذج مستقل أولاً عند غياب الحل الجاهز، ويمرّر الصور", async () => {
    const { llm, calls } = fakeLlm({ solve: "x = 3", compare: JSON.stringify({ results: [{ q: "1", status: "agree" }] }) });
    const images = [{ type: "image_url", image_url: { url: "data:image/jpeg;base64,AAAA" } }];
    const v = await verifyAnswer({ subject: "math", question: "", answer: "الجواب x = 3 مباشرة.", level: "strict", llm, images });
    expect(calls.map((c) => c.role)).toEqual(["solve", "compare"]);
    expect(calls[0].images).toBe(images);
    expect(v.level).toBe("verified");
  });

  it("strict بلا سؤال ولا صورة: لا حل مستقل", async () => {
    const { llm, calls } = fakeLlm({ solve: "x" });
    await verifyAnswer({ subject: "math", question: "  ", answer: "جواب", level: "strict", llm });
    expect(calls).toHaveLength(0);
  });

  it("يرسل تقدّماً running قبل النهاية، ويزيل كتلة thinking قبل الفحص", async () => {
    const { llm } = fakeLlm({ extract: claimsJson([]) });
    const seen: string[] = [];
    const v = await verifyAnswer({ subject: "math", question: "", answer: "<thinking>- خطة $$ مفتوحة</thinking>\nالجواب $x=1$.", level: "standard", llm, onProgress: (p) => seen.push(p.state) });
    expect(seen).toEqual(["running"]);
    expect(v.issues.map((i) => i.kind)).not.toContain("truncated");
  });

  it("تحية أو ردّ قصير: لا فحص ولا شارة", async () => {
    const { llm, calls } = fakeLlm({ extract: claimsJson([]) });
    const v = await verifyAnswer({ subject: "math", question: "", answer: "مرحباً! كيف أساعدك؟", level: "strict", llm });
    expect(v.level).toBe("unchecked");
    expect(v.checks).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  it("finish_reason=length يظهر خطأً صريحاً", async () => {
    const v = await verifyAnswer({ subject: "math", question: "", answer: "بداية الجواب", finishReason: "length", level: "basic" });
    expect(v.level).toBe("error");
  });
});

describe("buildVerdict / codeFindingsForReviewer", () => {
  it("المستويات", () => {
    const pass = [{ id: "arithmetic", status: "pass" as const, ar: "", fr: "" }];
    expect(buildVerdict("done", [], [], 0).level).toBe("unchecked");
    expect(buildVerdict("done", [{ id: "complete", status: "pass", ar: "", fr: "" }], [], 0).level).toBe("unchecked");
    expect(buildVerdict("done", pass, [], 0).level).toBe("checked");
    expect(buildVerdict("done", pass, [], 2).level).toBe("verified");
    expect(buildVerdict("done", pass, [{ severity: "info", kind: "k", ar: "", fr: "", source: "static" }], 2).level).toBe("verified");
    expect(buildVerdict("done", pass, [{ severity: "warn", kind: "k", ar: "", fr: "", source: "static" }], 2).level).toBe("warning");
    expect(buildVerdict("done", pass, [{ severity: "error", kind: "k", ar: "", fr: "", source: "code" }], 2).level).toBe("error");
  });
  it("يرتّب الأخطر أولاً ويقصّ القائمة", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ severity: (i === 11 ? "error" : "info") as "error" | "info", kind: `k${i}`, ar: "", fr: "", source: "static" as const }));
    const v = buildVerdict("done", [], many, 0);
    expect(v.issues).toHaveLength(8);
    expect(v.issues[0].kind).toBe("k11");
  });
  it("تقرير المراجع يضم ما أثبته الكود فقط", () => {
    const v = buildVerdict("done", [], [
      { severity: "error", kind: "claim_value", q: "2", ar: "القيمة خاطئة", fr: "", source: "code", evidence: "a = 3" },
      { severity: "warn", kind: "independent", ar: "اختلاف نموذجين", fr: "", source: "model" },
    ], 0);
    const r = codeFindingsForReviewer(v);
    expect(r).toContain("[السؤال 2] القيمة خاطئة");
    expect(r).toContain("a = 3");
    expect(r).not.toContain("اختلاف نموذجين");
    expect(codeFindingsForReviewer(buildVerdict("done", [], [], 0))).toBe("");
  });
  it("stripThinkBlock", () => {
    expect(stripThinkBlock("<thinking>خطة</thinking>\nالجواب")).toBe("الجواب");
    expect(stripThinkBlock("<thinking>لم تُغلق")).toBe("");
    expect(stripThinkBlock("بلا كتلة")).toBe("بلا كتلة");
  });
});

/* ------------------------------------------------------------------ */
/* الطبقات الخمس: قراءة الصورة، التحقق من الحل، تحديد الخطأ، الاكتمال، المنهج + «تعذر التحقق» */
/* ------------------------------------------------------------------ */
const IMG = [{ type: "image_url", image_url: { url: "data:image/jpeg;base64,AAAA" } }];
const sheet = (body: string, tail = "READABILITY: ok") => `## Texte\n${body}\n\n## Figures\nRien\n\n## Lisibilité\n${tail}`;
const EXAM = "1) Soit $f(x) = \\frac{1}{3}x^{2} + 15$ sur $[0 ; 4]$.\n2) On donne $m = 5 \\mathrm{mL}$ et $x \\leq 3$.";
const FR_ANSWER = "Voici la réponse détaillée du sujet avec assez de mots pour dépasser le seuil de la réponse courte et être examinée par le vérificateur.";

describe("قراءة الصورة", () => {
  it("مجاناً في basic: شكل غائب أو رموز غير مقروءة تظهر تنبيهاً و«تعذر التحقق»، بلا أي نموذج", async () => {
    const { llm, calls } = fakeLlm({});
    const t = sheet("1) Soit $f(x)=3[?]x$", "READABILITY: partial\nFIGURE_MISSING: la courbe de la question 2");
    const v = await verifyAnswer({ subject: "french", question: t, answer: FR_ANSWER, images: IMG, transcript: t, level: "basic", llm });
    expect(calls).toHaveLength(0);
    expect(v.issues.map((i) => i.kind)).toEqual(expect.arrayContaining(["reading_figure", "reading_illegible"]));
    expect(v.issues.every((i) => i.source === "static" || i.source === "reading")).toBe(true);
    expect(v.unverified.length).toBe(2);
    expect(v.level).toBe("warning");
  });

  it("صورة بلا قراءة نصية (الوضع السريع): تُعلَن غير مفحوصة بدل السكوت", async () => {
    const v = await verifyAnswer({ subject: "french", question: "", answer: FR_ANSWER, images: IMG, level: "basic" });
    expect(v.level).toBe("unchecked");
    expect(v.unverified).toHaveLength(1);
    expect(v.unverified[0].ar).toContain("قراءة الصورة");
  });

  it("standard: قراءتان مختلفتان في رقم = ملاحظة محددة بالقيمتين", async () => {
    const first = sheet(EXAM);
    const { llm, calls } = fakeLlm({ reread: sheet(EXAM.replace("15", "16")) });
    const v = await verifyAnswer({ subject: "french", question: first, answer: FR_ANSWER, images: IMG, transcript: first, level: "standard", llm });
    expect(calls.map((c) => c.role)).toEqual(["reread"]);
    expect(calls[0].images).toBe(IMG);
    const i = v.issues.find((x) => x.kind === "reading_numbers")!;
    expect(i.severity).toBe("warn");
    expect(i.source).toBe("reading");
    expect(i.ar).toContain("15");
    expect(i.ar).toContain("16");
    expect(v.checks.find((c) => c.id === "reading")?.status).toBe("warn");
    expect(v.verifiedCount).toBe(0); // اتفاق قراءتين لا يُحسب "تحققاً من الإجابة"
  });

  it("قراءتان متطابقتان: فحص ناجح بلا ملاحظات", async () => {
    const first = sheet(EXAM);
    const { llm } = fakeLlm({ reread: sheet(EXAM) });
    const v = await verifyAnswer({ subject: "french", question: first, answer: FR_ANSWER, images: IMG, transcript: first, level: "standard", llm });
    expect(v.issues.filter((i) => i.source === "reading")).toHaveLength(0);
    expect(v.checks.find((c) => c.id === "reading")?.status).toBe("pass");
    expect(v.unverified).toHaveLength(0);
  });

  it("فشل القراءة الثانية أو تباعدها الشديد = تعذر التحقق، لا اتهام", async () => {
    const first = sheet(EXAM);
    for (const reply of [null, new Error("boom"), "قصير", sheet("Autre 1) $g(x) = 7x + 91$ sur $[2 ; 8]$ avec $a = 31$, $b = 44$, $c = 57$, $d = 68$, $e = 12$.")]) {
      const { llm } = fakeLlm({ reread: reply as any });
      const v = await verifyAnswer({ subject: "french", question: first, answer: FR_ANSWER, images: IMG, transcript: first, level: "standard", llm });
      expect(v.issues.filter((i) => i.source === "reading")).toHaveLength(0);
      expect(v.checks.find((c) => c.id === "reading")?.status).toBe("skip");
      expect(v.unverified.length).toBeGreaterThan(0);
    }
  });

  it("بلا صور لا إعادة قراءة", async () => {
    const { llm, calls } = fakeLlm({ reread: sheet(EXAM) });
    await verifyAnswer({ subject: "french", question: EXAM, answer: FR_ANSWER, transcript: sheet(EXAM), level: "strict", llm });
    expect(calls.map((c) => c.role)).not.toContain("reread");
  });
});

describe("تحديد الخطأ بدقة", () => {
  it("الادعاء الخاطئ يحمل موضعه والقيمة الصحيحة", async () => {
    const { llm } = fakeLlm({ extract: claimsJson([{ type: "derivative", f: "x^3", df: "2*x^2", variable: "x", quote: "f'(x) = 2x^2", q: "1" }]) });
    const v = await verifyAnswer({ subject: "math", question: "", answer: "نعلم أن $f(x) = x^3$ إذن $f'(x) = 2x^2$ وهذا هو الحل.", level: "standard", llm });
    const i = v.issues.find((x) => x.kind === "claim_derivative")!;
    expect(i.severity).toBe("error");
    expect(i.where).toBe("f'(x) = 2x^2");
    expect(i.expected).toBeTruthy();
    expect(i.q).toBe("1");
  });

  it("الخطأ الحسابي الصرف يحمل موضعه", async () => {
    const v = await verifyAnswer({ subject: "physics", question: "", answer: "إذن $3 \\times 5 = 16$ ويكتمل الجواب بعد هذا السطر القصير.", level: "basic" });
    const i = v.issues.find((x) => x.kind === "arithmetic")!;
    expect(i.where).toContain("16");
  });

  it("الاختلاف مع حل مستقل: answer_quote لا يُحفظ إلا إن وُجد حرفياً، والصواب المتوقع من الحل المستقل", async () => {
    const answer = "الجواب النهائي: x = 4 بعد المعالجة الكاملة للمعادلة المعطاة في السؤال الثاني.";
    for (const [quote, expectWhere] of [["x = 4 بعد", true], ["x = 9 مختلق", false]] as const) {
      const { llm } = fakeLlm({ compare: JSON.stringify({ results: [{ q: "2", status: "disagree", answer_value: "4", independent_value: "3", answer_quote: quote }] }) });
      const v = await verifyAnswer({ subject: "math", question: "Q", answer, level: "strict", llm, independentSolution: "x=3" });
      const i = v.issues.find((x) => x.kind === "independent")!;
      expect(i.expected).toBe("3");
      expect(i.where !== undefined).toBe(expectWhere);
    }
  });
});

describe("اكتمال الإجابة (الفروع)", () => {
  const question = "1) Calculer :\n a) la limite\n b) la dérivée\n2) Résoudre\n3) Conclure";
  const answer = "1) a) la limite vaut 2 et on le montre en détail.\n b) la dérivée est 3x ce qui conclut cette partie.\n\n2) x vaut 1 après résolution complète.\n\n3) donc la conclusion est faite proprement.";

  it("فرع تخطّته الإجابة داخل سؤال عولج بترقيم فروع = تحذير ثابت بالكود (بلا نموذج)", async () => {
    const v = await verifyAnswer({ subject: "math", question, answer: answer.replace(/ b\) la dérivée est 3x ce qui conclut cette partie\.\n/, ""), level: "basic" });
    const i = v.issues.find((x) => x.kind === "coverage")!;
    expect(i.severity).toBe("warn");
    expect(i.ar).toContain("1-b");
  });

  it("الحل المستقل يقول «غائب» لسؤال موجود في الامتحان وغائب عن الإجابة: تحذير مؤكَّد بالكود", async () => {
    const q2 = "1) Calculer a.\n2) Calculer b.";
    const { llm } = fakeLlm({ compare: JSON.stringify({ results: [{ q: "2", status: "missing", independent_value: "b=4" }] }) });
    const v = await verifyAnswer({ subject: "math", question: q2, answer: "1) a vaut 2, voici le détail complet de ce calcul demandé.", level: "strict", llm, independentSolution: "1) a=2 2) b=4" });
    const i = v.issues.find((x) => x.kind === "incomplete")!;
    expect(i.severity).toBe("warn");
    expect(i.q).toBe("2");
    expect(i.expected).toBe("b=4");
    expect(v.checks.find((c) => c.id === "independent")?.status).toBe("warn");
  });

  it("«غائب» عن سؤال لا نعرفه من الامتحان = ملاحظة خفيفة فقط، وبلا تكرار لما ذكره الفحص الشكلي", async () => {
    const q4 = "1) a\n2) b\n3) c\n4) d";
    const { llm } = fakeLlm({ compare: JSON.stringify({ results: [
      { q: "4", status: "missing" }, // ذكره الفحص الشكلي أصلاً
      { q: "7", status: "missing" }, // ليس في الامتحان
    ] }) });
    const v = await verifyAnswer({ subject: "math", question: q4, answer: "1) a est fait avec le détail\n\n2) b est fait avec le détail\n\n3) c est fait avec le détail", level: "strict", llm, independentSolution: "..." });
    const inc = v.issues.filter((x) => x.kind === "incomplete");
    expect(inc).toHaveLength(1);
    expect(inc[0].q).toBe("7");
    expect(inc[0].severity).toBe("info");
  });

  it("النموذج يدّعي غياب سؤال موجود فعلاً في الإجابة (حتى بفروعه): يُهمَل", async () => {
    const { llm } = fakeLlm({ compare: JSON.stringify({ results: [{ q: "1", status: "missing" }, { q: "1-a", status: "missing" }, { status: "missing" }] }) });
    const v = await verifyAnswer({ subject: "math", question, answer, level: "strict", llm, independentSolution: "..." });
    expect(v.issues.filter((x) => x.kind === "incomplete")).toHaveLength(0);
  });

  it("sanitizeComparison: missing بلا رقم سؤال مرفوض، وquote مختلق يُسقط من الحقل فقط", () => {
    const r = sanitizeComparison({ results: [{ status: "missing" }, { q: "1", status: "disagree", answer_quote: "غير موجود" }] }, "نص الإجابة");
    expect(r).toHaveLength(1);
    expect(r[0].answerQuote).toBeUndefined();
  });
});

describe("مطابقة المنهج", () => {
  const ans = "نستعمل مباشرة قاعدة لوبيتال هنا لحساب النهاية $\\lim_{x\\to 0}\\frac{\\sin x}{x} = 1$ دون أي تبرير آخر ثم نكتب النتيجة النهائية كاملة في آخر السطر، وبعد ذلك نضيف سطراً آخر يشرح باختصار لماذا كانت النتيجة مقبولة عندنا في هذا الحل المطوّل نسبياً.";
  const notes = (n: unknown[]) => JSON.stringify({ notes: n });

  it("ملاحظة عالية الثقة بمقطع حرفي تظهر تحذيراً مصدره «method»", async () => {
    const { llm, calls } = fakeLlm({ method: notes([{ q: "1", kind: "out_of_program", quote: "قاعدة لوبيتال هنا", note: "استعمل النهاية الشهيرة بدلها", confidence: "high" }]) });
    const v = await verifyAnswer({ subject: "math", question: "Q", answer: ans, level: "strict", llm, independentSolution: "x" });
    expect(calls.map((c) => c.role)).toContain("method");
    expect(calls.find((c) => c.role === "method")!.user).toContain("Moroccan 2BAC mathematics");
    const i = v.issues.find((x) => x.kind === "method_out_of_program")!;
    expect(i.source).toBe("method");
    expect(i.severity).toBe("warn");
    expect(i.where).toBe("قاعدة لوبيتال هنا");
    expect(i.ar).toContain("قد يخطئ");
    expect(v.checks.find((c) => c.id === "method")?.status).toBe("warn");
  });

  it("متوسطة الثقة تبقى اقتراحاً (info) والبنية دائماً info", async () => {
    const { llm } = fakeLlm({ method: notes([
      { kind: "missing_justification", quote: "دون أي تبرير آخر", note: "اذكر النهاية الشهيرة", confidence: "medium" },
      { kind: "structure", quote: "ثم نكتب النتيجة النهائية", note: "أضف جملة ختامية", confidence: "high" },
    ]) });
    const v = await verifyAnswer({ subject: "math", question: "Q", answer: ans, level: "strict", llm, independentSolution: "x" });
    expect(v.issues.filter((i) => i.source === "method").map((i) => i.severity)).toEqual(["info", "info"]);
    expect(v.level).not.toBe("warning");
  });

  it("sanitizeMethodNotes: اقتباس مختلق أو ثقة منخفضة أو نوع غريب = يُسقَط", () => {
    const r = sanitizeMethodNotes({ notes: [
      { kind: "out_of_program", quote: "عبارة غير موجودة أبداً", note: "x", confidence: "high" },
      { kind: "out_of_program", quote: "قاعدة لوبيتال هنا", note: "x", confidence: "low" },
      { kind: "style", quote: "قاعدة لوبيتال هنا", note: "x", confidence: "high" },
      { kind: "structure", quote: "قاعدة لوبيتال هنا", note: "x", confidence: "high" },
    ] }, ans);
    expect(r).toHaveLength(1);
    expect(r[0].kind).toBe("structure");
  });

  it("لا يعمل في standard ولا مع إجابة قصيرة", async () => {
    const a = fakeLlm({ extract: claimsJson([]), method: notes([]) });
    await verifyAnswer({ subject: "math", question: "Q", answer: ans, level: "standard", llm: a.llm });
    expect(a.calls.map((c) => c.role)).not.toContain("method");
    const b = fakeLlm({ method: notes([]) });
    await verifyAnswer({ subject: "math", question: "Q", answer: "إذن $x = 2$ هو الحل بكل بساطة.", level: "strict", llm: b.llm, independentSolution: "x=2" });
    expect(b.calls.map((c) => c.role)).not.toContain("method");
  });

  it("رد تالف = تعذر التقييم، لا اتهام", async () => {
    const { llm } = fakeLlm({ method: "ليس json" });
    const v = await verifyAnswer({ subject: "math", question: "Q", answer: ans, level: "strict", llm, independentSolution: "x" });
    expect(v.checks.find((c) => c.id === "method")?.status).toBe("skip");
    expect(v.unverified.some((u) => u.ar.includes("المنهج"))).toBe(true);
    expect(v.issues.filter((i) => i.source === "method")).toHaveLength(0);
  });
});

describe("«تعذر التحقق» بدل حكم مخمَّن", () => {
  it("ادعاء لا يمكن فحصه يُدرج مع سببه ومقطعه، ولا يُحسب خطأً", async () => {
    const answer = "إذن $g(2) = 3$ حسب الدالة المعطاة، وهذه نتيجة نهائية لهذا السؤال الجزئي.";
    const { llm } = fakeLlm({ extract: claimsJson([{ type: "value", expr: "foo(2)", value: "3", quote: "g(2) = 3", q: "1" }]) });
    const v = await verifyAnswer({ subject: "math", question: "", answer, level: "standard", llm });
    expect(v.issues.filter((i) => i.severity !== "info")).toHaveLength(0);
    expect(v.unverified).toHaveLength(1);
    expect(v.unverified[0]).toMatchObject({ q: "1", what: "g(2) = 3" });
    expect(v.unverified[0].ar.length).toBeGreaterThan(5);
    expect(v.unverified[0].fr.length).toBeGreaterThan(5);
  });

  it("حل مستقل غير متأكد (unsure) = تعذر التحقق من ذلك السؤال", async () => {
    const { llm } = fakeLlm({ compare: JSON.stringify({ results: [{ q: "3", status: "unsure", note: "سؤال مفتوح" }, { q: "1", status: "agree" }] }) });
    const v = await verifyAnswer({ subject: "math", question: "Q", answer: LONG, level: "strict", llm, independentSolution: "..." });
    expect(v.unverified.map((u) => u.q)).toEqual(["3"]);
    expect(v.unverified[0].ar).toContain("سؤال مفتوح");
  });

  it("غياب المحقِّق أو فشله لا يخلق ادعاء ولا يغيّر الإجابة", async () => {
    const v = await verifyAnswer({ subject: "math", question: "", answer: ANSWER, level: "strict", llm: null });
    expect(v.state).toBe("done");
    expect(v.unverified).toEqual([]);
  });
});


describe("subject rubrics in standard mode", () => {
  it("checks a humanities answer against its Moroccan exam rubric", async () => {
    const { llm, calls } = fakeLlm({ method: JSON.stringify({ notes: [] }) });
    const answer = "Introduction : le texte pose une problématique importante. " +
      "La thèse défendue repose sur plusieurs arguments et exemples précis. " +
      "Dans le développement, on distingue les idées principales et leurs conséquences. " +
      "Enfin, la conclusion répond directement à la problématique posée.";
    await verifyAnswer({
      subject: "philosophy",
      question: "Expliquez la thèse et discutez-la.",
      answer,
      level: "standard",
      llm,
    });
    expect(calls.map((call) => call.role)).toContain("method");
    expect(calls.find((call) => call.role === "method")?.user).toContain("subject_rubric");
  });
});
