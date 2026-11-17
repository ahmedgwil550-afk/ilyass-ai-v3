import { createFileRoute } from "@tanstack/react-router";
import { handle } from "@/server-ai/solve-pdf";

export const Route = createFileRoute("/api/solve-pdf")({
  server: {
    handlers: {
      POST: ({ request }) => handle(request),
      OPTIONS: ({ request }) => handle(request),
    },
  },
});
