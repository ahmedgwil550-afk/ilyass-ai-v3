import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/account-client", () => ({
  accountClient: { auth: { getSession: async () => ({ data: { session: null } }) } },
}));

import { streamChat } from "./streamChat";

const enc = new TextEncoder();
const evt = (content: string) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
const creditsEvent = `data: ${JSON.stringify({ error: { code: "INSUFFICIENT_CREDITS", message: "نفد الرصيد" } })}\n\n`;

/** SSE response whose body delivers each piece separately, then closes or errors. */
function sseResponse(pieces: string[], ending: "close" | "error" = "close"): Response {
  let i = 0;
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        if (i < pieces.length) controller.enqueue(enc.encode(pieces[i++]));
        else if (ending === "error") controller.error(new Error("connection reset"));
        else controller.close();
      },
    }),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );
}

interface Outcome { text: string; done: number; errors: string[]; order: string[] }

async function run(response: Response): Promise<Outcome> {
  vi.stubGlobal("fetch", vi.fn(async () => response));
  const out: Outcome = { text: "", done: 0, errors: [], order: [] };
  await new Promise<void>((resolve) => {
    let settled = false;
    const settle = () => { if (!settled) { settled = true; setTimeout(resolve, 20); } };
    streamChat({
      messages: [{ role: "user", content: "سؤال" }],
      subject: "math",
      modelMode: "panache",
      onDelta: (t) => { out.text += t; out.order.push("delta"); },
      onDone: () => { out.done++; out.order.push("done"); settle(); },
      onError: (e) => { out.errors.push(e); out.order.push("error"); settle(); },
    });
  });
  return out;
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("streamChat keeps what was delivered", () => {
  it("delivers the whole answer, then finishes once", async () => {
    const out = await run(sseResponse([evt("الجواب "), evt("النهائي"), "data: [DONE]\n\n"]));
    expect(out.text).toBe("الجواب النهائي");
    expect(out.done).toBe(1);
    expect(out.errors).toEqual([]);
  });

  it("hands over the answer that came before a credit error, then reports it", async () => {
    const answer = "الحل الكامل للتمرين الأول والثاني";
    const out = await run(sseResponse([evt("<thinking>\n- خطوة\n</thinking>\n"), evt(answer), creditsEvent, "data: [DONE]\n\n"]));
    expect(out.text).toContain(answer);
    expect(out.errors).toEqual(["نفد الرصيد"]);
    expect(out.done).toBe(0);
    // The text reaches the caller before the error does, so it can keep it.
    expect(out.order.lastIndexOf("delta")).toBeLessThan(out.order.indexOf("error"));
  });

  it("does not lose text still waiting in the typewriter buffer when the connection drops", async () => {
    const answer = "س".repeat(400);
    const out = await run(sseResponse([evt(answer)], "error"));
    expect(out.text).toBe(answer);
    expect(out.errors).toHaveLength(1);
    expect(out.order.lastIndexOf("delta")).toBeLessThan(out.order.indexOf("error"));
  });

  it("reports a credit error that arrives as the very last event without a trailing blank line", async () => {
    const out = await run(sseResponse([evt("جواب"), creditsEvent.trimEnd()]));
    expect(out.text).toBe("جواب");
    expect(out.errors).toEqual(["نفد الرصيد"]);
  });
});
