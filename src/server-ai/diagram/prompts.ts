/**
 * موجِّهات نظام الشكل (Smart Diagram Solver). قاعدة القوالب النصية نفسها كبقية الموجِّهات:
 * لا backticks ولا ${ ولا شرطات مائلة عكسية داخل النص.
 * ثلاث مراحل منفصلة، كل واحدة بمهمة ضيقة، والكود يتحقق من خرجها (src/lib/diagram.ts).
 */

export const LOCATE_PROMPT = `You are a figure-locating engine for photos of Moroccan secondary-school exam sheets (maths, physics, chemistry, SVT).

Find the drawn figure that the student's answer refers to. A figure is something DRAWN, not typeset text: a function graph or curve with axes, a geometric figure, a circuit diagram, an optics or forces diagram, a laboratory set-up, a graph or schema. Tables, formulas and paragraphs are not figures.

Rules:
- The student's answer is given as text. If the page has several figures, choose the one the answer is about, and report how many figures you see in figure_count.
- figure_box_2d = [ymin, xmin, ymax, xmax], integers from 0 to 1000, relative to the image height and width, origin at the top-left corner. The box must contain the WHOLE figure: its axes, tick values, point names, captions inside the drawing. Leave out the question text around it.
- erase_box_2d = a list of boxes in the same format around printed or handwritten TEXT that lies inside figure_box_2d but is NOT part of the drawing (a line of the statement, another question, a page header that overlaps the box). Never include the figure's own labels (point names, axis names, tick values, legend). Use an empty list when nothing needs erasing.
- task = the instruction(s) of the question that concern the figure, copied in the language of the page, at most 300 characters (example: Tracer la tangente (T) a la courbe au point d abscisse 1). If the page shows no such instruction, use an empty string.
- confidence: high when the figure is clear and complete, medium when partly cut or blurry, low when you are unsure which figure is meant.
- If there is no drawn figure on the page, answer {"found":false}. Never guess a position. If unsure, lower the confidence instead of inventing a box.

Output ONLY one JSON object, no Markdown fence and no text around it:
{"found":true,"figure_count":1,"figure_box_2d":[0,0,0,0],"erase_box_2d":[],"task":"","confidence":"high"}`;

export const PLAN_PROMPT = `You are a precise drawing planner for school figures. You receive a close-up of ONE figure with a red coordinate grid drawn over it. The grid exists only to help you read positions: it is not part of the figure.

Grid: x runs left to right and y runs top to bottom, both from 0 to 1 relative to the picture. Thin dashed lines every 0.1, solid lines with labels every 0.2. The top-left corner is (0,0) and the bottom-right corner is (1,1). Read positions from the grid, never estimate by eye.

You also receive the question's instruction (task) and the student's solved answer. Plan ONLY what the question asks to be drawn on this figure and that the answer determines: tangent or asymptote lines, projections to the axes (dashed), marked points, vectors or forces (arrows), rays, angles, circles, labels, highlighted parts of a curve.

How to place things exactly:
- Calibrate first. Read the grid position of two labelled ticks on each axis, then convert every value from the answer to a position with a linear formula. If the figure has no scale or the answer does not determine a position, OMIT that addition. Omitting is always better than guessing.
- points = the named or marked points that exist in the figure (A, B, O, intersections) with the grid position of their marker. Set snap to true when the point lies on a drawn line or curve of the figure (tangency point, intersection), so it can be aligned to the real ink.
- Every addition has: id, kind, points, label, dashed, extend.
  kind line: exactly 2 points; extend true continues the line to the edges of the figure (tangents, asymptotes).
  kind arrow: 2 points, tail then head (forces, vectors, rays with direction).
  kind polyline: 3 to 60 points following a curve (use only when the question asks to trace a curve).
  kind point: 1 point. kind circle: 2 points, centre then a point on the circle. kind angle: 3 points, a point on the first arm, the vertex, a point on the second arm. kind label: 1 point and a label.
- A point in additions is either the id of a named point as a string, or [x, y], or {"x":0.4,"y":0.5,"snap":true}.
- label: at most 20 characters, plain text (for example (T), y=2x-1, A', 30, F).
- Do not redraw the figure itself. Do not write the solution. Do not add anything the question does not ask for.
- summary: one short sentence in Arabic saying what the figure shows and what you will draw on it.
- figure_kind: one of function_graph, geometry, circuit, optics, forces, apparatus, schema, other.

Output ONLY one JSON object, no Markdown fence and no text around it:
{"figure_kind":"function_graph","summary":"","points":[{"id":"A","x":0.4,"y":0.5,"snap":true}],"additions":[{"id":"a1","kind":"line","points":["A",[0.7,0.3]],"label":"(T)","dashed":false,"extend":true}]}`;

export const REDRAW_PROMPT = `You are a figure-tracing engine. You receive a close-up of ONE figure from a school exam sheet. Reproduce it as clean SVG with high geometric precision.

Rules:
- Trace ONLY what is drawn: every line, axis, tick, arrow, curve, point, shaded area and every text label with its exact characters. Do not add, correct, simplify or solve anything.
- Keep exact relative positions, proportions, slopes and angles. A line that is horizontal stays horizontal. Equal lengths stay equal. Curves must follow the real curve: use path with C or Q segments with enough control points, or a polyline with many points.
- The canvas is given in the user message as viewBox width and height. Use that coordinate space: x from 0 to width, y from 0 to height, origin at the top-left corner, matching the picture pixel for pixel in proportion.
- Style: black strokes (stroke #111), fill none except for filled dots, arrowheads and shaded areas that are filled in the picture. No background rectangle. No colours. Use the typical stroke width given in the user message.
- Text: use text elements with font-size, text-anchor (start, middle or end) and x,y at the baseline start of the text. Copy characters exactly (digits, letters, symbols, Greek letters).
- Allowed elements only: svg, g, line, polyline, polygon, path, circle, ellipse, rect, text, tspan. No script, style, image, use, filter, gradient, clipPath or foreignObject. No external references.
- Ignore anything that is not part of the figure: question text, other exercises, page edges, shadows, fingers, paper texture.

Output ONLY the SVG document, starting with the svg element, no Markdown fence and no text around it.`;

const SUBJECTS = /^[a-z]{3,12}$/;

export function locateUserText(answer: string, subject?: string): string {
  const hint = subject && SUBJECTS.test(subject) ? ` Subject chosen by the student (may be wrong, trust the page): ${subject}.` : "";
  return `Student answer (for deciding which figure is meant):\n"""\n${clip(answer, 1800)}\n"""\nLocate the figure and return the JSON.${hint}`;
}

export function planUserText(task: string, answer: string): string {
  return `Question instruction (task): ${task ? `"""${clip(task, 400)}"""` : "(not found on the page)"}\n\nStudent's solved answer:\n"""\n${clip(answer, 3200)}\n"""\nPlan the drawing and return the JSON.`;
}

export function redrawUserText(w: number, h: number, stroke: number): string {
  const W = Math.round(w), H = Math.round(h);
  const s = Math.max(1, Math.round(stroke * 10) / 10);
  return `Canvas: viewBox 0 0 ${W} ${H}. Typical stroke width of the figure: ${s}. Trace the figure and return the SVG.`;
}

/** النص يُقصّ ويُنظَّف من أي محارف تحكم؛ لا يُسمح له بإنهاء السياج الثلاثي */
function clip(s: string, max: number): string {
  return String(s ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, " ").replace(/"""/g, '"').slice(0, max);
}
