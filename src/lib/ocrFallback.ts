// Lazy OCR fallback using tesseract.js.
// Only loaded on demand to avoid bundle bloat.
// Used as a *fallback* when the AI model fails to read an image.

let workerPromise: Promise<any> | null = null;

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import("tesseract.js");
      // ara + fra + eng covers Moroccan high-school exams
      const worker = await createWorker(["ara", "fra", "eng"]);
      return worker;
    })();
  }
  return workerPromise;
}

// One Arabic letter (with its diacritics, if any)
const SINGLE_ARABIC_LETTER = /^[ء-يٱ-ۓ][ً-ٰٟ]*$/;

/**
 * Repairs the letter-spacing artefact OCR sometimes produces ("ا ل ك ت ا ب" -> "الكتاب").
 * Only runs of 3+ isolated letters are joined, so normal word spaces are never removed.
 */
export function joinSpacedArabicLetters(line: string): string {
  const tokens = line.split(" ");
  const out: string[] = [];
  let run: string[] = [];
  const flush = () => {
    if (run.length >= 3) out.push(run.join(""));
    else out.push(...run);
    run = [];
  };
  for (const token of tokens) {
    if (SINGLE_ARABIC_LETTER.test(token)) run.push(token);
    else {
      flush();
      out.push(token);
    }
  }
  flush();
  return out.join(" ");
}

export function cleanOcrText(text: string): string {
  if (!text) return "";
  return text
    // Normalise whitespace
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    // Common OCR noise — stray pipes, isolated punctuation lines
    .replace(/^\s*[|·•~`]+\s*$/gm, "")
    // Strip lines that are only symbols
    .replace(/^\s*[^A-Za-z0-9\u0600-\u06FF\u00C0-\u017F]{1,3}\s*$/gm, "")
    // Fix Arabic letter spacing artefacts: "ا ل ك ت ا ب" -> "الكتاب"
    // (only runs of 3+ isolated letters are merged; normal word spaces are kept)
    .split("\n")
    .map(joinSpacedArabicLetters)
    .join("\n")
    .trim();
}

export interface OcrResult {
  text: string;
  confidence: number;
}

/**
 * Run OCR on a base64 image (without data: prefix) with one retry on failure.
 * Returns cleaned text + average confidence (0-100).
 */
export async function ocrImage(base64: string): Promise<OcrResult> {
  const dataUrl = base64.startsWith("data:") ? base64 : `data:image/jpeg;base64,${base64}`;
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const worker = await getWorker();
      const { data } = await worker.recognize(dataUrl);
      const cleaned = cleanOcrText(data.text || "");
      return { text: cleaned, confidence: data.confidence || 0 };
    } catch (e) {
      lastErr = e;
      // Reset worker on failure so next attempt re-initialises
      workerPromise = null;
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  console.error("OCR failed:", lastErr);
  return { text: "", confidence: 0 };
}

export async function ocrImages(base64s: string[]): Promise<string> {
  if (!base64s.length) return "";
  const results = await Promise.all(base64s.map((b) => ocrImage(b)));
  return results
    .map((r, i) => (r.text ? `--- صورة ${i + 1} (OCR) ---\n${r.text}` : ""))
    .filter(Boolean)
    .join("\n\n");
}

/** Heuristic: detect whether the model said it can't read the image. */
export function answerIndicatesUnreadable(answer: string): boolean {
  if (!answer) return false;
  const a = answer.toLowerCase();
  const markers = [
    "غير واضحة",
    "غير واضح",
    "لا أستطيع قراءة",
    "لا يمكنني قراءة",
    "لا يمكنني رؤية",
    "صورة أوضح",
    "صورة واضحة",
    "image unclear",
    "image is unclear",
    "cannot read the image",
    "can't read the image",
    "unable to read",
    "image illisible",
    "image floue",
    "je ne peux pas lire",
  ];
  return markers.some((m) => a.includes(m.toLowerCase()));
}
