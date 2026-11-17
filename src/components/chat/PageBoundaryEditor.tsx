import { useRef, useState } from "react";
import { Check, RotateCcw } from "lucide-react";
import {
  rectifyPagePerspective,
} from "@/lib/perspectiveRectification";
import type { PageBoundaryCandidate } from "@/lib/opencvPageDetection";
import type { Point2D, Quadrilateral } from "@/lib/perspectiveGeometry";

interface PageBoundaryEditorProps {
  image: string;
  candidate: PageBoundaryCandidate;
  lang: string;
  onApply: (correctedImage: string) => void;
}

const copy = {
  ar: {
    title: "تحديد حدود الورقة",
    help: "اسحب الدوائر الأربع لتطابق زوايا الورقة بدقة، ثم اضغط على تصحيح المنظور.",
    apply: "تصحيح المنظور",
    reset: "إعادة الزوايا",
    working: "جارٍ تصحيح الصورة…",
    failed: "تعذّر التصحيح بهذه الزوايا. عدّلها وحاول مجدداً.",
  },
  fr: {
    title: "Délimiter la feuille",
    help: "Déplacez les quatre points sur les coins de la feuille, puis corrigez la perspective.",
    apply: "Corriger la perspective",
    reset: "Réinitialiser",
    working: "Correction de l’image…",
    failed: "Correction impossible avec ces points. Ajustez-les et réessayez.",
  },
};

export default function PageBoundaryEditor({
  image,
  candidate,
  lang,
  onApply,
}: PageBoundaryEditorProps) {
  const initialCorners = candidate.corners.map((point) => ({ ...point })) as Quadrilateral;
  const [corners, setCorners] = useState<Quadrilateral>(initialCorners);
  const [activePoint, setActivePoint] = useState<number | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState(false);
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const svgRef = useRef<SVGSVGElement>(null);
  const isArabic = lang === "ar";
  const labels = isArabic ? copy.ar : copy.fr;

  const movePoint = (event: React.PointerEvent<SVGSVGElement>) => {
    if (activePoint === null || !svgRef.current || !imageSize.width) return;
    const rect = svgRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(imageSize.width - 1, ((event.clientX - rect.left) / rect.width) * imageSize.width));
    const y = Math.max(0, Math.min(imageSize.height - 1, ((event.clientY - rect.top) / rect.height) * imageSize.height));
    setCorners((previous) => previous.map((point, index) =>
      index === activePoint ? { x, y } : point,
    ) as Quadrilateral);
  };

  const applyCorrection = async () => {
    if (working) return;
    setWorking(true);
    setError(false);
    try {
      const sourceImage = await new Promise<HTMLImageElement>((resolve, reject) => {
        const loaded = new Image();
        loaded.onload = () => resolve(loaded);
        loaded.onerror = reject;
        loaded.src = image;
      });
      const source = document.createElement("canvas");
      source.width = sourceImage.naturalWidth;
      source.height = sourceImage.naturalHeight;
      const context = source.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Canvas is unavailable.");
      context.drawImage(sourceImage, 0, 0);
      const corrected = rectifyPagePerspective(source, corners, {
        confidence: 1,
        minConfidence: 0.92,
        maxSide: 2000,
      });
      if (!corrected) throw new Error("The selected boundary is not a valid quadrilateral.");
      onApply(corrected.toDataURL("image/jpeg", 0.94));
    } catch {
      setError(true);
    } finally {
      setWorking(false);
    }
  };

  return (
    <section className="mt-2 w-full max-w-[520px] rounded-xl border border-primary/30 bg-background p-3" dir={isArabic ? "rtl" : "ltr"}>
      <div className="mb-2">
        <h4 className="text-sm font-semibold">{labels.title}</h4>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{labels.help}</p>
      </div>

      <div className="relative mx-auto w-full overflow-hidden rounded-lg bg-muted" style={imageSize.width ? { aspectRatio: `${imageSize.width} / ${imageSize.height}` } : undefined}>
        <img
          src={image}
          alt={labels.title}
          className="block h-auto w-full select-none"
          draggable={false}
          onLoad={(event) => setImageSize({
            width: event.currentTarget.naturalWidth,
            height: event.currentTarget.naturalHeight,
          })}
        />
        {imageSize.width > 0 && (
          <svg
            ref={svgRef}
            viewBox={`0 0 ${imageSize.width} ${imageSize.height}`}
            preserveAspectRatio="none"
            className="absolute inset-0 h-full w-full touch-none"
            onPointerMove={movePoint}
            onPointerUp={(event) => {
              setActivePoint(null);
              if (svgRef.current?.hasPointerCapture(event.pointerId)) {
                svgRef.current.releasePointerCapture(event.pointerId);
              }
            }}
            onPointerCancel={() => setActivePoint(null)}
          >
            <polygon
              points={corners.map((point) => `${point.x},${point.y}`).join(" ")}
              fill="rgba(34,197,94,0.12)"
              stroke="#22c55e"
              strokeWidth={Math.max(3, imageSize.width / 220)}
              strokeLinejoin="round"
            />
            {corners.map((point, index) => (
              <g key={index}>
                <circle cx={point.x} cy={point.y} r={Math.max(18, imageSize.width / 42)} fill="rgba(34,197,94,0.18)" />
                <circle
                  cx={point.x}
                  cy={point.y}
                  r={Math.max(10, imageSize.width / 75)}
                  fill="#16a34a"
                  stroke="white"
                  strokeWidth={Math.max(3, imageSize.width / 320)}
                  style={{ cursor: "grab", touchAction: "none" }}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setActivePoint(index);
                    svgRef.current?.setPointerCapture(event.pointerId);
                  }}
                />
                <text
                  x={point.x}
                  y={point.y - Math.max(20, imageSize.width / 55)}
                  textAnchor="middle"
                  fontSize={Math.max(24, imageSize.width / 28)}
                  fontWeight="bold"
                  fill="white"
                  stroke="#14532d"
                  strokeWidth={Math.max(2, imageSize.width / 360)}
                  paintOrder="stroke"
                >
                  {index + 1}
                </text>
              </g>
            ))}
          </svg>
        )}
      </div>

      {error && <p role="alert" className="mt-2 text-xs text-destructive">{labels.failed}</p>}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          disabled={working}
          onClick={() => {
            setCorners(candidate.corners.map((point: Point2D) => ({ ...point })) as Quadrilateral);
            setError(false);
          }}
          className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-muted disabled:opacity-50"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          {labels.reset}
        </button>
        <button
          type="button"
          disabled={working || imageSize.width === 0}
          onClick={() => void applyCorrection()}
          className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50"
        >
          <Check className="h-3.5 w-3.5" />
          {working ? labels.working : labels.apply}
        </button>
      </div>
    </section>
  );
}
