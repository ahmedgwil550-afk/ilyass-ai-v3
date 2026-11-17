// Lightweight answer cache for AI responses
// Keyed by a hash of (question + images + subject + mode + examMode + length + lang)
// Stored in localStorage for 7 days.

const CACHE_PREFIX = "ilyass-answer-cache:";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_ENTRIES = 60;

async function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function fastFingerprint(b64: string): string {
  // Sample chars to avoid hashing megabytes
  if (!b64) return "";
  if (b64.length < 4000) return b64;
  return `${b64.length}|${b64.slice(0, 1500)}|${b64.slice(-1500)}`;
}

export interface CacheKeyInput {
  content: string;
  images?: string[];
  subject: string;
  modelMode: string;
  responseLength: string;
  examMode: boolean;
  lang?: string;
}

export async function buildCacheKey(input: CacheKeyInput): Promise<string> {
  const imgFingerprint = (input.images || []).map(fastFingerprint).join("##");
  const raw = [
    input.content.trim().toLowerCase(),
    imgFingerprint,
    input.subject,
    input.modelMode,
    input.responseLength,
    input.examMode ? "1" : "0",
    input.lang || "",
  ].join("|");
  return await sha256(raw);
}

interface StoredEntry {
  answer: string;
  ts: number;
}

export function getCachedAnswer(key: string): string | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const entry: StoredEntry = JSON.parse(raw);
    if (Date.now() - entry.ts > CACHE_TTL_MS) {
      localStorage.removeItem(CACHE_PREFIX + key);
      return null;
    }
    return entry.answer;
  } catch {
    return null;
  }
}

export function setCachedAnswer(key: string, answer: string): void {
  if (!answer || answer.length < 10) return;
  try {
    const entry: StoredEntry = { answer, ts: Date.now() };
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(entry));
    pruneCache();
  } catch {
    // Quota exceeded — clear oldest and retry once
    try {
      pruneCache(true);
      localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ answer, ts: Date.now() }));
    } catch { /* ignore */ }
  }
}

function pruneCache(aggressive = false): void {
  const entries: { k: string; ts: number }[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith(CACHE_PREFIX)) continue;
    try {
      const v: StoredEntry = JSON.parse(localStorage.getItem(k) || "{}");
      entries.push({ k, ts: v.ts || 0 });
    } catch {
      localStorage.removeItem(k);
    }
  }
  const limit = aggressive ? Math.floor(MAX_ENTRIES / 2) : MAX_ENTRIES;
  if (entries.length <= limit) return;
  entries.sort((a, b) => a.ts - b.ts);
  const toRemove = entries.length - limit;
  for (let i = 0; i < toRemove; i++) localStorage.removeItem(entries[i].k);
}

/** Streaming-style replay: emits the cached answer in small chunks. */
export async function replayCachedAnswer(
  answer: string,
  onDelta: (chunk: string) => void,
  chunkSize = 40,
  delayMs = 8,
  signal?: AbortSignal,
): Promise<void> {
  for (let i = 0; i < answer.length; i += chunkSize) {
    if (signal?.aborted) return;
    onDelta(answer.slice(i, i + chunkSize));
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
  }
}
