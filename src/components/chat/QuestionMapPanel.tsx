import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Loader2, RotateCcw, Search } from "lucide-react";
import { cropDataUrl } from "@/lib/cropImage";
import {
  cropBoxFor,
  describeWarning,
  findSelection,
  flattenStructure,
  selectionHint,
  type FlatItem,
  type RecognitionResult,
} from "@/lib/recognition";

interface Props {
  /** صورة الورقة (data URL) */
  image: string;
  lang: string;
  subject?: string;
  /** يستلم المنطقة المقصوصة ونصاً إرشادياً يُوضع في خانة الكتابة */
  onApply: (croppedImage: string, hint: string) => void;
}

const copy = {
  ar: {
    open: "تحليل الورقة: اكتشاف التمارين والأسئلة",
    title: "بنية الورقة",
    analyzing: "جارٍ تحديد التمارين والأسئلة ومواضعها…",
    retry: "إعادة التحليل",
    failed: "تعذّر تحليل الورقة الآن. جرّب مجدداً بعد قليل.",
    credits: "رصيد الذكاء الاصطناعي غير كافٍ حالياً.",
    summary: (e: number, q: number) => `اكتُشف ${e} تمرين و${q} سؤالاً. اختر ما تريد حلّه.`,
    unreliable: "لم يكن الاكتشاف موثوقاً في هذه الصورة. استعمل الصورة كاملة، أو أعد التصوير بوضوح أكبر.",
    partial: "الاكتشاف جزئي: راجع التنبيهات قبل الاعتماد عليه.",
    use: "حلّ هذا الجزء فقط",
    working: "جارٍ القصّ…",
    cropFailed: "تعذّر قصّ هذا الجزء. اختر جزءاً آخر.",
    exercise: "تمرين",
    given: "معطيات",
    noBox: "بلا موضع",
    pts: "ن",
    pick: "اختر تمريناً أو سؤالاً من القائمة",
    unsure: "موضعه غير مؤكد",
  },
  fr: {
    open: "Analyser la feuille : repérer exercices et questions",
    title: "Structure de la feuille",
    analyzing: "Repérage des exercices, questions et positions…",
    retry: "Relancer l’analyse",
    failed: "Analyse impossible pour le moment. Réessayez dans un instant.",
    credits: "Crédit IA insuffisant pour le moment.",
    summary: (e: number, q: number) => `${e} exercice(s) et ${q} question(s) repérés. Choisissez ce que vous voulez résoudre.`,
    unreliable: "Le repérage n’est pas fiable sur cette image. Utilisez la photo entière ou refaites-la plus nettement.",
    partial: "Repérage partiel : vérifiez les avertissements avant de vous y fier.",
    use: "Résoudre cette partie seulement",
    working: "Découpe…",
    cropFailed: "Découpe impossible pour cette partie. Choisissez-en une autre.",
    exercise: "Exercice",
    given: "Données",
    noBox: "position inconnue",
    pts: "pt",
    pick: "Choisissez un exercice ou une question dans la liste",
    unsure: "position incertaine",
  },
};

const COLORS = ["#16a34a", "#2563eb", "#9333ea", "#ea580c", "#0891b2", "#be123c"];

type Status = "closed" | "loading" | "done" | "error" | "credits";

