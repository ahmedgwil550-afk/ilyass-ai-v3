import { describe, expect, it } from "vitest";
import { buildChunkRows, buildSourceRow, ingestBodySchema, isSearchable } from "./curriculumIngest";

// Invented payload used only to exercise validation; not curriculum content.
const base = {
  title: "TEST exam",
  sourceName: "TEST ONLY",
  sourceUrl: "https://example.test/exam.pdf",
  subject: "math",
  chunks: ["Un passage de test suffisamment long."],
};

const parse = (over: Record<string, unknown> = {}) =>
  ingestBodySchema.safeParse({ ...base, ...over });

describe("ingestBodySchema", () => {
  it("accepts plain text chunks and chunks with page metadata, and defaults to hidden", () => {
    const parsed = parse({
      chunks: [
        "Un passage de test suffisamment long.",
        { content: "Un autre passage de test long.", metadata: { page: 2 } },
      ],
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.grade).toBe("2bac");
      expect(parsed.data.isOfficial).toBe(false);
      expect(parsed.data.verified).toBe(false);
    }
  });

  it("accepts a document type and a file hash", () => {
    expect(parse({ docType: "correction", sourceHash: "c".repeat(64) }).success).toBe(true);
  });

  it("rejects anything that is not a clean, https, known-subject source", () => {
    expect(parse({ sourceUrl: "http://example.test/x" }).success).toBe(false);
    expect(parse({ subject: "geography" }).success).toBe(false);
    expect(parse({ docType: "rumour" }).success).toBe(false);
    expect(parse({ sourceHash: "not-a-hash" }).success).toBe(false);
    expect(parse({ sourceHash: "C".repeat(64) }).success).toBe(false);
    expect(parse({ unexpected: true }).success).toBe(false);
  });

  it("rejects empty, too short, and too many chunks", () => {
    expect(parse({ chunks: [] }).success).toBe(false);
    expect(parse({ chunks: ["trop court"] }).success).toBe(false);
    expect(
      parse({ chunks: [{ content: "Un autre passage de test long.", extra: 1 }] }).success,
    ).toBe(false);
    expect(
      parse({ chunks: Array(401).fill("Un passage de test suffisamment long.") }).success,
    ).toBe(false);
    expect(
      parse({ chunks: Array(400).fill("Un passage de test suffisamment long.") }).success,
    ).toBe(true);
  });
});

describe("isSearchable", () => {
  it("needs both official and verified", () => {
    expect(isSearchable({ isOfficial: true, verified: true })).toBe(true);
    expect(isSearchable({ isOfficial: true, verified: false })).toBe(false);
    expect(isSearchable({ isOfficial: false, verified: true })).toBe(false);
    expect(isSearchable({ isOfficial: false, verified: false })).toBe(false);
  });
});

describe("buildSourceRow", () => {
  const body = (over: Record<string, unknown> = {}) => {
    const parsed = parse(over);
    if (!parsed.success) throw new Error("fixture should be valid");
    return parsed.data;
  };
  const NOW = new Date("2026-11-20T10:00:00.000Z");

  it("stamps verified_at only for an official, verified source", () => {
    expect(buildSourceRow(body({ isOfficial: true, verified: true }), NOW).verified_at).toBe(
      "2026-11-20T10:00:00.000Z",
    );
    expect(buildSourceRow(body({ isOfficial: true, verified: false }), NOW).verified_at).toBeNull();
    expect(buildSourceRow(body({ isOfficial: false, verified: true }), NOW).verified_at).toBeNull();
  });

  it("leaves doc_type and source_hash out unless given, so older databases still accept the row", () => {
    const plain = buildSourceRow(body(), NOW);
    expect("doc_type" in plain).toBe(false);
    expect("source_hash" in plain).toBe(false);

    const full = buildSourceRow(body({ docType: "exam", sourceHash: "d".repeat(64) }), NOW);
    expect(full.doc_type).toBe("exam");
    expect(full.source_hash).toBe("d".repeat(64));
  });

  it("maps the camelCase fields to table columns", () => {
    const row = buildSourceRow(body({ track: "pc", sourceYear: 2023 }), NOW);

    expect(row).toMatchObject({
      title: "TEST exam",
      source_name: "TEST ONLY",
      source_url: "https://example.test/exam.pdf",
      subject: "math",
      grade: "2bac",
      track: "pc",
      source_year: 2023,
      is_official: false,
    });
  });
});

describe("buildChunkRows", () => {
  it("numbers chunks from zero and carries metadata when there is some", () => {
    const rows = buildChunkRows("src-1", [
      "Un passage de test suffisamment long.",
      { content: "Un autre passage de test long.", metadata: { page: 2 } },
      { content: "Un troisième passage de test long." },
    ]);

    expect(rows[0]).toEqual({
      source_id: "src-1",
      chunk_index: 0,
      content: "Un passage de test suffisamment long.",
    });
    expect(rows[1]).toEqual({
      source_id: "src-1",
      chunk_index: 1,
      content: "Un autre passage de test long.",
      metadata: { page: 2 },
    });
    expect(rows[2]).toEqual({
      source_id: "src-1",
      chunk_index: 2,
      content: "Un troisième passage de test long.",
      metadata: {},
    });
  });
});
