/**
 * اكتشاف بنية ورقة الامتحان: التمارين، المعطيات، الأسئلة وفروعها، وموضع كل منها في الصورة.
 *
 * النموذج يقترح، والكود يتحقق: كل ما يأتي من النموذج يُنظَّف ويُفحص هنا قبل أن يصل للواجهة.
 * المبدأ نفسه في نظام التحقق: لا نُظهر الثقة إلا عند دليل، وما فيه شك يُوسَم ولا يُخفى.
 * الملف نقي (بلا استيرادات من الخادم) ليستعمله الخادم والواجهة معاً.
 */

/** مستطيل نسبي إلى أبعاد الصورة (0 إلى 1)، الأصل أعلى اليسار */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Confidence = "high" | "medium" | "low";
export type GivenKind = "text" | "table" | "figure" | "formula" | "other";

export interface RecognizedQuestion {
  id: string;
  /** الترقيم كما هو مطبوع: 1، a، 1-a، أ */
  label: string;
  /** مقتطف قصير من نص السؤال */
  text: string;
  points?: number;
  box?: Box;
  confidence: Confidence;
  children: RecognizedQuestion[];
}

export interface RecognizedGiven {
  id: string;
  kind: GivenKind;
  text: string;
  box?: Box;
  confidence: Confidence;
}

export interface RecognizedExercise {
  id: string;
  label: string;
  title?: string;
  points?: number;
  /** اتحاد مربع النموذج ومربعات ما بداخله، فلا يقطع القصّ سؤالاً */
  box?: Box;
  statement: string;
  givens: RecognizedGiven[];
  questions: RecognizedQuestion[];
  confidence: Confidence;
}

export type RecognitionWarningCode =
  | "no_exercises"
  | "label_gap"
  | "duplicate_label"
  | "points_mismatch"
  | "box_outside_parent"
  | "box_overlap"
  | "no_box"
  | "low_box_coverage";

export interface RecognitionWarning {
  code: RecognitionWarningCode;
  /** العنصر المعني (معرّف التمرين أو السؤال) إن وُجد */
  targetId?: string;
  /** تفصيل قصير: الأرقام الناقصة، أو المجموع مقابل المتوقع */
  detail?: string;
}

export type RecognitionStatus = "ok" | "partial" | "unreliable";

export interface RecognitionResult {
  language: "ar" | "fr" | "en" | "mixed" | "unknown";
  subject: string | null;
  exercises: RecognizedExercise[];
  warnings: RecognitionWarning[];
  status: RecognitionStatus;
  /** ملاحظة النموذج عن الصفحة (مقطوعة، مائلة، غير واضحة…) */
  notes: string;
}

export const RECOGNITION_SUBJECTS = [
  "math", "physics", "chemistry", "biology", "french", "arabic", "english", "philosophy", "history", "islamic", "other",
] as const;

/* ---------- أدوات صغيرة ---------- */

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const toLatinDigits = (s: string) => s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
const round3 = (n: number) => Math.round(n * 1000) / 1000;
const clip = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** نقط: رقم أو نص مثل "1,5 pt" أو "٢ ن"؛ خارج (0، 40] = غير معروف */
export function parsePoints(v: unknown): number | undefined {
  let n: number;
  if (typeof v === "number") n = v;
  else if (typeof v === "string") {
    const m = /(\d+(?:[.,]\d+)?)/.exec(toLatinDigits(v));
    if (!m) return undefined;
    n = Number(m[1].replace(",", "."));
  } else return undefined;
  return Number.isFinite(n) && n > 0 && n <= 40 ? Math.round(n * 100) / 100 : undefined;
}

/**
 * مربع النموذج [ymin, xmin, ymax, xmax] بمقياس 0 إلى 1000 (أو 0 إلى 1) → Box.
 * الأزواج المعكوسة تُصحَّح، والخارج عن الصورة يُقصّ، والمربع الأصغر من حد أدنى يُرفض.
 */
export function toBox(v: unknown): Box | undefined {
  if (!Array.isArray(v) || v.length !== 4) return undefined;
  const n = v.map((x) => (typeof x === "number" ? x : typeof x === "string" ? Number(x) : NaN));
  if (n.some((x) => !Number.isFinite(x))) return undefined;
  const scale = n.every((x) => x >= 0 && x <= 1.0001) ? 1 : 1000;
  const [a, b, c, d] = n.map((x) => Math.min(1, Math.max(0, x / scale)));
  const y0 = Math.min(a, c), y1 = Math.max(a, c), x0 = Math.min(b, d), x1 = Math.max(b, d);
  const box = { x: round3(x0), y: round3(y0), w: round3(x1 - x0), h: round3(y1 - y0) };
  return box.w >= 0.01 && box.h >= 0.005 ? box : undefined;
}

