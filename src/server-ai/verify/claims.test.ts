import { describe, expect, it } from "vitest";
import { compile, evalConst, tryCompile } from "./expr";
import { runClaim, valueTolerance, type Claim } from "./claims";

const st = (c: Claim) => runClaim(c).status;

describe("expr: المحلّل", () => {
  it("يحسب الأولويات والقوى والضرب الضمني", () => {
    expect(evalConst("2+3*4")).toBe(14);
    expect(evalConst("-2^2")).toBe(-4);
    expect(evalConst("2^3^2")).toBe(512);
    expect(evalConst("(1+2)(3+4)")).toBe(21);
    expect(evalConst("2^-2")).toBe(0.25);
    expect(evalConst("5!")).toBe(120);
    expect(evalConst("comb(5,2)")).toBe(10);
    expect(evalConst("sqrt(16)+cbrt(-8)")).toBe(2);
    expect(evalConst("3*10^8")).toBe(3e8);
    expect(evalConst("2e3")).toBe(2000);
  });
  it("ثوابت ودوال ومتغيرات", () => {
    expect(evalConst("ln(e)")).toBeCloseTo(1, 12);
    expect(evalConst("2pi")).toBeCloseTo(2 * Math.PI, 12);
    expect(evalConst("log10(1000)")).toBeCloseTo(3, 12);
    expect(evalConst("logb(2,8)")).toBeCloseTo(3, 12);
    const c = compile("2x(x+1)");
    expect(c.vars).toEqual(["x"]);
    expect(c.eval({ x: 3 })).toBe(24);
    expect(compile("x*e^x").eval({ x: 1 })).toBeCloseTo(Math.E, 12);
    expect(compile("xe^x").eval({ x: 1 })).toBeCloseTo(Math.E, 12);
    expect(compile("xe^x").vars).toEqual(["x"]);
  });
  it("خارج المجال يعطي NaN لا رقماً كاذباً", () => {
    expect(compile("ln(x)").eval({ x: -1 })).toBeNaN();
    expect(compile("sqrt(x)").eval({ x: -4 })).toBeNaN();
    expect(evalConst("1/0")).toBeNull();
  });
  it("يرفض ما لا يفهمه بدل التخمين", () => {
    for (const bad of ["log(10)", "foo(2)", "2+", "(1+2", "1 2 $", "", "sin()", "x^"]) {
      expect(tryCompile(bad)).toBeNull();
    }
    expect(tryCompile("1+".repeat(400) + "1")).toBeNull(); // أطول من الحد
    expect(tryCompile("(".repeat(80) + "1" + ")".repeat(80))).toBeNull(); // عمق زائد
  });
  it("لا ينفّذ شيفرة", () => {
    expect(tryCompile("process.exit(1)")).toBeNull();
    expect(tryCompile("constructor")).not.toBeNull(); // حروف متعددة = متغيرات، تُقيَّم NaN
    expect(compile("constructor").eval({})).toBeNaN();
  });
});

describe("valueTolerance", () => {
  it("يستنتج التسامح من شكل الرقم المكتوب", () => {
    expect(valueTolerance("12.50", 12.5)).toBeCloseTo(0.005, 6);
    expect(valueTolerance("2,5", 2.5)).toBeCloseTo(0.05, 6);
    expect(valueTolerance("12", 12)).toBeCloseTo(0.5, 4);
    expect(valueTolerance("3.0*10^8", 3e8)).toBeCloseTo(0.05e8, -3);
    expect(valueTolerance("1/3", 1 / 3)).toBeLessThan(1e-8);
  });
});

