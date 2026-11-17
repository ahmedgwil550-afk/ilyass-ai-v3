import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown, Loader2, Shield, ShieldAlert, ShieldCheck, X } from "lucide-react";
import type { QLang } from "@/lib/thinking";
import type { Verdict, VerificationIssue } from "@/lib/verification";
import {
  DISCLAIMER, EXPECTED_LABEL, METHOD_TITLE, RUNNING_TEXT, SKIPPED_LABEL, SOURCE_LABEL, UNVERIFIED_NOTE, UNVERIFIED_TITLE, WHERE_LABEL,
  headline, issueText, splitIssues, viewLang, type ViewLang,
} from "@/lib/verificationView";

interface Props {
  verdict: Verdict | null;
  /** هل الرسالة ما زالت تُبثّ الآن؟ (حكم running يُعرض فقط أثناء البث) */
  streaming: boolean;
  lang: QLang;
}

const TONE = {
  unchecked: { icon: Shield, cls: "text-muted-foreground" },
  verified: { icon: ShieldCheck, cls: "text-emerald-400" },
  checked: { icon: Shield, cls: "text-muted-foreground" },
  warning: { icon: ShieldAlert, cls: "text-amber-400" },
  error: { icon: ShieldAlert, cls: "text-red-400" },
} as const;

const SEV_CLS = { error: "text-red-400", warn: "text-amber-400", info: "text-muted-foreground" } as const;

/** ملاحظة واحدة: أين الخطأ بالضبط، وما الصواب، وما الدليل، ومن أين جاء الحكم. */
function IssueItem({ i, l }: { i: VerificationIssue; l: ViewLang }) {
  return (
    <li className="space-y-0.5">
      <div className="flex items-start gap-2">
        <span className={`mt-0.5 w-3.5 shrink-0 text-center text-xs font-bold ${SEV_CLS[i.severity]}`} aria-hidden>{i.severity === "info" ? "i" : "!"}</span>
        <span dir="auto" className="min-w-0 flex-1">
          {i.q && <span className="me-1 font-medium">{l === "ar" ? `السؤال ${i.q}:` : `Q${i.q} :`}</span>}
          {issueText(i, l)}
        </span>
      </div>
      {i.where && (
        <p className="ms-5 text-xs text-muted-foreground">
          <span>{WHERE_LABEL[l]}: </span><bdi dir="auto" className="break-words font-mono">{i.where}</bdi>
        </p>
      )}
      {i.expected && (
        <p className="ms-5 text-xs text-muted-foreground">
          <span>{EXPECTED_LABEL[l]}: </span><bdi dir="ltr" className="break-words font-mono text-emerald-400">{i.expected}</bdi>
        </p>
      )}
      {i.evidence && <p dir="ltr" className="ms-5 break-words font-mono text-xs text-muted-foreground">{i.evidence}</p>}
      <p className="ms-5 text-xs text-muted-foreground">{SOURCE_LABEL[i.source][l]}</p>
    </li>
  );
}

/** شارة التحقق من صحة الإجابة: سطر صغير يُفتح لتفاصيل ما فُحص وما وُجد. */
export default function VerificationBadge({ verdict, streaming, lang }: Props) {
  const [open, setOpen] = useState(false);
  const l = viewLang(lang);
  if (!verdict) return null;

  if (verdict.state === "running") {
    // حكم وسيط عالق بعد انقطاع البث: لا نعرض شيئاً
    if (!streaming) return null;
    return (
      <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground" dir={l === "ar" ? "rtl" : "ltr"} role="status">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        <span>{RUNNING_TEXT[l]}</span>
      </div>
    );
  }

  const head = headline(verdict, l);
  if (!head) return null;
  const tone = TONE[verdict.level];
  const Icon = tone.icon;
  const { findings, method } = splitIssues(verdict.issues);
  const unverified = verdict.unverified ?? [];
  // لا نخفي ما تعذّر فحصه: يظهر بوسم "تعذر التحقق" بدل أن يبدو كأنه فُحص ونجح
  const checks = verdict.checks;

  return (
    <div className="mt-3 w-full text-sm" dir={l === "ar" ? "rtl" : "ltr"}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex max-w-full items-center gap-2 rounded-full py-1 text-muted-foreground transition-colors hover:text-foreground"
      >
        <Icon className={`h-4 w-4 shrink-0 ${tone.cls}`} aria-hidden />
        <span className={`truncate font-medium ${tone.cls}`}>{head.title}</span>
        {head.sub && <span className="truncate text-xs opacity-80">{head.sub}</span>}
        <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="details"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="mt-1 overflow-hidden border-s-2 border-border ps-3"
          >
            {findings.length > 0 && (
              <ul className="space-y-2 py-1">
                {findings.map((i, idx) => <IssueItem key={`${i.kind}-${idx}`} i={i} l={l} />)}
              </ul>
            )}

            {method.length > 0 && (
              <div className="py-1">
                <p className="pb-1 text-xs font-medium text-muted-foreground">{METHOD_TITLE[l]}</p>
                <ul className="space-y-2">
                  {method.map((i, idx) => <IssueItem key={`${i.kind}-${idx}`} i={i} l={l} />)}
                </ul>
              </div>
            )}

            {unverified.length > 0 && (
              <div className="py-1">
                <p className="pb-1 text-xs font-medium text-muted-foreground">{UNVERIFIED_TITLE[l]}</p>
                <ul className="space-y-1">
                  {unverified.map((u, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-xs text-muted-foreground">
                      <span className="mt-0.5 w-3.5 shrink-0 text-center" aria-hidden>?</span>
                      <span dir="auto" className="min-w-0 flex-1">
                        {u.q && <span className="me-1 font-medium">{l === "ar" ? `السؤال ${u.q}:` : `Q${u.q} :`}</span>}
                        {(l === "ar" ? u.ar : u.fr) || u.ar || u.fr}
                        {u.what && <bdi dir="auto" className="ms-1 break-words font-mono">{`«${u.what}»`}</bdi>}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="ps-5 pt-1 text-xs text-muted-foreground">{UNVERIFIED_NOTE[l]}</p>
              </div>
            )}

            {checks.length > 0 && (
              <ul className="space-y-1 py-1">
                {checks.map((c) => (
                  <li key={c.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                    {c.status === "pass" ? <Check className="h-3.5 w-3.5 shrink-0 text-emerald-400" aria-hidden />
                      : c.status === "skip" ? <span className="w-3.5 shrink-0 text-center" aria-hidden>–</span>
                      : c.status === "warn" ? <span className="w-3.5 shrink-0 text-center font-bold text-amber-400" aria-hidden>!</span>
                      : <X className="h-3.5 w-3.5 shrink-0 text-red-400" aria-hidden />}
                    <span dir="auto">
                      {l === "ar" ? c.ar : c.fr}{typeof c.count === "number" && c.count > 0 ? ` (${c.count})` : ""}
                      {c.status === "skip" ? ` — ${SKIPPED_LABEL[l]}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            <p className="py-1 text-xs leading-relaxed text-muted-foreground">{DISCLAIMER[l]}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