export const boxArea = (b: Box) => b.w * b.h;

export function unionBox(boxes: Array<Box | undefined>): Box | undefined {
  const list = boxes.filter((b): b is Box => !!b);
  if (list.length === 0) return undefined;
  const x0 = Math.min(...list.map((b) => b.x)), y0 = Math.min(...list.map((b) => b.y));
  const x1 = Math.max(...list.map((b) => b.x + b.w)), y1 = Math.max(...list.map((b) => b.y + b.h));
  return { x: round3(x0), y: round3(y0), w: round3(x1 - x0), h: round3(y1 - y0) };
}

function intersectionArea(a: Box, b: Box): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** نسبة مساحة child الواقعة داخل parent (بهامش 2% حول parent) */
export function containment(child: Box, parent: Box): number {
  const m = 0.02;
  const padded = { x: parent.x - m, y: parent.y - m, w: parent.w + 2 * m, h: parent.h + 2 * m };
  return intersectionArea(child, padded) / boxArea(child);
}

export function iou(a: Box, b: Box): number {
  const inter = intersectionArea(a, b);
  return inter / (boxArea(a) + boxArea(b) - inter);
}

/* ---------- ترقيم الأسئلة ---------- */

const AR_LETTERS = ["أ", "ب", "ج", "د", "ه", "و", "ز", "ح"];

/** رقم ترتيب الترقيم: 3 → 3، b → 2، ب → 2، 1-a → 1، 2.3 → 3. null إن لم يُفهم (مثل "الأول"). */
export function labelOrdinal(label: string): number | null {
  const s = toLatinDigits(label).toLowerCase().replace(/[()[\].:\-–—_*]/g, " ").trim();
  const parts = s.split(/\s+/).filter(Boolean);
  const last = (parts[parts.length - 1] ?? "").replace(/ـ/g, "");
  if (/^\d{1,2}$/.test(last)) return Number(last);
  if (/^[a-h]$/.test(last)) return last.charCodeAt(0) - 96;
  const ar = last === "ا" || last === "إ" ? "أ" : last;
  const i = AR_LETTERS.indexOf(ar);
  return i >= 0 ? i + 1 : null;
}

/** الأرقام الناقصة بين الإخوة (تبدأ من 1 وتتسلسل) أو null إن تعذر الفهم */
export function missingOrdinals(labels: string[]): number[] | null {
  if (labels.length === 0) return [];
  const ords = labels.map(labelOrdinal);
  if (ords.some((o) => o === null)) return null;
  const present = new Set(ords as number[]);
  const max = Math.max(...(ords as number[]));
  const missing: number[] = [];
  for (let i = 1; i < max; i++) if (!present.has(i)) missing.push(i);
  return missing;
}

/* ---------- استخراج JSON من رد النموذج ---------- */

/** يقبل JSON داخل ```json أو محاطاً بكلام؛ يعيد null إن لم يوجد كائن صالح */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidates = [fenced?.[1], text].filter((s): s is string => !!s);
  for (const c of candidates) {
    const start = c.indexOf("{");
    const end = c.lastIndexOf("}");
    if (start < 0 || end <= start) continue;
    try {
      return JSON.parse(c.slice(start, end + 1));
    } catch {
      /* جرّب المرشح التالي */
    }
  }
  return null;
}

/* ---------- بناء النتيجة المفحوصة ---------- */

const STEP_DOWN: Record<Confidence, Confidence> = { high: "medium", medium: "low", low: "low" };
const KINDS: GivenKind[] = ["text", "table", "figure", "formula", "other"];

function boxOf(o: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) if (o[k] !== undefined) return o[k];
  return undefined;
}

