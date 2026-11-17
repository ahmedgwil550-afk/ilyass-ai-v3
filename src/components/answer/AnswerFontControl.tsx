import { Minus, Plus } from "lucide-react";
import { ANSWER_FONT_DEFAULT, ANSWER_FONT_MAX, ANSWER_FONT_MIN } from "@/hooks/use-answer-font";

interface Props {
  size: number;
  onChange: (next: number) => void;
  lang: "ar" | "fr";
}

/** شريط صغير: تصغير / الحجم (يُعيد الافتراضي عند الضغط) / تكبير — من 12px إلى 24px. */
export default function AnswerFontControl({ size, onChange, lang }: Props) {
  const ar = lang === "ar";
  return (
    <div
      dir="ltr"
      role="group"
      aria-label={ar ? "حجم خط الإجابة" : "Taille du texte"}
      className="inline-flex h-9 items-center gap-1 rounded-full border border-border/80 bg-background/80 px-1.5 shadow-sm"
    >
      <button
        type="button"
        onClick={() => onChange(size - 1)}
        disabled={size <= ANSWER_FONT_MIN}
        className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95 disabled:opacity-30"
        title={ar ? "تصغير الخط" : "Réduire le texte"}
        aria-label={ar ? "تصغير الخط" : "Réduire le texte"}
      >
        <Minus className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => onChange(ANSWER_FONT_DEFAULT)}
        className="min-w-12 rounded-md px-1 text-center text-xs font-medium tabular-nums text-foreground"
        title={ar ? `إعادة الحجم الافتراضي ${ANSWER_FONT_DEFAULT}px` : `Réinitialiser à ${ANSWER_FONT_DEFAULT}px`}
        aria-label={ar ? "إعادة الحجم الافتراضي" : "Réinitialiser la taille"}
      >
        {size}px
      </button>
      <button
        type="button"
        onClick={() => onChange(size + 1)}
        disabled={size >= ANSWER_FONT_MAX}
        className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95 disabled:opacity-30"
        title={ar ? "تكبير الخط" : "Agrandir le texte"}
        aria-label={ar ? "تكبير الخط" : "Agrandir le texte"}
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}
