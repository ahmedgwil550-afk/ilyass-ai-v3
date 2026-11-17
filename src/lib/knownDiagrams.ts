/**
 * رسومات جاهزة موثوقة: عند طلب رسم/مخطط بنية معروفة نعرض صورة الكتاب المدرسي بدل الاعتماد على رسم النموذج.
 * تُضاف الصورة فقط إذا لم يكتبها النموذج بنفسه.
 */
interface KnownDiagram { test: RegExp; src: string; alt: string }

const DRAW = /(dessin|dessiner|schéma|schema|schématis|représent|illustr|annot|légend|ارسم|رسم|مخطط|تخطيط|شكل|تمثيل)/i;

const DIAGRAMS: KnownDiagram[] = [
  { test: /(mitochond|ميتوكوندر|ميتوكندر|متقدر|الميتوكوندري)/i, src: "/media/diagrams/mitochondrie.jpg", alt: "Schéma annoté d’une mitochondrie" },
];

export function findKnownDiagram(question: string): KnownDiagram | null {
  if (!question || !DRAW.test(question)) return null;
  return DIAGRAMS.find((d) => d.test.test(question)) ?? null;
}

/** يضيف صورة الرسم في نهاية الإجابة إن لم تكن موجودة. */
export function withKnownDiagram(answer: string, question: string): string {
  const d = findKnownDiagram(question);
  if (!d || !answer || answer.includes(d.src)) return answer;
  return `${answer}\n\n![${d.alt}](${d.src})`;
}
