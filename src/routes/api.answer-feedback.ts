import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const bodySchema = z.object({
  answerId: z.string().min(1).max(120),
  subject: z.enum(["math","physics","chemistry","biology","french","arabic","english","philosophy","history","islamic","other"]),
  rating: z.enum(["correct","incorrect"]),
  issueType: z.enum(["image_reading","calculation","scientific_fact","method","formatting","incomplete","other"]).optional(),
  score: z.number().min(0).max(20).optional(),
  note: z.string().max(1000).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.rating === "incorrect" && !value.issueType) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["issueType"], message: "Choose the issue type." });
  }
});

export const Route = createFileRoute("/api/answer-feedback")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authorization = request.headers.get("authorization") || "";
        const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
        if (!token || token.length > 8192) return Response.json({ error: "Authentication required." }, { status: 401 });

        const parsed = bodySchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return Response.json({ error: "Invalid feedback." }, { status: 400 });

        const url = process.env["SUPABASE_URL"];
        const publicKey = process.env["SUPABASE_PUBLISHABLE_KEY"];
        const serviceKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];
        if (!url || !publicKey || !serviceKey) return Response.json({ error: "Feedback storage is not configured." }, { status: 503 });

        const authClient = createClient(url, publicKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const { data, error } = await authClient.auth.getUser(token);
        if (error || !data.user) return Response.json({ error: "Invalid session." }, { status: 401 });

        const { answerId, subject, rating, issueType, score, note } = parsed.data;
        const response = await fetch(new URL("/rest/v1/answer_feedback", url), {
          method: "POST",
          headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
            "Content-Type": "application/json",
            Prefer: "return=minimal",
          },
          body: JSON.stringify({
            user_id: data.user.id,
            answer_id: answerId,
            subject,
            rating,
            issue_type: issueType ?? null,
            score: score ?? null,
            note: note?.trim() || null,
          }),
          signal: request.signal,
        });
        if (!response.ok) {
          console.error("answer feedback insert failed", response.status, (await response.text()).slice(0, 300));
          return Response.json({ error: "Could not save feedback." }, { status: 502 });
        }
        return Response.json({ ok: true });
      },
    },
  },
});
