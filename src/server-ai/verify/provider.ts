/**
 * اختيار نموذج المحقِّق. المبدأ: الحل المستقل والمقارنة بنموذج من فئة مختلفة عن النموذج الذي أجاب،
 * لأن نموذجاً يراجع نفسه يكرّر الخطأ نفسه غالباً. استخراج الادعاءات مجرد نسخ فيكفيه نموذج "accurate".
 * إعادة قراءة الصورة (reread) بنموذج advanced دائماً لأن القراءة الأولى تتم بـ accurate. مطابقة المنهج (method) مع الحَكَم.
 * VERIFY_MODEL (اختياري) يفرض اسم نموذج واحداً لكل المراحل على المزوّد المختار.
 */
import { getAiConfig, type AiConfig, type Tier } from "../ai-provider";
import { makeChatLlm, type LlmFn } from "./llm";

export function makeVerifierLlm(answerTier: Tier): LlmFn | null {
  const override = process.env["VERIFY_MODEL"] || undefined;
  const extractCfg = getAiConfig("accurate");
  const judgeTier: Tier = answerTier === "advanced" ? "accurate" : "advanced";
  const judgeCfg = getAiConfig(judgeTier) ?? extractCfg;
  if (!extractCfg && !judgeCfg) return null;
  const build = (cfg: AiConfig, tier: Tier): LlmFn =>
    makeChatLlm({ chatUrl: cfg.chatUrl, key: cfg.key, model: () => override || cfg.model(tier) });
  const ext = extractCfg ? build(extractCfg, "accurate") : null;
  const jdg = judgeCfg ? build(judgeCfg, judgeTier) : null;
  // إعادة قراءة الصورة: القراءة الأولى تجري دائماً بنموذج accurate (read-image.ts)، فنعيدها بنموذج advanced ليكون القارئ الثاني مختلفاً
  const advCfg = getAiConfig("advanced");
  const reread = advCfg ? build(advCfg, "advanced") : null;
  return (req) => (req.role === "extract" ? (ext ?? jdg)! : req.role === "reread" ? (reread ?? jdg ?? ext)! : (jdg ?? ext)!)(req);
}
