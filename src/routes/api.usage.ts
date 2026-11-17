import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const bodySchema = z.object({ deviceId: z.string().uuid() });
type UsageRow = { request_count: number; request_date: string };
type UsageReadClient = {
  from: (table: "daily_usage") => {
    select: (columns: "request_count, request_date") => {
      eq: (column: "device_id", value: string) => PromiseLike<{
        data: UsageRow[] | null;
        error: unknown | null;
      }>;
    };
  };
};

// Returns usage rows only for the caller's own (random, unguessable) device id.
export const Route = createFileRoute("/api/usage")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const parsed = bodySchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return Response.json({ rows: [] }, { status: 400 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        // This table exists in the app's quota migration, but the connected database currently
        // has no table metadata, so generated Database types cannot describe this read yet.
        const usageClient = supabaseAdmin as unknown as UsageReadClient;
        const { data, error } = await usageClient
          .from("daily_usage")
          .select("request_count, request_date")
          .eq("device_id", parsed.data.deviceId);
        if (error) return Response.json({ rows: [] }, { status: 500 });
        return Response.json({ rows: data ?? [] });
      },
    },
  },
});
