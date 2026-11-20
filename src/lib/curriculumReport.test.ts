import { describe, expect, it } from "vitest";
import { buildReviewReport, samplePassageIndexes } from "./curriculumReport";
import type { ChunkResult } from "./curriculumChunker";
import type { SeedSource } from "./curriculumSeedSql";

// Invented data used only to exercise the report builder.
const source: SeedSource = {
  title: "TEST exam",
  sourceName: "TEST ONLY",
  sourceUrl: "https://example.test/exam.pdf",
  subject: "math",
  grade: "2bac",
  docType: "exam",
  isOfficial: true,
  verified: false,
  sourceHash: "b".repeat(64),
};

const result = (count: number): ChunkResult => ({
  pages: 3,
  removedLines: ["Page # / #"],
  droppedFragments: ["ab"],
  chunks: Array.from({ length: count }, (_, index) => ({
    content: "Passage numéro " + (index + 1) + " du document de test.",
    metadata: { page: index + 1, heading: "Exercice " + (index + 1) },
  })),
});

describe("samplePassageIndexes", () => {
  it("returns everything for a short document", () => {
    expect(samplePassageIndexes(0)).toEqual([]);
    expect(samplePassageIndexes(3)).toEqual([0, 1, 2]);
  });

  it("returns the first, the last and some of the middle, in order, for a long one", () => {
    const picks = samplePassageIndexes(20);

    expect(picks).toHaveLength(5);
    expect(picks[0]).toBe(0);
    expect(picks[picks.length - 1]).toBe(19);
    expect([...picks].sort((a, b) => a - b)).toEqual(picks);
    expect(new Set(picks).size).toBe(5);
  });
});

describe("buildReviewReport", () => {
  it("says plainly that an unverified source is hidden from students", () => {
    const report = buildReviewReport({
      source,
      fileName: "exam.pdf",
      result: result(2),
      warnings: [],
    });

    expect(report).toContain("Visible to students after import: NO");
    expect(report).toContain("No extraction warnings.");
    expect(report).toContain("SHA-256: " + "b".repeat(64));
  });

  it("says when the source will be visible", () => {
    const report = buildReviewReport({
      source: { ...source, verified: true },
      fileName: "exam.pdf",
      result: result(2),
      warnings: [],
    });

    expect(report).toContain("Visible to students after import: YES");
  });

  it("lists warnings, removed lines and dropped fragments for the reviewer", () => {
    const report = buildReviewReport({
      source,
      fileName: "exam.pdf",
      result: result(2),
      warnings: [{ code: "little-text", message: "Very little text per page." }],
    });

    expect(report).toContain("**little-text**: Very little text per page.");
    expect(report).toContain("- Page # / #");
    expect(report).toContain("Fragments too short to keep");
  });

  it("shows a bounded sample of passages with their pages, plus the checklist", () => {
    const report = buildReviewReport({
      source,
      fileName: "exam.pdf",
      result: result(30),
      warnings: [],
    });

    expect(report.match(/^### Passage /gm)).toHaveLength(5);
    expect(report).toContain("### Passage 1 of 30 (page 1)");
    expect(report).toContain("### Passage 30 of 30 (page 30)");
    expect(report).toContain("Before marking this source verified");
  });
});
