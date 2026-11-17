import { describe, expect, it } from "vitest";
import { checkQuote, coverage, extractQuotes, normalizeForQuote, parseLabels, questionLabels, runStaticChecks } from "./static";

const kinds = (r: ReturnType<typeof runStaticChecks>) => r.issues.map((i) => i.kind);
const status = (r: ReturnType<typeof runStaticChecks>, id: string) => r.checks.find((c) => c.id === id)?.status;

describe("الحساب العددي", () => {
  it("يلتقط خطأ آلة حاسبة ويعدّ المتساويات السليمة", () => {
    const r = runStaticChecks({ subject: "physics", question: "", answer: "$2 \\times 4 = 8$ ثم $3 \\times 5 = 16$" });
    expect(kinds(r)).toContain("arithmetic");
    expect(r.issues[0].severity).toBe("error");
    expect(r.verifiedCount).toBe(1);
    expect(status(r, "arithmetic")).toBe("fail");
  });
  it("لا شيء لفحصه = لا فحص حسابي في القائمة", () => {
    const r = runStaticChecks({ subject: "arabic", question: "", answer: "جملة عادية بلا معادلات." });
    expect(r.checks.find((c) => c.id === "arithmetic")).toBeUndefined();
  });
});

describe("اكتمال الإجابة", () => {
  it("finish_reason=length خطأ صريح", () => {
    const r = runStaticChecks({ question: "", answer: "الجواب الأول ثم", finishReason: "length" });
    expect(r.issues.find((i) => i.kind === "truncated")?.severity).toBe("error");
  });
  it("معادلة $$ مفتوحة أو سياج كود مفتوح", () => {
    expect(kinds(runStaticChecks({ question: "", answer: "لدينا $$x^2 + " }))).toContain("truncated");
    expect(kinds(runStaticChecks({ question: "", answer: "```svg\n<svg>" }))).toContain("truncated");
  });
  it("إجابة سليمة تنتهي بنقطة", () => {
    const r = runStaticChecks({ question: "", answer: "إذن $x=2$ هو الحل." });
    expect(kinds(r)).not.toContain("truncated");
    expect(status(r, "complete")).toBe("pass");
  });
});

describe("تغطية الأسئلة", () => {
  const q = "1) Calculer a.\n2) Montrer que b.\n3) En déduire c.\n4) Résoudre d.";
  it("يستخرج الأرقام ولا يخلط الأعداد العشرية بأرقام الأسئلة", () => {
    expect(questionLabels(q)).toEqual(["1", "2", "3", "4"]);
    expect(questionLabels("3.14 est une valeur\n2,5 aussi\n1-1) a\n1-2) b\n2) c")).toEqual(["1-1", "1-2", "2"]);
    expect(questionLabels("السؤال 1: أعرب\n٢- حلل\nس3) علل")).toEqual(["1", "2", "3"]);
  });
  it("جواب يغطي كل الأسئلة", () => {
    const a = "**1)** a=2\n\n**2)** on a b.\n\n3. donc c.\n\n## Question 4 :\nd=1";
    const r = runStaticChecks({ question: q, answer: a });
    expect(kinds(r)).not.toContain("coverage");
    expect(status(r, "coverage")).toBe("pass");
  });
  it("جواب أهمل أسئلة", () => {
    const r = runStaticChecks({ question: q, answer: "1) a=2\n\n2) b." });
    const issue = r.issues.find((i) => i.kind === "coverage");
    expect(issue?.severity).toBe("warn");
    expect(issue?.ar).toContain("3");
    expect(issue?.ar).toContain("4");
  });
  it("نص مرقّم في مادة نصوص لا يُنتج تحذيراً (info فقط)", () => {
    const poem = "1. Le soleil se couche.\n2. La mer s'endort.\n3. Le vent se tait.\n4. La nuit s'étend.";
    const r = runStaticChecks({ subject: "french", question: poem, answer: "Le poème évoque la fin du jour avec douceur et mélancolie." });
    expect(r.issues.find((i) => i.kind === "coverage")?.severity).toBe("info");
  });
  it("سؤال ناقص واحد من أربعة = تنبيه خفيف فقط", () => {
    const r = runStaticChecks({ question: q, answer: "1) a\n2) b\n3) c" });
    expect(r.issues.find((i) => i.kind === "coverage")?.severity).toBe("info");
  });
  it("أقل من 3 أسئلة مرقّمة: لا فحص", () => {
    expect(runStaticChecks({ question: "1) a\n2) b", answer: "x" }).checks.find((c) => c.id === "coverage")).toBeUndefined();
  });
  it("الترقيم الفرعي 1-1", () => {
    const r = runStaticChecks({ question: "1-1) a\n1-2) b\n2-1) c", answer: "1-1) ok\n\n1.2) ok\n\n2-1) ok" });
    expect(kinds(r)).not.toContain("coverage");
  });
});