describe("equation", () => {
  const quad = { type: "equation", lhs: "x^2-4x+3", rhs: "0", variable: "x" } as const;
  it("جذور صحيحة كاملة", () => expect(st({ ...quad, solutions: ["1", "3"] })).toBe("verified"));
  it("جذر خاطئ", () => {
    const o = runClaim({ ...quad, solutions: ["1", "4"] });
    expect(o.status).toBe("mismatch");
    expect(o.ar).toContain("x = 4");
  });
  it("جذر صحيح لكن فاتَه جذر", () => {
    const o = runClaim({ ...quad, solutions: ["1"] });
    expect(o.status).toBe("partial");
    expect(o.ar).toContain("3");
  });
  it("complete=false لا يبحث عن الفائت", () => expect(st({ ...quad, solutions: ["1"], complete: false })).toBe("verified"));
  it("جذر مضاعف", () => expect(st({ type: "equation", lhs: "(x-2)^2", rhs: "0", variable: "x", solutions: ["2"] })).toBe("verified"));
  it("جذر مضاعف فائت", () => expect(st({ type: "equation", lhs: "(x-2)^2*(x+1)", rhs: "0", variable: "x", solutions: ["-1"] })).toBe("partial"));
  it("حلول تقريبية مقرَّبة تُقبل", () => expect(st({ type: "equation", lhs: "x^2", rhs: "2", variable: "x", solutions: ["1.41", "-1.41"] })).toBe("verified"));
  it("حلول بصيغة جذور وكسور", () => expect(st({ type: "equation", lhs: "2x^2", rhs: "1", variable: "x", solutions: ["sqrt(2)/2", "-sqrt(2)/2"] })).toBe("verified"));
  it("المعادلة اللوغاريتمية: الحل خارج المجال", () => expect(st({ type: "equation", lhs: "ln(x)", rhs: "ln(2x-1)", variable: "x", solutions: ["1", "0"] })).toBe("mismatch"));
  it("لا حل مدّعى وهو موجود", () => expect(st({ ...quad, solutions: [] })).toBe("mismatch"));
  it("لا حل صحيح", () => expect(st({ type: "equation", lhs: "x^2+1", rhs: "0", variable: "x", solutions: [] })).toBe("verified"));
  it("القطب ليس جذراً", () => expect(st({ type: "equation", lhs: "1/x", rhs: "0", variable: "x", solutions: [] })).toBe("verified"));
  it("المجال المحدد يحصر البحث", () =>
    expect(st({ type: "equation", lhs: "sin(x)", rhs: "0", variable: "x", domain: ["-1", "4"], solutions: ["0", "pi"] })).toBe("verified"));
  it("حلول لا نهائية بدون مجال: لا حكم على الاكتمال", () =>
    expect(st({ type: "equation", lhs: "sin(x)", rhs: "0", variable: "x", solutions: ["0"] })).toBe("verified"));
  it("وسيط إضافي = غير قابل للتحقق", () => expect(st({ type: "equation", lhs: "a*x", rhs: "1", variable: "x", solutions: ["1"] })).toBe("unverifiable"));
  it("صيغة الحل x = 3 تُقبل", () => expect(st({ type: "equation", lhs: "x-3", rhs: "0", variable: "x", solutions: ["x = 3"] })).toBe("verified"));
});

describe("derivative", () => {
  it("صحيحة", () => {
    expect(st({ type: "derivative", f: "x*e^x", df: "(x+1)*e^x", variable: "x" })).toBe("verified");
    expect(st({ type: "derivative", f: "ln(x)/x", df: "(1-ln(x))/x^2", variable: "x" })).toBe("verified");
    expect(st({ type: "derivative", f: "sqrt(x^2+1)", df: "x/sqrt(x^2+1)", variable: "x" })).toBe("verified");
  });
  it("خاطئة", () => {
    const o = runClaim({ type: "derivative", f: "x*e^x", df: "x*e^x", variable: "x" });
    expect(o.status).toBe("mismatch");
    expect(o.evidence).toContain("x*e^x");
    expect(st({ type: "derivative", f: "ln(x)/x", df: "(1+ln(x))/x^2", variable: "x" })).toBe("mismatch");
  });
  it("مع وسيط", () => expect(st({ type: "derivative", f: "a*x^2", df: "2*a*x", variable: "x" })).toBe("verified"));
  it("خارج المجال في كل النقاط الموجبة فقط: ما زال قابلاً للفحص", () => expect(st({ type: "derivative", f: "ln(x)", df: "1/x", variable: "x" })).toBe("verified"));
  it("دالة غير معرّفة في كل مكان", () => expect(st({ type: "derivative", f: "sqrt(-x^2-1)", df: "1", variable: "x" })).toBe("unverifiable"));
});

