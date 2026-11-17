import { useCallback, useRef, useState } from "react";
import { hapticTick } from "@/lib/haptics";

interface Props {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  label: string;
}

/**
 * منزلق بأسلوب iOS "Liquid Glass": مسار رفيع بتعبئة زرقاء، ومؤشر أبيض صغير يتحول عند اللمس
 * إلى كبسولة زجاجية كبيرة تتبع الإصبع بسلاسة، واهتزاز خفيف عند كل خطوة، ثم يلتصق بأقرب خطوة عند الإفلات.
 * الاتجاه: الأكبر يساراً والأصغر يميناً (تُملأ التعبئة من جهة الصغير).
 */
export function AnswerFontSlider({ value, min, max, onChange, label }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const grabOffset = useRef(0); // فرق الإصبع عن مركز المؤشر لحظة اللمس (px)
  const [drag, setDrag] = useState<number | null>(null); // موضع الإصبع المستمر 0..1 (0 = يسار = الأكبر)
  const steps = max - min;
  const toFrac = (v: number) => (max - v) / steps;
  const f = drag ?? toFrac(value);

  const commit = useCallback((raw: number) => {
    const next = Math.max(min, Math.min(max, Math.round(raw)));
    if (next !== value) { onChange(next); hapticTick(); }
  }, [min, max, value, onChange]);

  const move = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const nf = Math.max(0, Math.min(1, (clientX - grabOffset.current - r.left) / r.width));
    setDrag(nf);
    commit(max - nf * steps);
  };

  return (
    <div
      dir="ltr"
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={value + "px"}
      data-dragging={drag !== null || undefined}
      className="font-slider"
      onPointerDown={(e) => {
        const el = trackRef.current;
        if (!el) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        const r = el.getBoundingClientRect();
        const thumbX = r.left + toFrac(value) * r.width;
        // إذا لمس المؤشر نفسه نحافظ على الإزاحة (لا يقفز)، وإلا ينتقل المركز إلى الإصبع
        hapticTick();
        grabOffset.current = Math.abs(e.clientX - thumbX) <= 26 ? e.clientX - thumbX : 0;
        move(e.clientX);
      }}
      onPointerMove={(e) => { if (drag !== null) move(e.clientX); }}
      onPointerUp={() => setDrag(null)}
      onPointerCancel={() => setDrag(null)}
      onLostPointerCapture={() => setDrag(null)}
      onKeyDown={(e) => {
        const k = e.key;
        if (k === "ArrowLeft" || k === "ArrowUp") { e.preventDefault(); commit(value + 1); }
        else if (k === "ArrowRight" || k === "ArrowDown") { e.preventDefault(); commit(value - 1); }
        else if (k === "Home") { e.preventDefault(); commit(max); }
        else if (k === "End") { e.preventDefault(); commit(min); }
      }}
    >
      <div ref={trackRef} className="font-slider__track">
        <div className="font-slider__line" aria-hidden="true" />
        <div className="font-slider__fill" aria-hidden="true" style={{ left: `${f * 100}%` }} />
        <div className="font-slider__ticks" aria-hidden="true">
          {Array.from({ length: steps + 1 }, (_, i) => <span key={i} style={{ left: `${(i / steps) * 100}%` }} />)}
        </div>
        <div className="font-slider__thumb" aria-hidden="true" style={{ left: `${f * 100}%` }}>
          <b>{value}</b>
        </div>
      </div>
    </div>
  );
}