export default function QuestionMapPanel({ image, lang, subject, onApply }: Props) {
  const ar = lang === "ar";
  const t = ar ? copy.ar : copy.fr;
  const [status, setStatus] = useState<Status>("closed");
  const [result, setResult] = useState<RecognitionResult | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [cropError, setCropError] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  // صورة جديدة (مثلاً بعد تصحيح المنظور) = نتيجة قديمة لم تعد صالحة
  useEffect(() => {
    abortRef.current?.abort();
    setStatus("closed");
    setResult(null);
    setSelectedId(null);
  }, [image]);

  const analyze = async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus("loading");
    setResult(null);
    setSelectedId(null);
    setCropError(false);
    try {
      const res = await fetch("/api/recognize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ image, subject }),
      });
      if (!res.ok) {
        setStatus(res.status === 402 ? "credits" : "error");
        return;
      }
      const data = (await res.json()) as { result?: RecognitionResult };
      if (!data.result) {
        setStatus("error");
        return;
      }
      setResult(data.result);
      setSelectedId(data.result.exercises[0]?.id ?? null);
      setStatus("done");
    } catch (e) {
      if ((e as { name?: string })?.name === "AbortError") return;
      setStatus("error");
    }
  };

  const flat = useMemo(() => (result ? flattenStructure(result) : []), [result]);
  const selected = flat.find((i) => i.id === selectedId) ?? null;
  const exerciseIndex = (id: string) => Math.max(0, result?.exercises.findIndex((e) => e.id === id) ?? 0);
  const questionCount = flat.filter((i) => i.kind === "question").length;

  const visible = flat.filter((i) => i.box && (i.kind === "exercise" || i.exerciseId === selected?.exerciseId));

  const apply = async () => {
    if (!result || !selected) return;
    const sel = findSelection(result, selected.kind === "given" ? selected.exerciseId : selected.id);
    const box = sel ? cropBoxFor(sel) : undefined;
    if (!sel || !box) {
      setCropError(true);
      return;
    }
    setApplying(true);
    setCropError(false);
    try {
      const cropped = await cropDataUrl(image, box);
      onApply(cropped, selectionHint(sel, ar ? "ar" : "fr"));
    } catch {
      setCropError(true);
    } finally {
      setApplying(false);
    }
  };

  if (status === "closed") {
    return (
      <button
        type="button"
        onClick={() => void analyze()}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-muted"
      >
        <Search className="h-3.5 w-3.5" />
        {t.open}
      </button>
    );
  }

  return (
    <section className="w-full rounded-2xl border border-border bg-card p-3" dir={ar ? "rtl" : "ltr"}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{t.title}</h3>
        <button
          type="button"
          onClick={() => void analyze()}
          disabled={status === "loading"}
          className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs hover:bg-muted disabled:opacity-50"
        >
          <RotateCcw className="h-3 w-3" />
          {t.retry}
        </button>
      </div>

      {status === "loading" && (
        <p className="flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t.analyzing}
        </p>
      )}
      {(status === "error" || status === "credits") && (
        <p role="alert" className="rounded-xl border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {status === "credits" ? t.credits : t.failed}
        </p>
      )}

      {status === "done" && result && (
        <>
          <p
            className={`mb-2 rounded-xl border px-3 py-2 text-sm ${
              result.status === "ok"
                ? "border-emerald-500/40 bg-emerald-500/10"
                : result.status === "partial"
                  ? "border-amber-500/40 bg-amber-500/10"
                  : "border-destructive/40 bg-destructive/5"
            }`}
          >
            {result.status === "unreliable" ? t.unreliable : t.summary(result.exercises.length, questionCount)}
            {result.status === "partial" && <span className="mt-1 block text-xs text-muted-foreground">{t.partial}</span>}
          </p>

          {/* الصورة مع المربعات: أبعاد الغلاف = أبعاد الصورة، فتصح النسب المئوية */}
          <div dir="ltr" className="relative mx-auto w-full overflow-hidden rounded-lg border border-border">
            <img src={image} alt="" className="block h-auto w-full" draggable={false} />
            {visible.map((item) => {
              const b = item.box!;
              const color = COLORS[exerciseIndex(item.exerciseId) % COLORS.length];
              const isSel = item.id === selectedId;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-label={`${item.label}`}
                  onClick={() => setSelectedId(item.id)}
                  className="absolute"
                  style={{
                    left: `${b.x * 100}%`,
                    top: `${b.y * 100}%`,
                    width: `${b.w * 100}%`,
                    height: `${b.h * 100}%`,
                    border: `${isSel ? 3 : item.kind === "exercise" ? 2 : 1.5}px ${item.kind === "given" || item.confidence === "low" ? "dashed" : "solid"} ${color}`,
                    background: isSel ? `${color}33` : "transparent",
                    opacity: isSel || item.kind === "exercise" ? 1 : 0.8,
                    zIndex: isSel ? 3 : item.kind === "exercise" ? 1 : 2,
                  }}
                >
                  {isSel && (
                    <span className="absolute -top-px left-0 max-w-full truncate rounded-br px-1.5 py-0.5 text-[0.6875rem] font-bold text-white" style={{ background: color }}>
                      {item.label}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {result.warnings.length > 0 && (
            <ul className="mt-2 space-y-1 rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs leading-5">
              {result.warnings.slice(0, 6).map((w, i) => (
                <li key={`${w.code}-${i}`}>{describeWarning(w, ar ? "ar" : "fr")}</li>
              ))}
            </ul>
          )}
          {result.notes && <p className="mt-2 text-xs text-muted-foreground">{result.notes}</p>}

          <ul className="mt-3 space-y-1" role="listbox" aria-label={t.title}>
            {flat.map((item) => (
              <Row key={item.id} item={item} t={t} selected={item.id === selectedId} color={COLORS[exerciseIndex(item.exerciseId) % COLORS.length]} onSelect={() => setSelectedId(item.id)} />
            ))}
          </ul>

          {cropError && (
            <p role="alert" className="mt-2 text-xs text-destructive">
              {t.cropFailed}
            </p>
          )}
          <div className="mt-3 flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">{selected ? "" : t.pick}</span>
            <button
              type="button"
              disabled={!selected || applying}
              onClick={() => void apply()}
              className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50"
            >
              <Check className="h-3.5 w-3.5" />
              {applying ? t.working : t.use}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function Row({ item, t, selected, color, onSelect }: { item: FlatItem; t: (typeof copy)["ar"]; selected: boolean; color: string; onSelect: () => void }) {
  const indent = item.level === 0 ? "" : item.level === 1 ? "ms-4" : "ms-8";
  const name = item.kind === "exercise" ? item.label : item.kind === "given" ? `${t.given} (${item.label})` : item.parentLabel ? `${item.parentLabel}-${item.label}` : item.label;
  return (
    <li className={indent}>
      <button
        type="button"
        role="option"
        aria-selected={selected}
        onClick={onSelect}
        className={`flex w-full items-start gap-2 rounded-lg border px-2.5 py-2 text-start text-sm transition-colors ${
          selected ? "border-primary bg-primary/10" : "border-transparent hover:bg-muted"
        }`}
      >
        <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className={`block truncate ${item.kind === "exercise" ? "font-semibold" : ""}`}>
            {name}
            {item.text ? <span className="font-normal text-muted-foreground"> — {item.text}</span> : null}
          </span>
          {(!item.box || item.confidence !== "high") && (
            <span className="block text-xs text-amber-600 dark:text-amber-400">{item.box ? t.unsure : t.noBox}</span>
          )}
        </span>
        {item.points !== undefined && <span dir="ltr" className="shrink-0 text-xs text-muted-foreground">{item.points} {t.pts}</span>}
      </button>
    </li>
  );
}