describe("فروع الأسئلة (أ/ب، a/b، 1-1)", () => {
  const q = "1) Calculer :\n a) la limite\n b) la dérivée\n c) le signe\n2) Résoudre\n3) Conclure";
  it("يقرأ الفروع الحرفية العربية واللاتينية ويربطها بأبيها", () => {
    expect(parseLabels("1) x\n أ) y\n ب) z\n2) w").map((l) => l.id)).toEqual(["1", "1-a", "1-b", "2"]);
    expect(parseLabels(q).map((l) => l.id)).toEqual(["1", "1-a", "1-b", "1-c", "2", "3"]);
  });
  it("فرع لاتيني في بداية سطر قبل أي سؤال رئيسي لا يُعدّ فرعاً", () => {
    expect(parseLabels("a) intro\n1) x")).toEqual([{ id: "1", kind: "top", parent: "1" }]);
  });
  it("جواب يعالج السؤال 1 بترقيم فروع ويتخطى فرعاً = تحذير على الفرع", () => {
    const a = "1) a) la limite vaut 2\n b) la dérivée est 3x\n\n2) x=1\n\n3) donc fini";
    const c = coverage(q, a);
    expect(c.missingSub).toEqual(["1-c"]);
    expect(c.missingTop).toEqual([]);
    const r = runStaticChecks({ question: q, answer: a });
    const issue = r.issues.find((i) => i.kind === "coverage");
    expect(issue?.severity).toBe("warn");
    expect(issue?.ar).toContain("1-c");
    expect(issue?.fr).toContain("sous-question");
  });
  it("جواب لا يستعمل ترقيم فروع أصلاً: لا نتّهمه بإهمال الفروع", () => {
    const a = "1) La limite vaut 2, la dérivée est 3x et le signe est positif.\n\n2) x=1\n\n3) fini";
    const c = coverage(q, a);
    expect(c.missingSub).toEqual([]);
    expect(c.missingTop).toEqual([]);
    expect(runStaticChecks({ question: q, answer: a }).issues.find((i) => i.kind === "coverage")).toBeUndefined();
  });
  it("جواب بلا السؤال الأب وفروعه: يُعدّ السؤال الأب مهملاً مرة واحدة", () => {
    const c = coverage(q, "2) x=1\n\n3) fini");
    expect(c.missingTop).toEqual(["1"]);
    expect(c.missingSub).toEqual([]);
  });
  it("الفروع العربية أ/ب تطابق a/b", () => {
    const c = coverage("1) س\n أ) x\n ب) y\n2) z\n3) w", "1) أ) x\n ب) y\n2) ok\n3) ok");
    expect(c.missingSub).toEqual([]);
    expect(c.missingTop).toEqual([]);
  });
});

describe("سلامة العرض", () => {
  it("أقواس غير متوازنة و \\left بلا \\right و $ مفردة", () => {
    expect(kinds(runStaticChecks({ question: "", answer: "قيمة $\\frac{1}{2$ هنا." }))).toContain("render");
    expect(kinds(runStaticChecks({ question: "", answer: "قيمة $\\left( x + 1$ هنا." }))).toContain("render");
    expect(kinds(runStaticChecks({ question: "", answer: "قيمة $x=1 هنا و $$y=2$$." }))).toContain("render");
  });
  it("معادلات سليمة", () => {
    const r = runStaticChecks({ question: "", answer: "قيمة $\\frac{1}{2} + \\left( x \\right)$ و $$\\sqrt{x}=2$$ و \\{ مهرَّبة $\\{1;2\\}$." });
    expect(kinds(r)).not.toContain("render");
    expect(status(r, "render")).toBe("pass");
  });
});

describe("اللغة والقوالب", () => {
  const ar = "هذا نص عربي طويل يشرح الفكرة بوضوح ويستعمل كلمات كثيرة حتى يتجاوز الحد الأدنى من الحروف المطلوبة لإجراء الفحص اللغوي بشكل موثوق ".repeat(3);
  const fr = "Ceci est un long texte en français qui explique l'idée clairement et utilise suffisamment de mots pour dépasser le seuil minimal de lettres ".repeat(3);
  it("مادة عربية بجواب فرنسي", () => expect(kinds(runStaticChecks({ subject: "arabic", question: "", answer: fr }))).toContain("language"));
  it("مادة فرنسية بجواب عربي", () => expect(kinds(runStaticChecks({ subject: "french", question: "", answer: ar }))).toContain("language"));
  it("اللغة الصحيحة تمر", () => {
    expect(kinds(runStaticChecks({ subject: "arabic", question: "", answer: ar }))).not.toContain("language");
    expect(kinds(runStaticChecks({ subject: "french", question: "", answer: fr }))).not.toContain("language");
  });
  it("المواد العلمية لا تُفحص لغوياً", () => {
    expect(runStaticChecks({ subject: "math", question: "", answer: fr }).checks.find((c) => c.id === "language")).toBeUndefined();
  });
  it("تسرّب قوالب الرياضيات", () => {
    expect(kinds(runStaticChecks({ subject: "arabic", question: "", answer: "الإعراب:\nOn a : الفاعل مرفوع" }))).toContain("template");
    expect(kinds(runStaticChecks({ subject: "french", question: "", answer: "Application numérique : 3" }))).toContain("template");
    expect(kinds(runStaticChecks({ subject: "french", question: "", answer: "Le narrateur décrit la scène avec précision." }))).not.toContain("template");
  });
  it("«Donc,» و «On a :» نثر فرنسي سليم، لكنهما تسرّب داخل مادة عربية", () => {
    const prose = "Le texte s'ouvre sur une scène calme.\nDonc, le lecteur s'attend à un drame.\nOn a : un décor, puis un personnage.";
    expect(kinds(runStaticChecks({ subject: "french", question: "", answer: prose }))).not.toContain("template");
    expect(kinds(runStaticChecks({ subject: "arabic", question: "", answer: "الإعراب:\nDonc, الفاعل مرفوع" }))).toContain("template");
  });
});

