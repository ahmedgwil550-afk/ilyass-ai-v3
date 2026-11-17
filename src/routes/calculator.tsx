import { createFileRoute } from "@tanstack/react-router";
import CalculatorPage from "@/views/CalculatorPage";

export const Route = createFileRoute("/calculator")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "الآلة الحاسبة العلمية — ILYASS AI" },
      { name: "description", content: "آلة حاسبة علمية مجانية من ILYASS AI" },
      { property: "og:title", content: "الآلة الحاسبة العلمية — ILYASS AI" },
      { property: "og:description", content: "آلة حاسبة علمية مجانية من ILYASS AI" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CalculatorPage,
});
