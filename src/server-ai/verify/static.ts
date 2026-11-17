/**
 * فحوص شكلية فورية بلا نموذج لغوي (مجانية وتعمل في كل الأوضاع):
 * حساب عددي، تغطية الأسئلة، قطع الإجابة، سلامة عرض المعادلات، لغة الإجابة،
 * تسرّب قوالب الرياضيات إلى مواد اللغات، واقتباسات غير موجودة في النص.
 * المبدأ نفسه: لا نتّهم إلا عند دليل واضح، وما لا يمكن فحصه يُسجَّل "skip" لا "pass".
 */
import { arithmeticStats } from "../numberCheck";
import { findUnitMismatches } from "./unitEngine";
import type { VerificationCheck, VerificationIssue } from "../../lib/verification";

export interface StaticInput {
  subject?: string;
  /** نص السؤال (مكتوب أو مقروء من الصورة)؛ فارغ إن لم يتوفر */
  question: string;
  answer: string;
  /** finish_reason القادم من المزوّد إن عُرف */
  finishReason?: string | null;
  /** false إن كان نص الامتحان في صورة لم تُقرأ نصياً (فلا نقارن الاقتباسات بسؤال لا يحوي النص) */
  sourceComplete?: boolean;
}

/** أقل عدد كلمات في نص المصدر ليُعتمد في مقارنة الاقتباسات */
const MIN_SOURCE_TOKENS = 30;

export interface StaticReport {
  checks: VerificationCheck[];
  issues: VerificationIssue[];
  /** عدد العناصر التي ثبتت صحتها (متساويات عددية، اقتباسات حرفية) */
  verifiedCount: number;
}

const ARABIC_SUBJECTS = new Set(["arabic", "islamic", "philosophy", "history"]);
const TEXT_SUBJECTS = new Set(["arabic", "islamic", "philosophy", "history", "french", "english"]);

const toLatinDigits = (s: string) => s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
const fmt = (x: number) => String(+x.toPrecision(6));

/** إزالة الكتل التي لا نريد فحص نصها (كود، svg) */
const stripCode = (s: string) => s.replace(/```[\s\S]*?```/g, " ");

/* ---------- تغطية الأسئلة وفروعها ---------- */
interface QLabel { id: string; kind: "top" | "sub"; parent: string }
const ARABIC_SUB: Record<string, string> = { "أ": "a", "ب": "b", "ج": "c", "د": "d" };
const TOP_RE = /^(?:(?:question|q|exercice|السؤال|س)\s*)?\(?(\d{1,2})\s*[.)\-–:](?!\d)/i;
const NUM_SUB_RE = /^\(?(\d{1,2})\s*[-.]\s*(\d{1,2})\s*[.)\-–:](?!\d)/;
const LETTER_SUB_RE = /^\(?([a-eأبجد])\s*[.)\-–:](?=\s|$)/i;

