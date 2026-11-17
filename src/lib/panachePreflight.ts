const CREDIT_BLOCK_KEY = "ilyass-panache-lovable-credit-blocked-until";
const CREDIT_BLOCK_MS = 10 * 60 * 1000;

export interface PanacheEstimate {
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedTotalTokens: number;
  imageCount: number;
  stages: string[];
  confidence: "rough";
}

/**
 * Ultra-light local estimate: bounded arithmetic only.
 * No AI calls, tokenizers, OCR, image decoding, regex scans, or network requests.
 * Runtime is effectively constant because image processing is capped at 30 items.
 */
export function estimatePanacheUsage(
  text: string,
  imageCount = 0,
  imagePayloadSizes: number[] = [],
): PanacheEstimate {
  const images = Math.max(0, Math.min(30, Math.floor(imageCount || 0)));
  const chars = Math.min(Math.max(0, text?.length || 0), 120_000);
  const textTokens = Math.ceil(chars / 4);
  let imageTokens = 0;

  // Only inspect a bounded list of already-available base64 string lengths.
  for (let i = 0; i < images; i++) {
    const encodedChars = Math.max(0, imagePayloadSizes[i] || 0);
    const estimatedBytes = encodedChars ? encodedChars * 0.75 : 528_000;
    imageTokens += Math.min(16_000, Math.max(2_200, Math.ceil(estimatedBytes / 180)));
  }

  // Fixed-cost heuristic for the multi-stage Pananachi pipeline.
  const writer = chars >= 1_200 || images >= 2;
  const independent = chars >= 500 || images > 0;
  const stages = [
    ...(images ? ["vision"] : []),
    "solver",
    ...(writer ? ["writer"] : []),
    ...(independent ? ["independent-review", "final-review"] : ["possible-final-review"]),
  ];

  const contextTokens = 1_800 + textTokens + imageTokens;
  const baseOutput = Math.min(7_000, Math.max(1_000, 1_400 + textTokens * 0.35 + images * 450));
  const inputTokens =
    contextTokens +
    (images ? 2_600 + imageTokens : 0) +
    (writer ? 1_200 + Math.ceil(textTokens * 1.5) : 0) +
    (independent ? 900 + textTokens + imageTokens + contextTokens : 0);
  const outputTokens =
    baseOutput +
    (images ? 1_200 : 0) +
    (writer ? Math.ceil(baseOutput * 0.6) : 0) +
    (independent ? Math.ceil(baseOutput * 1.5) : 0);

  // Reserve a safety margin for the possible image OCR fallback.
  const safetyFactor = images ? 1.35 : 1.15;
  const estimatedInputTokens = Math.ceil(inputTokens * safetyFactor);
  const estimatedOutputTokens = Math.ceil(outputTokens * safetyFactor);
  if (images) stages.push("possible-OCR-retry");

  return {
    estimatedInputTokens,
    estimatedOutputTokens,
    estimatedTotalTokens: estimatedInputTokens + estimatedOutputTokens,
    imageCount: images,
    stages,
    confidence: "rough",
  };
}

export function markLovableCreditsInsufficient(): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(CREDIT_BLOCK_KEY, String(Date.now() + CREDIT_BLOCK_MS));
  } catch { /* storage may be unavailable in private or restricted contexts */ }
}

export function getLovableCreditBlockRemaining(): number {
  try {
    if (typeof localStorage === "undefined") return 0;
    const until = Number(localStorage.getItem(CREDIT_BLOCK_KEY) || 0);
    if (!Number.isFinite(until) || until <= Date.now()) {
      localStorage.removeItem(CREDIT_BLOCK_KEY);
      return 0;
    }
    return until - Date.now();
  } catch {
    return 0;
  }
}
