import { createFileRoute } from "@tanstack/react-router";
import {
  buildChunkRows,
  buildSourceRow,
  ingestBodySchema,
  isSearchable,
} from "../server-ai/curriculumIngest";

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
        const parsed = ingestBodySchema.safeParse(body);
        if (!parsed.success) return Response.json({ error: "Invalid source payload." }, { status: 400 });
        const url = process.env["SUPABASE_URL"];
        const key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
        if (!url || !key) return Response.json({ error: "Database is not configured." }, { status: 503 });
        const value = parsed.data;
        const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=representation" };

        if (value.sourceHash) {
          const existing = await fetch(
            new URL(`/rest/v1/curriculum_sources?source_hash=eq.${value.sourceHash}&select=id&limit=1`, url),
            { headers, signal: request.signal },
          );
          if (!existing.ok) {
            return Response.json({ error: "Could not check for a duplicate. Is migration 20261120000100 applied?" }, { status: 502 });
          }
          const rows = await existing.json();
          const existingId = Array.isArray(rows) ? rows[0]?.id : null;
          if (typeof existingId === "string") {
            return Response.json({ error: "This file was already ingested.", sourceId: existingId }, { status: 409 });
          }
        }

        const sourceResponse = await fetch(new URL("/rest/v1/curriculum_sources", url), {
          method: "POST",
          headers,
          body: JSON.stringify(buildSourceRow(value)),
          signal: request.signal,
        });
        if (!sourceResponse.ok) return Response.json({ error: "Could not save curriculum source." }, { status: 502 });
        const sourceRows = await sourceResponse.json();
        const sourceId = Array.isArray(sourceRows) ? sourceRows[0]?.id : null;
        if (typeof sourceId !== "string") return Response.json({ error: "Source ID was not returned." }, { status: 502 });
        const chunkResponse = await fetch(new URL("/rest/v1/curriculum_chunks", url), {
          method: "POST",
          headers: { ...headers, Prefer: "return=minimal" },
          body: JSON.stringify(buildChunkRows(sourceId, value.chunks)),
          signal: request.signal,
        });
        if (!chunkResponse.ok) {
          // Remove the empty source so the same upload can be retried (chunks cascade).
          await fetch(new URL(`/rest/v1/curriculum_sources?id=eq.${sourceId}`, url), {
            method: "DELETE",
            headers: { ...headers, Prefer: "return=minimal" },
          }).catch(() => undefined);
          return Response.json({ error: "The text chunks failed to save; nothing was kept." }, { status: 502 });
        }
        return Response.json({ ok: true, sourceId, chunks: value.chunks.length, searchable: isSearchable(value) });
      },
    },
  },
});
