import { createFileRoute } from "@tanstack/react-router";
import GraphingPage from "@/views/GraphingPage";

export const Route = createFileRoute("/graphing")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "رسم الدوال — ILYASS AI" },
      { name: "description", content: "ارسم منحنيات الدوال بسهولة مع ILYASS AI" },
      { property: "og:title", content: "رسم الدوال — ILYASS AI" },
      { property: "og:description", content: "ارسم منحنيات الدوال بسهولة مع ILYASS AI" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: GraphingPage,
});
