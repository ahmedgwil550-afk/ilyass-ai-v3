import { z } from "zod";

export const CURRICULUM_SUBJECTS = [
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
] as const;

export const CURRICULUM_DOC_TYPES = ["framework", "lesson", "exam", "correction", "guide"] as const;

const passage = z.string().min(20).max(12000);

/** A chunk is plain text, or text with its page and section title. */
const chunkSchema = z.union([
  passage,
  z
    .object({
      content: passage,
      metadata: z.record(z.string(), z.unknown()).optional(),
    })
    .strict(),
]);

export const ingestBodySchema = z
  .object({
    title: z.string().min(1).max(300),
    sourceName: z.string().min(1).max(200),
    sourceUrl: z
      .string()
      .url()
      .refine((value) => value.startsWith("https://")),
    subject: z.enum(CURRICULUM_SUBJECTS),
    grade: z.string().min(1).max(40).default("2bac"),
    track: z.string().max(80).optional(),
    sourceYear: z.number().int().min(1990).max(2100).optional(),
    docType: z.enum(CURRICULUM_DOC_TYPES).optional(),
    /** SHA-256 of the original file. A second upload of the same file is refused. */
    sourceHash: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
    isOfficial: z.boolean().default(false),
    verified: z.boolean().default(false),
    chunks: z.array(chunkSchema).min(1).max(400),
  })
  .strict();

export type IngestBody = z.infer<typeof ingestBodySchema>;

/** A source is searchable only when it is official AND someone confirmed it against the original. */
export function isSearchable(value: Pick<IngestBody, "isOfficial" | "verified">): boolean {
  return value.isOfficial && value.verified;
}

/**
 * Row for curriculum_sources. doc_type and source_hash are only included when given, so an
 * upload that does not use them still works on a database without migration 20261120000100.
 */
export function buildSourceRow(value: IngestBody, now: Date = new Date()): Record<string, unknown> {
  const row: Record<string, unknown> = {
    title: value.title,
    source_name: value.sourceName,
    source_url: value.sourceUrl,
    subject: value.subject,
    grade: value.grade,
    track: value.track ?? null,
    source_year: value.sourceYear ?? null,
    is_official: value.isOfficial,
    verified_at: isSearchable(value) ? now.toISOString() : null,
  };
  if (value.docType) row.doc_type = value.docType;
  if (value.sourceHash) row.source_hash = value.sourceHash;
  return row;
}

export function buildChunkRows(
  sourceId: string,
  chunks: IngestBody["chunks"],
): Record<string, unknown>[] {
  return chunks.map((chunk, chunkIndex) =>
    typeof chunk === "string"
      ? { source_id: sourceId, chunk_index: chunkIndex, content: chunk }
      : {
          source_id: sourceId,
          chunk_index: chunkIndex,
          content: chunk.content,
          metadata: chunk.metadata ?? {},
        },
  );
}
