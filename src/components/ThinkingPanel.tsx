import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown } from "lucide-react";
import { CheckIcon } from "@/components/icons";
import AcademicEmblem from "@/components/AcademicEmblem";
import { thinkingLines, type QLang } from "@/lib/thinking";
import "./ThinkingPanel.css";

interface Props {
  /** نص كتلة التفكير القادم من splitThinking(...).thinking */
  thinking: string;
  /** هل بدأت الإجابة الفعلية بالظهور؟ (answer.length > 0) */
  answerStarted: boolean;
  /** هل الرسالة ما زالت قيد البث؟ */
  streaming: boolean;
  /** لغة سؤال الطالب: detectLang(نص السؤال, fallbackLangForSubject(subject)) */
  lang: QLang;
  hasImage?: boolean;
  examMode?: boolean;
}

/* ---------- أيقونة ILYASS AI الأكاديمية ---------- */
function MetalBrain({ shining, size = 22 }: { shining: boolean; size?: number }) {
  return (
    <span
      aria-hidden
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{ width: size, height: size, filter: "drop-shadow(0 0 3px rgba(120,175,255,.55))" }}
    >
      <AcademicEmblem size={size} animated={shining} className="block" />
    </span>
  );
}

/* ---------- النصوص حسب لغة السؤال ---------- */
const TEXTS: Record<QLang, { writing: string; done: string; sec: string; thinking: string; image: string[]; text: string[]; calc: string; exam: string }> = {
  fr: {
    writing: "Rédaction de la réponse…", done: "Réflexion terminée", sec: "s", thinking: "ILYASS AI réfléchit…",
    image: ["Lecture de la feuille d’examen…", "Détection des questions…", "Analyse de l’exercice…"],
    text: ["Compréhension de la question…", "Choix de la méthode…"],
    calc: "Calcul et vérification…", exam: "Mise en forme de la réponse d’examen…",
  },
  ar: {
    writing: "كتابة الإجابة…", done: "تم التفكير", sec: "ث", thinking: "ILYASS AI يفكّر…",
    image: ["قراءة ورقة الامتحان…", "تحديد الأسئلة…", "تحليل التمرين…"],
    text: ["فهم السؤال…", "اختيار طريقة الحل…"],
    calc: "الحساب والتحقق…", exam: "تنسيق إجابة الامتحان…",
  },
  en: {
    writing: "Writing the answer…", done: "Thought process", sec: "s", thinking: "ILYASS AI is thinking…",
    image: ["Reading the exam sheet…", "Detecting the questions…", "Analysing the exercise…"],
    text: ["Understanding the question…", "Choosing the method…"],
    calc: "Calculating and checking…", exam: "Formatting the exam answer…",
  },
};

export default function ThinkingPanel({ thinking, answerStarted, streaming, lang, hasImage = false, examMode = false }: Props) {
  const t = TEXTS[lang];
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState(0);

  // زمن التفكير: نقيسه فقط إذا ظهرت اللوحة أثناء البث (الرسائل القديمة بلا زمن)
  const startedAt = useRef<number | null>(streaming ? Date.now() : null);
  const [secs, setSecs] = useState<number | null>(null);
  useEffect(() => {
    if (answerStarted && startedAt.current !== null && secs === null) {
      setSecs(Math.max(1, Math.round((Date.now() - startedAt.current) / 1000)));
    }
  }, [answerStarted, secs]);

  const lines = useMemo(() => thinkingLines(thinking), [thinking]);
  const stages = useMemo(() => [...(hasImage ? t.image : t.text), t.calc, ...(examMode ? [t.exam] : [])], [t, hasImage, examMode]);

  // مراحل تقديرية قبل وصول أسطر حقيقية: تتبدل كل ~1.8 ثانية
  const waiting = streaming && !answerStarted && lines.length === 0;
  useEffect(() => {
    if (!waiting) return;
    const id = setInterval(() => setStage((s) => Math.min(s + 1, stages.length - 1)), 1800);
    return () => clearInterval(id);
  }, [waiting, stages.length]);

  // الرسائل القديمة بلا كتلة تفكير: لا نعرض شيئاً
  if (!streaming && lines.length === 0) return null;

  const done = answerStarted || !streaming;
  const items = lines.length > 0 ? lines : stages.slice(0, stage + 1);
  const headerLabel = done
    ? `${t.done}${secs ? ` · ${secs} ${t.sec}` : ""}`
    : lines.length > 0
      ? lines[lines.length - 1]
      : stages[stage] ?? t.thinking;

  const Dot = () => (
    <motion.span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" animate={{ scale: [1, 1.5, 1] }} transition={{ duration: 1, repeat: Infinity }} />
  );

  return (
    <div className="w-full text-sm" dir={lang === "ar" ? "rtl" : "ltr"}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex max-w-full items-center gap-2 rounded-full py-1 text-muted-foreground transition-colors hover:text-foreground"
      >
        <MetalBrain shining={!done} />
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={headerLabel}
            dir="auto"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18 }}
            className={`truncate font-medium italic ${done ? "" : "thinking-shimmer"}`}
          >
            {headerLabel}
          </motion.span>
        </AnimatePresence>
        <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.ul
            key="steps"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="mt-1 space-y-1.5 overflow-hidden border-s-2 border-border ps-3"
          >
            {items.map((text, i) => {
              const active = !done && lines.length === 0 && i === items.length - 1;
              return (
                <li key={`${i}-${text}`} dir="auto" className="flex items-start gap-2 text-muted-foreground">
                  {active ? <Dot /> : <CheckIcon size={14} className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />}
                  <span className={active ? "thinking-shimmer" : ""}>{text}</span>
                </li>
              );
            })}
            {!done && lines.length > 0 && (
              <li className="flex items-start gap-2 text-muted-foreground">
                <Dot />
                <span className="thinking-shimmer">{t.writing}</span>
              </li>
            )}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
