import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { transcribeImages } from "@/server-ai/read-image";
import { needsImageReview } from "@/lib/imageReview";
import { routesFor } from "@/server-ai/panache";

const bodySchema = z.object({
  modelMode: z.enum(["fast", "accurate", "advanced", "panache"]).optional(),
  images: z.array(z.string().min(100).max(12_000_000)).min(1).max(12),
}).superRefine((value, ctx) => {
  const totalLength = value.images.reduce((sum, image) => sum + image.length, 0);
  if (totalLength > 24_000_000) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Images exceed the total size limit." });
  }
});

export const Route = createFileRoute("/api/read-image")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const parsed = bodySchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) {
          return Response.json({ error: "Invalid image payload or image size limit exceeded." }, { status: 400 });
        }

        let reading = null as Awaited<ReturnType<typeof transcribeImages>>;
        if (parsed.data.modelMode === "panache") {
          // Keep Panache's preferred vision provider order for its pre-solve read.
          for (const route of routesFor("vision")) {
            reading = await transcribeImages(parsed.data.images, route, {
              signal: request.signal,
              maxOutputTokens: 2600,
              failOnInsufficientCredits: true,
            });
            if (reading) break;
          }
        }
        if (!reading) {
          reading = await transcribeImages(parsed.data.images, undefined, {
            signal: request.signal,
            maxOutputTokens: 2600,
            failOnInsufficientCredits: parsed.data.modelMode === "panache",
          });
        }
        if (!reading) {
          return Response.json({ error: "Image transcription is temporarily unavailable." }, { status: 503 });
        }

        return Response.json({
          transcript: reading.text,
          needsReview: needsImageReview(reading.text),
          figureMissing: reading.figureMissing,
        });
      },
    },
  },
});
