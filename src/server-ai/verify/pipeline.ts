/**
 * خط التحقق من صحة الإجابة. الطبقات:
 *  basic    فحوص شكلية برمجية فقط (مجانية، لكل الأوضاع)
 *  standard + استخراج ادعاءات رياضية بنموذج صغير ثم إعادة حسابها بالكود (الكود هو الحَكَم)
 *  strict   + حل مستقل بنموذج آخر ومقارنة النتائج النهائية
 * أي فشل أو مهلة في مرحلة نموذج = "لم يُفحص"، ولا يُفسد الإجابة ولا يُعدّ خطأً فيها أبداً.
 *
 * متغيرات البيئة (اختيارية):  VERIFY_LEVEL = off | basic | standard | strict  (يفرض مستوى واحداً على كل الأوضاع)
 *                            VERIFY_TIMEOUT_MS  أقصى مدة لكل مرحلة نموذج (افتراضي 25000)
 */
import type { Verdict, VerificationCheck, VerificationIssue, Severity, UnverifiedItem } from "../../lib/verification";
import { runClaim, type ClaimOutcome } from "./claims";
import { COMPARE_SYSTEM, EXTRACT_SYSTEM, INDEPENDENT_SOLVER_SYSTEM, METHOD_SYSTEM, REREAD_SYSTEM, methodRubric } from "./prompts";
import { parseJsonLoose, sanitizeClaims, sanitizeComparison, sanitizeMethodNotes, type LlmFn, type MethodNote } from "./llm";
import { compareReadings, comparisonIssues, readingSignals, signalIssues } from "./reading";
import { coverage, normalizeLabel, parseLabels, questionLabels, runStaticChecks } from "./static";

export type VerifyLevel = "off" | "basic" | "standard" | "strict";
const LEVELS: VerifyLevel[] = ["off", "basic", "standard", "strict"];
const TEXT_SUBJECTS = new Set(["arabic", "islamic", "philosophy", "history", "french", "english"]);

export function resolveVerifyLevel(mode: unknown, complexity = 0, override: string | undefined = process.env["VERIFY_LEVEL"]): VerifyLevel {
  const o = override?.trim().toLowerCase() as VerifyLevel | undefined;
  if (o && LEVELS.includes(o)) return o;
  if (mode === "fast") return "basic";
  if (mode === "panache") return "strict";
  if (mode === "advanced") return complexity >= 3 ? "strict" : "standard";
  return "standard";
}

export interface VerifyContext {
  subject?: string;
  mode?: unknown;
  /** نص السؤال (مكتوب أو مقروء من الصورة) */
  question: string;
  /** الإجابة النهائية كما أُرسلت للتلميذ (تُزال منها كتلة thinking تلقائياً) */
  answer: string;
  images?: any[];
  finishReason?: string | null;
  /** false إن كان نص الامتحان في صورة لم تُقرأ نصياً */
  sourceComplete?: boolean;
  /** القراءة الأولى للصورة (التي بُني عليها الحل). مع images تُعاد القراءة بنموذج مستقل وتُقارَن */
  transcript?: string;
  level: VerifyLevel;
  llm?: LlmFn | null;
  /** حل مستقل جاهز (وضع Pananachi) فلا نعيد حلّه */
  independentSolution?: string | null;
  signal?: AbortSignal;
  stageTimeoutMs?: number;
  onProgress?: (v: Verdict) => void;
}

export const stripThinkBlock = (t: string): string =>
  t.replace(/<thinking>[\s\S]*?<\/thinking>/g, "").replace(/^\s*<thinking>[\s\S]*$/, "").trim();

const SEV_ORDER: Record<Severity, number> = { error: 0, warn: 1, info: 2 };

export function buildVerdict(state: Verdict["state"], checks: VerificationCheck[], issues: VerificationIssue[], verifiedCount: number, unverified: UnverifiedItem[] = []): Verdict {
  const sorted = [...issues].sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]).slice(0, 8);
  const hasError = issues.some((i) => i.severity === "error");
  const hasWarn = issues.some((i) => i.severity === "warn");
  const level: Verdict["level"] = hasError ? "error" : hasWarn ? "warning"
    : verifiedCount > 0 ? "verified"
    // "اكتمال الإجابة" ينجح دائماً تقريباً فلا يكفي وحده ليُعدّ فحصاً ذا معنى
    : checks.some((c) => c.status === "pass" && c.id !== "complete") ? "checked" : "unchecked";
  return { v: 1, state, level, verifiedCount, checks, issues: sorted, unverified: unverified.slice(0, 12) };
}

