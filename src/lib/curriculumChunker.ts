/**
 * Turns text extracted from an official PDF into passages for the curriculum search.
 *
 * Pure and dependency-free so it can run in the app, in tests, and from the ingestion
 * script (which imports it with an explicit .ts extension under Node).
 *
 * Nothing here decides whether a document is trustworthy. It only prepares text; a person
 * still has to compare it with the original official document before marking it verified.
 */

export interface ChunkMetadata {
  /** 1-based page where the passage starts. */
  page: number;
  /** Last page the passage touches, when it spans more than one. */
  pageEnd?: number;
  /** Nearest section or exercise title above the passage. */
  heading?: string;
}

export interface ChunkDraft {
  content: string;
  metadata: ChunkMetadata;
}

export interface ChunkOptions {
  /** Close a passage once it reaches this many characters. */
  targetChars?: number;
  /** Hard ceiling; the answer prompt only shows the first 2,400 characters of a passage. */
  maxChars?: number;
  /** The database refuses passages shorter than this. */
  minChars?: number;
}

export interface ChunkResult {
  chunks: ChunkDraft[];
  pages: number;
  /** Header/footer lines that repeated on many pages and were removed (for the review report). */
  removedLines: string[];
  /** Fragments too short to keep that could not be merged into a neighbour. */
  droppedFragments: string[];
}

const DEFAULTS = { targetChars: 1400, maxChars: 2200, minChars: 20 };

const INVISIBLE_FORMAT_CHARS = /[\u0000\u00AD\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;
const COMPATIBILITY_FORMS = /[\uFB00-\uFB06\uFB50-\uFDFF\uFE70-\uFEFE]/g;

/**
 * Light cleanup of raw PDF text. Arabic presentation forms and Latin ligatures are folded to
 * ordinary letters, which fixes words that PDF extraction leaves in shaped glyph form. Full
 * NFKC is deliberately not applied: it would turn ℝ into R and x² into x2, changing the maths.
 */
export function cleanExtractedText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(COMPATIBILITY_FORMS, (char) => char.normalize("NFKC"))
    .replace(INVISIBLE_FORMAT_CHARS, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/(\p{L})-\n(\p{Ll})/gu, "$1$2");
}

/** pdftotext separates pages with a form feed. */
export function splitPages(text: string): string[] {
  const pages = text.split("\f");
  while (pages.length > 1 && pages[pages.length - 1].trim() === "") pages.pop();
  return pages;
}

const REPEAT_MIN_PAGES = 4;
const REPEAT_SHARE = 0.4;
const REPEAT_MAX_LINE = 90;

// "12", "Page 3 / 6", "الصفحة 2 من 5": page counters, whose digits change on every page.
const PAGE_NUMBER_LINE =
  /^[\s\-–—.()[\]]*(?:page|p|صفحة|الصفحة|ص)?[\s.:]*#(?:\s*(?:\/|sur|من|of|-|–)\s*#)?[\s\-–—.()[\]]*$/iu;

/**
 * Lines are compared exactly, except page counters, which are compared with their digits masked.
 * Digits stay significant everywhere else so that "Exercice 1", "Exercice 2" are never treated
 * as one repeating header.
 */
function repeatKey(line: string): string {
  const spaced = line.trim().replace(/\s+/g, " ");
  const masked = spaced.replace(/[0-9٠-٩۰-۹]+/g, "#");
  return PAGE_NUMBER_LINE.test(masked) ? masked : spaced;
}

/**
 * Drops headers, footers and page numbers: short lines that show up unchanged (page counters:
 * apart from their digits) on at least 40% of the pages of a document with four or more pages.
 */