describe("equality", () => {
  it("متطابقة صحيحة", () => {
    expect(st({ type: "equality", left: "(x+1)^2", right: "x^2+2x+1" })).toBe("verified");
    expect(st({ type: "equality", left: "sin(x)^2+cos(x)^2", right: "1" })).toBe("verified");
  });
  it("متطابقة خاطئة", () => expect(st({ type: "equality", left: "(x+1)^2", right: "x^2+1" })).toBe("mismatch"));
  it("ثابتان", () => {
    expect(st({ type: "equality", left: "sqrt(8)", right: "2*sqrt(2)" })).toBe("verified");
    expect(st({ type: "equality", left: "sqrt(8)", right: "3*sqrt(2)" })).toBe("mismatch");
  });
});

describe("value", () => {
  it("قيمة مقرَّبة صحيحة", () => expect(st({ type: "value", expr: "2.5*10^3/(4.2*10^-2)", value: "5.95*10^4" })).toBe("verified"));
  it("قيمة خاطئة (خطأ آلة حاسبة)", () => {
    const o = runClaim({ type: "value", expr: "2.5*10^3/(4.2*10^-2)", value: "5.95*10^5" });
    expect(o.status).toBe("mismatch");
    expect(o.ar).toContain("5.95*10^5");
  });
  it("تقريب لمنزلتين", () => {
    expect(st({ type: "value", expr: "pi*r^2", vars: { r: "2" }, value: "12.57" })).toBe("verified");
    expect(st({ type: "value", expr: "pi*r^2", vars: { r: "2" }, value: "12.75" })).toBe("mismatch");
  });
  it("فاصلة عشرية فرنسية", () => expect(st({ type: "value", expr: "5/2", value: "2,5" })).toBe("verified"));
  it("متغير بلا قيمة", () => expect(st({ type: "value", expr: "x+1", value: "3" })).toBe("unverifiable"));
});

describe("limit", () => {
  const lim = (f: string, to: string, value: string, side?: "+" | "-"): Claim => ({ type: "limit", f, variable: "x", to, value, ...(side ? { side } : {}) });
  it("صحيحة", () => {
    expect(st(lim("sin(x)/x", "0", "1"))).toBe("verified");
    expect(st(lim("(1+1/x)^x", "+inf", "e"))).toBe("verified");
    expect(st(lim("(x^2-1)/(x-1)", "1", "2"))).toBe("verified");
    expect(st(lim("1/x", "0", "+inf", "+"))).toBe("verified");
    expect(st(lim("1/x", "0", "-inf", "-"))).toBe("verified");
    expect(st(lim("x^2", "+inf", "+inf"))).toBe("verified");
    expect(st(lim("1/x", "+inf", "0"))).toBe("verified");
  });
  it("خاطئة", () => {
    expect(st(lim("sin(x)/x", "0", "0"))).toBe("mismatch");
    expect(st(lim("(x^2-1)/(x-1)", "1", "1"))).toBe("mismatch");
    expect(st(lim("1/x", "0", "+inf", "-"))).toBe("mismatch");
    expect(st(lim("x^2", "+inf", "0"))).toBe("mismatch");
  });
  it("نهاية ثنائية الجانب غير موجودة", () => expect(st(lim("1/x", "0", "+inf"))).toBe("mismatch"));
  it("تقارب لوغاريتمي بطيء لا يُتَّهم", () => expect(st(lim("1/ln(x)", "+inf", "0"))).not.toBe("mismatch"));
  it("ln(x)/x عند ما لا نهاية", () => expect(st(lim("ln(x)/x", "+inf", "0"))).toBe("verified"));
});

