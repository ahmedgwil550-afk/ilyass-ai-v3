import { createFileRoute } from "@tanstack/react-router";
import HistoryPage from "@/views/HistoryPage";

export const Route = createFileRoute("/history")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "السجل — ILYASS AI" },
      { name: "description", content: "سجل أسئلتك وإجاباتك السابقة في ILYASS AI" },
      { property: "og:title", content: "السجل — ILYASS AI" },
      { property: "og:description", content: "سجل أسئلتك وإجاباتك السابقة في ILYASS AI" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: HistoryPage,
});