export function buildRecognition(raw: unknown): RecognitionResult {
  const warnings: RecognitionWarning[] = [];
  const root = isObj(raw) ? raw : {};
  const language = ((): RecognitionResult["language"] => {
    const l = clip(root["language"], 12).toLowerCase();
    return l === "ar" || l === "fr" || l === "en" || l === "mixed" ? l : "unknown";
  })();
  const subjectRaw = clip(root["subject"] ?? root["subject_guess"], 20).toLowerCase();
  const subject = (RECOGNITION_SUBJECTS as readonly string[]).includes(subjectRaw) ? subjectRaw : null;
  const notes = clip(root["notes"] ?? root["page_notes"], 300);

  const exRaw = Array.isArray(root["exercises"]) ? root["exercises"] : [];
  const exercises: RecognizedExercise[] = [];

  exRaw.slice(0, 12).forEach((e, ei) => {
    if (!isObj(e)) return;
    const id = `e${ei + 1}`;
    const modelBox = toBox(boxOf(e, "box_2d", "box", "bbox"));
    const confidences = new Map<string, Confidence>();
    const lower = (target: string) => confidences.set(target, STEP_DOWN[confidences.get(target) ?? "high"]);
    const warn = (w: RecognitionWarning, target = w.targetId) => {
      warnings.push(w);
      if (target) lower(target);
    };

    const parseQuestions = (arr: unknown, prefix: string, depth: number): RecognizedQuestion[] => {
      if (!Array.isArray(arr)) return [];
      const out: RecognizedQuestion[] = [];
      arr.slice(0, 30).forEach((q, qi) => {
        if (!isObj(q)) return;
        const qid = `${prefix}-${depth === 0 ? "q" : "s"}${qi + 1}`;
        const label = clip(q["label"] ?? q["number"], 24);
        const text = clip(q["text"], 260);
        if (!label && !text) return;
        const box = toBox(boxOf(q, "box_2d", "box", "bbox"));
        out.push({
          id: qid,
          label: label || String(qi + 1),
          text,
          points: parsePoints(q["points"]),
          box,
          confidence: "high",
          children: depth === 0 ? parseQuestions(q["subquestions"] ?? q["children"], qid, 1) : [],
        });
      });
      return out;
    };

    const givens: RecognizedGiven[] = [];
    (Array.isArray(e["givens"]) ? e["givens"] : []).slice(0, 20).forEach((g, gi) => {
      if (!isObj(g)) return;
      const text = clip(g["text"], 260);
      const kindRaw = clip(g["kind"], 12).toLowerCase() as GivenKind;
      const box = toBox(boxOf(g, "box_2d", "box", "bbox"));
      if (!text && !box) return;
      givens.push({ id: `${id}-g${gi + 1}`, kind: KINDS.includes(kindRaw) ? kindRaw : "other", text, box, confidence: "high" });
    });

    const questions = parseQuestions(e["questions"], id, 0);
    const exercise: RecognizedExercise = {
      id,
      label: clip(e["label"], 60) || `Exercice ${ei + 1}`,
      title: clip(e["title"], 120) || undefined,
      points: parsePoints(e["points"]),
      box: modelBox,
      statement: clip(e["statement"], 400),
      givens,
      questions,
      confidence: "high",
    };

    /* --- فحص الأصل والأبناء: مربع يقع خارج تمرينه غالباً خاطئ، فيُسقَط ولا يُرسم --- */
    const stmtBox = toBox(boxOf(e, "statement_box_2d", "statement_box"));
    const inside = (item: { id: string; box?: Box }): Box | undefined => {
      if (!item.box) return undefined;
      if (modelBox && containment(item.box, modelBox) < 0.5) {
        warn({ code: "box_outside_parent", targetId: item.id });
        item.box = undefined;
        return undefined;
      }
      return item.box;
    };
    const accepted: Array<Box | undefined> = [stmtBox];
    for (const g of givens) accepted.push(inside(g));
    const walk = (qs: RecognizedQuestion[]) => {
      for (const q of qs) {
        accepted.push(inside(q));
        walk(q.children);
      }
    };
    walk(questions);
    exercise.box = unionBox([modelBox, ...accepted]);
    if (!exercise.box) warn({ code: "no_box", targetId: id });

    /* --- ترقيم الإخوة، تكراره، نقصه، تداخل مربعاتهم، ومجموع النقط --- */
    const checkSiblings = (qs: RecognizedQuestion[], parentId: string, parentPoints: number | undefined) => {
      if (qs.length === 0) return;
      const labels = qs.map((q) => q.label);
      const missing = missingOrdinals(labels);
      if (missing && missing.length > 0) warn({ code: "label_gap", targetId: parentId, detail: missing.join(",") });
      const ords = labels.map(labelOrdinal);
      const dup = ords.find((o, i) => o !== null && ords.indexOf(o) !== i);
      if (dup !== undefined) warn({ code: "duplicate_label", targetId: parentId, detail: String(dup) });
      for (let i = 0; i < qs.length; i++) {
        for (let j = i + 1; j < qs.length; j++) {
          const a = qs[i].box, b = qs[j].box;
          if (a && b && iou(a, b) > 0.5) warn({ code: "box_overlap", targetId: qs[j].id, detail: `${qs[i].label}/${qs[j].label}` });
        }
        if (!qs[i].box) warn({ code: "no_box", targetId: qs[i].id });
      }
      if (parentPoints !== undefined && qs.every((q) => q.points !== undefined)) {
        const sum = Math.round(qs.reduce((s, q) => s + (q.points ?? 0), 0) * 100) / 100;
        if (Math.abs(sum - parentPoints) > 0.01) warn({ code: "points_mismatch", targetId: parentId, detail: `${sum}/${parentPoints}` });
      }
    };
    checkSiblings(questions, id, exercise.points);
    for (const q of questions) checkSiblings(q.children, q.id, q.points);

    /* --- الثقة النهائية لكل عنصر --- */
    const apply = <T extends { id: string; confidence: Confidence }>(item: T) => {
      item.confidence = confidences.get(item.id) ?? "high";
    };
    apply(exercise);
    givens.forEach(apply);
    const applyQ = (qs: RecognizedQuestion[]) => qs.forEach((q) => { apply(q); applyQ(q.children); });
    applyQ(questions);
    exercises.push(exercise);
  });

  if (exercises.length === 0) warnings.push({ code: "no_exercises" });

  /* --- تغطية المربعات إجمالاً --- */
  const nodes: Array<{ box?: Box }> = [];
  const collect = (qs: RecognizedQuestion[]) => qs.forEach((q) => { nodes.push(q); collect(q.children); });
  for (const ex of exercises) { nodes.push(ex); ex.givens.forEach((g) => nodes.push(g)); collect(ex.questions); }
  const withBox = nodes.filter((n) => n.box).length;
  if (nodes.length > 0 && withBox / nodes.length < 0.5) warnings.push({ code: "low_box_coverage", detail: `${withBox}/${nodes.length}` });

  const status: RecognitionStatus =
    exercises.length === 0 || (nodes.length > 0 && withBox === 0) ? "unreliable" : warnings.length === 0 ? "ok" : "partial";

  return { language, subject, exercises, warnings, status, notes };
}

