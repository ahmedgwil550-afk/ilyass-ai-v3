import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { isValidUnlockCode } from "@/server-ai/unlock";

const bodySchema = z.object({ code: z.string().min(1).max(100) });

export const Route = createFileRoute("/api/verify-unlock")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const parsed = bodySchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return Response.json({ valid: false }, { status: 400 });
        return Response.json({ valid: isValidUnlockCode(parsed.data.code) });
      },
    },
  },
});