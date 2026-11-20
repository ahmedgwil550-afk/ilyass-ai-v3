import { describe, expect, it } from "vitest";
import { encodeVerification, type Verdict } from "./verification";
import {
  MAX_UNREADABLE_REPLY_CHARS,
  hasVisibleAnswer,
  pickAnswerToKeep,
  shouldRetryWithOcr,
  visibleAnswer,
} from "./answerSafety";

const verdict: Verdict = {
  v: 1,
  state: "done",
  level: "warning",
  verifiedCount: 0,
  checks: [],
  issues: [
    {
      severity: "warn",
      kind: "reading",
      ar: "بعض الأرقام غير واضحة في الصورة، جرّب صورة أوضح.",
      fr: "Certains chiffres sont illisibles.",
      source: "reading",
    },
  ],
  unverified: [],
};

const thinking = "<thinking>\n- فريق Pananachi\n</thinking>\n";
const longSolution = "## التمرين الأول\n" + "نحسب المشتقة ثم نحل المعادلة. ".repeat(60);

describe("visibleAnswer", () => {
  it("removes the thinking block and the verification block", () => {
    const raw = thinking + "الجواب: 12" + encodeVerification(verdict);
    expect(visibleAnswer(raw)).toBe("الجواب: 12");
  });

  it("is empty while only the thinking block has arrived", () => {
    expect(visibleAnswer("<thinking>\n- قراءة الورقة…")).toBe("");
    expect(hasVisibleAnswer("<thinking>\n- قراءة الورقة…")).toBe(false);
  });
});

describe("shouldRetryWithOcr", () => {
  const base = { hasImages: true, alreadyRetried: false, modelMode: "accurate" };

  it("retries a short reply that says the photo cannot be read", () => {
    expect(shouldRetryWithOcr({ ...base, rawAnswer: "الصورة غير واضحة، أرسل صورة أوضح." })).toBe(true);
  });

  it("never retries Pananachi, whatever the reply says", () => {
    expect(shouldRetryWithOcr({ ...base, modelMode: "panache", rawAnswer: "الصورة غير واضحة." })).toBe(false);
  });

  it("does not retry when there is no photo or the retry already happened", () => {
    expect(shouldRetryWithOcr({ ...base, hasImages: false, rawAnswer: "الصورة غير واضحة." })).toBe(false);
    expect(shouldRetryWithOcr({ ...base, alreadyRetried: true, rawAnswer: "الصورة غير واضحة." })).toBe(false);
  });

  it("does not throw away a full solution that mentions one unclear detail", () => {
    const raw = longSolution + "\nالرقم في السطر الثالث غير واضح فاعتمدت 4.";
    expect(visibleAnswer(raw).length).toBeGreaterThan(MAX_UNREADABLE_REPLY_CHARS);
    expect(shouldRetryWithOcr({ ...base, rawAnswer: raw })).toBe(false);
  });

  it("ignores the words of the verification block", () => {
    // The paid answer is long and fine; only the verification note says "صورة أوضح".
    const raw = thinking + longSolution + encodeVerification(verdict);
    expect(shouldRetryWithOcr({ ...base, rawAnswer: raw })).toBe(false);
  });

  it("does not retry when nothing but thinking arrived", () => {
    expect(shouldRetryWithOcr({ ...base, rawAnswer: "<thinking>\n- الصورة غير واضحة" })).toBe(false);
  });
});

describe("pickAnswerToKeep", () => {
  it("keeps what arrived", () => {
    expect(pickAnswerToKeep("الجواب الجديد", "الجواب القديم")).toBe("الجواب الجديد");
  });

  it("falls back to the answer from before the retry", () => {
    expect(pickAnswerToKeep("<thinking>\n- بدأنا", "الجواب القديم")).toBe("الجواب القديم");
    expect(pickAnswerToKeep("", "الجواب القديم")).toBe("الجواب القديم");
  });

  it("returns an empty string when there is nothing to keep", () => {
    expect(pickAnswerToKeep("<thinking>\n- بدأنا", "")).toBe("");
    expect(pickAnswerToKeep("", "")).toBe("");
  });
});
