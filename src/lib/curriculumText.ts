/**
 * Text handling for the Moroccan curriculum search.
 *
 * `normalizeCurriculumText` mirrors the SQL function public.normalize_curriculum_text
 * (supabase/migrations/20261120000100_curriculum_search_v2.sql). Stored chunks are
 * normalised by the database, questions by this module, so the two must fold text the
 * same way. Change both together; curriculumText.test.ts pins the shared examples.
 */

// Latin accents, Arabic letter variants and Arabic-Indic digits folded to a base form.
const FOLD_FROM = "àâäáãåçéèêëíìîïñóòôöõúùûüýÿأإآٱىؤئة٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹";
const FOLD_TO = "aaaaaaceeeeiiiinooooouuuuyyاااايويه01234567890123456789";

const FOLD_MAP: Map<string, string> = (() => {
  const from = Array.from(FOLD_FROM);
  const to = Array.from(FOLD_TO);
  if (from.length !== to.length) throw new Error("curriculumText fold tables differ in length");
  return new Map(from.map((char, index) => [char, to[index]]));
})();

const INVISIBLE_FORMAT_CHARS = /[\u00AD\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;
const ARABIC_MARKS = /[\u064B-\u065F\u0670\u0640]/g;
const ARABIC_ARTICLE = /(^|[^\u0621-\u064A])(?:وال|بال|كال|فال|ال)(?=[\u0621-\u064A]{3})/g;

export function normalizeCurriculumText(input: string): string {
  const lowered = input.normalize("NFKC").toLowerCase().replaceAll("œ", "oe").replaceAll("æ", "ae");
  let folded = "";
  for (const char of lowered) folded += FOLD_MAP.get(char) ?? char;
  return folded
    .replace(INVISIBLE_FORMAT_CHARS, "")
    .replace(ARABIC_MARKS, "")
    .replace(ARABIC_ARTICLE, "$1");
}

/** Raw words that carry no subject meaning: Arabic, Darija, French and English chat filler. */
const STOPWORD_SOURCE = [
  // Arabic and Darija
  "ما",
  "ماذا",
  "هل",
  "من",
  "في",
  "على",
  "عن",
  "إلى",
  "الى",
  "هذا",
  "هذه",
  "هاد",
  "هادا",
  "هادي",
  "فهاد",
  "ذلك",
  "تلك",
  "هو",
  "هي",
  "هم",
  "التي",
  "الذي",
  "الذين",
  "كان",
  "كانت",
  "يكون",
  "تكون",
  "كيف",
  "كيفاش",
  "لماذا",
  "علاش",
  "متى",
  "أين",
  "فين",
  "او",
  "أو",
  "ثم",
  "قد",
  "كل",
  "بعض",
  "مع",
  "عند",
  "أن",
  "إن",
  "ان",
  "لا",
  "لم",
  "لن",
  "إذا",
  "اذا",
  "حتى",
  "فقط",
  "جدا",
  "أي",
  "اي",
  "يمكن",
  "ممكن",
  "اريد",
  "أريد",
  "نريد",
  "بغيت",
  "شرح",
  "اشرح",
  "اشرحلي",
  "علمني",
  "عطيني",
  "واش",
  "شنو",
  "شنوهي",
  "ديال",
  "ديالي",
  "ليا",
  "لي",
  "عفاك",
  "فضلك",
  "سمحت",
  "مرحبا",
  "السلام",
  "عليكم",
  "شكرا",
  "ولكن",
  "لكن",
  "بين",
  "حول",
  "بعد",
  "قبل",
  "كم",
  "كذلك",
  "ايضا",
  "أيضا",
  "هنا",
  "هناك",
  // French
  "le",
  "la",
  "les",
  "un",
  "une",
  "des",
  "du",
  "de",
  "et",
  "ou",
  "en",
  "au",
  "aux",
  "est",
  "sont",
  "ce",
  "cet",
  "cette",
  "ces",
  "que",
  "qui",
  "quoi",
  "quel",
  "quelle",
  "quels",
  "quelles",
  "dans",
  "pour",
  "par",
  "sur",
  "avec",
  "sans",
  "comment",
  "pourquoi",
  "quand",
  "ou",
  "je",
  "tu",
  "il",
  "elle",
  "nous",
  "vous",
  "ils",
  "elles",
  "me",
  "te",
  "se",
  "mon",
  "ma",
  "mes",
  "ton",
  "ta",
  "tes",
  "son",
  "sa",
  "ses",
  "leur",
  "leurs",
  "ne",
  "pas",
  "plus",
  "moins",
  "tres",
  "etre",
  "avoir",
  "fait",
  "faire",
  "peux",
  "peut",
  "veux",
  "veut",
  "voudrais",
  "explique",
  "expliquer",
  "expliquez",
  "moi",
  "svp",
  "stp",
  "plait",
  "bonjour",
  "merci",
  "donne",
  "donner",
  "dis",
  "dire",
  "est-ce",
  // English
  "the",
  "an",
  "of",
  "to",
  "on",
  "at",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "do",
  "does",
  "did",
  "what",
  "which",
  "who",
  "how",
  "why",
  "when",
  "where",
  "for",
  "with",
  "from",
  "by",
  "and",
  "not",
  "can",
  "could",
  "would",
  "should",
  "please",
  "explain",
  "my",
  "you",
  "it",
  "this",
  "that",
  "these",
  "those",
  "about",
  "give",
  "tell",
  // Darija written in Latin letters
  "chno",
  "wach",
  "kifach",
  "3lach",
  "fin",
  "bghit",
  "chrah",
  "3afak",
  "safi",
];

export const CURRICULUM_STOPWORDS: ReadonlySet<string> = new Set(
  STOPWORD_SOURCE.map((word) => normalizeCurriculumText(word)),
);

const WORD = /[\p{L}\p{M}\p{N}]+/gu;
const MAX_WORD_LENGTH = 40;
/** What the database accepts as search terms (search_terms[1:24]). */
export const MAX_SEARCH_TERMS = 24;

/** Splits already-normalised text into word tokens. */
export function tokenizeNormalized(normalized: string): string[] {
  return normalized.match(WORD) ?? [];
}

/** Normalises then tokenises: the form used to compare a question with chunk text. */
export function tokenizeCurriculumText(text: string): string[] {
  return tokenizeNormalized(normalizeCurriculumText(text));
}

function isMeaningful(token: string): boolean {
  if (token.length < 2 || token.length > MAX_WORD_LENGTH) return false;
  if (/^\p{N}+$/u.test(token) && token.length < 4) return false;
  return !CURRICULUM_STOPWORDS.has(token);
}

/** Light French/English plural folding so "équations" and "équation" compare as one stem. */
export function stemLatin(token: string): string {
  if (token.length >= 5 && /^[a-z]+$/.test(token) && /[sx]$/.test(token)) return token.slice(0, -1);
  return token;
}

/**
 * The meaningful words of a question, as normalised, de-duplicated, stemmed terms.
 * Used to compare the question against retrieved chunks.
 */
export function rankingTerms(question: string): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const token of tokenizeCurriculumText(question)) {
    if (!isMeaningful(token)) continue;
    const term = stemLatin(token);
    if (seen.has(term)) continue;
    seen.add(term);
    terms.push(term);
  }
  return terms;
}

/**
 * The words to send to the database search. They are sent in their original form
 * (the database normalises them itself, exactly once), longest first because longer
 * words are more specific, and Latin plurals also get their singular so a prefix
 * search finds both. At most MAX_SEARCH_TERMS are returned.
 */
export function selectSearchTerms(question: string, maxWords = 16): string[] {
  const text = question.normalize("NFKC").toLowerCase();
  const seen = new Set<string>();
  const words: string[] = [];
  for (const raw of text.match(WORD) ?? []) {
    const key = normalizeCurriculumText(raw);
    if (!isMeaningful(key) || seen.has(key)) continue;
    seen.add(key);
    words.push(raw);
  }
  words.sort((a, b) => b.length - a.length);
  const chosen = words.slice(0, maxWords);

  const terms = [...chosen];
  for (const raw of chosen) {
    const key = normalizeCurriculumText(raw);
    const stem = stemLatin(key);
    if (stem !== key && !seen.has(stem)) {
      seen.add(stem);
      terms.push(stem);
    }
  }
  return terms.slice(0, MAX_SEARCH_TERMS);
}
