import { createFileRoute } from "@tanstack/react-router";
import Index from "@/views/Index";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "ILYASS AI - مساعد الواجبات والامتحانات الذكي" },
      { name: "description", content: "مساعد ذكي لحل الواجبات والامتحانات للمستوى الثانوي - رياضيات، فيزياء، كيمياء والمزيد" },
      { property: "og:title", content: "ILYASS AI - مساعد الواجبات والامتحانات الذكي" },
      { property: "og:description", content: "مساعد ذكي لحل الواجبات والامتحانات للمستوى الثانوي - رياضيات، فيزياء، كيمياء والمزيد" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});
