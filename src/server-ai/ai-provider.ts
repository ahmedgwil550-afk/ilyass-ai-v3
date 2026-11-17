/**
 * مزوّد الذكاء الاصطناعي — إعدادات من متغيرات البيئة (على السيرفر فقط).
 *
 *  AI_API_KEY          مفتاح المزوّد (سر — لا يوضع في الواجهة أبداً)
 *  AI_BASE_URL         اختياري. الافتراضي: واجهة Gemini المتوافقة مع OpenAI
 *  AI_MODEL_FAST       اختياري (الافتراضي gemini-2.5-flash)
 *  AI_MODEL_ACCURATE   اختياري (الافتراضي gemini-2.5-pro)
 *  AI_MODEL_ADVANCED   اختياري (الافتراضي gemini-2.5-pro)
 *  OPENAI_API_KEY      اختياري. إن وُجد يعمل وضع "Avancé" عبر ChatGPT (OpenAI)
 *  OPENAI_MODEL        اختياري (الافتراضي gpt-5)
 *
 * توافق خلفي: إن لم يوجد AI_API_KEY ووُجد LOVABLE_API_KEY، يُستعمل Lovable AI Gateway كما كان.
 * أسماء النماذج تتغير مع الوقت — تأكد منها في لوحة المزوّد إن ظهر خطأ "model not found".
 */
export type Tier = "fast" | "accurate" | "advanced";

export interface AiConfig {
  chatUrl: string;
  key: string;
  provider: "custom" | "lovable";
  model: (tier: Tier) => string;
}

const GEMINI_CHAT = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const LOVABLE_CHAT = "https://ai.gateway.lovable.dev/v1/chat/completions";

const OPENAI_CHAT = "https://api.openai.com/v1/chat/completions";

export function getAiConfig(tier?: Tier): AiConfig | null {
  // وضع "Avancé" عبر ChatGPT (OpenAI) إن وُجد OPENAI_API_KEY؛ بقية الأوضاع تبقى على Gemini
  const openai = process.env["OPENAI_API_KEY"];
  if (openai && tier === "advanced") {
    const model = process.env["OPENAI_MODEL"] || "gpt-5";
    return { chatUrl: OPENAI_CHAT, key: openai, provider: "custom", model: () => model };
  }
  const own = process.env["AI_API_KEY"];
  if (own) {
    const base = process.env["AI_BASE_URL"]?.replace(/\/+$/, "");
    const chatUrl = base ? (base.endsWith("/chat/completions") ? base : `${base}/chat/completions`) : GEMINI_CHAT;
    const m = {
      fast: process.env["AI_MODEL_FAST"] || "gemini-2.5-flash",
      accurate: process.env["AI_MODEL_ACCURATE"] || "gemini-2.5-pro",
      advanced: process.env["AI_MODEL_ADVANCED"] || "gemini-2.5-pro",
    };
    return { chatUrl, key: own, provider: "custom", model: (t) => m[t] };
  }
  const lov = process.env["LOVABLE_API_KEY"];
  if (lov) {
    const m = { fast: "google/gemini-3.8-flash", accurate: "google/gemini-3.1-pro-preview", advanced: "openai/gpt-6-astra" };
    return { chatUrl: LOVABLE_CHAT, key: lov, provider: "lovable", model: (t) => m[t] };
  }
  return null;
}

export const tierOf = (modelMode: unknown): Tier =>
  modelMode === "advanced" || modelMode === "panache" ? "advanced" : modelMode === "accurate" ? "accurate" : "fast";
