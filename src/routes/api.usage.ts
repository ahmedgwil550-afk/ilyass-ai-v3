import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const bodySchema = z.object({ deviceId: z.string().uuid() });

// Returns usage rows only for the caller's own (random, unguessable) device id.
export const Route = createFileRoute("/api/usage")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const parsed = bodySchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return Response.json({ rows: [] }, { status: 400 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin
          .from("daily_usage")
          .select("request_count, request_date")
          .eq("device_id", parsed.data.deviceId);
        if (error) return Response.json({ rows: [] }, { status: 500 });
        return Response.json({ rows: data ?? [] });
      },
    },
  },
});
