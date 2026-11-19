import { getAiConfig } from "../ai-provider";

export type VisionFailure = "no_provider" | "credits" | "upstream" | "empty" | "aborted";

export type VisionOutcome =
  | { ok: true; text: string; model: string }
  | { ok: false; reason: VisionFailure; status?: number };

export interface VisionOptions {
  system: string;
  userText: string;
  /** data URL أو base64 خام */
  image: string;
  maxTokens: number;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** للاختبار */
  fetchImpl?: typeof fetch;
  config?: { chatUrl: string; key: string; model: string };
}

/**
 * استدعاء رؤية واحد مشترك بين مراحل نظام الشكل (تحديد/تخطيط/إعادة رسم).
 * لا يرمي أبداً: كل فشل يعود كسبب واضح، والمستدعي هو من يقرر الاحتياط.
 */
export async function callVision(options: VisionOptions): Promise<VisionOutcome> {
  const cfg = options.config
    ? options.config
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
  const isGpt = cfg.model.startsWith("gpt-") || cfg.model.startsWith("openai/gpt-");

  try {
    const res = await doFetch(cfg.chatUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.key}`, "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        model: cfg.model,
        // نماذج gpt-* ترفض temperature غير الافتراضي وتستعمل max_completion_tokens
        ...(isGpt ? { max_completion_tokens: options.maxTokens } : { temperature: 0, max_tokens: options.maxTokens }),
        stream: false,
        messages: [
          { role: "system", content: options.system },
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url } },
              { type: "text", text: options.userText },
            ],
          },
        ],
      }),
    });
    if (!res.ok) {
      if (res.status === 402) return { ok: false, reason: "credits", status: 402 };
      console.error("diagram upstream status", res.status);
      return { ok: false, reason: "upstream", status: res.status };
    }
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: unknown } }> };
    const content = data?.choices?.[0]?.message?.content;
    const text = typeof content === "string" ? content.trim() : "";
    if (!text) return { ok: false, reason: "empty" };
    return { ok: true, text, model: cfg.model };
  } catch (e) {
    if (options.signal?.aborted) return { ok: false, reason: "aborted" };
    console.error("diagram vision failed:", e);
    return { ok: false, reason: "upstream" };
  }
}
