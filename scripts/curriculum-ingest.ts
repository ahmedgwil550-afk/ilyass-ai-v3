#!/usr/bin/env node
/**
 * Prepares an official curriculum document (PDF, or text already extracted from it) for the
 * curriculum knowledge base. It writes a review report and a SQL seed file; nothing is sent
 * anywhere and the database is never touched by this script.
 *
 *   node scripts/curriculum-ingest.ts <file.pdf|file.txt> \
 *     --title "..." --source-name "..." --source-url https://... --subject math \
 *     [--doc-type exam|correction|lesson|framework|guide] [--grade 2bac] [--track ...] [--year 2023] \
 *     [--official] [--verified] [--out seed.sql] [--report review.md] [--json payload.json] [--force]
 *
 * Without --official and --verified the source is stored but students never see it.
 * --verified is a statement that you compared the extracted text with the original official
 * document. Run once without it, read the report, then run again with it.
 *
 * Needs Node 22.18+ (runs TypeScript directly) and, for PDFs, `pdftotext` (poppler-utils).
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { chunkDocument, diagnoseExtractedText } from "../src/lib/curriculumChunker.ts";
import { buildReviewReport } from "../src/lib/curriculumReport.ts";
import { buildSeedSql, buildVerifySql, type SeedSource } from "../src/lib/curriculumSeedSql.ts";

const SUBJECTS = [
  "math",
  "physics",
  "chemistry",
  "biology",
  "french",
  "arabic",
  "english",
  "philosophy",
  "history",
  "islamic",
];
const DOC_TYPES = ["framework", "lesson", "exam", "correction", "guide"];

function fail(message: string): never {
  console.error("Error: " + message);
  process.exit(1);
}

function extractText(path: string): string {
  if (extname(path).toLowerCase() !== ".pdf") return readFileSync(path, "utf8");
  const run = spawnSync("pdftotext", ["-layout", "-enc", "UTF-8", path, "-"], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (run.error)
    fail(
      "pdftotext is not installed (poppler-utils). Extract the text yourself and pass the .txt file instead.",
    );
  if (run.status !== 0) fail("pdftotext failed: " + run.stderr.trim());
  return run.stdout;
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    title: { type: "string" },
    "source-name": { type: "string" },
    "source-url": { type: "string" },
    subject: { type: "string" },
    "doc-type": { type: "string", default: "lesson" },
    grade: { type: "string", default: "2bac" },
    track: { type: "string" },
    year: { type: "string" },
    official: { type: "boolean", default: false },
    verified: { type: "boolean", default: false },
    out: { type: "string" },
    report: { type: "string" },
    json: { type: "string" },
    force: { type: "boolean", default: false },
  },
});

const file = positionals[0];
if (!file) fail("Give the PDF or text file to ingest as the first argument.");
if (!values.title) fail("--title is required.");
if (!values["source-name"])
  fail("--source-name is required (who published it, e.g. the ministry or the exam authority).");
if (!values["source-url"]?.startsWith("https://"))
  fail("--source-url must be the https:// address of the official page.");
if (!values.subject || !SUBJECTS.includes(values.subject))
  fail("--subject must be one of: " + SUBJECTS.join(", "));
if (!DOC_TYPES.includes(values["doc-type"] as string))
  fail("--doc-type must be one of: " + DOC_TYPES.join(", "));
if (values.verified && !values.official)
  fail("--verified only makes sense together with --official.");
const year = values.year ? Number(values.year) : undefined;
if (year !== undefined && !(Number.isInteger(year) && year >= 1990 && year <= 2100))
  fail("--year must be between 1990 and 2100.");

const bytes = readFileSync(file);
const source: SeedSource = {
  title: values.title,
  sourceName: values["source-name"],
  sourceUrl: values["source-url"],
  subject: values.subject,
  grade: values.grade as string,
  track: values.track,
  sourceYear: year,
  docType: values["doc-type"] as string,
  isOfficial: values.official as boolean,
  verified: values.verified as boolean,
  sourceHash: createHash("sha256").update(bytes).digest("hex"),
};

const text = extractText(file);
const result = chunkDocument(text);
const warnings = diagnoseExtractedText(text, result.pages);

const stem = basename(file, extname(file));
const reportPath = values.report ?? stem + ".review.md";
writeFileSync(
  reportPath,
  buildReviewReport({ source, fileName: basename(file), result, warnings }),
);
console.log(
  `Pages: ${result.pages}   Passages: ${result.chunks.length}   Warnings: ${warnings.length}`,
);
console.log("Review report: " + reportPath);

const blocking = warnings.filter(
  (warning) => warning.code === "no-text" || warning.code === "reversed-arabic",
);
if (blocking.length && !values.force) {
  for (const warning of blocking) console.error("Blocked: " + warning.message);
  fail(
    "The extracted text is not usable, so no seed file was written. Fix the extraction (or pass --force to override).",
  );
}
if (!result.chunks.length) fail("No passages were produced.");

const seedPath = values.out ?? stem + ".seed.sql";
writeFileSync(
  seedPath,
  buildSeedSql(source, result.chunks) +
    "\n-- To make this source searchable later, after checking the text:\n-- " +
    buildVerifySql(source.sourceHash).replaceAll("\n", "\n-- "),
);
console.log("SQL seed: " + seedPath);

if (values.json) {
  const payload = {
    title: source.title,
    sourceName: source.sourceName,
    sourceUrl: source.sourceUrl,
    subject: source.subject,
    grade: source.grade,
    ...(source.track ? { track: source.track } : {}),
    ...(source.sourceYear ? { sourceYear: source.sourceYear } : {}),
    docType: source.docType,
    sourceHash: source.sourceHash,
    isOfficial: source.isOfficial,
    verified: source.verified,
    chunks: result.chunks,
  };
  writeFileSync(values.json, JSON.stringify(payload));
  console.log(
    "API payload: " +
      values.json +
      (result.chunks.length > 400 ? "  (more than 400 passages: use the SQL seed instead)" : ""),
  );
}

console.log(
  source.isOfficial && source.verified
    ? "This source WILL be visible to students. You stated that you compared the text with the original official document."
    : "This source will NOT be visible to students until it is marked official and verified.",
);