describe("الاقتباسات", () => {
  const source = "قال الشاعر في وصف الليل: «سَرَيْتُ والليلُ قد أرخى سُدولَهُ علينا بأنواعِ الهمومِ ليبتلي» وهو يصف حاله مع الهموم الكثيرة التي أثقلت قلبه ومنعته من النوم طوال تلك الليلة الطويلة الموحشة في الصحراء الواسعة.";
  it("التطبيع يتجاهل التشكيل وأشكال الألف", () => {
    expect(normalizeForQuote("أَرْخَى سُدُولَهُ")).toBe(normalizeForQuote("ارخى سدوله"));
    expect(normalizeForQuote("Éléonore  — l’été")).toBe("eleonore l'ete".replace("'", " "));
  });
  it("اقتباس صحيح بتشكيل مختلف يُقبل", () => {
    const r = runStaticChecks({ subject: "arabic", question: source, answer: "الشاهد «سريت والليل قد أرخى سدوله» يدل على الليل." });
    expect(kinds(r)).not.toContain("quote");
    expect(status(r, "quotes")).toBe("pass");
    expect(r.verifiedCount).toBe(1);
  });
  it("اقتباس مخترَع", () => {
    const r = runStaticChecks({ subject: "arabic", question: source, answer: "الشاهد «والنهار قد أشرق نوره علينا بالفرح والسرور» يدل على الصباح." });
    const i = r.issues.find((x) => x.kind === "quote");
    expect(i?.severity).toBe("warn");
    expect(i?.evidence).toContain("والنهار");
  });
  it("اقتباس بحذف (...) يُفحص جزءاً جزءاً", () => {
    const r = runStaticChecks({ subject: "arabic", question: source, answer: "«سريت والليل قد أرخى (...) بأنواع الهموم ليبتلي»" });
    expect(kinds(r)).not.toContain("quote");
  });
  it("تسامح مع خطأ قراءة واحد في اقتباس طويل", () => {
    const quote = "سريت والليل قد ارخى سدوله علينا بانواع الهموم ليبتلي".replace("علينا", "علينى");
    expect(checkQuote(quote, normalizeForQuote(source), normalizeForQuote(source).split(" "))).toBe("found");
  });
  it("مصطلحات قصيرة لا تُفحص", () => {
    const r = runStaticChecks({ subject: "arabic", question: source, answer: "الصورة «استعارة مكنية» واضحة." });
    expect(kinds(r)).not.toContain("quote");
  });
  it("صورة بلا قراءة نصية: لا مقارنة حتى لو كان السؤال المكتوب طويلاً", () => {
    const r = runStaticChecks({ subject: "arabic", question: source, sourceComplete: false, answer: "الشاهد «والنهار قد أشرق نوره علينا بالفرح والسرور» يدل على الصباح." });
    expect(kinds(r)).not.toContain("quote");
    expect(status(r, "quotes")).toBe("skip");
  });
  it("بدون نص مصدر: يُسجَّل skip ولا يُتهم الجواب", () => {
    const r = runStaticChecks({ subject: "french", question: "Analysez ce texte.", answer: "Le texte dit « il faut cultiver notre jardin tous les jours » clairement." });
    expect(kinds(r)).not.toContain("quote");
    expect(status(r, "quotes")).toBe("skip");
  });
  it("المواد العلمية لا تُفحص اقتباساتها", () => {
    expect(runStaticChecks({ subject: "physics", question: source, answer: "«شيء ما ليس في النص أبداً هنا»" }).checks.find((c) => c.id === "quotes")).toBeUndefined();
  });
  it("استخراج الاقتباسات يتجاوز الرياضيات والكود", () => {
    expect(extractQuotes("```\n«داخل كود طويل جداً جداً»\n```\n$\"x\"$ و «خارج الكود وطويل بما يكفي»")).toEqual(["خارج الكود وطويل بما يكفي"]);
  });
});
