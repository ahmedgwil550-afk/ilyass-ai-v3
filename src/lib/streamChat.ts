import { stripThinking } from "@/lib/thinking";
import { markLovableCreditsInsufficient } from "@/lib/panachePreflight";
import { accountClient } from "@/lib/account-client";
export type Msg = { role: "user" | "assistant"; content: string; imageBase64?: string; imageBase64s?: string[] };

const CHAT_URL = "/api/solve";

export type ModelMode = "fast" | "accurate" | "advanced" | "panache";
export type ResponseLength = "short" | "medium" | "detailed";

export function getDeviceId(): string {
  let id = localStorage.getItem("ilyass-device-id");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("ilyass-device-id", id);
  }
  return id;
}

export function getUnlockCode(): string | null {
  return localStorage.getItem("ilyass-unlock-code");
}
export function isUnlimited(): boolean {
  return Boolean(getUnlockCode()) && localStorage.getItem("ilyass-unlocked") === "1";
}

export async function streamChat({
  messages, subject, imageBase64, modelMode = "fast", responseLength = "medium",
  examMode = false, imageTranscript, onDelta, onDone, onError, signal,
}: {
  messages: Msg[];
  subject: string;
  imageBase64?: string;
  modelMode?: ModelMode;
  responseLength?: ResponseLength;
  examMode?: boolean;
  imageTranscript?: string;
  onDelta: (text: string) => void;
  onDone: () => void;
  onError: (error: string) => void;
  signal?: AbortSignal;
}) {
  // Typewriter buffer: tokens arrive in bursts, but we reveal them at an adaptive pace
  // (~30 renders/s) that follows the stream's own speed. A big backlog drains fast, a
  // trickle shows almost immediately, and each render stays cheap enough for KaTeX.
  const TICK_MS = 32;
  let pending = "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  let settled = false;   // network side finished (or aborted)
  let ending = false;    // drain the remaining buffer, then call onDone
  let completed = false;
  let requestFailed = false;
  let failureMessage = "";

  const clearScheduled = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
  };
  const complete = () => {
    if (completed) return;
    completed = true;
    clearScheduled();
    onDone();
  };
  const tick = () => {
    timer = undefined;
    // On stop, queued characters are discarded so nothing appears after Stop.
    if (signal?.aborted) { pending = ""; if (ending) complete(); return; }
    if (pending) {
      const backlog = pending.length;
      let n = Math.max(3, Math.ceil(backlog * (ending ? 0.35 : 0.12)));
      if (typeof document !== "undefined" && document.hidden) n = backlog; // timers are throttled in background tabs
      n = Math.min(n, backlog);
      const last = pending.charCodeAt(n - 1);
      if (last >= 0xd800 && last <= 0xdbff && n < backlog) n++; // never split an emoji / surrogate pair
      const text = pending.slice(0, n);
      pending = pending.slice(n);
      onDelta(text);
    }
    if (pending) timer = setTimeout(tick, TICK_MS);
    else if (ending) complete();
  };
  const push = (text: string) => {
    if (!text || signal?.aborted) return;
    pending += text;
    if (!timer) timer = setTimeout(tick, TICK_MS);
  };
  const finish = () => {
    if (settled) return;
    settled = true;
    if (signal?.aborted) { pending = ""; complete(); return; }
    ending = true;
    clearScheduled();
    tick();
  };
  /**
   * Text that already arrived is never dropped: the part still waiting in the
   * typewriter buffer is shown first, so the caller can keep everything it was
   * sent when it learns that the stream failed.
   */
  const flushPending = () => {
    clearScheduled();
    if (pending && !signal?.aborted) {
      const rest = pending;
      pending = "";
      onDelta(rest);
    }
    pending = "";
  };
  const reportFailure = (): boolean => {
    if (!requestFailed) return false;
    flushPending();
    onError(failureMessage);
    return true;
  };
  const parseEvent = (data: string) => {
    if (data === "[DONE]") return true;
    try {
      const payload = JSON.parse(data);
      if (payload?.error?.code === "INSUFFICIENT_CREDITS") {
        requestFailed = true;
        failureMessage = payload.error.message || "تعذر تنفيذ الطلب: رصيد Lovable AI غير كافٍ. لم تُستكمل مراحل Pananachi.";
        markLovableCreditsInsufficient();
        return true;
      }
      const content = payload.choices?.[0]?.delta?.content;
      if (typeof content === "string") push(content);
      // Some compatible providers return content as an array of text parts.
      else if (Array.isArray(content)) {
        for (const part of content) if (typeof part?.text === "string") push(part.text);
      }
    } catch {
      // Ignore malformed/incomplete SSE events; never append raw JSON to the answer.
    }
    return false;
  };

  try {
    if (signal?.aborted) { finish(); return; }
    const { data: sessionData } = await accountClient.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    const resp = await fetch(CHAT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(accessToken ? { Authorization: "Bearer " + accessToken } : {}),
      },
      body: JSON.stringify({
        messages: messages.map((m) => m.role === "assistant" ? { ...m, content: stripThinking(m.content) } : m),
        subject, imageBase64, modelMode, responseLength, examMode, imageTranscript,
        deviceId: getDeviceId(), unlockCode: getUnlockCode(),
      }),
      signal,
    });

    if (signal?.aborted) { finish(); return; }
    if (resp.status === 429) {
      try {
        const data = await resp.json();
        if (data.error === "daily_limit_reached") {
          onError(data.message || "⚠️ لقد استهلكت جميع محاولاتك اليوم (3/3).\nيرجى العودة غدًا أو الترقية للحصول على استخدام غير محدود.");
          return;
        }
      } catch {}
      onError("تم تجاوز حد الطلبات. حاول مرة أخرى بعد قليل.");
      return;
    }
    if (resp.status === 402) {
      if (modelMode === "panache") markLovableCreditsInsufficient();
      onError("تعذر تنفيذ الطلب: رصيد مزود AI غير كافٍ (402). لم يتم استكمال الطلب.");
      return;
    }
    if (!resp.ok || !resp.body) {
      let extra = "";
      try {
        const d = await resp.json();
        // رسائل الخادم الجاهزة بالعربية (مثل خدمة حدّ الاستعمال) تُعرض كما هي بدل نص إنجليزي تقني
        if (resp.status === 503 && typeof d.message === "string" && d.message) { onError(d.message); return; }
        extra = [d.error, d.upstreamStatus && `(${d.upstreamStatus})`, d.model, d.detail].filter(Boolean).join(" ");
      } catch {}
      onError("حدث خطأ في الاتصال بالخادم." + (extra ? `\n[${extra}]` : ""));
      return;
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let dataLines: string[] = [];
    let finished = false;

    const dispatchEvent = () => {
      if (!dataLines.length) return;
      const data = dataLines.join("\n");
      dataLines = [];
      if (parseEvent(data)) finished = true;
    };
    const processLine = (line: string) => {
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (line === "") { dispatchEvent(); return; }
      if (line.startsWith(":")) return; // SSE comment / heartbeat
      if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
    };

    while (!finished && !signal?.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline: number;
      while (!finished && (newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        processLine(line);
      }
    }

    if (reportFailure()) return;
    if (!signal?.aborted) {
      buffer += decoder.decode();
      if (buffer) processLine(buffer);
      dispatchEvent();
      if (!finished && dataLines.length) dispatchEvent();
      if (reportFailure()) return;
    } else {
      pending = "";
      clearScheduled();
      await reader.cancel().catch(() => {});
    }
    finish();
  } catch (e: any) {
    if (e?.name === "AbortError" || signal?.aborted) {
      pending = "";
      clearScheduled();
      finish();
      return;
    }
    flushPending();
    console.error("Stream error:", e);
    onError("حدث خطأ غير متوقع. حاول مرة أخرى.");
  }
}
