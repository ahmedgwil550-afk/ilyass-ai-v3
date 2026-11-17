import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const chunkSchema = z.array(z.string().min(20).max(12000)).min(1).max(100);
const bodySchema = z.object({
  title: z.string().min(1).max(300),
  sourceName: z.string().min(1).max(200),
  sourceUrl: z.string().url().refine((value) => value.startsWith("https://")),
  subject: z.enum(["math","physics","chemistry","biology","french","arabic","english","philosophy","history","islamic"]),
  grade: z.string().min(1).max(40).default("2bac"),
  track: z.string().max(80).optional(),
  sourceYear: z.number().int().min(1990).max(2100).optional(),
  isOfficial: z.boolean().default(false),
  verified: z.boolean().default(false),
  chunks: chunkSchema,
}).strict();

export const Route = createFileRoute("/api/curriculum-ingest")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env["CURRICULUM_INGEST_KEY"];
        const auth = request.headers.get("authorization") || "";
        if (!secret || auth !== `Bearer ${secret}`) return Response.json({ error: "Forbidden." }, { status: 403 });
        const rawBody = await request.text();
        if (rawBody.length > 1_500_000) return Response.json({ error: "Payload too large." }, { status: 413 });
        let body: unknown = null;
        try { body = JSON.parse(rawBody); } catch { return Response.json({ error: "Invalid JSON." }, { status: 400 }); }
        const parsed = bodySchema.safeParse(body);
        if (!parsed.success) return Response.json({ error: "Invalid source payload." }, { status: 400 });
        const url = process.env["SUPABASE_URL"];
        const key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
        if (!url || !key) return Response.json({ error: "Database is not configured." }, { status: 503 });
        const value = parsed.data;
        const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=representation" };
        const sourceResponse = await fetch(new URL("/rest/v1/curriculum_sources", url), {
          method: "POST",
          headers,
          body: JSON.stringify({
            title: value.title, source_name: value.sourceName, source_url: value.sourceUrl,
            subject: value.subject, grade: value.grade, track: value.track ?? null,
            source_year: value.sourceYear ?? null, is_official: value.isOfficial,
            verified_at: value.isOfficial && value.verified ? new Date().toISOString() : null,
          }),
          signal: request.signal,
        });
        if (!sourceResponse.ok) return Response.json({ error: "Could not save curriculum source." }, { status: 502 });
        const sourceRows = await sourceResponse.json();
        const sourceId = Array.isArray(sourceRows) ? sourceRows[0]?.id : null;
        if (typeof sourceId !== "string") return Response.json({ error: "Source ID was not returned." }, { status: 502 });
        const chunkResponse = await fetch(new URL("/rest/v1/curriculum_chunks", url), {
          method: "POST",
          headers: { ...headers, Prefer: "return=minimal" },
          body: JSON.stringify(value.chunks.map((content, chunk_index) => ({ source_id: sourceId, chunk_index, content }))),
          signal: request.signal,
        });
        if (!chunkResponse.ok) return Response.json({ error: "Source saved but its text chunks failed to save." }, { status: 502 });
        return Response.json({ ok: true, sourceId, chunks: value.chunks.length, searchable: value.isOfficial && value.verified });
      },
    },
  },
});
