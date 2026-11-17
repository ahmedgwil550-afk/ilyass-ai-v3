import { describe, expect, it } from "vitest";
import { splitVerification, type Verdict } from "../../lib/verification";
import { withVerification } from "./stream";
import { buildVerdict } from "./pipeline";

const enc = new TextEncoder();
const evt = (content: string, extra: object = {}) => `data: ${JSON.stringify({ choices: [{ delta: { content }, ...extra }] })}\n\n`;

/** يبني استجابة SSE تصل مقطّعة إلى أجزاء بحجم محدد (لاختبار حدود الأحداث). */
function upstream(text: string, chunk = 1e9): Response {
  const bytes = enc.encode(text);
  let i = 0;
  return new Response(new ReadableStream<Uint8Array>({
    pull(c) { if (i >= bytes.length) return c.close(); c.enqueue(bytes.slice(i, i + chunk)); i += chunk; },
  }));
}

async function run(up: Response, verify: any, level: any = "standard") {
  const res = withVerification(up, { headers: { "Content-Type": "text/event-stream" }, context: { level, subject: "math", question: "Q" }, verify });
  return res.text();
}
const contents = (sse: string) => [...sse.matchAll(/^data: (.*)$/gm)].map((m) => m[1]).filter((d) => d !== "[DONE]").map((d) => JSON.parse(d)?.choices?.[0]?.delta?.content ?? "").join("");

const done = (over: Partial<Verdict> = {}) => ({ ...buildVerdict("done", [{ id: "complete", status: "pass", ar: "", fr: "" }], [], 2), ...over });

describe("withVerification", () => {
  const body = evt("الجواب ") + evt("النهائي", { finish_reason: "stop" }) + "data: [DONE]\n\n";

  it("يمرّر الإجابة كما هي ثم يُلحق الحكم قبل [DONE] مرة واحدة", async () => {
    const out = await run(upstream(body), async () => done());
    const { text, verification } = splitVerification(contents(out));
    expect(text).toBe("الجواب النهائي");
    expect(verification?.state).toBe("done");
    expect(out.match(/\[DONE\]/g)).toHaveLength(1);
    expect(out.trimEnd().endsWith("data: [DONE]")).toBe(true);
    expect(out.indexOf("verification")).toBeGreaterThan(out.indexOf("النهائي"));
  });

  it("يسلّم المحقِّق الإجابة الكاملة وسبب الانتهاء", async () => {
    let seen: any;
    await run(upstream(body), async (ctx: any) => { seen = ctx; return done(); });
    expect(seen.answer).toBe("الجواب النهائي");
    expect(seen.finishReason).toBe("stop");
    expect(seen.level).toBe("standard");
  });

  it("يعمل مع تقطيع الشبكة بايتاً بايتاً", async () => {
    const out = await run(upstream(body, 1), async () => done());
    expect(splitVerification(contents(out)).text).toBe("الجواب النهائي");
    expect(out.match(/\[DONE\]/g)).toHaveLength(1);
  });

  it("يبثّ حكم running الوسيط ثم النهائي", async () => {
    const out = await run(upstream(body), async (ctx: any) => { ctx.onProgress(done({ state: "running" })); return done(); });
    const blocks = [...contents(out).matchAll(/<verification>/g)];
    expect(blocks).toHaveLength(2);
    expect(splitVerification(contents(out)).verification?.state).toBe("done");
  });

  it("فشل التحقق لا يمسّ الإجابة ولا ينهي البث بلا [DONE]", async () => {
    const out = await run(upstream(body), async () => { throw new Error("boom"); });
    expect(splitVerification(contents(out))).toEqual({ text: "الجواب النهائي", verification: null });
    expect(out.trimEnd().endsWith("data: [DONE]")).toBe(true);
  });

  it("إن انقطع المزوّد بلا [DONE] يُتحقق ويُنهى البث بشكل سليم", async () => {
    const out = await run(upstream(evt("جواب قصير")), async () => done());
    expect(splitVerification(contents(out)).verification).not.toBeNull();
    expect(out.trimEnd().endsWith("data: [DONE]")).toBe(true);
  });

  it("رد فارغ: لا تحقق ولا كتلة", async () => {
    let called = false;
    const out = await run(upstream("data: [DONE]\n\n"), async () => { called = true; return done(); });
    expect(called).toBe(false);
    expect(out).not.toContain("verification");
    expect(out.trimEnd().endsWith("data: [DONE]")).toBe(true);
  });

  it("أحداث الخطأ والتعليقات من المزوّد تمرّ كما هي", async () => {
    const errEvt = `data: ${JSON.stringify({ error: { code: "INSUFFICIENT_CREDITS", message: "x" } })}\n\n`;
    const out = await run(upstream(`: ping\n\n${evt("نص")}${errEvt}data: [DONE]\n\n`), async () => done());
    expect(out).toContain(": ping");
    expect(out).toContain("INSUFFICIENT_CREDITS");
  });

  it("المستوى off يمرّر البث دون أي تعديل", async () => {
    const out = await run(upstream(body), async () => { throw new Error("must not run"); }, "off");
    expect(out).toBe(body);
  });

  it("الأحداث بنهايات CRLF", async () => {
    const crlf = body.replace(/\n\n/g, "\r\n\r\n");
    const out = await run(upstream(crlf), async () => done());
    expect(splitVerification(contents(out)).text).toBe("الجواب النهائي");
  });
});
