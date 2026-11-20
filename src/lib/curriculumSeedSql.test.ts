import { describe, expect, it } from "vitest";
import {
  buildSeedSql,
  buildVerifySql,
  pickDollarTag,
  sqlString,
  type SeedSource,
} from "./curriculumSeedSql";

const HASH = "a".repeat(64);

// Invented source used only to exercise the SQL builder.
const source: SeedSource = {
  title: "TEST exam",
  sourceName: "TEST ONLY",
  sourceUrl: "https://example.test/exam.pdf",
  subject: "math",
  grade: "2bac",
  docType: "exam",
  isOfficial: true,
  verified: false,
  sourceHash: HASH,
};

const chunk = (content: string, page = 1) => ({ content, metadata: { page } });

describe("sqlString", () => {
  it("doubles single quotes and drops NUL bytes", () => {
    expect(sqlString("l'équation")).toBe("'l''équation'");
    expect(sqlString("a" + String.fromCharCode(0) + "b")).toBe("'ab'");
  });
});

describe("pickDollarTag", () => {
  it("uses the first tag that no text mentions", () => {
    expect(pickDollarTag(["plain text"])).toBe("$c0$");
  });

  it("skips a tag found in a text, and one a text could complete by ending in its opening", () => {
    expect(pickDollarTag(["price $c0$ here"])).toBe("$c1$");
    expect(pickDollarTag(["ends with $c0", "$c1$ inside"])).toBe("$c2$");
  });
});

describe("buildSeedSql", () => {
  it("is idempotent on the file hash and inserts every passage in order", () => {
    const sql = buildSeedSql(source, [
      chunk("Premier passage du document."),
      chunk("Second passage du document.", 2),
    ]);

    expect(sql).toContain("ON CONFLICT (source_hash) WHERE source_hash IS NOT NULL DO NOTHING");
    expect(sql).toContain("'" + HASH + "'");
    expect(sql).toContain("(0, $c0$Premier passage du document.$c0$, '{\"page\":1}'::jsonb)");
    expect(sql).toContain("(1, $c0$Second passage du document.$c0$, '{\"page\":2}'::jsonb)");
  });

  it("keeps an unverified source invisible to students", () => {
    const sql = buildSeedSql(source, [chunk("Un passage assez long.")]);

    expect(sql).toContain("true, NULL, 'exam'");
    expect(sql).toContain("Searchable by students: NO");
  });

  it("makes a source searchable only when it is both official and verified", () => {
    const both = buildSeedSql({ ...source, verified: true }, [chunk("Un passage assez long.")]);
    const verifiedOnly = buildSeedSql({ ...source, isOfficial: false, verified: true }, [
      chunk("Un passage assez long."),
    ]);

    expect(both).toContain("true, now(), 'exam'");
    expect(both).toContain("Searchable by students: YES");
    expect(verifiedOnly).toContain("false, NULL, 'exam'");
  });

  it("writes optional fields as NULL or quoted values", () => {
    const without = buildSeedSql(source, [chunk("Un passage assez long.")]);
    const withBoth = buildSeedSql({ ...source, track: "pc", sourceYear: 2023 }, [
      chunk("Un passage assez long."),
    ]);

    expect(without).toContain("'math', '2bac', NULL,");
    expect(without).toContain("    NULL, true");
    expect(withBoth).toContain("'math', '2bac', 'pc',");
    expect(withBoth).toContain("    2023, true");
  });

  it("escapes quotes in text fields and in the JSON metadata", () => {
    const sql = buildSeedSql({ ...source, title: "L'examen national" }, [
      { content: "Un passage assez long.", metadata: { page: 1, heading: "Partie A : l'étude" } },
    ]);

    expect(sql).toContain("'L''examen national'");
    expect(sql).toContain('"heading":"Partie A : l\'\'étude"');
  });

  it("chooses a quote tag that the passage text cannot break", () => {
    const sql = buildSeedSql(source, [chunk("Prix: $c0$ et $c0 encore, rien d'autre.")]);

    expect(sql).toContain("$c1$Prix: $c0$ et $c0 encore, rien d'autre.$c1$");
  });
});

describe("buildVerifySql", () => {
  it("targets one source by its file hash and only if it is official", () => {
    const sql = buildVerifySql(HASH);

    expect(sql).toContain("SET verified_at = now()");
    expect(sql).toContain("source_hash = '" + HASH + "'");
    expect(sql).toContain("is_official = true");
  });
});
