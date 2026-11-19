import { buildLocation, buildPlan, type DiagramLocation, type DiagramPlan } from "../../lib/diagram";
import { extractJson } from "../../lib/recognition";
import { extractSvg, sanitizeSvg } from "../../lib/svgSanitize";
import { callVision, type VisionFailure, type VisionOptions } from "./vision";
import { LOCATE_PROMPT, locateUserText, PLAN_PROMPT, planUserText, REDRAW_PROMPT, redrawUserText } from "./prompts";

type Shared = Pick<VisionOptions, "signal" | "timeoutMs" | "fetchImpl" | "config">;

export type LocateOutcome =
  | { ok: true; location: DiagramLocation; model: string }
  | { ok: false; reason: VisionFailure | "bad_json" | "no_figure" | "figure_too_small" };

/** المرحلة 1: أين الشكل وما الذي يُمسح من حوله وما المطلوب منه */
export async function locateFigure(o: Shared & { image: string; answer: string; subject?: string }): Promise<LocateOutcome> {
  const r = await callVision({ ...o, system: LOCATE_PROMPT, userText: locateUserText(o.answer, o.subject), maxTokens: 1800 });
  if (!r.ok) return r;
  const parsed = extractJson(r.text);
  if (!parsed) return { ok: false, reason: "bad_json" };
  const loc = buildLocation(parsed);
  if (!loc.ok) return { ok: false, reason: loc.reason === "bad_shape" ? "bad_json" : loc.reason };
  return { ok: true, location: loc.location, model: r.model };
}

export type PlanOutcome =
  | { ok: true; plan: DiagramPlan; model: string }
  | { ok: false; reason: VisionFailure | "bad_json" };

/** المرحلة 2: ما الذي يُرسم فوق الشكل وبأي إحداثيات (الصورة المرسلة عليها شبكة إحداثيات) */
export async function planDrawing(o: Shared & { image: string; task: string; answer: string }): Promise<PlanOutcome> {
  const r = await callVision({ ...o, system: PLAN_PROMPT, userText: planUserText(o.task, o.answer), maxTokens: 5000 });
  if (!r.ok) return r;
  const plan = buildPlan(extractJson(r.text));
  return plan ? { ok: true, plan, model: r.model } : { ok: false, reason: "bad_json" };
}

export type RedrawOutcome =
  | { ok: true; svg: string; model: string }
  | { ok: false; reason: VisionFailure | "bad_svg" };

/** المرحلة 3 (محرك إعادة الرسم): SVG للشكل وحده، يمرّ على المنظِّف الصارم قبل أن يخرج من الخادم */
export async function redrawFigure(o: Shared & { image: string; w: number; h: number; stroke: number }): Promise<RedrawOutcome> {
  const r = await callVision({ ...o, system: REDRAW_PROMPT, userText: redrawUserText(o.w, o.h, o.stroke), maxTokens: 14_000, timeoutMs: o.timeoutMs ?? 85_000 });
  if (!r.ok) return r;
  const raw = extractSvg(r.text);
  const svg = raw ? sanitizeSvg(raw, o.w, o.h) : null;
  return svg ? { ok: true, svg, model: r.model } : { ok: false, reason: "bad_svg" };
}
