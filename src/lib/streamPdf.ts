import { getDeviceId, getUnlockCode } from "./streamChat";
import { markLovableCreditsInsufficient } from "@/lib/panachePreflight";

const PDF_URL = "/api/solve-pdf";

export async function streamPdfAnalysis({
  pageImages, subject, modelMode, pageNumbers, onDelta, onDone, onError, signal,
}: {
  pageImages: string[];
  subject: string;
  modelMode: string;
  pageNumbers?: number[];
  onDelta: (text: string) => void;
  onDone: () => void;
  onError: (error: string) => void;
  signal?: AbortSignal;
}) {
  let pending = "";
  let raf = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let settled = false;
  const clearScheduled = () => {
    if (raf) cancelAnimationFrame(raf);
    if (timer) clearTimeout(timer);
    raf = 0;
    timer = undefined;
  };
  const flush = () => {
    clearScheduled();
    if (signal?.aborted) { pending = ""; return; }
    if (pending) {
      const chunk = pending;
      pending = "";
      onDelta(chunk);
    }
  };
  const push = (chunk: string) => {
    if (!chunk || signal?.aborted) return;
    pending += chunk;
    if (!raf) {
      raf = requestAnimationFrame(flush);
      timer = setTimeout(flush, 50);
    }
  };
  const finish = () => {
    if (settled) return;
    settled = true;
    if (signal?.aborted) pending = "";
    else flush();
    clearScheduled();
    onDone();
  };
  const parseEvent = (data: string) => {
    if (data === "[DONE]") return true;
    try {
      const payload = JSON.parse(data);
      const content = payload.choices?.[0]?.delta?.content;
      if (typeof content === "string") push(content);
      else if (Array.isArray(content)) {
        for (const part of content) if (typeof part?.text === "string") push(part.text);
      }
    } catch {
      // Ignore malformed events; never expose raw protocol data in the answer.
    }
    return false;
  };

  try {
    if (signal?.aborted) { finish(); return; }
    const resp = await fetch(PDF_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pageImages, subject, modelMode, pageNumbers,
        deviceId: getDeviceId(), unlockCode: getUnlockCode(),
      }),
      signal,
    });
    if (signal?.aborted) { finish(); return; }
    if (resp.status === 429) { onError("تم تجاوز حد الطلبات. حاول مرة أخرى بعد قليل."); return; }
    if (resp.status === 402) {
      if (modelMode === "panache") markLovableCreditsInsufficient();
      onError("تعذر تنفيذ الطلب: رصيد مزود AI غير كافٍ (402). لم يتم تحليل الملف.");
      return;
    }
    if (!resp.ok || !resp.body) { onError("حدث خطأ في الاتصال بالخادم."); return; }

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
      if (line.startsWith(":")) return;
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
    if (!signal?.aborted) {
      buffer += decoder.decode();
      if (buffer) processLine(buffer);
      dispatchEvent();
      if (!finished && dataLines.length) dispatchEvent();
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
    clearScheduled();
    pending = "";
    console.error("PDF stream error:", e);
    onError("حدث خطأ غير متوقع. حاول مرة أخرى.");
  }
}