export function removeRepeatedLines(pages: string[]): { pages: string[]; removed: string[] } {
  if (pages.length < REPEAT_MIN_PAGES) return { pages, removed: [] };
  const counts = new Map<string, number>();
  for (const page of pages) {
    const keys = new Set(
      page
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line && line.length <= REPEAT_MAX_LINE)
        .map(repeatKey),
    );
    for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const threshold = Math.max(REPEAT_MIN_PAGES - 1, Math.ceil(pages.length * REPEAT_SHARE));
  const repeated = new Set(
    [...counts].filter(([, count]) => count >= threshold).map(([key]) => key),
  );
  if (!repeated.size) return { pages, removed: [] };

  const removed = new Set<string>();
  const cleaned = pages.map((page) =>
    page
      .split("\n")
      .filter((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.length > REPEAT_MAX_LINE) return true;
        const key = repeatKey(trimmed);
        if (!repeated.has(key)) return true;
        removed.add(key);
        return false;
      })
      .join("\n"),
  );
  return { pages: cleaned, removed: [...removed] };
}

// Section starts, written without the Arabic article and accents (matched on folded text).
// Strong titles (an exercise, a chapter, the correction) always start a new passage. Weak titles
// (a part of an exercise, a marking-scheme heading) start one only when the passage is already long,
// so "Partie A", "Partie B" and "سلم التنقيط" stay with the exercise they belong to.
const STRONG_HEADING =
  /^(?:درس|وحده|مجزوءه|تمرين|مساله|موضوع|عناصر الاجابه|exercices?|chapitre|unite|sequence|probleme|sujet|corrige|correction)(?=\s|[:.\d)-]|$)/;
const WEAK_HEADING =
  /^(?:محور|جزء|كفايات|توجيهات|سلم التنقيط|partie|competences?|bareme)(?=\s|[:.\d)-]|$)/;
const MAX_HEADING_LENGTH = 90;
/** A weak title splits the passage only once it has at least this many characters. */
const WEAK_SPLIT_MIN = 400;

function foldForHeading(line: string): string {
  return line
    .trim()
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/^ال(?=[\u0621-\u064A]{3})/, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036F]/g, "");
}

export function headingStrength(line: string): "strong" | "weak" | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > MAX_HEADING_LENGTH) return null;
  const folded = foldForHeading(trimmed);
  if (STRONG_HEADING.test(folded)) return "strong";
  return WEAK_HEADING.test(folded) ? "weak" : null;
}

export function isHeadingLine(line: string): boolean {
  return headingStrength(line) !== null;
}

/** Splits a very long paragraph at sentence ends, or at spaces when a sentence is itself too long. */
function splitLong(paragraph: string, maxChars: number): string[] {
  if (paragraph.length <= maxChars) return [paragraph];
  const sentences = paragraph.split(/(?<=[.!?؟…])\s+/u);
  const pieces: string[] = [];
  let current = "";
  const push = () => {
    if (current.trim()) pieces.push(current.trim());
    current = "";
  };
  for (let sentence of sentences) {
    while (sentence.length > maxChars) {
      const cut = sentence.lastIndexOf(" ", maxChars);
      const at = cut > maxChars / 2 ? cut : maxChars;
      if (current) push();
      pieces.push(sentence.slice(0, at).trim());
      sentence = sentence.slice(at).trim();
    }
    if (current && current.length + sentence.length + 1 > maxChars) push();
    current += (current ? " " : "") + sentence;
  }
  push();
  return pieces.filter(Boolean);
}

interface Paragraph {
  text: string;
  page: number;
}

function paragraphsOf(pages: string[]): Paragraph[] {
  const result: Paragraph[] = [];
  pages.forEach((page, index) => {
    for (const block of page.split(/\n\s*\n/)) {
      const text = block
        .split("\n")
        .map((line) => line.replace(/[ \t]{2,}/g, " ").trim())
        .filter(Boolean)
        .join("\n");
      if (text) result.push({ text, page: index + 1 });
    }
  });
  return result;
}

