import { useEffect, useMemo, useState } from "react";
import { Download, ExternalLink, RefreshCw, Share2, ShieldAlert, ShieldCheck, X } from "lucide-react";
import ImageViewer, { openImage, saveImage, shareImage } from "./ImageViewer";
import AnswerImageLoader from "./AnswerImageLoader";
import { Button } from "@/components/ui/button";
import { describeDiagramWarning } from "@/lib/diagram";
import { diagramApi } from "@/lib/diagramApi";
import { canvasRaster } from "@/lib/diagramRender";
import { solveDiagram, type DiagramFailReason, type DiagramResult, type DiagramStage } from "@/lib/diagramSolver";

type Lang = "ar" | "fr";

const STAGE: Record<DiagramStage, { ar: string; fr: string }> = {
  locating: { ar: "أبحث عن الشكل في الورقة…", fr: "Recherche de la figure sur la feuille…" },
  cropping: { ar: "أقصّ الشكل وأنظّفه…", fr: "Découpe et nettoyage de la figure…" },
  drawing: { ar: "أحلّل المطلوب وأرسم بدقة…", fr: "Analyse de la consigne et tracé précis…" },
  finishing: { ar: "أركّب الرسم النهائي…", fr: "Assemblage du tracé final…" },
};

const FAIL: Record<DiagramFailReason, { ar: string; fr: string }> = {
  no_figure: { ar: "لم أجد شكلاً مرسوماً في هذه الورقة.", fr: "Aucune figure dessinée trouvée sur cette feuille." },
  figure_too_small: { ar: "الشكل صغير جداً في الصورة. قرّب الكاميرا وأعد التصوير.", fr: "La figure est trop petite sur la photo. Rapprochez-vous et reprenez-la." },
  no_provider: { ar: "خدمة رسم الأشكال غير مُعدّة بعد.", fr: "Le service de tracé n’est pas encore configuré." },
  credits: { ar: "رصيد الذكاء الاصطناعي نفد مؤقتاً.", fr: "Crédits IA épuisés pour le moment." },
  aborted: { ar: "", fr: "" },
  upstream: { ar: "الخدمة غير متاحة الآن، حاول بعد قليل.", fr: "Service indisponible, réessayez dans un instant." },
  image_failed: { ar: "تعذرت معالجة الصورة على هذا الجهاز.", fr: "Impossible de traiter l’image sur cet appareil." },
};

interface Props {
  sheetImage: string;
  answer: string;
  lang: Lang;
  id: string;
  onClose: () => void;
}

/**
 * يرسم الشكل الذي تدور حوله الإجابة وينفّذ عليه ما يطلبه السؤال (ماسّ، نقاط، أسهم…).
 * محركان: إعادة رسم دقيقة بالذكاء الاصطناعي (لا تُقبل إلا إن طابقت الأصل)، وإلا نظام الطوارئ
 * (الصورة الأصلية بعد مسح الأسئلة الأخرى وتكبير الشكل). كل شيء يُبنى في المتصفح فوق نتيجة مفحوصة.
 */
