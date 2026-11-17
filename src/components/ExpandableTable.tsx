import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Maximize2, Minus, Plus, X } from "lucide-react";

interface ExpandableTableProps {
  /** محتوى الجدول؛ يُعرض مرتين: داخل الرسالة، وفي الشاشة الكاملة عند الضغط على الزر */
  children: ReactNode;
  /** light = جدول HTML على خلفية بيضاء (كما في وضع الجداول الحالي)، theme = يتبع ألوان التطبيق */
  variant?: "theme" | "light" | "flat";
  /** كلاسات خاصة بالجدول نفسه (حدود الخلايا، لون الرأس…) */
  tableClassName?: string;
  /** أدوات تظهر يساراً في شريط الجدول (عنوان + أزرار حجم الخط) */
  toolbar?: ReactNode;
  /** حجم الخط داخل الرسالة بالنسبة المئوية (لا يؤثر على الشاشة الكاملة التي لها تكبيرها الخاص) */
  fontScale?: number;
}

const MIN_ZOOM = 0.8;
const MAX_ZOOM = 1.8;
const STEP = 0.2;

export default function ExpandableTable({
  children,
  variant = "theme",
  tableClassName = "",
  toolbar,
  fontScale,
}: ExpandableTableProps) {
  const [open, setOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [scrollMetrics, setScrollMetrics] = useState({ overflow: false, thumb: 100, offset: 0 });
  const scrollRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerX: number; offset: number } | null>(null);
  const light = variant === "light";
  const flat = variant === "flat";

  const updateScrollMetrics = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth);
    const thumb = el.scrollWidth > 0 ? Math.max(12, (el.clientWidth / el.scrollWidth) * 100) : 100;
    const offset = maxScroll > 0 ? (el.scrollLeft / maxScroll) * (100 - thumb) : 0;
    setScrollMetrics({ overflow: maxScroll > 1, thumb, offset: Math.max(0, Math.min(100 - thumb, offset)) });
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    updateScrollMetrics();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(updateScrollMetrics) : null;
    observer?.observe(el);
    if (el.firstElementChild) observer?.observe(el.firstElementChild);
    const mutationObserver = typeof MutationObserver !== "undefined"
      ? new MutationObserver(updateScrollMetrics)
      : null;
    mutationObserver?.observe(el, { childList: true, subtree: true, characterData: true });
    window.addEventListener("resize", updateScrollMetrics);
    return () => {
      observer?.disconnect();
      mutationObserver?.disconnect();
      window.removeEventListener("resize", updateScrollMetrics);
    };
  }, [children, updateScrollMetrics]);

  const handleTrackPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const track = trackRef.current;
    const el = scrollRef.current;
    if (!track || !el) return;
    const rect = track.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth);
    el.scrollLeft = ratio * maxScroll;
    dragRef.current = { pointerX: event.clientX, offset: el.scrollLeft };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleThumbPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const track = trackRef.current;
    const el = scrollRef.current;
    if (!drag || !track || !el) return;
    const rect = track.getBoundingClientRect();
    const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth);
    const thumbWidth = (el.clientWidth / Math.max(el.scrollWidth, 1)) * rect.width;
    const usable = Math.max(1, rect.width - thumbWidth);
    el.scrollLeft = Math.max(0, Math.min(maxScroll, drag.offset + ((event.clientX - drag.pointerX) / usable) * maxScroll));
  };

  // Esc يغلق، ونمنع تمرير الصفحة الخلفية أثناء فتح الجدول
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  const iconBtn = light
    ? "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
    : "text-muted-foreground hover:bg-muted hover:text-foreground";

  return (
    <>
      <div
        className={
          "expandable-table my-4 w-full min-w-0 max-w-full overflow-hidden rounded-xl border " +
          (flat ? "border-transparent bg-transparent" : light ? "border-border bg-white text-black" : "border-border bg-card")
        }
      >
        <div className={`flex min-w-0 flex-wrap items-center ${toolbar ? "justify-between" : "justify-end"} gap-2 px-2 pt-1.5`} dir="ltr">
          {toolbar}
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Agrandir le tableau / تكبير الجدول"
            title="Agrandir / تكبير"
            className={`inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${iconBtn}`}
          >
            <Maximize2 className="h-4 w-4" />
          </button>
        </div>
        <div
          ref={scrollRef}
          className={`expandable-table-scroll w-full min-w-0 ${flat ? "px-1" : "px-3"} pb-2 ${tableClassName}`}
          onScroll={updateScrollMetrics}
          style={fontScale ? { fontSize: `${fontScale}%` } : undefined}
        >
          {children}
        </div>
        {scrollMetrics.overflow && (
          <div className="px-3 pb-2.5 pt-1" dir="ltr">
            <div
              ref={trackRef}
              className="h-2 w-full touch-none rounded-full bg-muted/70 cursor-pointer"
              role="scrollbar"
              aria-label="Horizontal table scroll"
              aria-orientation="horizontal"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(scrollMetrics.offset / Math.max(1, 100 - scrollMetrics.thumb) * 100)}
              onPointerDown={handleTrackPointerDown}
              onPointerMove={handleThumbPointerMove}
              onPointerUp={() => { dragRef.current = null; }}
              onPointerCancel={() => { dragRef.current = null; }}
            >
              <div
                className="h-full rounded-full bg-muted-foreground/65 hover:bg-muted-foreground/80"
                style={{ width: `${scrollMetrics.thumb}%`, marginLeft: `${scrollMetrics.offset}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] flex flex-col bg-background"
            role="dialog"
            aria-modal="true"
            aria-label="Tableau"
          >
            <div
              className="flex items-center justify-between gap-2 border-b border-border px-3 py-2"
              style={{ paddingTop: "max(0.5rem, env(safe-area-inset-top))" }}
              dir="ltr"
            >
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.max(MIN_ZOOM, +(z - STEP).toFixed(2)))}
                  disabled={zoom <= MIN_ZOOM}
                  aria-label="Réduire / تصغير"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                >
                  <Minus className="h-4 w-4" />
                </button>
                <span className="w-12 text-center text-xs tabular-nums text-muted-foreground">
                  {Math.round(zoom * 100)}%
                </span>
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.min(MAX_ZOOM, +(z + STEP).toFixed(2)))}
                  disabled={zoom >= MAX_ZOOM}
                  aria-label="Agrandir / تكبير"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Fermer / إغلاق"
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-auto p-3">
              {/* markdown-content: لتعمل قواعد CSS الخاصة بالجداول و KaTeX داخل الشاشة الكاملة */}
              <div
                className={
                  "markdown-content w-max min-w-full rounded-xl p-3 " +
                  (light ? "bg-white text-black" : flat ? "bg-background" : "bg-card") +
                  " " +
                  tableClassName +
                  // في الشاشة الكاملة: لا التفاف للنص، فيتوسع الجدول بدل أن تتكدس الخلايا
                  " [&_table]:!w-max [&_table]:min-w-full [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap"
                }
                style={{ fontSize: `${zoom * 100}%` }}
              >
                {children}
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
