/**
 * شبكة أمان للعرض: إذا كتب النموذج الخطوات في فقرة واحدة (On a … A.N : … Résultat : …)
 * نفصل كل خطوة في فقرة مستقلة بسطر فارغ بينها. لا تلمس كتل الكود (SVG / HTML / جداول).
 * استعملها قبل عرض نص الرد:  <MarkdownRenderer content={spreadSteps(text)} />
 */
// كلمات تبدأ خطوة جديدة دائماً: نفصل قبلها أينما وردت
const STRONG = "(?:A\\.N|Application numérique|Résultats?(?: final)?|D'où|Donc|Par suite|Par conséquent|On en déduit)";
// كلمات قد ترد وسط جملة: نفصل قبلها فقط بعد نهاية خطوة (معادلة/نقطة/قوس)
const LABELS =
  "(?:Alors|Or|Comme|Puisque|Pour|On a|On pose|Soit|Calculons|Montrons|Vrai|Faux|" + STRONG.slice(3, -1) + ")";
const BREAK_STRONG = new RegExp(`(\\S)[ \\t]+(?=(?:\\*\\*)?${STRONG}(?![\\p{L}]))`, "gu");

// علامة نهاية خطوة (إغلاق معادلة/نقطة/قوس/نجمتا الخط العريض) ثم مسافة ثم بداية خطوة جديدة
const BREAK = new RegExp(`([$.)\\]]|\\*\\*)[ \\t]+(?=(?:\\*\\*)?${LABELS}(?![\\p{L}])(?:[ \\t]*[:：])?)`, "gu");

// سطر نتيجة كُتب فيه LaTeX بدون $ (مثل: **Résultat : v = 340 \\, \\mathrm{m}**) نصلحه ليُعرض كمعادلة
const RESULT_LINE = /^(\s*)(?:\*\*)?\s*(Résultats?(?: final)?|Réponse(?: finale)?)\s*:\s*(?:\*\*)?\s*(.+?)\s*(?:\*\*)?\s*$/u;
function fixBareLatex(line: string): string {
  if (line.includes("$") || !/\\[a-zA-Z]+/.test(line)) return line;
  const m = line.match(RESULT_LINE);
  if (!m) return line;
  const body = m[3].replace(/\*\*/g, "").trim();
  return `${m[1]}**${m[2]} :** $${body}$`;
}

export function spreadSteps(md: string): string {
  return md
    .split(/(```[\s\S]*?(?:```|$))/g) // الأجزاء الفردية = كتل كود، نتركها كما هي
    .map((part, i) => {
      if (i % 2 === 1) return part;
      return part
        .split("\n")
        .map((line) => (line.trimStart().startsWith("|") ? line : fixBareLatex(line).replace(BREAK_STRONG, "$1\n\n").replace(BREAK, "$1\n\n")))
        .join("\n");
    })
    .join("");
}
