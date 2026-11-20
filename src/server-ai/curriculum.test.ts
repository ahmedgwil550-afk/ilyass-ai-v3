import { describe, expect, it } from "vitest";
import { curriculumPrompt, searchCurriculum, type CurriculumChunk } from "./curriculum";

const URL_ = "https://db.example";
const KEY = "service-key";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// Invented rows used only to exercise the search wiring; they are not curriculum content.
const row = (over: Partial<CurriculumChunk> = {}): CurriculumChunk => ({
  chunk_id: "c1",
  source_id: "s1",
  content: "نهاية دالة عند اللانهاية وحساب النهايات",
  title: "TEST lesson",
  source_name: "TEST",
  source_url: "https://example.test/1",
  source_year: 2024,
  subject: "math",
  grade: "2bac",
  track: null,
  doc_type: "lesson",
  rank: 0.2,
  ...over,
});

interface Call {
  name: string;
  body: Record<string, unknown>;
  headers: Record<string, string>;
}

function fakeDb(handler: (name: string) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: URL | string, init?: RequestInit) => {
    const name = String(input).split("/rpc/")[1];
    calls.push({
      name,
      body: JSON.parse(String(init?.body)),
      headers: init?.headers as Record<string, string>,
    });
    return handler(name);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const base = {
  url: URL_,
  key: KEY,
  subject: "math",
  question: "ما هي نهاية الدالة عند اللانهاية ؟",
};

describe("searchCurriculum", () => {
  it("sends the meaningful words of the question to the v2 function", async () => {
    const db = fakeDb(() => json([row()]));
    const result = await searchCurriculum({ ...base, fetchImpl: db.fetchImpl });

    expect(result).toHaveLength(1);
    expect(db.calls).toHaveLength(1);
    expect(db.calls[0].name).toBe("search_curriculum_chunks_v2");
    expect(db.calls[0].body.search_terms).toEqual(["اللانهاية", "الدالة", "نهاية"]);
    expect(db.calls[0].body.filter_subject).toBe("math");
    expect(db.calls[0].body.filter_grade).toBe("2bac");
    expect(db.calls[0].body.filter_doc_types).toBeNull();
    expect(db.calls[0].headers["Authorization"]).toBe("Bearer " + KEY);
  });

  it("passes the track and the requested document types through", async () => {
    const db = fakeDb(() => json([row({ doc_type: "correction" })]));
    await searchCurriculum({
      ...base,
      track: "pc",
      docTypes: ["correction", "exam"],
      fetchImpl: db.fetchImpl,
    });

    expect(db.calls[0].body.filter_track).toBe("pc");
    expect(db.calls[0].body.filter_doc_types).toEqual(["correction", "exam"]);
  });

  it("drops a passage that shares only one word with a multi-word question", async () => {
    const weak = row({
      chunk_id: "weak",
      source_id: "s2",
      content: "الدوال في الفيزياء: حركة وسرعة الدالة",
    });
    const db = fakeDb(() => json([weak, row()]));
    const result = await searchCurriculum({ ...base, fetchImpl: db.fetchImpl });

    expect(result.map((item) => item.chunk_id)).toEqual(["c1"]);
  });

  it("falls back to the original function when v2 is not installed yet", async () => {
    const db = fakeDb((name) =>
      name === "search_curriculum_chunks_v2" ? json({ code: "PGRST202" }, 404) : json([row()]),
    );
    const result = await searchCurriculum({ ...base, fetchImpl: db.fetchImpl });

    expect(db.calls.map((call) => call.name)).toEqual([
      "search_curriculum_chunks_v2",
      "search_curriculum_chunks",
    ]);
    expect(db.calls[1].body.search_query).toBe(base.question);
    expect(result).toHaveLength(1);
  });

  it("does not fall back when a document type was requested, because the old function cannot filter", async () => {
    const db = fakeDb(() => json({ code: "PGRST202" }, 404));
    const result = await searchCurriculum({
      ...base,
      docTypes: ["correction"],
      fetchImpl: db.fetchImpl,
    });

    expect(result).toEqual([]);
    expect(db.calls).toHaveLength(1);
  });

  it("returns an empty list instead of throwing when the database fails", async () => {
    const failing = fakeDb(() => json({ message: "boom" }, 500));
    expect(await searchCurriculum({ ...base, fetchImpl: failing.fetchImpl })).toEqual([]);

    const throwing = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    expect(await searchCurriculum({ ...base, fetchImpl: throwing })).toEqual([]);

    const garbage = fakeDb(() => json({ not: "an array" }));
    expect(await searchCurriculum({ ...base, fetchImpl: garbage.fetchImpl })).toEqual([]);
  });

  it("ignores rows that do not come from an https source", async () => {
    const db = fakeDb(() =>
      json([row({ source_url: "http://insecure.test/x" }), row({ chunk_id: "ok" })]),
    );
    const result = await searchCurriculum({ ...base, fetchImpl: db.fetchImpl });

    expect(result.map((item) => item.chunk_id)).toEqual(["ok"]);
  });

  it("does not call the database without credentials, a subject, or real words", async () => {
    const db = fakeDb(() => json([row()]));
    await searchCurriculum({ ...base, key: "", fetchImpl: db.fetchImpl });
    await searchCurriculum({ ...base, subject: "", fetchImpl: db.fetchImpl });
    await searchCurriculum({ ...base, question: "ما هي هذا ؟", fetchImpl: db.fetchImpl });
    await searchCurriculum({ ...base, question: "؟", fetchImpl: db.fetchImpl });

    expect(db.calls).toHaveLength(0);
  });

  it("never returns more than eight passages", async () => {
    const rows = Array.from({ length: 12 }, (_, index) =>
      row({ chunk_id: "c" + index, source_id: "s" + index }),
    );
    const db = fakeDb(() => json(rows));
    const result = await searchCurriculum({ ...base, limit: 50, fetchImpl: db.fetchImpl });

    expect(result).toHaveLength(8);
  });
});

describe("curriculumPrompt", () => {
  it("is empty without passages", () => {
    expect(curriculumPrompt([])).toBe("");
  });

  it("labels each passage with its source, year, document type and page", () => {
    const prompt = curriculumPrompt([
      row({
        doc_type: "correction",
        metadata: { page: 3 },
        title: "Examen national",
        source_year: 2023,
      }),
    ]);

    expect(prompt).toContain(
      "[Source 1] Examen national — TEST (2023), official correction and marking scheme, p. 3",
    );
    expect(prompt).toContain("URL: https://example.test/1");
    expect(prompt).toContain("<curriculum_references>");
  });

  it("omits the type and page when the database does not provide them", () => {
    const prompt = curriculumPrompt([row({ doc_type: undefined, metadata: undefined })]);

    expect(prompt).toContain("[Source 1] TEST lesson — TEST (2024)\n");
  });
});
