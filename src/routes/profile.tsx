import { createFileRoute } from "@tanstack/react-router";
import ProfilePage from "@/views/ProfilePage";

export const Route = createFileRoute("/profile")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "الملف الشخصي — ILYASS AI" },
      { name: "description", content: "إدارة ملفك الشخصي في ILYASS AI" },
      { property: "og:title", content: "الملف الشخصي — ILYASS AI" },
      { property: "og:description", content: "إدارة ملفك الشخصي في ILYASS AI" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ProfilePage,
});
