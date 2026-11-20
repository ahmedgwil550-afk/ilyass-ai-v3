#!/usr/bin/env node
/**
 * Measures how well the curriculum search finds the right passage, against the real database.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   node scripts/curriculum-eval.ts cases.json [--min-hit 0.8] [--max-false-positive 0.1]
 *
 * cases.json is written by a person who has read the ingested documents (see
 * docs/curriculum-eval.example.json). Read-only: it only calls the search function.
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { scoreCase, summarize, validateCases, type CaseScore } from "../src/lib/curriculumEval.ts";
import { searchCurriculum, type CurriculumDocType } from "../src/server-ai/curriculum.ts";

function fail(message: string): never {
  console.error("Error: " + message);
  process.exit(1);
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    "min-hit": { type: "string" },
    "max-false-positive": { type: "string" },
  },
});

const file = positionals[0];
if (!file) fail("Give the cases file as the first argument.");
if (!process.env["SUPABASE_URL"] || !process.env["SUPABASE_SERVICE_ROLE_KEY"]) {
  fail("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
}

let cases;
try {
  cases = validateCases(JSON.parse(readFileSync(file, "utf8")));
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

const scores: CaseScore[] = [];
for (const evalCase of cases) {
  const passages = await searchCurriculum({
    question: evalCase.question,
    subject: evalCase.subject,
    grade: evalCase.grade,
    track: evalCase.track,
    docTypes: evalCase.docTypes as CurriculumDocType[] | undefined,
  });
  const score = scoreCase(evalCase, passages);
  scores.push(score);
  const rank = score.kind === "answerable" ? "rank=" + (score.rank ?? "-") : "expected nothing";
  console.log(
    `${score.passed ? "PASS" : "FAIL"}  ${score.id}  ${rank}  returned=${score.returned}`,
  );
}

const summary = summarize(scores);
const percent = (value: number) => (value * 100).toFixed(1) + "%";
console.log("");
console.log(
  `Cases: ${summary.cases} (${summary.answerable} answerable, ${summary.unanswerable} unanswerable)`,
);
console.log(
  `hit@1 ${percent(summary.hitAt1)}   hit@k ${percent(summary.hitAtK)}   MRR ${summary.mrr.toFixed(3)}   false positives ${percent(summary.falsePositiveRate)}`,
);

if (scores.every((score) => score.returned === 0)) {
  console.log(
    "\nNo case returned any passage. Check that migration 20261120000100 is applied, that sources are marked official AND verified, and that the subject names match.",
  );
}

let failed = false;
if (values["min-hit"] !== undefined && summary.hitAtK < Number(values["min-hit"])) {
  console.error(
    `hit@k ${percent(summary.hitAtK)} is below the required ${percent(Number(values["min-hit"]))}.`,
  );
  failed = true;
}
if (
  values["max-false-positive"] !== undefined &&
  summary.falsePositiveRate > Number(values["max-false-positive"])
) {
  console.error(
    `False positives ${percent(summary.falsePositiveRate)} exceed the allowed ${percent(Number(values["max-false-positive"]))}.`,
  );
  failed = true;
}
process.exit(failed ? 1 : 0);