/* ---------- للواجهة: قائمة مسطّحة، قصّ، نص إرشادي ---------- */

export interface FlatItem {
  id: string;
  kind: "exercise" | "given" | "question";
  level: 0 | 1 | 2;
  label: string;
  text: string;
  points?: number;
  box?: Box;
  confidence: Confidence;
  exerciseId: string;
  /** للسؤال الفرعي: ترقيم السؤال الأب */
  parentLabel?: string;
}

export function flattenStructure(result: RecognitionResult): FlatItem[] {
  const out: FlatItem[] = [];
  for (const ex of result.exercises) {
    out.push({ id: ex.id, kind: "exercise", level: 0, label: ex.label, text: ex.title ?? ex.statement, points: ex.points, box: ex.box, confidence: ex.confidence, exerciseId: ex.id });
    for (const g of ex.givens) out.push({ id: g.id, kind: "given", level: 1, label: g.kind, text: g.text, box: g.box, confidence: g.confidence, exerciseId: ex.id });
    for (const q of ex.questions) {
      out.push({ id: q.id, kind: "question", level: 1, label: q.label, text: q.text, points: q.points, box: q.box, confidence: q.confidence, exerciseId: ex.id });
      for (const c of q.children) out.push({ id: c.id, kind: "question", level: 2, label: c.label, text: c.text, points: c.points, box: c.box, confidence: c.confidence, exerciseId: ex.id, parentLabel: q.label });
    }
  }
  return out;
}

/** مستطيل القصّ بالبكسل مع هامش نسبي، داخل حدود الصورة دائماً */
export function cropRect(box: Box, width: number, height: number, pad = 0.015): { sx: number; sy: number; sw: number; sh: number } {
  const x0 = Math.max(0, box.x - pad), y0 = Math.max(0, box.y - pad);
  const x1 = Math.min(1, box.x + box.w + pad), y1 = Math.min(1, box.y + box.h + pad);
  // 1e-6: كي لا يُسقط خطأ الفاصلة العائمة (189.99999) بكسلاً كاملاً
  const sx = Math.floor(x0 * width + 1e-6), sy = Math.floor(y0 * height + 1e-6);
  return { sx, sy, sw: Math.max(1, Math.ceil(x1 * width - 1e-6) - sx), sh: Math.max(1, Math.ceil(y1 * height - 1e-6) - sy) };
}