export default function DiagramSolverPanel({ sheetImage, answer, lang, id, onClose }: Props) {
  const ar = lang === "ar";
  const t = (p: { ar: string; fr: string }) => (ar ? p.ar : p.fr);
  const [runKey, setRunKey] = useState(0);
  const [stage, setStage] = useState<DiagramStage>("locating");
  const [result, setResult] = useState<DiagramResult | null>(null);
  const [view, setView] = useState<"primary" | "alternate">("primary");
  const [viewer, setViewer] = useState(false);

  useEffect(() => {
    const ctl = new AbortController();
    setResult(null);
    setView("primary");
    setStage("locating");
    solveDiagram({ sheet: sheetImage, answer: answer.slice(0, 6000) }, diagramApi, canvasRaster, { signal: ctl.signal, onStage: setStage })
      .then((r) => { if (!ctl.signal.aborted) setResult(r); })
      .catch(() => { if (!ctl.signal.aborted) setResult({ ok: false, reason: "image_failed" }); });
    return () => ctl.abort();
  }, [sheetImage, answer, runKey]);

  const shown = useMemo(() => {
    if (!result || !result.ok) return null;
    return view === "alternate" && result.alternate ? { image: result.alternate.image, engine: result.alternate.engine } : { image: result.image, engine: result.engine };
  }, [result, view]);

  const name = `ILYASS-AI-figure-${id}.png`;
  const retry = () => setRunKey((k) => k + 1);

  return (
    <div className="w-full overflow-hidden rounded-2xl border border-border" dir={ar ? "rtl" : "ltr"}>
      <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/30 px-3 py-1.5 text-xs font-semibold text-foreground">
        <span>{ar ? "رسم الشكل وتنفيذ المطلوب" : "Figure et tracé demandé"}</span>
        <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onClose} aria-label={ar ? "إغلاق" : "Fermer"}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {!result && <AnswerImageLoader label={t(STAGE[stage])} />}

      {result && !result.ok && (
        <div className="flex flex-col items-start gap-2 p-4 text-sm">
          <div className="flex items-start gap-2 text-foreground">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            <span>{t(FAIL[result.reason])}</span>
          </div>
          {result.reason !== "no_provider" && result.reason !== "credits" && (
            <Button type="button" variant="ghost" size="sm" className="gap-1.5 text-xs" onClick={retry}>
              <RefreshCw className="h-4 w-4" />{ar ? "إعادة المحاولة" : "Réessayer"}
            </Button>
          )}
        </div>
      )}

      {result && result.ok && shown && (
        <div className="space-y-2 p-2">
          <div
            className={
              "flex items-start gap-2 rounded-xl px-3 py-2 text-xs " +
              (result.status === "ok" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                : result.status === "partial" ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
                : "bg-red-500/10 text-red-700 dark:text-red-300")
            }
          >
            {result.status === "ok" ? <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" /> : result.status === "partial" ? <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" /> : <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />}
            <div className="space-y-0.5">
              <div className="font-semibold">
                {result.status === "unreliable"
                  ? (ar ? "غير موثوق: لم أتأكد أي شكل تقصد. راجعه قبل الاعتماد." : "Peu fiable : je ne suis pas sûr de la figure visée. Vérifiez avant de vous y fier.")
                  : result.status === "partial"
                    ? (ar ? "نتيجة جزئية" : "Résultat partiel")
                    : shown.engine === "redraw"
                      ? (ar ? `إعادة رسم مطابقة للأصل (تطابق ${Math.round((result.similarity ?? 0) * 100)}٪)` : `Redessin conforme à l’original (${Math.round((result.similarity ?? 0) * 100)} %)`)
                      : (ar ? "الشكل هو صورتك الأصلية دون أي تعديل في خطوطه" : "La figure est votre image d’origine, sans retouche des traits")}
              </div>
              {shown.engine === "emergency" && result.status !== "unreliable" && (
                <div className="opacity-90">
                  {ar ? "مسحتُ الأسئلة الأخرى وكبّرتُ الشكل ورسمتُ فوقه." : "Autres questions effacées, figure agrandie et tracé par-dessus."}
                </div>
              )}
              {result.drawn > 0 && (
                <div className="opacity-90">
                  {ar ? `رُسم ${result.drawn} من ${result.planned} عنصر مطلوب` : `${result.drawn} élément(s) tracé(s) sur ${result.planned}`}
                  {result.snapped > 0 ? (ar ? ` · ${result.snapped} نقطة التصقت بخط الشكل` : ` · ${result.snapped} point(s) alignés sur le tracé`) : ""}
                </div>
              )}
            </div>
          </div>

          {result.alternate && (
            <div className="flex gap-1 text-xs">
              {(["primary", "alternate"] as const).map((v) => (
                <Button key={v} type="button" size="sm" variant={view === v ? "secondary" : "ghost"} className="h-7 flex-1 text-xs" onClick={() => setView(v)}>
                  {v === "primary" ? (ar ? "المُعاد رسمه" : "Redessiné") : (ar ? "الأصل مكبَّراً" : "Original agrandi")}
                </Button>
              ))}
            </div>
          )}

          <div className="overflow-hidden rounded-xl border border-border bg-white">
            <img src={shown.image} alt={ar ? "الشكل مع المطلوب" : "Figure avec le tracé demandé"} className="block w-full cursor-zoom-in" onClick={() => setViewer(true)} />
          </div>

          {(result.task || result.summary) && (
            <div className="space-y-0.5 px-1 text-xs text-muted-foreground">
              {result.task && <div><span className="font-semibold">{ar ? "المطلوب: " : "Consigne : "}</span><bdi>{result.task}</bdi></div>}
              {result.summary && <div>{result.summary}</div>}
            </div>
          )}

          {result.warnings.length > 0 && (
            <ul className="space-y-0.5 px-1 text-xs text-muted-foreground">
              {result.warnings.map((w, i) => <li key={i}>• {describeDiagramWarning(w, lang)}</li>)}
            </ul>
          )}

          <div className="px-1 text-[11px] leading-relaxed text-muted-foreground">
            {ar ? "النظام يتحقق من تطابق الشكل ومواضع الرسم، لا من صحة الحل نفسه. قارن دائماً مع حلّك." : "Le système vérifie la fidélité de la figure et la position du tracé, pas l’exactitude de la solution. Comparez toujours avec votre solution."}
          </div>

          <div className="flex flex-wrap justify-center gap-1 border-t border-border pt-1 text-xs">
            <Button variant="ghost" size="sm" className="gap-1.5 text-xs" onClick={() => openImage(shown.image)}><ExternalLink className="h-4 w-4" />{ar ? "فتح" : "Ouvrir"}</Button>
            <Button variant="ghost" size="sm" className="gap-1.5 text-xs" onClick={() => saveImage(shown.image, name)}><Download className="h-4 w-4" />{ar ? "حفظ" : "Enregistrer"}</Button>
            <Button variant="ghost" size="sm" className="gap-1.5 text-xs" onClick={() => shareImage(shown.image, name).catch(() => {})}><Share2 className="h-4 w-4" />{ar ? "مشاركة" : "Partager"}</Button>
            <Button variant="ghost" size="sm" className="gap-1.5 text-xs" onClick={retry}><RefreshCw className="h-4 w-4" />{ar ? "إعادة" : "Refaire"}</Button>
          </div>
        </div>
      )}

      {viewer && shown && <ImageViewer src={shown.image} name={name} onClose={() => setViewer(false)} />}
    </div>
  );
}
