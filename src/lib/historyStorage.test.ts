import { describe, expect, it } from "vitest";
import { HISTORY_KEY, saveHistoryEntry, type StorageLike } from "./historyStorage";

interface Entry {
  id: string;
  messages: { role: string; content: string; imagePreview?: string; imagePreviews?: string[] }[];
}

const photo = "data:image/jpeg;base64," + "A".repeat(2000);
const entry = (id: string, answer = "الجواب", withPhoto = true): Entry => ({
  id,
  messages: [
    { role: "user", content: "سؤال", ...(withPhoto ? { imagePreview: photo, imagePreviews: [photo] } : {}) },
    { role: "assistant", content: answer },
  ],
});

/** Storage that refuses any write larger than `limit` characters, like a full localStorage. */
function memoryStorage(limit = Infinity, initial?: Entry[]): StorageLike & { writes: number; raw(): string | null } {
  const data = new Map<string, string>();
  if (initial) data.set(HISTORY_KEY, JSON.stringify(initial));
  return {
    writes: 0,
    getItem: (k) => data.get(k) ?? null,
    setItem(k, v) {
      this.writes++;
      if (v.length > limit) throw new DOMException("quota", "QuotaExceededError");
      data.set(k, v);
    },
    raw: () => data.get(HISTORY_KEY) ?? null,
  };
}
const saved = (s: ReturnType<typeof memoryStorage>): Entry[] => JSON.parse(s.raw() ?? "[]");

describe("saveHistoryEntry", () => {
  it("puts the new conversation first and replaces one with the same id", () => {
    const s = memoryStorage(Infinity, [entry("a"), entry("b")]);
    expect(saveHistoryEntry(s, entry("b", "جواب محدَّث"))).toBe(true);
    const list = saved(s);
    expect(list.map((e) => e.id)).toEqual(["b", "a"]);
    expect(list[0].messages[1].content).toBe("جواب محدَّث");
  });

  it("caps the list at the maximum", () => {
    const many = Array.from({ length: 6 }, (_, i) => entry(`old${i}`, "x", false));
    const s = memoryStorage(Infinity, many);
    saveHistoryEntry(s, entry("new", "x", false), 4);
    expect(saved(s).map((e) => e.id)).toEqual(["new", "old0", "old1", "old2"]);
  });

  it("keeps the answer text when the photos make the write too big", () => {
    const old = [entry("a"), entry("b")];
    const fullSize = JSON.stringify([entry("n"), ...old]).length;
    const s = memoryStorage(Math.floor(fullSize / 2), old);
    expect(saveHistoryEntry(s, entry("n", "الإجابة المدفوعة"))).toBe(true);
    const list = saved(s);
    expect(list[0].id).toBe("n");
    expect(list[0].messages[1].content).toBe("الإجابة المدفوعة");
    expect(JSON.stringify(list)).not.toContain("base64");
  });

  it("drops old conversations before it drops the new answer", () => {
    const old = Array.from({ length: 30 }, (_, i) => entry(`old${i}`, "قديم ".repeat(100), false));
    const only = JSON.stringify([entry("n", "الجواب الجديد", false)]).length;
    const s = memoryStorage(only + 50, old);
    expect(saveHistoryEntry(s, entry("n", "الجواب الجديد", false))).toBe(true);
    const list = saved(s);
    expect(list[0].id).toBe("n");
    expect(list[0].messages[1].content).toBe("الجواب الجديد");
  });

  it("returns false instead of throwing when nothing can be written", () => {
    const s = memoryStorage(5);
    expect(saveHistoryEntry(s, entry("n"))).toBe(false);
  });

  it("copes with unreadable stored history", () => {
    const s = memoryStorage();
    s.setItem(HISTORY_KEY, "{not json");
    expect(saveHistoryEntry(s, entry("n", "ok", false))).toBe(true);
    expect(saved(s).map((e) => e.id)).toEqual(["n"]);
  });
});
