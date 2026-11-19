import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { locateFigure, planDrawing, redrawFigure } from "@/server-ai/diagram/diagram";

/**
 * نظام الشكل: ثلاث مراحل بنقطة نهاية واحدة، يختار العميل المرحلة بحقل mode.
 *  locate: صورة الورقة كاملة ← مكان الشكل وما يُمسح من حوله وما المطلوب منه
 *  plan:   قصّ الشكل (عليه شبكة إحداثيات) ← ما يُرسم فوقه وبأي إحداثيات
 *  redraw: قصّ الشكل ← SVG مُنظَّف للشكل وحده (محرك إعادة الرسم)
 * كل ناتج يمرّ على الفحوص في src/lib/diagram.ts قبل أن يخرج من هنا.
 */
const answer = z.string().max(6000);

const bodySchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("locate"),
    image: z.string().min(100).max(12_000_000),
    answer,
    subject: z.string().max(20).optional(),
  }),
  z.object({
    mode: z.literal("plan"),
    image: z.string().min(100).max(6_000_000),
    task: z.string().max(600),
    answer,
  }),
  z.object({
    mode: z.literal("redraw"),
    image: z.string().min(100).max(6_000_000),
    w: z.number().int().min(50).max(1000),
    h: z.number().int().min(50).max(1000),
    stroke: z.number().min(0.5).max(40),
  }),
]);

type Failure = { reason: string; status?: number };

function failure(f: Failure): Response {
  switch (f.reason) {
    case "no_provider":
      return Response.json({ error: "Diagram solving is not configured.", reason: f.reason }, { status: 503 });
    case "credits":
      return Response.json({ error: "The AI provider reported insufficient credits.", reason: f.reason }, { status: 402 });
    case "aborted":
      return Response.json({ error: "Request cancelled.", reason: f.reason }, { status: 499 });
    case "no_figure":
    case "figure_too_small":
      return Response.json({ error: "No usable figure found on this page.", reason: f.reason }, { status: 422 });
    default:
      return Response.json({ error: "Diagram solving is temporarily unavailable.", reason: f.reason }, { status: 502 });
  }
}

export const Route = createFileRoute("/api/diagram")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const parsed = bodySchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) {
          return Response.json({ error: "Invalid diagram payload or image size limit exceeded." }, { status: 400 });
        }
        const body = parsed.data;
        const signal = request.signal;

        if (body.mode === "locate") {
          const out = await locateFigure({ image: body.image, answer: body.answer, subject: body.subject, signal });
          return out.ok ? Response.json({ location: out.location }) : failure(out);
        }
        if (body.mode === "plan") {
          const out = await planDrawing({ image: body.image, task: body.task, answer: body.answer, signal });
          return out.ok ? Response.json({ plan: out.plan }) : failure(out);
        }
        const out = await redrawFigure({ image: body.image, w: body.w, h: body.h, stroke: body.stroke, signal });
        return out.ok ? Response.json({ svg: out.svg }) : failure(out);
      },
    },
  },
});
