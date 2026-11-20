import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { UI_SCALE_BOOT_SCRIPT } from "../lib/display-scale";
import UiScaleSync from "../components/UiScaleSync";

const CHUNK_RETRY_FALLBACK_SCRIPT = `(function(){
  var shown = false;
  function showRetry(event) {
    var target = event && event.target;
    var message = event && event.message ? String(event.message) : "";
    var isChunk = (target && (target.tagName === "SCRIPT" || target.tagName === "LINK")) ||
      message.indexOf("Importing a module script failed") !== -1 ||
      message.indexOf("Failed to fetch dynamically imported module") !== -1;
    if (!isChunk || shown) return;
    if (event && event.preventDefault) event.preventDefault();
    if (event && event.stopImmediatePropagation) event.stopImmediatePropagation();
    try {
      if (!window.sessionStorage.getItem("chunk-reload-attempted")) {
        window.sessionStorage.setItem("chunk-reload-attempted", "1");
        window.location.reload();
        return;
      }
    } catch (_) {}
    shown = true;
    var main = document.createElement("main");
    main.className = "min-h-screen flex flex-col items-center justify-center gap-4 bg-background px-4 text-center text-foreground";
    main.setAttribute("aria-live", "polite");
    var title = document.createElement("h1");
    title.className = "text-xl font-semibold";
    title.textContent = "تعذر تحميل الصفحة";
    var description = document.createElement("p");
    description.className = "max-w-md text-sm text-muted-foreground";
    description.textContent = "حدث خلل أثناء تحميل الصفحة. أعد المحاولة لفتحها من جديد.";
    var button = document.createElement("button");
    button.type = "button";
    button.className = "inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground";
    button.textContent = "إعادة المحاولة";
    button.addEventListener("click", function() {
      try { window.sessionStorage.removeItem("chunk-reload-attempted"); } catch (_) {}
      window.location.reload();
    });
    main.append(title, description, button);
    document.body.replaceChildren(main);
  }
  window.addEventListener("vite:preloadError", showRetry);
  window.addEventListener("error", showRetry, true);
  window.addEventListener("unhandledrejection", function(event) {
    var reason = event && event.reason;
    showRetry({
      message: reason && reason.message ? String(reason.message) : String(reason || ""),
      preventDefault: function() { event.preventDefault(); },
      stopImmediatePropagation: function() { event.stopImmediatePropagation(); }
    });
  });
})();`;

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "ILYASS AI" },
      { name: "description", content: "مساعد ذكي لحل الواجبات والامتحانات للمستوى الثانوي" },
      { name: "author", content: "ILYASS AI" },
      { name: "theme-color", content: "#4f46e5" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-title", content: "ILYASS AI" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", type: "image/png", href: "/favicon.png" },
      { rel: "apple-touch-icon", href: "/icon-512.png" },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=Poppins:wght@500;600;700;800&family=Caveat:wght@500;700&family=Kalam:wght@400;700&display=swap",
      },
      { rel: "stylesheet", href: "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="ar" dir="ltr" suppressHydrationWarning>
      <head>
        {/* يضبط --ui-scale قبل أول رسم حسب شاشة الجهاز، فلا يظهر وميض بالحجم القديم */}
        <script dangerouslySetInnerHTML={{ __html: UI_SCALE_BOOT_SCRIPT }} />
        <HeadContent />
      </head>
      <body>
        <script dangerouslySetInnerHTML={{ __html: CHUNK_RETRY_FALLBACK_SCRIPT }} />
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  useEffect(() => {
    try {
      window.sessionStorage.removeItem("chunk-reload-attempted");
    } catch (_) {}
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <TooltipProvider>
        <UiScaleSync />
        <Toaster />
        <Sonner />
        <Outlet />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