export interface Selection {
  exercise: RecognizedExercise;
  question?: RecognizedQuestion;
  parent?: RecognizedQuestion;
}

/** يجد التمرين/السؤال المختار من معرّفه */
export function findSelection(result: RecognitionResult, id: string): Selection | null {
  for (const exercise of result.exercises) {
    if (exercise.id === id) return { exercise };
    for (const q of exercise.questions) {
      if (q.id === id) return { exercise, question: q };
      for (const c of q.children) if (c.id === id) return { exercise, question: c, parent: q };
    }
  }
  return null;
}

/** المنطقة التي تُقصّ: التمرين كله دائماً (فالمعطيات تسبق الأسئلة)، وإن غاب مربعه فمربع السؤال */
export function cropBoxFor(sel: Selection): Box | undefined {
  return sel.exercise.box ?? sel.question?.box;
}

/** الترقيم الكامل لسؤال فرعي: (1، a) → 1-a، و(1، 1-a) يبقى 1-a */
export function fullLabel(sel: Selection): string {
  const q = sel.question;
  if (!q) return sel.exercise.label;
  if (!sel.parent) return q.label;
  return q.label.includes(sel.parent.label) ? q.label : `${sel.parent.label}-${q.label}`;
}

/** جملة تُوضع في خانة الكتابة لتحديد المطلوب حلّه من الصورة المقصوصة */
export function selectionHint(sel: Selection, lang: "ar" | "fr"): string {
  if (!sel.question) {
    return lang === "ar" ? `حلّ ${sel.exercise.label} كاملاً.` : `Résous ${sel.exercise.label} en entier.`;
  }
  const label = fullLabel(sel);
  return lang === "ar"
    ? `حلّ السؤال ${label} فقط من ${sel.exercise.label}، معتمداً على معطيات التمرين الظاهرة في الصورة.`
    : `Résous uniquement la question ${label} de ${sel.exercise.label}, à partir des données de l'exercice visibles sur l'image.`;
}

/** نص تحذير مفهوم للطالب */
export function describeWarning(w: RecognitionWarning, lang: "ar" | "fr"): string {
  const ar = lang === "ar";
  switch (w.code) {
    case "no_exercises":
      return ar ? "لم أتمكن من تمييز تمارين في هذه الصورة." : "Aucun exercice n'a pu être distingué sur cette image.";
    case "label_gap":
      return ar
        ? `ترقيم الأسئلة غير متسلسل (ينقص: ${w.detail}). قد يكون سؤال لم يُكتشف أو خارج الصورة.`
        : `La numérotation n'est pas continue (manque : ${w.detail}). Une question a pu être manquée ou sortir du cadre.`;
    case "duplicate_label":
      return ar ? `الترقيم ${w.detail} مكرر، تحقق من الأسئلة.` : `Le numéro ${w.detail} apparaît deux fois, vérifiez les questions.`;
    case "points_mismatch":
      return ar
        ? `مجموع نقط الأسئلة لا يطابق نقط التمرين (${w.detail})، وقد يكون هناك سؤال ناقص.`
        : `La somme des points des questions ne correspond pas à celle de l'exercice (${w.detail}) : une question manque peut-être.`;
    case "box_outside_parent":
      return ar ? "موضع أحد العناصر يقع خارج تمرينه، فلم أعتمده في تحديد المنطقة." : "La position d'un élément sort de son exercice : elle n'a pas été retenue.";
    case "box_overlap":
      return ar ? `مربعان متداخلان (${w.detail})، فموضعهما غير دقيق.` : `Deux zones se chevauchent (${w.detail}) : position imprécise.`;
    case "no_box":
      return ar ? "لم يُحدَّد موضع بعض العناصر في الصورة." : "La position de certains éléments n'a pas pu être déterminée.";
    case "low_box_coverage":
      return ar ? "تحديد المواضع ضعيف في هذه الصورة، فاعتمد القائمة أكثر من المربعات." : "Le repérage est faible sur cette image : fiez-vous à la liste plutôt qu'aux cadres.";
  }
}