/** يستخرج ترقيم الأسئلة وفروعها (1، 1-a، 2-1) من نص سؤال أو جواب، بترتيب ورودها. */
export function parseLabels(text: string): QLabel[] {
  const out: QLabel[] = [];
  let parent = "";
  for (const raw of toLatinDigits(text).split("\n")) {
    const line = raw.replace(/\*\*|__/g, "").replace(/^[\s#>*_\-]+/, "");
    let m = NUM_SUB_RE.exec(line);
    if (m) { out.push({ id: `${m[1]}-${m[2]}`, kind: "sub", parent: m[1] }); parent = m[1]; continue; }
    m = TOP_RE.exec(line);
    if (m) {
      out.push({ id: m[1], kind: "top", parent: m[1] }); parent = m[1];
      // فرع في السطر نفسه: "1) a) la limite ..."
      const inline = LETTER_SUB_RE.exec(line.slice(m[0].length).trimStart());
      if (inline) out.push({ id: `${m[1]}-${ARABIC_SUB[inline[1]] ?? inline[1].toLowerCase()}`, kind: "sub", parent: m[1] });
      continue;
    }
    m = parent ? LETTER_SUB_RE.exec(line) : null;
    if (m) { const l = ARABIC_SUB[m[1]] ?? m[1].toLowerCase(); out.push({ id: `${parent}-${l}`, kind: "sub", parent }); }
  }
  return out;
}

/** يوحّد رقماً كتبه نموذج ("1.a" أو "1a" أو "أ" بعد 1) إلى صيغة المعرّفات هنا ("1-a"). */
export function normalizeLabel(q: string): string {
  const t = toLatinDigits(q).trim().toLowerCase().replace(/^(?:question|exercice|q|السؤال|س)\s*/, "").replace(/[()]/g, "");
  const m = /^(\d{1,2})\s*[-.]?\s*([a-eأبجد]|\d{1,2})?$/.exec(t);
  if (!m) return t;
  return m[2] ? `${m[1]}-${ARABIC_SUB[m[2]] ?? m[2]}` : m[1];
}

export function questionLabels(question: string): string[] {
  return [...new Set(parseLabels(question).map((l) => l.id))];
}

export interface CoverageResult { total: number; missingTop: string[]; missingSub: string[] }

/** مقارنة ترقيم السؤال بترقيم الإجابة. missingSub لا يُحسب إلا حين تكون الإجابة قد عالجت السؤال الأب واستعملت ترقيماً للفروع. */
export function coverage(question: string, answer: string): CoverageResult {
  const q = parseLabels(question), a = parseLabels(answer);
  const ids = new Set(a.map((l) => l.id));
  const aTops = new Set(a.filter((l) => l.kind === "top").map((l) => l.id));
  const aParents = new Set(a.map((l) => l.parent));
  const answerUsesSubs = a.some((l) => l.kind === "sub");
  const missingTop: string[] = [], missingSub: string[] = [];
  const seen = new Set<string>();
  for (const l of q) {
    if (seen.has(l.id)) continue;
    seen.add(l.id);
    if (l.kind === "top") { if (!aParents.has(l.id)) missingTop.push(l.id); continue; }
    if (ids.has(l.id)) continue;
    if (answerUsesSubs && aTops.has(l.parent)) missingSub.push(l.id);
    else if (!aParents.has(l.parent)) missingTop.push(l.parent); // الأب كله غائب
  }
  return { total: seen.size, missingTop: [...new Set(missingTop)], missingSub };
}

/* ---------- تطبيع الاقتباسات ---------- */
export function normalizeForQuote(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "") // تشكيل وعلامات مركّبة (é → e)
    .replace(/ـ/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[’‘`´]/g, "'")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** أفضل تشابه بين اقتباس (كلمات) ونافذة بنفس الطول من المصدر، لتحمّل أخطاء القراءة البسيطة. */
function bestWindowSimilarity(qTokens: string[], srcTokens: string[]): number {
  const n = qTokens.length;
  if (n === 0 || srcTokens.length < n) return 0;
  let best = 0;
  for (let i = 0; i + n <= srcTokens.length; i++) {
    let same = 0;
    for (let j = 0; j < n; j++) if (srcTokens[i + j] === qTokens[j]) same++;
    if (same > best) best = same;
    if (best === n) break;
  }
  return best / n;
}

export function extractQuotes(answer: string): string[] {
  const text = stripCode(answer).replace(/\$\$[\s\S]*?\$\$|\$[^$\n]*\$/g, " ");
  const found: string[] = [];
  const push = (re: RegExp) => { for (const m of text.matchAll(re)) found.push(m[1].trim()); };
  push(/«\s*([^»\n]{6,400}?)\s*»/g);
  push(/“([^”\n]{6,400})”/g);
  push(/"([^"\n]{12,400})"/g);
  return [...new Set(found)];
}

export function checkQuote(quote: string, normalizedSource: string, sourceTokens: string[]): "found" | "missing" | "short" {
  const fragments = quote.split(/\[?\s*(?:\.{3}|…)\s*\]?|\(\s*\.{3}\s*\)/).map(normalizeForQuote).filter(Boolean);
  const checkable = fragments.filter((f) => f.split(" ").length >= 3);
  if (!checkable.length) return "short";
  for (const f of checkable) {
    if (normalizedSource.includes(f)) continue;
    const toks = f.split(" ");
    if (toks.length >= 5 && bestWindowSimilarity(toks, sourceTokens) >= 0.85) continue;
    return "missing";
  }
  return "found";
}

/* ---------- الفحص ---------- */
export function runStaticChecks(input: StaticInput): StaticReport {
  const { subject = "", question, finishReason } = input;
  const answer = input.answer.trim();
  const checks: VerificationCheck[] = [];
  const issues: VerificationIssue[] = [];
  let verifiedCount = 0;
  const body = stripCode(answer);

  /* 1) الحساب العددي */
  const hasMath = /\$/.test(body);
  if (hasMath) {
    const { issues: arith, checked } = arithmeticStats(body);
    for (const x of arith) {
      issues.push({
        severity: "error", kind: "arithmetic", source: "code",
        ar: `خطأ حسابي: $${x.expr}$ ، الطرف الأيسر يساوي فعلاً ${fmt(x.left)} والأيمن ${fmt(x.right)}`,
        fr: `Erreur de calcul : $${x.expr}$ , le membre de gauche vaut ${fmt(x.left)} et celui de droite ${fmt(x.right)}`,
        evidence: `${x.expr}`,
        where: `$${x.expr}$`,
      });
    }
    if (checked > 0) {
      verifiedCount += checked - arith.length;
      checks.push({ id: "arithmetic", status: arith.length ? "fail" : "pass", count: checked, ar: "الحسابات العددية", fr: "Calculs numériques" });
    }
  }

  /* 1.5) التحقق البُعدي من الوحدات المصرّح بها بوضوح */
  const unitMismatches = findUnitMismatches(body);
  for (const mismatch of unitMismatches.slice(0, 4)) {
    issues.push({
      severity: "error", kind: "unit_dimension", source: "code",
      ar: `تعارض في الوحدات: ${mismatch.left} و${mismatch.right} لا تمثلان البعد الفيزيائي نفسه. راجع التحويل أو التعويض.`,
      fr: `Incohérence d’unités : ${mismatch.left} et ${mismatch.right} ne représentent pas la même dimension physique. Vérifiez la conversion.`,
      evidence: mismatch.line, where: mismatch.line,
    });
  }
  if (unitMismatches.length) checks.push({ id: "units", status: "fail", count: unitMismatches.length, ar: "توافق الوحدات والأبعاد", fr: "Cohérence des unités et dimensions" });

  /* 2) اكتمال الإجابة */
  const dollars2 = (body.match(/\$\$/g) ?? []).length;
  const fences = (answer.match(/```/g) ?? []).length;
  const tail = body.trimEnd().slice(-40);
  const danglingEnd = /(?:[=+]|\\\\|\\frac\{[^}]*)$/.test(tail); // تنتهي بعملية أو كسر مفتوح
  let incomplete: "length" | "structure" | null = null;
  if (finishReason === "length") incomplete = "length";
  else if (dollars2 % 2 === 1 || fences % 2 === 1 || danglingEnd) incomplete = "structure";
  if (incomplete) {
    issues.push({
      severity: incomplete === "length" ? "error" : "warn", kind: "truncated", source: "static",
      ar: incomplete === "length" ? "الإجابة قُطعت قبل اكتمالها (بلغت الحد الأقصى للطول). اطلب إكمالها." : "يبدو أن نهاية الإجابة غير مكتملة. اطلب إكمالها إن كانت ناقصة.",
      fr: incomplete === "length" ? "La réponse a été coupée avant la fin (limite de longueur atteinte). Demande la suite." : "La fin de la réponse semble incomplète. Demande la suite si besoin.",
    });
  }
  checks.push({ id: "complete", status: incomplete ? (incomplete === "length" ? "fail" : "warn") : "pass", ar: "اكتمال الإجابة", fr: "Réponse complète" });

  /* 3) تغطية الأسئلة وفروعها */
  const labelCount = questionLabels(question).length;
  if (labelCount >= 3 && answer.length > 0) {
    const cov = coverage(question, answer);
    const missingAll = cov.missingTop.length + cov.missingSub.length;
    // الفرع المتخطّى داخل سؤال عولج فعلاً بترقيم فروع = ثقة عالية. أما غياب سؤال رئيسي فقد يكون النص نفسه مرقّماً (أبيات، فقرات)
    // فلا نرفعه فوق "info" في مواد النصوص إلا عند قطع الإجابة.
    const strongTop = cov.missingTop.length >= 2 && cov.missingTop.length / labelCount >= 0.3 && !TEXT_SUBJECTS.has(subject);
    if (missingAll) {
      const arParts = [
        ...(cov.missingTop.length ? [`${cov.missingTop.length > 1 ? "الأسئلة" : "السؤال"} ${cov.missingTop.slice(0, 5).join("، ")}`] : []),
        ...(cov.missingSub.length ? [`${cov.missingSub.length > 1 ? "الفروع" : "الفرع"} ${cov.missingSub.slice(0, 5).join("، ")}`] : []),
      ];
      const frParts = [
        ...(cov.missingTop.length ? [`${cov.missingTop.length > 1 ? "questions" : "question"} ${cov.missingTop.slice(0, 5).join(", ")}`] : []),
        ...(cov.missingSub.length ? [`${cov.missingSub.length > 1 ? "sous-questions" : "sous-question"} ${cov.missingSub.slice(0, 5).join(", ")}`] : []),
      ];
      issues.push({
        severity: strongTop || cov.missingSub.length > 0 || incomplete ? "warn" : "info", kind: "coverage", source: "static",
        ar: `قد تكون الإجابة أهملت: ${arParts.join(" و")}`,
        fr: `La réponse semble avoir omis : ${frParts.join(" et ")}`,
      });
    }
    checks.push({ id: "coverage", status: strongTop || cov.missingSub.length > 0 ? "warn" : "pass", count: cov.total - missingAll, ar: "اكتمال الأسئلة والفروع", fr: "Questions et sous-questions traitées" });
  }

  /* 4) سلامة عرض المعادلات */
  if (hasMath) {
    const problems: string[] = [];
    const noPairs = body.replace(/\$\$[\s\S]*?\$\$/g, " ").replace(/\\\$/g, "");
    if (((noPairs.match(/\$/g) ?? []).length) % 2 === 1) problems.push("علامة $ غير متوازنة");
    for (const m of [...body.matchAll(/\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g)].slice(0, 80)) {
      const seg = m[1] ?? m[2];
      let depth = 0, bad = false;
      for (const ch of seg.replace(/\\[{}]/g, "")) { if (ch === "{") depth++; else if (ch === "}") { depth--; if (depth < 0) { bad = true; break; } } }
      if (bad || depth !== 0) { problems.push("أقواس {} غير متوازنة"); break; }
      if ((seg.match(/\\left/g) ?? []).length !== (seg.match(/\\right/g) ?? []).length) { problems.push("\\left/\\right غير متوازنة"); break; }
    }
    if (problems.length) {
      issues.push({
        severity: "warn", kind: "render", source: "static",
        ar: `قد تظهر بعض المعادلات مكسورة (${[...new Set(problems)].join("، ")})`,
        fr: "Certaines formules risquent de mal s'afficher (délimiteurs ou accolades non équilibrés)",
      });
    }
    checks.push({ id: "render", status: problems.length ? "warn" : "pass", ar: "سلامة عرض المعادلات", fr: "Affichage des formules" });
  }

  /* 5) لغة الإجابة وتسرّب القوالب (مواد اللغات والإنسانيات) */
  if (TEXT_SUBJECTS.has(subject)) {
    const letters = body.replace(/\$\$[\s\S]*?\$\$|\$[^$\n]*\$/g, " ");
    const ar = (letters.match(/[؀-ۿ]/g) ?? []).length;
    const lat = (letters.match(/[A-Za-zÀ-ÿ]/g) ?? []).length;
    const total = ar + lat;
    if (total >= 120) {
      const arShare = ar / total;
      let wrong = false;
      if (ARABIC_SUBJECTS.has(subject)) wrong = arShare < 0.5;
      else if (subject === "french" || subject === "english") wrong = arShare > 0.35;
      if (wrong) {
        issues.push({
          severity: "warn", kind: "language", source: "static",
          ar: subject === "french" ? "الإجابة ليست بالفرنسية كما تتطلب المادة" : subject === "english" ? "الإجابة ليست بالإنجليزية كما تتطلب المادة" : "الإجابة ليست بالعربية كما تتطلب المادة",
          fr: subject === "french" ? "La réponse n'est pas rédigée en français comme l'exige la matière" : subject === "english" ? "The answer is not written in English as the subject requires" : "La réponse n'est pas en arabe comme l'exige la matière",
        });
      }
      checks.push({ id: "language", status: wrong ? "warn" : "pass", ar: "لغة الإجابة", fr: "Langue de la réponse" });
    }
    // "On a :" و "Donc," كلمتان فرنسيتان عاديتان في نثر فرنسي سليم، فلا تُعدّان تسرّباً إلا داخل نص عربي
    const leak = subject === "english" ? false
      : subject === "french" ? /\\boxed|Application num[ée]rique/i.test(body)
      : /\\boxed|Application num[ée]rique|(?:^|\n)\s*(?:On a|Donc)\s*[:,]/i.test(body);
    if (leak) {
      issues.push({
        severity: "warn", kind: "template", source: "static",
        ar: "ظهرت قوالب خاصة بالمواد العلمية (إطار النتيجة، «On a»، «Application numérique») داخل مادة لغوية",
        fr: "Des formules propres aux sciences (« On a », « Application numérique », cadre de résultat) apparaissent dans une matière littéraire",
      });
    }
    if (leak || total >= 120) checks.push({ id: "template", status: leak ? "warn" : "pass", ar: "منهجية المادة", fr: "Méthodologie de la matière" });
  }

  /* 6) الاقتباسات من النص */
  if (TEXT_SUBJECTS.has(subject)) {
    const src = normalizeForQuote(question);
    const srcTokens = src ? src.split(" ") : [];
    const quotes = extractQuotes(answer);
    if (input.sourceComplete === false || srcTokens.length < MIN_SOURCE_TOKENS) {
      if (quotes.length) checks.push({ id: "quotes", status: "skip", ar: "الاقتباسات من النص (نص السؤال غير متاح للمقارنة)", fr: "Citations du texte (texte indisponible pour comparaison)" });
    } else if (quotes.length) {
      let found = 0;
      const missing: string[] = [];
      for (const q of quotes) {
        const r = checkQuote(q, src, srcTokens);
        if (r === "found") found++;
        else if (r === "missing") missing.push(q);
      }
      verifiedCount += found;
      for (const q of missing.slice(0, 3)) {
        const shown = q.length > 90 ? `${q.slice(0, 90)}…` : q;
        issues.push({
          severity: "warn", kind: "quote", source: "static", evidence: shown,
          ar: `اقتباس لم أجده حرفياً في النص، تأكد منه: «${shown}»`,
          fr: `Citation introuvable mot pour mot dans le texte, à vérifier : « ${shown} »`,
        });
      }
      if (found + missing.length > 0) checks.push({ id: "quotes", status: missing.length ? "warn" : "pass", count: found, ar: "الاقتباسات من النص", fr: "Citations du texte" });
    }
  }

  return { checks, issues, verifiedCount };
}
