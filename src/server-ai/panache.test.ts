import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { splitThinking } from "../lib/thinking";
import { panacheResponse } from "./panache";

const enc = new TextEncoder();
const evt = (content: string) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;

const QUESTION = [
  "التمرين الأول",
  "1) احسب 2+3=5",
  "2) احسب 4×5=20",
  "3) احسب 6-1=5",
  "4) حل x+1=2",
  "5) احسب 7+8=15",
].join("\n");

const DRAFT = "المسودة الأولية: 5 و 20 و 5 و 1 و 15";
const STUDENT = "الإجابة المصاغة للتلميذ: 5 و 20 و 5 و 1 و 15";
const FINAL = "الإجابة النهائية بعد المراجعة: 5 و 20 و 5 و 1 و 15";

type Req = { url: string; model: string; stream: boolean };
type Handler = (req: Req) => Response | Promise<Response>;

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const chatJson = (text: string) => json({ choices: [{ message: { content: text } }] });
const claudeJson = (text: string) => json({ content: [{ text }] });
const payment = () => new Response("payment required", { status: 402 });

/** SSE body that delivers every piece, then closes cleanly or breaks like a dropped connection. */
function sse(pieces: string[], ending: "close" | "error" = "close"): Response {
  let i = 0;
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        if (i < pieces.length) controller.enqueue(enc.encode(pieces[i++]));
        else if (ending === "error") controller.error(new Error("connection reset"));
        else { controller.enqueue(enc.encode("data: [DONE]\n\n")); controller.close(); }
      },
    }),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );
}

/** Every model call, by role: solver and final share one model, the independent solver is Gemini. */
function gateway(overrides: { solver?: Handler; writer?: Handler; independent?: Handler; final?: Handler }): Handler {
  return (req) => {
    if (req.url.endsWith("/v1/messages")) return (overrides.writer ?? (() => claudeJson(STUDENT)))(req);
    if (req.model.includes("gemini")) return (overrides.independent ?? (() => chatJson("الحل المستقل: 5 و 20 و 5 و 1 و 15")))(req);
    if (req.stream) return (overrides.final ?? (() => sse([evt(FINAL)])))(req);
    return (overrides.solver ?? (() => chatJson(DRAFT)))(req);
  };
}

interface Result { raw: string; text: string; answer: string; errors: any[]; doneCount: number; calls: Req[] }

async function run(handler: Handler): Promise<Result> {
  const calls: Req[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: any, init: any) => {
    const body = JSON.parse(init.body);
    const req = { url: String(url), model: String(body.model), stream: body.stream === true };
    calls.push(req);
    return handler(req);
  }));
  const res = panacheResponse({
    systemPrompt: "system",
    subject: "math",
    aiMessages: [{ role: "system", content: "system" }, { role: "user", content: QUESTION }],
    images: [],
    fallback: async () => new Response("no", { status: 500 }),
  });
  const raw = await res.text();
  const events = [...raw.matchAll(/^data: (.*)$/gm)].map((m) => m[1]);
  const errors = events.filter((d) => d !== "[DONE]").map((d) => JSON.parse(d)).filter((p) => p.error).map((p) => p.error);
  const text = events
    .filter((d) => d !== "[DONE]")
    .map((d) => JSON.parse(d)?.choices?.[0]?.delta?.content ?? "")
    .join("");
  return { raw, text, answer: splitThinking(text).answer, errors, doneCount: events.filter((d) => d === "[DONE]").length, calls };
}

beforeEach(() => {
  vi.stubEnv("LOVABLE_API_KEY", "test-key");
  for (const k of ["OPENAI_API_KEY", "AI_API_KEY", "ANTHROPIC_API_KEY", "PANACHE_MODEL_SOLVER", "PANACHE_MODEL_FINAL", "PANACHE_MODEL_WRITER", "PANACHE_MODEL_VISION"]) {
    vi.stubEnv(k, "");
  }
  vi.stubEnv("VERIFY_LEVEL", "off");
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("panacheResponse", () => {
  it("streams the reviewed answer once, with a single closing thinking tag", async () => {
    const r = await run(gateway({}));
    expect(r.answer).toBe(FINAL);
    expect(r.text.match(/<\/thinking>/g)).toHaveLength(1);
    expect(r.errors).toEqual([]);
    expect(r.doneCount).toBe(1);
    expect(r.calls.some((c) => c.stream)).toBe(true);
  });
});

describe("panacheResponse never discards an answer that was paid for", () => {
  it("hands over the written answer when credits run out at the final review", async () => {
    const r = await run(gateway({ final: payment }));
    expect(r.answer).toContain(STUDENT);
    expect(r.answer).toContain("⚠️ تنبيه");
    expect(r.answer).toContain("لم تُراجَع");
    expect(r.text.match(/<\/thinking>/g)).toHaveLength(1);
    // The client still learns that credits ran out, so it can pause new requests.
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].code).toBe("INSUFFICIENT_CREDITS");
    expect(r.doneCount).toBe(1);
  });

  it("hands over the written answer when credits run out at the independent solve", async () => {
    const r = await run(gateway({ independent: payment }));
    expect(r.answer).toContain(STUDENT);
    expect(r.answer).toContain("لم تُراجَع");
    expect(r.errors[0]?.code).toBe("INSUFFICIENT_CREDITS");
  });

  it("falls back to the first solution when credits run out during the writer stage", async () => {
    const r = await run(gateway({ writer: payment }));
    expect(r.answer).toContain(DRAFT);
    expect(r.answer).not.toContain(STUDENT);
    expect(r.errors[0]?.code).toBe("INSUFFICIENT_CREDITS");
  });

  it("sends only the credit error when nothing has been produced yet", async () => {
    const r = await run(gateway({ solver: payment }));
    expect(r.answer).toBe("");
    expect(r.text).not.toContain("حدث خطأ غير متوقع");
    expect(r.errors[0]?.code).toBe("INSUFFICIENT_CREDITS");
    expect(r.doneCount).toBe(1);
  });

  it("keeps the part already streamed when the final review connection drops, without a second copy", async () => {
    const partial = "الإجابة النهائية الجزئية: التمرين الأول";
    const r = await run(gateway({ final: () => sse([evt(partial)], "error") }));
    expect(r.answer).toContain(partial);
    expect(r.answer).toContain("انقطع بث المراجعة النهائية");
    expect(r.answer).not.toContain(STUDENT);
    expect(r.answer.split(partial)).toHaveLength(2);
    expect(r.errors).toEqual([]);
    expect(r.doneCount).toBe(1);
  });

  it("shows the written answer when the final review cannot start at all", async () => {
    const r = await run(gateway({ final: () => new Response("boom", { status: 500 }) }));
    expect(r.answer).toBe(STUDENT);
    expect(r.errors).toEqual([]);
  });
});
