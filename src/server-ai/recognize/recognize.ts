import { getAiConfig } from "../ai-provider";
import { buildRecognition, extractJson, type RecognitionResult } from "../../lib/recognition";
import { RECOGNIZE_PROMPT, recognizeUserText } from "./prompt";

export type RecognizeFailure = "no_provider" | "credits" | "upstream" | "bad_json" | "aborted";

export type RecognizeOutcome =
  | { ok: true; result: RecognitionResult; model: string }
  | { ok: false; reason: RecognizeFailure; status?: number };

export interface RecognizeOptions {
  /** data URL أو base64 خام */
  image: string;
  subject?: string;
  signal?: AbortSignal;
  /** للاختبار */
  fetchImpl?: typeof fetch;
  config?: { chatUrl: string; key: string; model: string };
  timeoutMs?: number;
}

/**
 * يطلب من نموذج الرؤية بنية الورقة، ثم يمرّرها على الفحوص بالكود (recognition.ts).
 * النموذج يقترح فقط؛ لا شيء مما يعيده يصل للواجهة دون تنظيف وفحص.
 * لا يرمي أبداً: كل فشل يعود كسبب واضح.
 */
export async function recognizeQuestions(options: RecognizeOptions): Promise<RecognizeOutcome> {
  const cfg = options.config
    ? { chatUrl: options.config.chatUrl, key: options.config.key, model: options.config.model }
    : (() => {
        const base = getAiConfig("accurate");
        return base ? { chatUrl: base.chatUrl, key: base.key, model: base.model("accurate") } : null;
      })();
  if (!cfg) return { ok: false, reason: "no_provider" };

  const doFetch = options.fetchImpl ?? fetch;
  const timeout = AbortSignal.timeout(options.timeoutMs ?? 55_000);
  const anySignal = (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }).any;
  const signal = options.signal && typeof anySignal === "function" ? anySignal([options.signal, timeout]) : options.signal || timeout;
  const url = options.image.startsWith("data:") ? options.image : `data:image/jpeg;base64,${options.image}`;

  try {
    const res = await doFetch(cfg.chatUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.key}`, "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0,
        max_tokens: 7000,
        stream: false,
        messages: [
          { role: "system", content: RECOGNIZE_PROMPT },
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url } },
              { type: "text", text: recognizeUserText(options.subject) },
            ],
          },
        ],
      }),
    });
    if (!res.ok) {
      if (res.status === 402) return { ok: false, reason: "credits", status: 402 };
      console.error("recognize upstream status", res.status);
      return { ok: false, reason: "upstream", status: res.status };
    }
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: unknown } }> };
    const content = data?.choices?.[0]?.message?.content;
    const text = typeof content === "string" ? content : "";
    const parsed = extractJson(text);
    if (!parsed) return { ok: false, reason: "bad_json" };
    return { ok: true, result: buildRecognition(parsed), model: cfg.model };
  } catch (e) {
    if (options.signal?.aborted) return { ok: false, reason: "aborted" };
    console.error("recognize failed:", e);
    return { ok: false, reason: "upstream" };
  }
}
