/** Decide whether the transcription needs a student check before solving. */
export function needsImageReview(text: string): boolean {
  if (!text.trim()) return true;
  return (
    /\[\s*\?\s*\]/.test(text) ||
    /READABILITY\s*:\s*(?:partial|poor)\b/i.test(text) ||
    /FIGURE_MISSING\s*:/i.test(text) ||
    /(?:not clearly legible|cannot be read|illegible)/i.test(text) ||
    /(?:confidence|confiance)\s*[:=-]\s*(?:low|faible|uncertain)/i.test(text)
  );
}
