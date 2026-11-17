const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
import { z } from "zod";
import { getAiConfig } from "./ai-provider";

const Body = z.object({
  image: z.string().startsWith("data:image/").max(12_000_000),
  answer: z.string().max(40_000).default(""),
  grid: z.boolean().default(false),
});

const BASE = `You receive a photo of an exam/exercise sheet and a worked solution (or instructions to solve it yourself).
Your task is to create a clean, readable, exam-style annotated copy of the SAME sheet, as if a strong Moroccan high-school student had written the answers neatly in blue pen.

1. READ AND SOLVE
- Identify every numbered question and sub-question visible on the page. Answer only the questions, not introductions or document descriptions.
- If a worked solution is provided, use it as the source of the answers, but correct obvious scientific or mathematical mistakes when needed.
- If no solution is provided, solve the questions from the sheet yourself. Do not invent unreadable values; use approximate values only when the graph supports them.
- Use the language of the exam, usually French. Keep Moroccan school terminology and the exact question numbering.
- Write complete but concise exam-ready answers: include the key observation, reasoning or deduction required to earn marks. Do not reduce a question asking to explain/justify/deduce to a single keyword.
- For calculations, include the essential formula, substitution and final result with unit. For document analysis, describe the relevant trend before the deduction. For SVT, use short, precise scientific sentences.

2. REPLACE EACH QUESTION BY ITS ANSWER
- For every numbered question or sub-question (1., 2., 3), a), ...), ERASE the printed question wording (the instruction sentence, including its blue/printed text) and write the answer in its place. KEEP ONLY the question number/label (for example "1)" or "3.") and, if present, the mark such as "(2 pts)" at the right edge.
- Each answer starts right after its question number, on the first line of the erased question, and continues on the lines below, filling the freed space of that question. The answer must include its full justification (observation/evidence, reasoning, deduction or formula, substitution and result with unit), exactly as a student would write it.
- The erase region of a question = the whole rectangle of the question wording, from just right of its number to the end of its last line (and as many lines as needed to hold the answer, if the blank area right under the question is empty). Make it tight: never include the number, the points, titles, "Données"/"Document" statements, diagrams, tables, axes, labels, given data, or other questions.
- Never erase or write over anything that is not a question wording: exercise titles, introductions, data statements, documents, figures, tables and their captions must stay untouched.
- If the freed space is too small for the whole answer, extend the answer into the genuinely blank area directly below the question (empty lines), never over printed content.
- Keep the original page and its structure otherwise unchanged.

3. TEXT AND LINE BOXES
- Put each answer in its own box. A box may contain a short paragraph wrapped over multiple lines if enough clear space exists; set its height to fit all lines. For longer answers, split into several boxes in reading order, one line or short sentence per box, with enough vertical spacing to prevent overlap.
- Handwriting must be LARGE and clearly readable, like a student's neat blue-pen writing on a ruled notebook: each text line is about 0.025–0.03 of the image height. Make h big enough for ALL wrapped lines (about 0.03 per line) and w as wide as the free space allows (up to 0.95 when the line area is empty). Use plain text and Unicode math symbols (×, ÷, √, ², π, ≤, →, ≈); avoid LaTeX delimiters and Markdown formatting.
- Use French decimal commas where appropriate and include units. Keep final results clearly identifiable, for example with “Donc,” or a short underlined-style phrase expressed as plain text (do not add Markdown).
- Coordinates are normalized to the image (0..1), origin at top-left. For answers, x,y are the top-left of the text, w is the usable width, and h is the full text-box height. Keep x + w <= 0.98 and y + h <= 0.98.
- Answers must not overlap one another or printed content. Keep the original question order. Use a readable line height and realistic handwriting scale.
- Do not answer introductions, statements, or documents; answer numbered questions only. If the image is a dense textbook page with graphs and no writing space, use nearby clear space and prioritize short, complete answers over long explanations.

4. DRAWING QUESTIONS (physics / chemistry / maths) — DRAW, DO NOT WRITE
- If a question asks to draw / trace / plot / construct / represent something ON the figure, curve, graph, table or diagram of the sheet (tracer, construire, représenter, placer, tangente, asymptote, droite, "ارسم", "مثّل", "أنشئ", "عيّن على المنحنى"), the answer MUST be a drawing placed on the figure itself, in the "drawings" array. Do NOT answer it with a written sentence and do NOT erase the question wording or anything of the figure.
- Coordinates are normalized to the image (0..1) and MUST be read from the grid labels. Locate the graph axes' origin and the printed scale on the grid first, then convert data values to image coordinates by linear interpolation along each axis (use at least two tick marks per axis).
- kind "line": straight segment between 2 points (to draw a tangent or a straight line, extend it across the useful part of the graph). "polyline": a curve through several points (≥ 4, smooth). "arrow": arrow from points[0] to points[1] (vectors, forces). "point": a marked point at points[0] (cross). "circle": circle with center points[0] and a point on its edge points[1].
- "dashed": true for construction/projection lines (e.g. dashed lines from a point to the axes).
- "label": a very short plain-text tag next to the drawing (e.g. "T", "A(2 ; 3,5)", "τ = 0,4 s"); use "" when none is needed.
- Draw with precision: a tangent must touch the curve at the requested point with the correct slope; a point must sit exactly on the printed curve/axis tick.
- For "graphical reading" questions (graphiquement / par lecture graphique): write the value as usual in "answers", AND add dashed projection lines in "drawings" from the read point to both axes with a "point" mark on the curve.
- If the figure needed for a drawing question is not visible or too unclear to place points reliably, do not draw: return no drawing for it and write in "answers" one short sentence next to the question saying the figure is not clear on the photo.

Return only the structured JSON required by the schema.`;

