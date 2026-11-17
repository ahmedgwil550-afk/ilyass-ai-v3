import { createFileRoute } from "@tanstack/react-router";
import { handle } from "@/server-ai/solve";

export const Route = createFileRoute("/api/solve")({
  server: {
    handlers: {
      POST: ({ request }) => handle(request),
      OPTIONS: ({ request }) => handle(request),
    },
  },
});