describe("integral", () => {
  it("صحيح وخاطئ", () => {
    expect(st({ type: "integral", f: "2x", variable: "x", from: "0", to: "3", value: "9" })).toBe("verified");
    expect(st({ type: "integral", f: "2x", variable: "x", from: "0", to: "3", value: "6" })).toBe("mismatch");
    expect(st({ type: "integral", f: "sin(x)", variable: "x", from: "0", to: "pi", value: "2" })).toBe("verified");
    expect(st({ type: "integral", f: "1/x", variable: "x", from: "1", to: "e", value: "1" })).toBe("verified");
  });
  it("تكامل معمَّم = غير قابل للتحقق", () => expect(st({ type: "integral", f: "1/x", variable: "x", from: "0", to: "1", value: "1" })).toBe("unverifiable"));
});

describe("تحديد الصحيح عند الخطأ (expected)", () => {
  it("جذر خاطئ: يعرض الجذور الفعلية", () => {
    const o = runClaim({ type: "equation", lhs: "x^2-4*x+3", rhs: "0", variable: "x", solutions: ["1", "4"] });
    expect(o.status).toBe("mismatch");
    expect(o.expected).toBe("x ∈ {1 ; 3}");
  });
  it("جذر فائت: يعرض الفائت", () => {
    const o = runClaim({ type: "equation", lhs: "x^2-4*x+3", rhs: "0", variable: "x", solutions: ["1"] });
    expect(o.status).toBe("partial");
    expect(o.expected).toBe("x ∈ {1 ; 3}");
  });
  it("لا حل مدّعى: يعرض الحل الفعلي، ولا حل حقيقي: ∅", () => {
    expect(runClaim({ type: "equation", lhs: "x-2", rhs: "0", variable: "x", solutions: [] }).expected).toBe("x ∈ {2}");
    expect(runClaim({ type: "equation", lhs: "x^2+1", rhs: "0", variable: "x", solutions: ["1"] }).expected).toBe("∅");
  });
  it("معادلة دورية بلا مجال: لا قيمة متوقعة مخمَّنة", () => {
    expect(runClaim({ type: "equation", lhs: "sin(x)", rhs: "1/2", variable: "x", solutions: ["1"] }).expected).toBeUndefined();
  });
  it("قيمة خاطئة: القيمة المحسوبة", () => {
    expect(runClaim({ type: "value", expr: "pi*r^2", vars: { r: "2" }, value: "12.75" }).expected).toBe("12.56637");
  });
  it("مشتقة خاطئة: المشتقة العددية عند نقطة الخطأ", () => {
    const o = runClaim({ type: "derivative", f: "x^2", df: "3*x", variable: "x" });
    expect(o.status).toBe("mismatch");
    expect(o.expected).toMatch(/^f'\(x=[-\d.]+\) ≈ [-\d.]+$/);
  });
  it("نهاية خاطئة: تقدير عددي", () => {
    const o = runClaim({ type: "limit", f: "sin(x)/x", variable: "x", to: "0", value: "0" });
    expect(o.expected).toBe("≈ 1");
  });
  it("تكامل خاطئ", () => {
    expect(runClaim({ type: "integral", f: "2x", variable: "x", from: "0", to: "3", value: "6" }).expected).toBe("9");
  });
  it("الإجابة الصحيحة بلا expected", () => {
    expect(runClaim({ type: "value", expr: "5/2", value: "2.5" }).expected).toBeUndefined();
  });
});

describe("أسباب تعذر التحقق", () => {
  it("لكل سبب عربي مستعمل في claims.ts ترجمة فرنسية", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const { REASON_FR } = await import("./claims");
    const src = readFileSync(resolve(process.cwd(), "src/server-ai/verify/claims.ts"), "utf8");
    const used = [...src.matchAll(/unver\(\w+, "([^"]+)"\)/g)].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(15);
    for (const r of used) expect(REASON_FR[r], `missing FR for: ${r}`).toBeTruthy();
  });
  it("الادعاء غير القابل للفحص يحمل الفرنسية", () => {
    const o = runClaim({ type: "equation", lhs: "a*x", rhs: "1", variable: "x", solutions: ["1"] });
    expect(o.status).toBe("unverifiable");
    expect(o.fr).toContain("paramètres");
  });
});
