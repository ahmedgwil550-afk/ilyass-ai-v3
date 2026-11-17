import { describe, expect, it } from "vitest";
import type { Verdict } from "./verification";
import { DISCLAIMER, SOURCE_LABEL, headline, issueText, splitIssues, viewLang } from "./verificationView";

const v = (over: Partial<Verdict>): Verdict => ({ v: 1, state: "done", level: "verified", verifiedCount: 0, checks: [], issues: [], unverified: [], ...over });
const issue = (severity: "info" | "warn" | "error") => ({ severity, kind: "k", ar: "عربي", fr: "français", source: "code" as const });

describe("verificationView", () => {
  it("لا عنوان عندما لم يُفحص شيء", () => expect(headline(v({ level: "unchecked" }), "ar")).toBeNull());

  it("يعدّ العناصر المثبتة والملاحظات (info لا تُحسب)", () => {
    expect(headline(v({ level: "verified", verifiedCount: 5 }), "ar")).toEqual({ title: "اجتازت التحقق الآلي", sub: "تم التحقق من 5 عناصر" });
    expect(headline(v({ level: "warning", verifiedCount: 1, issues: [issue("warn"), issue("info")] }), "fr"))
      .toEqual({ title: "Points à revoir", sub: "1 élément confirmé · 1 point" });
    expect(headline(v({ level: "error", issues: [issue("error"), issue("warn")] }), "ar")?.sub).toBe("ملاحظتان");
  });

  it("تمييز العدد في العربية", () => {
    const sub = (n: number) => headline(v({ level: "verified", verifiedCount: n }), "ar")?.sub;
    expect(sub(1)).toBe("تم التحقق من عنصر واحد");
    expect(sub(2)).toBe("تم التحقق من عنصرين");
    expect(sub(10)).toBe("تم التحقق من 10 عناصر");
    expect(sub(11)).toBe("تم التحقق من 11 عنصراً");
    const iss = (k: number) => headline(v({ level: "warning", issues: Array.from({ length: k }, () => issue("warn")) }), "ar")?.sub;
    expect(iss(1)).toBe("ملاحظة واحدة");
    expect(iss(3)).toBe("3 ملاحظات");
  });

  it("لا شيء ثبت لكن هناك ما تعذّر فحصه: عنوان «تعذر التحقق» صريح", () => {
    const u = [{ ar: "قراءة الصورة لم تُفحص", fr: "Lecture non vérifiée" }];
    expect(headline(v({ level: "unchecked", unverified: u }), "ar")).toEqual({ title: "تعذر التحقق من أجزاء من الإجابة", sub: "" });
    expect(headline(v({ level: "unchecked", unverified: u }), "fr")?.title).toBe("Vérification impossible pour certaines parties");
    expect(headline(v({ level: "unchecked", unverified: [] }), "ar")).toBeNull();
  });

  it("يذكر عدد ما تعذّر التحقق منه إلى جانب ما ثبت", () => {
    const u = (n: number) => Array.from({ length: n }, () => ({ ar: "x", fr: "y" }));
    expect(headline(v({ level: "verified", verifiedCount: 2, unverified: u(1) }), "ar")?.sub).toBe("تم التحقق من عنصرين · تعذر التحقق من جزء واحد");
    expect(headline(v({ level: "verified", verifiedCount: 2, unverified: u(2) }), "ar")?.sub).toContain("جزأين");
    expect(headline(v({ level: "verified", verifiedCount: 2, unverified: u(3) }), "ar")?.sub).toContain("3 أجزاء");
    expect(headline(v({ level: "warning", unverified: u(2) }), "fr")?.sub).toBe("2 parties non vérifiées");
  });

  it("مصادر جديدة بوسوم، وفصل ملاحظات المنهج عن الأدلة", () => {
    expect(SOURCE_LABEL.reading.ar).toContain("قراءتين");
    expect(SOURCE_LABEL.method.ar).toContain("اقتراح");
    const m = { ...issue("info"), source: "method" as const };
    const r = splitIssues([issue("warn"), m]);
    expect(r.findings).toHaveLength(1);
    expect(r.method).toEqual([m]);
  });

  it("الفرنسية لأي لغة غير العربية", () => {
    expect(viewLang("ar")).toBe("ar");
    expect(viewLang("fr")).toBe("fr");
    expect(viewLang("en")).toBe("fr");
  });

  it("نص الملاحظة بلغة العرض مع احتياط للأخرى", () => {
    expect(issueText(issue("warn"), "fr")).toBe("français");
    expect(issueText({ ...issue("warn"), fr: "" }, "fr")).toBe("عربي");
  });

  it("لا يَعِد بما لا يضمنه", () => {
    expect(DISCLAIMER.ar).toContain("لا يغني عن مراجعة أستاذك");
    expect(DISCLAIMER.fr).toContain("ne remplace pas ton professeur");
  });
});
