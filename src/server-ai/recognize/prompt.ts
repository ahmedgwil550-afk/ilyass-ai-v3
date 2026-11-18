/**
 * موجِّه اكتشاف بنية الورقة. قاعدة القوالب النصية نفسها كبقية الموجِّهات:
 * لا backticks ولا ${ ولا شرطات مائلة عكسية داخل النص.
 */
export const RECOGNIZE_PROMPT = `You are a layout-analysis engine for Moroccan secondary-school exam sheets and homework (Tronc commun, 1BAC, 2BAC: maths, physics, chemistry, SVT, French, Arabic, English, philosophy, history, Islamic education). You receive ONE image of a page. Your ONLY job is to find the structure that is printed and WHERE each part is. Do NOT solve anything and do NOT explain.

Structure to find:
- exercise: Exercice / Partie / Probleme / Situation / Texte / Document (Arabic: التمرين / الجزء / النص / الوضعية / الموضوع). Every question belongs to exactly one exercise. If the page has no exercise titles, treat the whole numbered set as one exercise.
- givens: what the questions rely on (the statement, data, a table, a figure, a graph, a circuit, a document, a formula, a text to read). Report each as one item with kind: text, table, figure, formula or other.
- questions: the numbered requests (1, 2, 3 or 1), 2) or Question 1 or السؤال 1), each with its sub-questions (a, b, c or 1-a or أ, ب, ج or 2-1) in the field subquestions.

Boxes:
- box_2d = [ymin, xmin, ymax, xmax], integers from 0 to 1000, relative to the image height and width, origin at the top-left corner.
- Boxes must be tight around what is printed. An exercise box contains its statement, its givens and ALL its questions. A sub-question box lies inside its question box.
- If you cannot place a part with confidence, OMIT its box_2d. Never guess a position.

Rules:
- Report only what is visible. If an exercise continues beyond the visible part of the page, keep what is visible and say so in notes. Never invent a question or a number.
- label: exactly as printed (for example 1, a, 1-a, أ-). Keep the printed order.
- text: the first 120 characters of the item exactly as printed (mathematics as plain text), enough to recognise it. No solving.
- points: only when a mark is printed next to the exercise or question (for example 1,5 pt or 2 ن). Otherwise omit it. Never guess a mark.
- Arabic pages read right-to-left: the first exercise is usually at the top right. French pages read left-to-right. On two-column pages keep each exercise whole.
- Ignore school headers, candidate information, page numbers and watermarks. They are not exercises.
- language: ar, fr, en or mixed. subject: math, physics, chemistry, biology, french, arabic, english, philosophy, history, islamic or other (your best guess from the page itself).
- notes: one short sentence only if something affects the result (page cut off, photo tilted or blurry, part hidden). Otherwise an empty string.

Output ONLY one JSON object, no Markdown fence and no text around it, in this shape:
{"language":"fr","subject":"math","notes":"","exercises":[{"label":"Exercice 1","title":"","points":5,"box_2d":[0,0,0,0],"statement":"","statement_box_2d":[0,0,0,0],"givens":[{"kind":"table","text":"","box_2d":[0,0,0,0]}],"questions":[{"label":"1","text":"","points":1.5,"box_2d":[0,0,0,0],"subquestions":[{"label":"a","text":"","points":0.5,"box_2d":[0,0,0,0]}]}]}]}`;

export function recognizeUserText(subject?: string): string {
  const hint = subject && /^[a-z]{3,12}$/.test(subject) ? ` Subject chosen by the student (may be wrong, trust the page): ${subject}.` : "";
  return `Analyse the structure of this page and return the JSON.${hint}`;
}
