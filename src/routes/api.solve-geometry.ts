import { createFileRoute } from "@tanstack/react-router";
import { handle } from "@/server-ai/solve-geometry";

export const Route = createFileRoute("/api/solve-geometry")({
  server: {
    handlers: {
      POST: ({ request }) => handle(request),
      OPTIONS: ({ request }) => handle(request),
    },
  },
});
