import { createFileRoute } from "@tanstack/react-router";
import { handle } from "@/server-ai/annotate-sheet";

export const Route = createFileRoute("/api/annotate-sheet")({
  server: {
    handlers: {
      POST: ({ request }) => handle(request),
      OPTIONS: ({ request }) => handle(request),
    },
  },
});
