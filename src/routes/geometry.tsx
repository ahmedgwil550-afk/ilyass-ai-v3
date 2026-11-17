import { createFileRoute } from "@tanstack/react-router";
import GeometryPage from "@/views/GeometryPage";

export const Route = createFileRoute("/geometry")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "الهندسة — ILYASS AI" },
      { name: "description", content: "حل وتمثيل مسائل الهندسة مع ILYASS AI" },
      { property: "og:title", content: "الهندسة — ILYASS AI" },
      { property: "og:description", content: "حل وتمثيل مسائل الهندسة مع ILYASS AI" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: GeometryPage,
});
