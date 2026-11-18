import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { recognizeQuestions } from "@/server-ai/recognize/recognize";

const bodySchema = z.object({
  /** صورة واحدة (data URL أو base64): القياس النسبي للمربعات يخص صورة واحدة */
  image: z.string().min(100).max(12_000_000),
  subject: z.string().max(20).optional(),
});

export const Route = createFileRoute("/api/recognize")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const parsed = bodySchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) {
          return Response.json({ error: "Invalid image payload or image size limit exceeded." }, { status: 400 });
        }

        const outcome = await recognizeQuestions({
          image: parsed.data.image,
          subject: parsed.data.subject,
          signal: request.signal,
        });

        if (outcome.ok) return Response.json({ result: outcome.result });

        switch (outcome.reason) {
          case "no_provider":
            return Response.json({ error: "Question recognition is not configured.", reason: outcome.reason }, { status: 503 });
          case "credits":
            return Response.json({ error: "The AI provider reported insufficient credits.", reason: outcome.reason }, { status: 402 });
          case "aborted":
            return Response.json({ error: "Request cancelled.", reason: outcome.reason }, { status: 499 });
          default:
            return Response.json({ error: "Question recognition is temporarily unavailable.", reason: outcome.reason }, { status: 502 });
        }
      },
    },
  },
});