const anySignal = (signals: AbortSignal[]): AbortSignal => {
  const any = (AbortSignal as any).any;
  if (typeof any === "function") return any(signals);
  const c = new AbortController();
  for (const s of signals) { if (s.aborted) c.abort(); else s.addEventListener("abort", () => c.abort(), { once: true }); }
  return c.signal;
};

function claimIssue(o: ClaimOutcome): VerificationIssue | null {
  if (o.status !== "mismatch" && o.status !== "partial") return null;
  return {
    severity: o.status === "mismatch" ? "error" : "warn",
    kind: `claim_${o.claim.type}${o.status === "partial" ? "_partial" : ""}`,
    source: "code",
    ...(o.claim.q ? { q: o.claim.q } : {}),
    ar: o.ar, fr: o.fr,
    ...(o.evidence ? { evidence: o.evidence } : {}),
    ...(o.claim.quote ? { where: o.claim.quote } : {}),
    ...(o.expected ? { expected: o.expected } : {}),
  };
}

const METHOD_MSG: Record<MethodNote["kind"], { ar: string; fr: string }> = {
  out_of_program: { ar: "طريقة قد تتجاوز برنامج الباكالوريا (تقدير نموذج وقد يخطئ)", fr: "Méthode peut-être hors programme du bac (estimation d'un modèle, peut se tromper)" },
  missing_justification: { ar: "تبرير ناقص قد يكلّفك نقاطاً عند التصحيح (تقدير نموذج)", fr: "Justification manquante qui peut coûter des points (estimation d'un modèle)" },
  structure: { ar: "ملاحظة على بنية الإجابة (تقدير نموذج)", fr: "Remarque sur la structure de la réponse (estimation d'un modèle)" },
};

function methodIssue(n: MethodNote): VerificationIssue {
  const m = METHOD_MSG[n.kind];
  // لا نرفع إلى "warn" إلا ما كان عالي الثقة ومن نوعين محددين؛ وغير ذلك يبقى اقتراحاً
  const warn = n.confidence === "high" && (n.kind === "out_of_program" || n.kind === "missing_justification");
  return {
    severity: warn ? "warn" : "info", kind: `method_${n.kind}`, source: "method",
    ...(n.q ? { q: n.q } : {}),
    ar: `${m.ar}: ${n.note}`, fr: `${m.fr} : ${n.note}`,
    where: n.quote,
  };
}