const GRID = `

COORDINATE GRID: the image you receive has a red grid drawn over it by the app.
- Solid lines every 0.1 and dashed lines every 0.05, labelled 0.1 … 0.9 on all four edges (top and bottom = x, left and right = y).
- Read every coordinate FROM THE GRID LABELS, interpolating between neighbouring lines; do NOT guess from the picture.
- Before writing a position, locate the target (blank line, number "2)", table cell) between two grid lines on each axis, then give the value to 2 decimals.
- Ignore the grid lines themselves; they are not part of the sheet.`;

const box = { x: { type: "number" }, y: { type: "number" }, w: { type: "number" }, h: { type: "number" } };
const schema = {
  type: "object",
  additionalProperties: false,
  required: ["answers", "erase", "drawings"],
  properties: {
    drawings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "points", "label", "dashed"],
        properties: {
          kind: { type: "string", enum: ["line", "polyline", "arrow", "point", "circle"] },
          points: { type: "array", items: { type: "object", additionalProperties: false, required: ["x", "y"], properties: { x: { type: "number" }, y: { type: "number" } } } },
          label: { type: "string" },
          dashed: { type: "boolean" },
        },
      },
    },
    answers: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["text", "x", "y", "w", "h"], properties: { text: { type: "string" }, ...box } },
    },
    erase: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["x", "y", "w", "h", "reason"], properties: { ...box, reason: { type: "string" } } },
    },
  },
};

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, Number.isFinite(v) ? v : 0));
const fixBox = <T extends { x: number; y: number; w: number; h: number }>(b: T): T => {
  const x = clamp(b.x), y = clamp(b.y);
  return { ...b, x, y, w: clamp(b.w, 0.02, 1 - x), h: clamp(b.h, 0.012, 1 - y) };
};

const KINDS = new Set(["line", "polyline", "arrow", "point", "circle"]);
const fixDrawings = (list: any[]) =>
  (Array.isArray(list) ? list : [])
    .filter((d) => d && KINDS.has(d.kind) && Array.isArray(d.points))
    .slice(0, 40)
    .map((d) => ({
      kind: d.kind as string,
      points: d.points.slice(0, 60).map((p: any) => ({ x: clamp(p?.x), y: clamp(p?.y) })),
      label: typeof d.label === "string" ? d.label.slice(0, 40) : "",
      dashed: Boolean(d.dashed),
    }))
    .filter((d) => d.points.length >= (d.kind === "point" ? 1 : 2));

export async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  try {
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) return json({ error: "Invalid request" }, 400);
    const ai = getAiConfig();
    if (!ai) return json({ error: "AI not configured" }, 500);

    const prompt = BASE + (parsed.data.grid ? GRID : "");
    const userText = parsed.data.answer ? `Solution:\n${parsed.data.answer}` : "Solve the sheet yourself.";

    let res: Response;
    if (ai.provider === "lovable") {
      // مسار Lovable القديم (Responses API مع json_schema صارم)
      res = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
        method: "POST",
        headers: { Authorization: `Bearer ${ai.key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "openai/gpt-6-astra",
          // "low" يخطئ كثيراً في الإحداثيات؛ medium أدق بفارق بسيط في الزمن
          reasoning: { effort: "medium" },
          text: { format: { type: "json_schema", name: "sheet_answers", strict: true, schema } },
          input: [
            { role: "system", content: [{ type: "input_text", text: prompt }] },
            { role: "user", content: [
              { type: "input_text", text: userText },
              { type: "input_image", image_url: parsed.data.image },
            ] },
          ],
        }),
      });
    } else {
      // مزوّد خاص: Chat Completions مع JSON، والمخطط يُرفق في التعليمات
      res = await fetch(ai.chatUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${ai.key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: ai.model("accurate"),
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: `${prompt}\n\nReturn ONLY one JSON object that matches this JSON Schema exactly:\n${JSON.stringify(schema)}` },
            { role: "user", content: [
              { type: "text", text: userText },
              { type: "image_url", image_url: { url: parsed.data.image } },
            ] },
          ],
        }),
      });
    }
    if (!res.ok) {
      const t = await res.text();
      console.error("gateway", res.status, t);
      const msg = res.status === 429 ? "Trop de requêtes, réessayez plus tard." : res.status === 402 ? "Crédits IA épuisés." : "Erreur IA";
      return json({ error: msg }, res.status);
    }
    const data = await res.json();
    const text: string | undefined = ai.provider === "lovable"
      ? (data.output_text ?? data.output?.flatMap((o: any) => o.content ?? []).find((c: any) => c.type === "output_text")?.text)
      : data.choices?.[0]?.message?.content;
    if (!text) return json({ error: "Réponse vide" }, 502);
    const out = JSON.parse(text.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, ""));
    return json({
      answers: (out.answers ?? []).map(fixBox),
      erase: (out.erase ?? []).map(fixBox),
      drawings: fixDrawings(out.drawings),
    });
  } catch (e) {
    console.error(e);
    return json({ error: "Server error" }, 500);
  }
}
