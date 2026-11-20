import { describe, expect, it } from "vitest";
import { isRelevant, scoreCase, summarize, validateCases, type EvalCase } from "./curriculumEval";

// Invented passages used only to exercise the metrics; they are not curriculum content.
const passage = (content: string, title = "TEST lesson") => ({ content, title });

const answerable: EvalCase = {
  id: "q1",
  question: "ما هي نهاية الدالة عند اللانهاية ؟",
  subject: "math",
  relevant: { contentIncludes: ["نهاية دالة", "اللانهاية"] },
};

describe("isRelevant", () => {
  it("needs every phrase, compared after Arabic and French folding", () => {
    expect(
      isRelevant(passage("نهايةُ دالةٍ عند اللانهاية"), {
        contentIncludes: ["نهاية دالة", "لانهاية"],
      }),
    ).toBe(true);
    expect(
      isRelevant(passage("Équations différentielles"), {
        contentIncludes: ["equations", "differentielles"],
      }),
    ).toBe(true);
    expect(
      isRelevant(passage("نهاية دالة فقط"), { contentIncludes: ["نهاية دالة", "اللانهاية"] }),
    ).toBe(false);
  });

  it("can also require part of the document title", () => {
    const rule = { contentIncludes: ["limite"], titleIncludes: "examen" };
    expect(isRelevant(passage("la limite", "Examen national"), rule)).toBe(true);
    expect(isRelevant(passage("la limite", "Cours"), rule)).toBe(false);
  });
});

describe("scoreCase", () => {
  it("records the 1-based position of the first relevant passage", () => {
    const hit = passage("نهاية دالة عند اللانهاية");
    expect(scoreCase(answerable, [passage("شيء آخر"), hit])).toEqual({
      id: "q1",
      kind: "answerable",
      returned: 2,
      rank: 2,
      passed: true,
    });
    expect(scoreCase(answerable, [passage("شيء آخر")])).toEqual({
      id: "q1",
      kind: "answerable",
      returned: 1,
      rank: null,
      passed: false,
    });
    expect(scoreCase(answerable, [])).toEqual({
      id: "q1",
      kind: "answerable",
      returned: 0,
      rank: null,
      passed: false,
    });
  });

  it("passes an unanswerable question only when nothing is returned", () => {
    const outside: EvalCase = {
      id: "n1",
      question: "recette du couscous",
      subject: "math",
      expectNothing: true,
    };
    expect(scoreCase(outside, []).passed).toBe(true);
    expect(scoreCase(outside, [passage("نهاية دالة")]).passed).toBe(false);
  });
});

describe("summarize", () => {
  it("computes hit@1, hit@k, MRR and the false-positive rate", () => {
    const scores = [
      { id: "a", kind: "answerable" as const, returned: 3, rank: 1, passed: true },
      { id: "b", kind: "answerable" as const, returned: 3, rank: 2, passed: true },
      { id: "c", kind: "answerable" as const, returned: 0, rank: null, passed: false },
      { id: "d", kind: "answerable" as const, returned: 2, rank: 4, passed: true },
      { id: "n1", kind: "unanswerable" as const, returned: 0, rank: null, passed: true },
      { id: "n2", kind: "unanswerable" as const, returned: 2, rank: null, passed: false },
    ];
    const summary = summarize(scores);

    expect(summary.cases).toBe(6);
    expect(summary.answerable).toBe(4);
    expect(summary.unanswerable).toBe(2);
    expect(summary.hitAt1).toBeCloseTo(0.25, 5);
    expect(summary.hitAtK).toBeCloseTo(0.75, 5);
    expect(summary.mrr).toBeCloseTo((1 + 0.5 + 0 + 0.25) / 4, 5);
    expect(summary.falsePositiveRate).toBeCloseTo(0.5, 5);
  });

  it("does not divide by zero for an empty group", () => {
    expect(summarize([])).toEqual({
      cases: 0,
      answerable: 0,
      unanswerable: 0,
      hitAt1: 0,
      hitAtK: 0,
      mrr: 0,
      falsePositiveRate: 0,
    });
  });
});

describe("validateCases", () => {
  it("accepts well-formed cases", () => {
    expect(
      validateCases({
        cases: [answerable, { id: "n", question: "x", subject: "math", expectNothing: true }],
      }),
    ).toHaveLength(2);
  });

  it("names the problem when a case is malformed", () => {
    expect(() => validateCases({})).toThrow();
    expect(() => validateCases({ cases: [] })).toThrow();
    expect(() =>
      validateCases({
        cases: [{ question: "q", subject: "math", relevant: { contentIncludes: ["a"] } }],
      }),
    ).toThrow();
    expect(() => validateCases({ cases: [answerable, answerable] })).toThrow();
    expect(() => validateCases({ cases: [{ id: "x", question: "q", subject: "math" }] })).toThrow();
    expect(() =>
      validateCases({
        cases: [{ id: "x", question: "q", subject: "math", relevant: { contentIncludes: [] } }],
      }),
    ).toThrow();
  });
});
