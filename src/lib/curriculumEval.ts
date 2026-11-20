import { normalizeCurriculumText } from "./curriculumText.ts";

/**
 * Measures whether the curriculum search finds the right passage for a question.
 * Cases are written by a person who has read the source document, so the expected
 * wording comes from the document, never from the search itself.
 */

export interface RelevantRule {
  /** Every one of these phrases must appear in the passage (compared after Arabic/French folding). */
  contentIncludes: string[];
  /** Optional: the document title must contain this text. */
  titleIncludes?: string;
}

export interface EvalCase {
  id: string;
  question: string;
  subject: string;
  grade?: string;
  track?: string;
  docTypes?: string[];
  /** A question the corpus cannot answer: the right result is no passage at all. */
  expectNothing?: boolean;
  relevant?: RelevantRule;
}

export interface EvalPassage {
  content: string;
  title: string;
}

export interface CaseScore {
  id: string;
  kind: "answerable" | "unanswerable";
  returned: number;
  /** 1-based position of the first relevant passage, or null. */
  rank: number | null;
  passed: boolean;
}

export interface EvalSummary {
  cases: number;
  answerable: number;
  unanswerable: number;
  /** Share of answerable cases whose first passage is relevant. */
  hitAt1: number;
  /** Share of answerable cases with a relevant passage anywhere in the results. */
  hitAtK: number;
  /** Mean of 1/rank over answerable cases (0 when nothing relevant was found). */
  mrr: number;
  /** Share of unanswerable cases that wrongly returned something. */
  falsePositiveRate: number;
}

function fold(text: string): string {
  return normalizeCurriculumText(text).replace(/\s+/g, " ");
}

export function isRelevant(passage: EvalPassage, rule: RelevantRule): boolean {
  const content = fold(passage.content);
  if (!rule.contentIncludes.every((phrase) => content.includes(fold(phrase)))) return false;
  return !rule.titleIncludes || fold(passage.title).includes(fold(rule.titleIncludes));
}

export function scoreCase(evalCase: EvalCase, passages: EvalPassage[]): CaseScore {
  if (evalCase.expectNothing) {
    return {
      id: evalCase.id,
      kind: "unanswerable",
      returned: passages.length,
      rank: null,
      passed: passages.length === 0,
    };
  }
  const index = passages.findIndex((passage) =>
    isRelevant(passage, evalCase.relevant as RelevantRule),
  );
  return {
    id: evalCase.id,
    kind: "answerable",
    returned: passages.length,
    rank: index === -1 ? null : index + 1,
    passed: index !== -1,
  };
}

export function summarize(scores: CaseScore[]): EvalSummary {
  const answerable = scores.filter((score) => score.kind === "answerable");
  const unanswerable = scores.filter((score) => score.kind === "unanswerable");
  const share = (count: number, total: number) => (total === 0 ? 0 : count / total);
  return {
    cases: scores.length,
    answerable: answerable.length,
    unanswerable: unanswerable.length,
    hitAt1: share(answerable.filter((score) => score.rank === 1).length, answerable.length),
    hitAtK: share(answerable.filter((score) => score.rank !== null).length, answerable.length),
    mrr: share(
      answerable.reduce((sum, score) => sum + (score.rank ? 1 / score.rank : 0), 0),
      answerable.length,
    ),
    falsePositiveRate: share(
      unanswerable.filter((score) => !score.passed).length,
      unanswerable.length,
    ),
  };
}

/** Checks a parsed JSON file and returns the cases, or throws an error that names the problem. */
export function validateCases(data: unknown): EvalCase[] {
  const list = (data as { cases?: unknown } | null)?.cases;
  if (!Array.isArray(list) || list.length === 0)
    throw new Error('The file must look like {"cases": [ ... ]} with at least one case.');
  const seen = new Set<string>();
  return list.map((item, position) => {
    const where = "case #" + (position + 1);
    const entry = item as Partial<EvalCase> | null;
    if (!entry || typeof entry !== "object") throw new Error(where + " is not an object.");
    if (typeof entry.id !== "string" || !entry.id) throw new Error(where + " needs an id.");
    if (seen.has(entry.id)) throw new Error(where + ": duplicate id " + entry.id);
    seen.add(entry.id);
    if (typeof entry.question !== "string" || !entry.question.trim())
      throw new Error(where + " (" + entry.id + ") needs a question.");
    if (typeof entry.subject !== "string" || !entry.subject)
      throw new Error(where + " (" + entry.id + ") needs a subject.");
    if (!entry.expectNothing) {
      const phrases = entry.relevant?.contentIncludes;
      if (
        !Array.isArray(phrases) ||
        phrases.length === 0 ||
        phrases.some((phrase) => typeof phrase !== "string" || !phrase.trim())
      ) {
        throw new Error(
          where + " (" + entry.id + ") needs relevant.contentIncludes, or expectNothing: true.",
        );
      }
    }
    return entry as EvalCase;
  });
}