export async function verifyAnswer(ctx: VerifyContext): Promise<Verdict> {
  const answer = stripThinkBlock(ctx.answer);
  const subject = ctx.subject ?? "";
  // تحية أو ردّ قصير بلا أرقام ولا معادلات: لا شيء يستحق الفحص ولا شارة (أما "x = 12" فتُفحص)
  if (answer.length < 60 && !/[0-9٠-٩=$]/.test(answer) && ctx.finishReason !== "length") return buildVerdict("done", [], [], 0);
  const st = runStaticChecks({ subject, question: ctx.question, answer, finishReason: ctx.finishReason, sourceComplete: ctx.sourceComplete });
  const checks: VerificationCheck[] = [...st.checks];
  const issues: VerificationIssue[] = [...st.issues];
  const unverified: UnverifiedItem[] = [];
  let verified = st.verifiedCount;
  const hasImages = !!ctx.images?.length;
  const transcript = ctx.transcript?.trim() ?? "";

  /* ---- قراءة الصورة (القراءة الأولى: مجانية، تعمل في كل المستويات) ---- */
  if (hasImages && transcript) {
    const sig = readingSignals(transcript);
    issues.push(...signalIssues(sig));
    if (sig.figureMissing) unverified.push({ ar: "ما يعتمد على الشكل أو المنحنى غير الظاهر في الصورة", fr: "Ce qui dépend de la figure ou de la courbe non visible sur la photo" });
    if (sig.illegible > 0) unverified.push({ ar: "النتائج التي تعتمد على المواضع غير المقروءة في الصورة", fr: "Les résultats qui dépendent des passages illisibles de la photo" });
  } else if (hasImages) {
    unverified.push({ ar: "قراءة الصورة: لم تُقرأ الورقة نصياً في هذا الوضع، فلم تُفحص الأرقام ولا الرموز ولا تغطية الأسئلة", fr: "Lecture de la photo : la feuille n'a pas été relue en texte dans ce mode, donc chiffres, symboles et questions traitées ne sont pas vérifiés" });
  }

  if (ctx.level === "off" || ctx.level === "basic" || !ctx.llm || !answer) return buildVerdict("done", checks, issues, verified, unverified);
  const rawLlm = ctx.llm;
  // أي استثناء من النموذج يُعامَل كفشل عادي (null) فيُسجَّل "تعذر التحقق" بدل أن يضيع بصمت
  const llm: LlmFn = async (req) => { try { return await rawLlm(req); } catch { return null; } };
  ctx.onProgress?.(buildVerdict("running", checks, issues, verified, unverified));

  const stageMs = ctx.stageTimeoutMs ?? (Number(process.env["VERIFY_TIMEOUT_MS"]) || 25_000);
  const sig = () => anySignal([...(ctx.signal ? [ctx.signal] : []), AbortSignal.timeout(stageMs)]);
  const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);
  const question = ctx.question.trim();

  /* ---- استخراج الادعاءات ثم إعادة حسابها بالكود ---- */
  const claimsTask = async () => {
    if (TEXT_SUBJECTS.has(subject) || !/\$/.test(answer)) return;
    const raw = await llm({
      role: "extract", system: EXTRACT_SYSTEM, maxTokens: 1800, signal: sig(),
      user: `<exam_question>\n${clip(question, 4000) || "(not available)"}\n</exam_question>\n\n<student_answer>\n${clip(answer, 12000)}\n</student_answer>`,
    });
    const label = { ar: "إعادة حساب النتائج بالكود", fr: "Recalcul des résultats par programme" };
    if (!raw) { checks.push({ id: "claims", status: "skip", ...label }); return; }
    const { claims } = sanitizeClaims(parseJsonLoose(raw), answer);
    const outcomes = claims.map(runClaim);
    const ok = outcomes.filter((o) => o.status === "verified").length;
    const unver = outcomes.filter((o) => o.status === "unverifiable");
    for (const o of outcomes) { const i = claimIssue(o); if (i) issues.push(i); }
    for (const o of unver.slice(0, 5)) unverified.push({ ...(o.claim.q ? { q: o.claim.q } : {}), ar: o.ar, fr: o.fr, ...(o.claim.quote ? { what: o.claim.quote } : {}) });
    verified += ok;
    const bad = outcomes.some((o) => o.status === "mismatch");
    const partial = outcomes.some((o) => o.status === "partial");
    const suffix = unver.length ? { ar: ` (${unver.length} تعذر التحقق منها)`, fr: ` (${unver.length} non vérifiés)` } : { ar: "", fr: "" };
    checks.push({
      id: "claims", count: ok,
      status: bad ? "fail" : partial ? "warn" : ok > 0 ? "pass" : "skip",
      ar: label.ar + suffix.ar, fr: label.fr + suffix.fr,
    });
  };

  /* ---- حل مستقل ومقارنة (strict) ---- */
  const compareTask = async () => {
    if (ctx.level !== "strict") return;
    const label = { ar: "مقارنة مع حل مستقل", fr: "Comparaison avec une solution indépendante" };
    let independent = ctx.independentSolution?.trim() || null;
    if (!independent) {
      if (!question && !ctx.images?.length) return;
      independent = await llm({
        role: "solve", system: INDEPENDENT_SOLVER_SYSTEM, images: ctx.images, maxTokens: 3000, signal: sig(),
        user: `<exam_question>\n${clip(question, 6000) || "(see the attached image)"}\n</exam_question>\nSolve independently.`,
      });
    }
    if (!independent) { checks.push({ id: "independent", status: "skip", ...label }); return; }
    const raw = await llm({
      role: "compare", system: COMPARE_SYSTEM, maxTokens: 1700, signal: sig(),
      user: `<exam_question>\n${clip(question, 4000) || "(not available)"}\n</exam_question>\n\n<student_answer>\n${clip(answer, 12000)}\n</student_answer>\n\n<independent_solution>\n${clip(independent, 9000)}\n</independent_solution>`,
    });
    const results = raw ? sanitizeComparison(parseJsonLoose(raw), answer) : [];
    if (!results.length) { checks.push({ id: "independent", status: "skip", ...label }); return; }
    const agree = results.filter((r) => r.status === "agree").length;
    const dis = results.filter((r) => r.status === "disagree");
    verified += agree;
    for (const r of dis.slice(0, 4)) {
      const where = r.q ? ` في السؤال ${r.q}` : "";
      const whereFr = r.q ? ` à la question ${r.q}` : "";
      issues.push({
        severity: "warn", kind: "independent", source: "model", ...(r.q ? { q: r.q } : {}),
        ar: `اختلاف مع حل مستقل${where}: جوابك «${r.answerValue}» مقابل «${r.independentValue}»${r.note ? ` (${r.note})` : ""}`,
        fr: `Écart avec une solution indépendante${whereFr} : ta réponse « ${r.answerValue} » contre « ${r.independentValue} »${r.note ? ` (${r.note})` : ""}`,
        evidence: `${r.answerValue} ≠ ${r.independentValue}`,
        ...(r.answerQuote ? { where: r.answerQuote } : {}),
        ...(r.independentValue ? { expected: r.independentValue } : {}),
      });
    }

    /* سؤال أو فرع أجاب عنه الحل المستقل ولم تجب عنه الإجابة: لا نصدّق النموذج وحده، بل نتحقق من ترقيم الإجابة بالكود */
    const known = new Set(questionLabels(question));
    const cov = question ? coverage(question, answer) : { missingTop: [] as string[], missingSub: [] as string[] };
    // لا نكرر ما ذكره الفحص الشكلي، لكن فقط إن كان قد ذكره فعلاً (يتطلب 3 أرقام أسئلة على الأقل)
    const alreadyFlagged = st.issues.some((i) => i.kind === "coverage") ? new Set([...cov.missingTop, ...cov.missingSub]) : new Set<string>();
    const answerLabels = parseLabels(answer);
    // سؤال رئيسي عولج بفروعه (1-1، 1-a) يُعدّ حاضراً
    const answerIds = new Set([...answerLabels.map((l) => l.id), ...answerLabels.map((l) => l.parent)]);
    const missing = results.filter((r) => r.status === "missing").map((r) => ({ r, id: normalizeLabel(r.q) }))
      .filter(({ id }) => id && !answerIds.has(id) && !alreadyFlagged.has(id));
    for (const { r, id } of missing.slice(0, 3)) {
      const confirmed = known.has(id); // الترقيم موجود في الامتحان فعلاً وغائب عن الإجابة
      issues.push({
        severity: confirmed ? "warn" : "info", kind: "incomplete", source: "model", q: id,
        ar: `${confirmed ? "لم أجد في الإجابة جواباً عن" : "قد تكون الإجابة أهملت"} ${id.includes("-") ? "الفرع" : "السؤال"} ${id}${r.independentValue ? ` (الحل المستقل يعطي «${r.independentValue}»)` : ""}`,
        fr: `${confirmed ? "Je ne trouve pas de réponse pour" : "La réponse a peut-être omis"} ${id.includes("-") ? "la sous-question" : "la question"} ${id}${r.independentValue ? ` (la solution indépendante donne « ${r.independentValue} »)` : ""}`,
        ...(r.independentValue ? { expected: r.independentValue } : {}),
      });
    }

    const unsure = results.filter((r) => r.status === "unsure");
    for (const r of unsure.slice(0, 4)) {
      unverified.push({
        ...(r.q ? { q: r.q } : {}),
        ar: `${r.q ? `السؤال ${r.q}: ` : ""}لم يُحسم بالحل المستقل${r.note ? ` (${r.note})` : " (سؤال مفتوح أو غير واضح)"}`,
        fr: `${r.q ? `Question ${r.q} : ` : ""}non tranché par la solution indépendante${r.note ? ` (${r.note})` : " (question ouverte ou peu claire)"}`,
      });
    }
    const flagged = dis.length > 0 || missing.length > 0;
    checks.push({ id: "independent", count: agree, status: flagged ? "warn" : agree > 0 ? "pass" : "skip", ...label });
  };

  /* ---- إعادة قراءة الصورة بنموذج مستقل ومقارنتها بالأولى ---- */
  const readingTask = async () => {
    if (!hasImages || !transcript) return;
    const label = { ar: "قراءة الصورة (قراءتان مستقلتان)", fr: "Lecture de la photo (deux lectures indépendantes)" };
    const second = await llm({
      role: "reread", system: REREAD_SYSTEM, images: ctx.images, maxTokens: 3200, signal: sig(),
      user: images1(ctx.images!.length),
    });
    if (!second || second.trim().length < 20) {
      checks.push({ id: "reading", status: "skip", ...label });
      unverified.push({ ar: "تعذر إعادة قراءة الصورة بنموذج ثان، فلم تُقارَن الأرقام والرموز", fr: "La photo n'a pas pu être relue par un second modèle : chiffres et symboles non comparés" });
      return;
    }
    const cmp = compareReadings(transcript, second);
    if (!cmp.comparable || cmp.divergent) {
      checks.push({ id: "reading", status: "skip", ...label });
      unverified.push(cmp.divergent
        ? { ar: "القراءتان للصورة متباعدتان كثيراً فلا يمكن الجزم بأيهما الصحيحة؛ قارن الأرقام بورقتك", fr: "Les deux lectures de la photo divergent trop pour trancher : compare les chiffres avec ta feuille" }
        : { ar: "الصورة تحوي أرقاماً أو رموزاً قليلة جداً للمقارنة بين القراءتين", fr: "La photo contient trop peu de chiffres ou de symboles pour comparer les deux lectures" });
      return;
    }
    const found = comparisonIssues(cmp);
    issues.push(...found);
    checks.push({ id: "reading", count: cmp.matched, status: found.length ? "warn" : "pass", ...label });
  };

  /* ---- مطابقة المنهج ومستوى الباك (strict فقط: رأي نموذج، فيُعرض اقتراحاً لا حكماً) ---- */
  const methodTask = async () => {
    // Standard mode also applies the Moroccan subject rubric to humanities answers.
    // Strict mode keeps the review enabled for scientific subjects too.
    if ((ctx.level !== "strict" && !(ctx.level === "standard" && TEXT_SUBJECTS.has(subject))) || answer.length < 200) return;
    const label = { ar: "مطابقة المنهج ومستوى الباك", fr: "Conformité de la méthode au niveau du bac" };
    const raw = await llm({
      role: "method", system: METHOD_SYSTEM, maxTokens: 1000, signal: sig(),
      user: `<subject_rubric>\n${methodRubric(subject)}\n</subject_rubric>\n\n<exam_question>\n${clip(question, 4000) || "(not available)"}\n</exam_question>\n\n<student_answer>\n${clip(answer, 12000)}\n</student_answer>`,
    });
    const parsed = raw ? parseJsonLoose(raw) : null;
    if (!raw || !parsed || !Array.isArray((parsed as any).notes)) {
      checks.push({ id: "method", status: "skip", ...label });
      unverified.push({ ar: "تعذر تقييم مطابقة المنهج لمستوى الباك", fr: "Impossible d'évaluer la conformité de la méthode au niveau du bac" });
      return;
    }
    const notes = sanitizeMethodNotes(parsed, answer);
    for (const n of notes) issues.push(methodIssue(n));
    checks.push({ id: "method", count: notes.length, status: notes.some((n) => methodIssue(n).severity === "warn") ? "warn" : "pass", ...label });
  };

  await Promise.all([claimsTask().catch(() => {}), compareTask().catch(() => {}), readingTask().catch(() => {}), methodTask().catch(() => {})]);
  return buildVerdict("done", checks, issues, verified, unverified);
}

const images1 = (n: number) => (n > 1 ? "Transcribe all these images in order (the pages or parts of one sheet)." : "Transcribe this sheet.");

/** تقرير مختصر بما أثبته الكود (وليس النماذج) لمراجع Pananachi النهائي كي يصحّحه قبل عرض الإجابة. */
export function codeFindingsForReviewer(v: Verdict): string {
  const lines = v.issues
    // الحساب العددي الصرف يصل المراجع أصلاً عبر arithmeticReport فلا نكرره
    .filter((i) => i.kind !== "arithmetic" && (i.source === "code" || i.kind === "truncated" || i.kind === "coverage"))
    .map((i) => `- ${i.q ? `[السؤال ${i.q}] ` : ""}${i.ar}${i.evidence ? ` ؛ المقارنة: ${i.evidence}` : ""}`);
  return lines.length ? "نتائج فحص برمجي (محسوبة آلياً، تحقق منها بنفسك وصحّح ما ثبت خطؤه):\n" + lines.join("\n") : "";
}
