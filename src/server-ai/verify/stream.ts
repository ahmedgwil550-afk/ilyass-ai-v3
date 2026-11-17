/**
 * غلاف بث SSE: يمرّر إجابة النموذج للتلميذ فوراً دون أي تأخير، وعند انتهائها يشغّل التحقق
 * ويُلحق حكمه ككتلة <verification> قبل [DONE]. أي عطل في التحقق لا يمسّ الإجابة.
 */
import { encodeVerification, type Verdict } from "../../lib/verification";
import { verifyAnswer, type VerifyContext } from "./pipeline";

export interface WithVerificationOptions {
  headers: HeadersInit;
  context: Omit<VerifyContext, "answer" | "finishReason" | "onProgress">;
  /** للاختبار */
  verify?: (ctx: VerifyContext) => Promise<Verdict>;
}

export function withVerification(upstream: Response, opts: WithVerificationOptions): Response {
  if (!upstream.body || opts.context.level === "off") return new Response(upstream.body, { status: upstream.status, headers: opts.headers });

  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const reader = upstream.body.getReader();
  const abort = new AbortController();
  const verify = opts.verify ?? verifyAnswer;
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let answer = "";
      let finishReason: string | null = null;
      const send = (s: string) => { if (closed) return; try { controller.enqueue(enc.encode(s)); } catch { closed = true; } };
      const emitVerdict = (v: Verdict) => send(`data: ${JSON.stringify({ choices: [{ delta: { content: encodeVerification(v) } }] })}\n\n`);
      const close = () => { if (closed) return; closed = true; clearInterval(heartbeat); try { controller.close(); } catch { /* مغلق */ } };

      /** يعالج حدثاً واحداً؛ يعيد true إن كان [DONE] (نحجبه لنُلحق الحكم قبله). */
      const handle = (evt: string): boolean => {
        const data = evt.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).replace(/^ /, "")).join("\n");
        if (!data) { send(`${evt}\n\n`); return false; } // تعليق/نبضة من المزوّد
        if (data.trim() === "[DONE]") return true;
        try {
          const ch = JSON.parse(data)?.choices?.[0];
          const c = ch?.delta?.content;
          if (typeof c === "string") answer += c;
          else if (Array.isArray(c)) for (const p of c) if (typeof p?.text === "string") answer += p.text;
          if (ch?.finish_reason) finishReason = ch.finish_reason;
        } catch { /* حدث ناقص: يُمرَّر كما هو */ }
        send(`${evt}\n\n`);
        return false;
      };

      try {
        let buf = "";
        let sawDone = false;
        while (!sawDone) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let m: RegExpExecArray | null;
          while (!sawDone && (m = /\r?\n\r?\n/.exec(buf))) {
            const evt = buf.slice(0, m.index);
            buf = buf.slice(m.index + m[0].length);
            if (evt && handle(evt)) sawDone = true;
          }
        }
        buf += dec.decode();
        if (!sawDone && buf.trim()) handle(buf.trim());
        if (sawDone) await reader.cancel().catch(() => {});
      } catch (e) {
        if (!abort.signal.aborted) console.error("verify stream read error", e);
        close();
        return;
      }

      // الإجابة وصلت كاملة للتلميذ. نتحقق الآن (إن وُجد نص) ثم نُنهي البث.
      if (!closed && answer.trim()) {
        heartbeat = setInterval(() => send(": keep-alive\n\n"), 8000);
        try {
          const verdict = await verify({ ...opts.context, answer, finishReason, signal: abort.signal, onProgress: emitVerdict });
          if (!abort.signal.aborted) emitVerdict(verdict);
        } catch (e) {
          if (!abort.signal.aborted) console.error("verification failed", e);
        }
      }
      send("data: [DONE]\n\n");
      close();
    },
    cancel() {
      abort.abort(new Error("Client cancelled stream"));
      clearInterval(heartbeat);
      reader.cancel().catch(() => {});
    },
  });

  return new Response(body, { status: upstream.status, headers: opts.headers });
}