/** Packs paragraphs into passages, starting a new passage at each section or exercise title. */
export function chunkPages(pages: string[], options: ChunkOptions = {}): ChunkResult {
  const { targetChars, maxChars, minChars } = { ...DEFAULTS, ...options };
  const chunks: ChunkDraft[] = [];
  const droppedFragments: string[] = [];

  let parts: string[] = [];
  let length = 0;
  let startPage = 1;
  let endPage = 1;
  let startHeading: string | undefined;
  let activeHeading: string | undefined;

  const flush = () => {
    const content = parts.join("\n\n").trim();
    const metadata: ChunkMetadata = { page: startPage };
    if (endPage !== startPage) metadata.pageEnd = endPage;
    if (startHeading) metadata.heading = startHeading;
    parts = [];
    length = 0;
    if (!content) return;
    if (content.length >= minChars) {
      chunks.push({ content, metadata });
      return;
    }
    const previous = chunks[chunks.length - 1];
    if (previous && previous.content.length + content.length + 2 <= maxChars) {
      previous.content += "\n\n" + content;
      if (endPage !== previous.metadata.page) previous.metadata.pageEnd = endPage;
    } else {
      droppedFragments.push(content);
    }
  };

  const add = (text: string, page: number) => {
    if (!parts.length) {
      startPage = page;
      startHeading = activeHeading;
    }
    parts.push(text);
    length += text.length + 2;
    endPage = page;
  };

  for (const paragraph of paragraphsOf(pages)) {
    const firstLine = paragraph.text.split("\n")[0];
    const strength = headingStrength(firstLine);
    if (strength === "strong" || (strength === "weak" && length >= WEAK_SPLIT_MIN)) flush();
    if (strength) activeHeading = firstLine.trim().slice(0, 120);
    for (const piece of splitLong(paragraph.text, maxChars)) {
      if (length > 0 && length + piece.length + 2 > targetChars) flush();
      add(piece, paragraph.page);
    }
  }
  flush();

  return { chunks, pages: pages.length, removedLines: [], droppedFragments };
}

/** Full pipeline: raw extracted text in, passages out. */
export function chunkDocument(rawText: string, options: ChunkOptions = {}): ChunkResult {
  const pages = splitPages(cleanExtractedText(rawText));
  const stripped = removeRepeatedLines(pages);
  const result = chunkPages(stripped.pages, options);
  return { ...result, removedLines: stripped.removed };
}

export type ExtractionWarningCode =
  | "no-text"
  | "little-text"
  | "reversed-arabic"
  | "replacement-characters";

export interface ExtractionWarning {
  code: ExtractionWarningCode;
  message: string;
}

// Very frequent Arabic words and the same words with their letters in reverse order.
const ARABIC_FUNCTION_WORDS = ["في", "من", "على", "التي", "هذا", "أن", "إلى", "عن"];

function countWord(text: string, word: string): number {
  const pattern = new RegExp("(?:^|[^\u0621-\u064A])" + word + "(?=[^\u0621-\u064A]|$)", "gu");
  return text.match(pattern)?.length ?? 0;
}

/**
 * Warns when extracted text is probably unusable: a scanned PDF with no text layer, Arabic whose
 * letters come out in visual (reversed) order, or damaged characters.
 */
export function diagnoseExtractedText(
  rawText: string,
  pageCount = splitPages(rawText).length,
): ExtractionWarning[] {
  const warnings: ExtractionWarning[] = [];
  const text = cleanExtractedText(rawText);
  const letters = (text.match(/\p{L}/gu) ?? []).length;

  if (letters === 0) {
    warnings.push({
      code: "no-text",
      message: "No text was extracted. The PDF is probably scanned images and needs OCR first.",
    });
    return warnings;
  }
  if (letters / Math.max(pageCount, 1) < 150) {
    warnings.push({
      code: "little-text",
      message: "Very little text per page. Parts of the PDF may be scanned images that need OCR.",
    });
  }

  const forward = ARABIC_FUNCTION_WORDS.reduce((sum, word) => sum + countWord(text, word), 0);
  const reversed = ARABIC_FUNCTION_WORDS.reduce(
    (sum, word) => sum + countWord(text, Array.from(word).reverse().join("")),
    0,
  );
  if (reversed >= 5 && reversed > forward * 2) {
    warnings.push({
      code: "reversed-arabic",
      message:
        "Arabic words appear letter-reversed. Re-extract with another tool before using this text.",
    });
  }

  const damaged = (text.match(/\uFFFD/g) ?? []).length;
  if (damaged >= 3) {
    warnings.push({
      code: "replacement-characters",
      message: damaged + " damaged characters (U+FFFD) found. Compare the text with the PDF.",
    });
  }
  return warnings;
}
