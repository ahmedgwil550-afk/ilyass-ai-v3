import { answerIndicatesUnreadable } from "./ocrFallback";
import { splitThinking } from "./thinking";

/**
 * A reply that really means "I cannot read this image" is short. A full
 * solution that only mentions one unclear detail is long, and so is one that
 * carries a verification note such as "try a clearer picture". Such an answer
 * has already been paid for and must never be thrown away for a retry.
 */
export const MAX_UNREADABLE_REPLY_CHARS = 700;

/** The answer the student sees: no thinking block and no verification block. */
export function visibleAnswer(raw: string): string {
  return splitThinking(raw).answer.trim();
}

export function hasVisibleAnswer(raw: string): boolean {
  return visibleAnswer(raw).length > 0;
}

export interface OcrRetryInput {
  /** Everything streamed so far, including the thinking and verification blocks. */
  rawAnswer: string;
  hasImages: boolean;
  /** True when this stream is already the OCR retry. */
  alreadyRetried: boolean;
  modelMode?: string;
}

/**
 * Decides whether to discard the answer and run the whole request again with
 * OCR text. Only a short reply that says the photo cannot be read qualifies,
 * and never in Pananachi: it already reads the photo in its own vision stage,
 * and a second run repeats every paid stage.
 */
export function shouldRetryWithOcr({ rawAnswer, hasImages, alreadyRetried, modelMode }: OcrRetryInput): boolean {
  if (alreadyRetried || !hasImages) return false;
  if (modelMode === "panache") return false;
  const answer = visibleAnswer(rawAnswer);
  if (!answer || answer.length > MAX_UNREADABLE_REPLY_CHARS) return false;
  return answerIndicatesUnreadable(answer);
}

/**
 * The raw text to leave on screen when a stream ends badly. The text that
 * arrived wins; the answer from before a retry is the fallback; an empty
 * string means there is nothing worth keeping.
 */
export function pickAnswerToKeep(current: string, previous: string): string {
  if (hasVisibleAnswer(current)) return current;
  if (hasVisibleAnswer(previous)) return previous;
  return "";
}
