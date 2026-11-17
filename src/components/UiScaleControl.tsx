import { Smartphone } from "lucide-react";
import { useUiScale } from "@/hooks/use-ui-scale";
import { SCALE_PRESETS, approxDpi, looksLikeDesktopSite } from "@/lib/display-scale";

interface Props {
  lang: "ar" | "fr";
}

/**
 * اختيار حجم الواجهة: «تلقائي» يقدّر الحجم من شاشة هاتفك، أو حجم ثابت تختاره.
 * السطر تحت الأزرار يعرض ما يكتشفه المتصفح فعلاً (الأبعاد والكثافة)، ليعرف الطالب لماذا اختير هذا الحجم.
 */
export default function UiScaleControl({ lang }: Props) {
  const ar = lang === "ar";
  const { choice, setChoice, env, scale } = useUiScale();

  const chip = (active: boolean) =>
    `rounded-full border px-3.5 py-2 text-sm font-medium transition-colors active:scale-95 ${
      active
        ? "border-primary bg-primary/10 text-primary"
        : "border-border text-foreground/80 hover:bg-muted"
    }`;

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Smartphone className="h-4 w-4 text-primary" />
        {ar ? "حجم الواجهة" : "Taille de l'interface"}
        <span dir="ltr" className="ms-auto rounded-full bg-primary/10 px-3 py-1 text-sm font-semibold text-primary">
          ×{scale}
        </span>
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label={ar ? "حجم الواجهة" : "Taille de l'interface"}>
        <button type="button" onClick={() => setChoice("auto")} aria-pressed={choice === "auto"} className={chip(choice === "auto")}>
          {ar ? "تلقائي" : "Auto"}
        </button>
        {SCALE_PRESETS.map((preset) => (
          <button
            key={preset.value}
            type="button"
            onClick={() => setChoice(preset.value)}
            aria-pressed={choice === preset.value}
            className={chip(choice === preset.value)}
          >
            {ar ? preset.ar : preset.fr}
          </button>
        ))}
      </div>

      {env && (
        <p dir="ltr" className="text-xs leading-5 text-muted-foreground">
          {ar ? "شاشتك" : "Écran"}: {env.shortSide}×{env.longSide} · ×{Math.round(env.dpr * 100) / 100} (≈{approxDpi(env.dpr)} dpi) ·{" "}
          {choice === "auto" ? (ar ? "تلقائي" : "auto") : ar ? "يدوي" : "manuel"} ×{scale}
        </p>
      )}

      {env && looksLikeDesktopSite(env) && (
        <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-600 dark:text-amber-400">
          {ar
            ? "يبدو أن المتصفح يعرض نسخة سطح المكتب من الموقع، وهذا يصغّر النص كثيراً. ألغِ خيار «موقع سطح المكتب» من قائمة المتصفح."
            : "Le navigateur semble afficher la version bureau du site, ce qui rapetisse le texte. Désactivez « Site pour ordinateur » dans le menu du navigateur."}
        </p>
      )}

      <p className="text-xs leading-5 text-muted-foreground">
        {ar
          ? "«تلقائي» يكبّر الواجهة فقط عندما تكون شاشتك بكثافة عالية تصغّر النص، وخط الإجابات يتبع هذا الحجم أيضاً. اختر حجماً بنفسك إن لم يناسبك."
          : "« Auto » n'agrandit l'interface que si la densité de votre écran rend le texte trop petit, et le texte des réponses suit aussi. Choisissez une taille si elle ne vous convient pas."}
      </p>
    </section>
  );
}
