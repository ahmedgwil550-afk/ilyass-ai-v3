import type { ChunkResult, ExtractionWarning } from "./curriculumChunker.ts";
import type { SeedSource } from "./curriculumSeedSql.ts";

export interface ReviewInput {
  source: SeedSource;
  fileName: string;
  result: ChunkResult;
  warnings: ExtractionWarning[];
}

/** Which passages a reviewer should read: the first, the last, and a few from the middle. */
export function samplePassageIndexes(count: number, wanted = 5): number[] {
  if (count <= wanted) return Array.from({ length: count }, (_, index) => index);
  const picks = new Set<number>([0, count - 1]);
  for (let step = 1; picks.size < wanted; step++) {
    picks.add(Math.round((step * (count - 1)) / (wanted - 1)));
    if (step > wanted * 2) break;
  }
  return [...picks].sort((a, b) => a - b);
}

function preview(text: string, length = 400): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > length ? flat.slice(0, length) + "…" : flat;
}

/** Markdown report that a person reads before marking a source verified. */
export function buildReviewReport({ source, fileName, result, warnings }: ReviewInput): string {
  const sizes = result.chunks.map((chunk) => chunk.content.length);
  const total = sizes.reduce((sum, size) => sum + size, 0);
  const average = sizes.length ? Math.round(total / sizes.length) : 0;
  const searchable = source.isOfficial && source.verified;

  const lines: string[] = [
    "# Curriculum ingestion review",
    "",
    "## Source",
    `- File: ${fileName}`,
    `- SHA-256: ${source.sourceHash}`,
    `- Title: ${source.title}`,
    `- Publisher: ${source.sourceName}`,
    `- URL: ${source.sourceUrl}`,
    `- Subject / grade / track: ${source.subject} / ${source.grade} / ${source.track ?? "-"}`,
    `- Document type: ${source.docType}`,
    `- Year: ${source.sourceYear ?? "-"}`,
    `- Marked official: ${source.isOfficial ? "yes" : "no"}`,
    `- Marked verified: ${source.verified ? "yes" : "no"}`,
    `- **Visible to students after import: ${searchable ? "YES" : "NO"}**`,
    "",
    "## Extraction",
    `- Pages: ${result.pages}`,
    `- Passages: ${result.chunks.length} (average ${average} characters, longest ${Math.max(0, ...sizes)})`,
  ];

  if (warnings.length) {
    lines.push("", "## Warnings");
    for (const warning of warnings) lines.push(`- **${warning.code}**: ${warning.message}`);
  } else {
    lines.push("- No extraction warnings.");
  }

  if (result.removedLines.length) {
    lines.push("", "## Lines removed as headers, footers or page numbers");
    for (const line of result.removedLines) lines.push(`- ${line}`);
  }
  if (result.droppedFragments.length) {
    lines.push("", "## Fragments too short to keep (check that nothing important was lost)");
    for (const fragment of result.droppedFragments) lines.push(`- ${preview(fragment, 120)}`);
  }

  lines.push("", "## Passages to compare with the original PDF");
  for (const index of samplePassageIndexes(result.chunks.length)) {
    const chunk = result.chunks[index];
    const where = chunk.metadata.pageEnd
      ? `pages ${chunk.metadata.page}-${chunk.metadata.pageEnd}`
      : `page ${chunk.metadata.page}`;
    lines.push("", `### Passage ${index + 1} of ${result.chunks.length} (${where})`);
    if (chunk.metadata.heading) lines.push(`Heading: ${chunk.metadata.heading}`);
    lines.push("", "> " + preview(chunk.content).replaceAll("\n", " "));
  }

  lines.push(
    "",
    "## Before marking this source verified",
    "- [ ] The URL above is the official publisher page, and the file really is that document.",
    "- [ ] The passages above match the same pages of the original word for word (digits, formulas, Arabic letters, accents).",
    "- [ ] The language direction is right (Arabic reads right to left, no reversed words).",
    "- [ ] Tables, formulas and marking-scheme points (barème) are not scrambled.",
    "",
    "Only then re-run with --official --verified, or run the verify statement from the seed file.",
    "",
  );
  return lines.join("\n");
}
