import { getDeviceId, getUnlockCode, type ModelMode } from "./streamChat";

const URL_ENDPOINT = "/api/solve-geometry";

export type GeoMsg = { role: "user" | "assistant"; content: string; imageBase64s?: string[] };

export async function streamGeometry({
  messages,
  modelMode = "accurate",
  signal,
  onDelta,
  onDone,
  onError,
}: {
  messages: GeoMsg[];
  modelMode?: ModelMode;
  signal?: AbortSignal;
  onDelta: (chunk: string) => void;
  onDone: () => void;
  onError: (msg: string) => void;
}) {
  try {
    const resp = await fetch(URL_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ messages, modelMode, deviceId: getDeviceId(), unlockCode: getUnlockCode() }),
      signal,
    });

    if (resp.status === 429) {
      try {
        const data = await resp.json();
        if (data.error === "daily_limit_reached") return onError(data.message);
      } catch {}
      return onError("تم تجاوز حد الطلبات. حاول لاحقاً.");
    }
    if (resp.status === 402) return onError("انتهت الرصيد. يرجى إضافة رصيد.");
    if (!resp.ok || !resp.body) return onError("خطأ في الاتصال بالخادم.");

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let done = false;
    while (!done) {
      const { done: rd, value } = await reader.read();
      if (rd) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n")) !== -1) {
        let line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (!line.startsWith("data: ")) continue;
        const json = line.slice(6).trim();
        if (json === "[DONE]") { done = true; break; }
        try {
          const parsed = JSON.parse(json);
          const c = parsed.choices?.[0]?.delta?.content;
          if (c) onDelta(c);
        } catch {
          buf = line + "\n" + buf;
          break;
        }
      }
    }
    onDone();
  } catch (e: any) {
    if (e?.name === "AbortError") return onDone();
    console.error(e);
    onError("حدث خطأ غير متوقع.");
  }
}
