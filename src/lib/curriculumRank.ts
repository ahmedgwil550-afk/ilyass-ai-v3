import { rankingTerms, tokenizeCurriculumText } from "./curriculumText.ts";

export interface RankableChunk {
  content: string;
  /** Used to limit how many passages come from one document. */
  source_id?: string;
  source_url?: string;
}

export interface RerankOptions {
  /** How many chunks to return. */
  limit?: number;
  /** At most this many chunks from the same document, so one long file cannot fill every slot. */
  maxPerSource?: number;
  /**
   * A chunk must contain at least this many distinct words of the question.
   * Defaults to 2 (or 1 for a one-word question): one shared common word is not evidence.
   */
  minMatchedTerms?: number;
}

const K1 = 1.2;
const B = 0.75;

/** Prefix match for longer words (mirrors the database search), exact match for short ones. */
function matches(term: string, token: string): boolean {
  return term.length >= 4 ? token.startsWith(term) : token === term;
}

function sourceKey(chunk: RankableChunk, index: number): string {
  return chunk.source_id ?? chunk.source_url ?? "chunk-" + index;
}

/**
 * Reorders database candidates with BM25 over the candidate set, scaled by how many of the
 * question's words the chunk covers, drops passages that share too little with the question,
 * and spreads the result across documents. The database order breaks ties.
 */
export function rerankChunks<T extends RankableChunk>(
  chunks: T[],
  question: string,
  options: RerankOptions = {},
): T[] {
  const limit = options.limit ?? 5;
  const maxPerSource = options.maxPerSource ?? 2;
  const terms = rankingTerms(question);
  if (!chunks.length || !terms.length) return [];
  const minMatched = Math.min(options.minMatchedTerms ?? 2, terms.length);

  const docs = chunks.map((chunk) => tokenizeCurriculumText(chunk.content));
  const averageLength = docs.reduce((sum, tokens) => sum + tokens.length, 0) / docs.length || 1;

  const termFrequencies = docs.map((tokens) =>
    terms.map((term) => tokens.reduce((count, token) => count + (matches(term, token) ? 1 : 0), 0)),
  );
  const idf = terms.map((_, termIndex) => {
    const documentFrequency = termFrequencies.filter((row) => row[termIndex] > 0).length;
    return Math.log(1 + (docs.length - documentFrequency + 0.5) / (documentFrequency + 0.5));
  });

  const scored = chunks.map((chunk, index) => {
    const frequencies = termFrequencies[index];
    const length = docs[index].length || 1;
    let bm25 = 0;
    let matched = 0;
    frequencies.forEach((frequency, termIndex) => {
      if (frequency === 0) return;
      matched += 1;
      bm25 +=
        (idf[termIndex] * frequency * (K1 + 1)) /
        (frequency + K1 * (1 - B + (B * length) / averageLength));
    });
    const coverage = matched / terms.length;
    return { chunk, index, matched, score: bm25 * (0.5 + 0.5 * coverage) };
  });

  scored.sort((a, b) => b.score - a.score || a.index - b.index);

  const perSource = new Map<string, number>();
  const picked: T[] = [];
  for (const entry of scored) {
    if (picked.length >= limit) break;
    if (entry.matched < minMatched) continue;
    const key = sourceKey(entry.chunk, entry.index);
    const used = perSource.get(key) ?? 0;
    if (used >= maxPerSource) continue;
    perSource.set(key, used + 1);
    picked.push(entry.chunk);
  }
  return picked;
}
