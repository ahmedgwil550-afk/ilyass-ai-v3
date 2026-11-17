import { describe, expect, it } from "vitest";
import { splitThinking, stripThinking } from "./thinking";
import { encodeVerification, parseVerdict, splitVerification, type Verdict } from "./verification";

const verdict = (over: Partial<Verdict> = {}): Verdict => ({
  v: 1, state: "done", level: "verified", verifiedCount: 3,
  checks: [{ id: "arithmetic", status: "pass", count: 3, ar: "الحسابات", fr: "Calculs" }],
  issues: [], unverified: [], ...over,
});

describe("encode / split", () => {
  it("يعيد الحكم والنص كما كانا", () => {
    const v = verdict({ issues: [{ severity: "error", kind: "x", source: "code", ar: "خطأ </verification> مدسوس", fr: "e", evidence: "a < b" }] });
    const raw = `الجواب هو $x=2$.${encodeVerification(v)}`;
    const r = splitVerification(raw);
    expect(r.text).toBe("الجواب هو $x=2$.");
    expect(r.verification?.issues[0].ar).toBe("خطأ </verification> مدسوس");
    expect(r.verification?.issues[0].evidence).toBe("a < b");
  });
  it("نص بلا كتل يعود كما هو (بما فيه المسافات)", () => {
    const raw = "جواب عادي\n\n";
    expect(splitVerification(raw)).toEqual({ text: raw, verification: null });
  });
  it("الكتلة الناقصة أثناء البث لا تظهر أبداً", () => {
    const full = encodeVerification(verdict());
    const closedAt = full.indexOf("</verification>") + "</verification>".length; // قبل هذا الموضع الكتلة ناقصة
    for (let n = 1; n < closedAt; n++) {
      const r = splitVerification(`الجواب${full.slice(0, n)}`);
      expect(r.text.startsWith("الجواب")).toBe(true);
      expect(r.text).not.toContain("<");
      expect(r.text).not.toContain("verif");
      expect(r.verification).toBeNull();
    }
  });
  it("آخر كتلة صالحة هي المعتمدة (running ثم done)", () => {
    const raw = `النص${encodeVerification(verdict({ state: "running", level: "unchecked" }))}${encodeVerification(verdict({ state: "done" }))}`;
    const r = splitVerification(raw);
    expect(r.text).toBe("النص");
    expect(r.verification?.state).toBe("done");
  });
  it("كتلة تالفة تُحذف من النص ولا تُنتج حكماً", () => {
    const r = splitVerification("النص<verification>{oops</verification>");
    expect(r.text).toBe("النص");
    expect(r.verification).toBeNull();
  });
  it("عندما تُغلق الكتلة الثانية بعد running يبقى running مؤقتاً", () => {
    const raw = `النص${encodeVerification(verdict({ state: "running" }))}\n<verification>{"v":1,"sta`;
    expect(splitVerification(raw).verification?.state).toBe("running");
  });
});

describe("التكامل مع كتلة التفكير", () => {
  it("splitThinking يعيد التفكير والإجابة والحكم، و stripThinking (سجل الخادم) نظيف", () => {
    const raw = `<thinking>\n- خطوة\n</thinking>\nالجواب $x=2$.${encodeVerification(verdict())}`;
    const p = splitThinking(raw);
    expect(p.thinking).toBe("- خطوة");
    expect(p.answer).toBe("الجواب $x=2$.");
    expect(p.verification?.level).toBe("verified");
    expect(stripThinking(raw)).toBe("الجواب $x=2$.");
  });
  it("أثناء التفكير لا يظهر حكم", () => {
    expect(splitThinking("<thinking>\n- خطوة").verification).toBeNull();
  });
  it("إجابة قديمة بلا كتل تعمل كما كانت", () => {
    expect(splitThinking("جواب عادي")).toEqual({ thinking: "", answer: "جواب عادي", closed: true, verification: null });
  });
});

describe("parseVerdict", () => {
  it("يرفض الأشكال الخاطئة", () => {
    expect(parseVerdict("null")).toBeNull();
    expect(parseVerdict(JSON.stringify({ v: 2 }))).toBeNull();
    expect(parseVerdict(JSON.stringify({ v: 1, state: "done", level: "perfect", checks: [], issues: [] }))).toBeNull();
    expect(parseVerdict(JSON.stringify({ v: 1, state: "done", level: "verified" }))).toBeNull();
  });
  it("ينظّف الحقول الغريبة", () => {
    const v = parseVerdict(JSON.stringify({
      v: 1, state: "done", level: "warning", verifiedCount: -5,
      checks: [{ id: "a", status: "pass", ar: "x", fr: "y", evil: "<script>" }, { id: 5 }, null],
      issues: [{ severity: "hacker", ar: "x" }, { severity: "warn", kind: "k", ar: "م", fr: "m", source: "weird" }],
    }))!;
    expect(v.verifiedCount).toBe(0);
    expect(v.checks).toHaveLength(1);
    expect(v.checks[0]).not.toHaveProperty("evil");
    expect(v.issues).toHaveLength(1);
    expect(v.issues[0].source).toBe("static");
  });
});

describe("الحقول الجديدة: where / expected / unverified / مصادر reading و method", () => {
  it("تمر عبر الترميز كاملة ولو احتوت وسم إغلاق مدسوساً", () => {
    const v = verdict({
      issues: [{ severity: "warn", kind: "method_out_of_program", source: "method", ar: "م", fr: "m", where: "قاعدة </verification> لوبيتال", expected: "x=3" }],
      unverified: [{ q: "2", ar: "تعذر", fr: "impossible", what: "g(2)" }],
    });
    const r = splitVerification(`نص${encodeVerification(v)}`).verification!;
    expect(r.issues[0]).toMatchObject({ source: "method", where: "قاعدة </verification> لوبيتال", expected: "x=3" });
    expect(r.unverified).toEqual([{ q: "2", ar: "تعذر", fr: "impossible", what: "g(2)" }]);
  });
  it("حكم قديم بلا unverified يُقبل ويصير []", () => {
    const old = JSON.stringify({ v: 1, state: "done", level: "checked", verifiedCount: 0, checks: [], issues: [] });
    expect(parseVerdict(old)?.unverified).toEqual([]);
  });
  it("عناصر unverified الفاسدة تُسقَط والعدد يُقيَّد بـ 12", () => {
    const raw = JSON.stringify({
      v: 1, state: "done", level: "checked", verifiedCount: 0, checks: [], issues: [],
      unverified: [null, 5, { q: 3 }, ...Array.from({ length: 20 }, (_, k) => ({ ar: `ع${k}`, fr: `f${k}` }))],
    });
    const r = parseVerdict(raw)!;
    expect(r.unverified).toHaveLength(12);
    expect(r.unverified[0]).toEqual({ ar: "ع0", fr: "f0" });
  });
  it("source=reading مقبول، وwhere/expected غير النصية تُهمَل", () => {
    const raw = JSON.stringify({
      v: 1, state: "done", level: "warning", verifiedCount: 0, checks: [], unverified: [],
      issues: [{ severity: "warn", kind: "reading_numbers", source: "reading", ar: "a", fr: "b", where: 5, expected: {} }],
    });
    const i = parseVerdict(raw)!.issues[0];
    expect(i.source).toBe("reading");
    expect(i.where).toBeUndefined();
    expect(i.expected).toBeUndefined();
  });
});
