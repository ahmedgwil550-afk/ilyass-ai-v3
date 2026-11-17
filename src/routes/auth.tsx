import { createFileRoute } from "@tanstack/react-router";
import AuthPage from "@/views/AuthPage";
import mikaModel from "@/assets/mika-mika.fbx.asset.json";
import mikaSkin from "@/assets/mika-skin.jpg.asset.json";
import mikaHair from "@/assets/mika-hair.webp.asset.json";
import { oauthReturnPath } from "@/lib/oauth-return-path";

export const Route = createFileRoute("/auth")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>) => ({ next: oauthReturnPath(search["next"]) }),
  head: () => ({
    meta: [
      { title: "تسجيل الدخول — ILYASS AI" },
      { name: "description", content: "سجّل الدخول أو أنشئ حساباً في ILYASS AI" },
      { property: "og:title", content: "تسجيل الدخول — ILYASS AI" },
      { property: "og:description", content: "سجّل الدخول أو أنشئ حساباً في ILYASS AI" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    // تنزيل ملفات الشخصية بالتوازي مع كود الصفحة (بدل انتظاره)
    links: [
      { rel: "preload", href: mikaModel.url, as: "fetch", crossOrigin: "anonymous" },
      { rel: "preload", href: mikaSkin.url, as: "image" },
      { rel: "preload", href: mikaHair.url, as: "image" },
    ],
  }),
  component: AuthRoute,
});

function AuthRoute() {
  const { next } = Route.useSearch();
  return <AuthPage next={next} />;
}
