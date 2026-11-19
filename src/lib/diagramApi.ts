import type { DiagramLocation, DiagramPlan } from "./diagram";
import { DiagramApiError, type Api } from "./diagramSolver";

async function post<T>(body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch("/api/diagram", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  } catch (e) {
    throw new DiagramApiError(signal?.aborted ? "aborted" : "upstream");
  }
  if (!res.ok) {
    const j = (await res.json().catch(() => null)) as { reason?: unknown } | null;
    throw new DiagramApiError(typeof j?.reason === "string" ? j.reason : "upstream", res.status);
  }
  return (await res.json()) as T;
}

/** عميل نقطة النهاية /api/diagram: كل دالة تقابل مرحلة. الأخطاء تعود DiagramApiError بسبب واضح */
export const diagramApi: Api = {
  async locate(image, answer, subject, signal) {
    const r = await post<{ location?: DiagramLocation }>({ mode: "locate", image, answer, subject }, signal);
    if (!r.location?.crop) throw new DiagramApiError("bad_json");
    return r.location;
  },
  async plan(image, task, answer, signal) {
    const r = await post<{ plan?: DiagramPlan }>({ mode: "plan", image, task, answer }, signal);
    if (!r.plan) throw new DiagramApiError("bad_json");
    return r.plan;
  },
  async redraw(image, w, h, stroke, signal) {
    const r = await post<{ svg?: string }>({ mode: "redraw", image, w, h, stroke }, signal);
    if (!r.svg) throw new DiagramApiError("bad_svg");
    return r.svg;
  },
};
