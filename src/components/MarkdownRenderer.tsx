import { ANSWER_FONT_DEFAULT } from "@/hooks/use-answer-font";
import { useState, memo, isValidElement, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { convertLatexDelimiters } from "@/lib/mathFormat";
import { convertLatexTableEnvironments } from "@/lib/latexTableEnvironments";
import { Copy, Check } from "lucide-react";
import DOMPurify from "dompurify";
import katex from "katex";
import TableBlock, { detectMathTable } from "./answer/TableBlock";
import StepBlock from "./answer/StepBlock";
import MathBlock from "./answer/MathBlock";
import { rehypeMathBlocks } from "@/lib/rehypeMathBlocks";
import "./markdown-math.css";

interface MarkdownRendererProps {
  content: string;
  fontSize?: number;
};

/**
 * تحويل children إلى نص حقيقي حتى نستطيع معرفة
 * هل المحتوى عربي أم فرنسي/إنجليزي.
 */
const getTextContent = (node: ReactNode): string => {
  if (node === null || node === undefined || typeof node === "boolean") {
    return "";
  }

  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }

  if (Array.isArray(node)) {
    return node.map(getTextContent).join("");
  }

  if (isValidElement(node)) {
    return getTextContent((node.props as { children?: ReactNode }).children);
  }

  return "";
};

/**
 * اكتشاف وجود الأحرف العربية.
 */
// RTL only when Arabic letters dominate the Latin letters (ignores math/LaTeX noise)
const containsArabic = (text: string) => {
  const arabic = (text.match(/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/g) || []).length;
  if (arabic === 0) return false;
  const latin = (text.replace(/\$[^$]*\$/g, "").match(/[A-Za-zÀ-ÿ]/g) || []).length;
  return arabic >= latin;
};

/**
 * تحديد اتجاه العنصر.
 *
 * عربي / عربي + فرنسي = RTL
 * فرنسي / إنجليزي فقط = LTR
 */
const getDirection = (children: ReactNode): "rtl" | "ltr" => {
  const text = getTextContent(children);
  return containsArabic(text) ? "rtl" : "ltr";
};

const unescapeHtml = (text: string) =>
  text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");

const renderMathInHtml = (html: string) =>
  html.replace(/>([^<>]*\$[^<>]*)</g, (_match, text: string) =>
    `>${text.replace(/\$([^$]+)\$/g, (whole, latex: string) => {
      try {
        return katex.renderToString(cleanLatex(unescapeHtml(latex)), { throwOnError: false, output: "html" });
      } catch {
        return whole;
      }
    })}<`,
  );

// تنسيق جداول HTML (نفس التنسيق السابق)
const HTML_TABLE_CLASS =
  "[&_*]:!text-black [&_table]:w-full [&_td]:border [&_td]:border-[#555] [&_td]:px-3 [&_td]:py-2 [&_th]:border [&_th]:border-[#555] [&_th]:px-3 [&_th]:py-2 [&_th]:bg-[#f5f5f5] [&_th]:font-bold";

// ---------- جداول Markdown (بدون remark-gfm): نحوّلها إلى بلوك ```mdtable ثم نرسمها بأنفسنا ----------
const splitRow = (line: string): string[] => {
  let t = line.trim();
  if (t.startsWith("|")) t = t.slice(1);
  if (t.endsWith("|") && !t.endsWith("\\|")) t = t.slice(0, -1);
  const cells: string[] = [];
  let cur = "";
  let inMath = false;
  let braceDepth = 0;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (ch === "\\" && t[i + 1] === "|") { cur += "|"; i++; continue; }
    if (ch === "\\" && i + 1 < t.length) { cur += ch + t[i + 1]; i++; continue; }
    if (ch === "$") inMath = !inMath;
    // Track braces even inside math: LaTeX column formats such as {|c|} may
    // contain pipes that are syntax, not Markdown cell separators.
    if (ch === "{") braceDepth++;
    else if (ch === "}") braceDepth = Math.max(0, braceDepth - 1);
    if (ch === "|" && !inMath && braceDepth === 0) { cells.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  cells.push(cur.trim());
  return cells;
};


/**
 * Read a LaTeX group while respecting nested braces and escaped characters.
 */
const readLatexGroup = (source: string, start: number): { value: string; end: number } | null => {
  if (source[start] !== "{") return null;
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    if (source[i] === "\\" && i + 1 < source.length) { i++; continue; }
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return { value: source.slice(start + 1, i), end: i + 1 };
    }
  }
  return null;
};

/**
 * Parse \multicolumn and \multirow cells, including commands wrapped in $...$.
 */
const parseMulticolumnCell = (raw: string): { text: string; colSpan?: number; rowSpan?: number; align?: "left" | "center" | "right" } => {
  let source = raw.trim();
  if (source.startsWith("$") && source.endsWith("$") && source.length > 1) {
    source = source.slice(1, -1).trim();
  }
  const command = source.startsWith("\\multicolumn") ? "\\multicolumn" : source.startsWith("\\multirow") ? "\\multirow" : "";
  if (!command) return { text: raw };

  let i = command.length;
  const readGroup = (): string | null => {
    while (/\s/.test(source[i] ?? "")) i++;
    const group = readLatexGroup(source, i);
    if (!group) return null;
    i = group.end;
    return group.value;
  };

  const spanText = readGroup();
  const formatOrWidth = readGroup();
  const content = readGroup();
  const span = Number(spanText);
  if (content === null || !Number.isInteger(span) || span < 1 || span > 32) {
    return { text: raw };
  }

  // \text{...} is textual content, not a math command to display literally.
  const textGroup = content.trim().startsWith("\\text")
    ? readLatexGroup(content.trim(), "\\text".length)
    : null;
  const renderedContent = textGroup && textGroup.end === content.trim().length
    ? textGroup.value
    : content.trim().startsWith("\\")
      ? "$" + content + "$"
      : content;

  if (command === "\\multirow") return { text: renderedContent, rowSpan: span };
  const alignment = formatOrWidth?.match(/[lcr]/)?.[0];
  return { text: renderedContent, colSpan: span, align: alignment === "l" ? "left" : alignment === "r" ? "right" : "center" };
};

const SEP_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

const wrapMarkdownTables = (text: string): string => {
  const lines = text.split("\n");
  const out: string[] = [];
  let fence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) { fence = !fence; out.push(line); continue; }
    if (!fence && line.includes("|") && i + 1 < lines.length && SEP_RE.test(lines[i + 1]) && lines[i + 1].includes("-")) {
      const block = [line, lines[i + 1]];
      let j = i + 2;
      while (j < lines.length && lines[j].trim() !== "" && lines[j].includes("|")) { block.push(lines[j]); j++; }
      out.push("", "```mdtable", ...block, "```", "");
      i = j - 1;
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
};

const MdCell = memo(({ text }: { text: string }) => (
  <ReactMarkdown
    remarkPlugins={[remarkMath]}
    rehypePlugins={[rehypeKatex]}
    components={{ p: ({ children }) => <>{children}</> }}
  >
    {text}
  </ReactMarkdown>
));

const MdTable = memo(function MdTable({ source }: { source: string }) {
  const lines = source.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return null;
  const head = splitRow(lines[0]);
  const aligns = splitRow(lines[1]).map((c) =>
    c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : "left"
  );
  const rows = lines.slice(2).map(splitRow);
  const kind = detectMathTable(head, rows);
  const normalizedHead = head.map((cell) => cell.replace(/[$\\\\{}\\s]/g, "").toLowerCase());
  const firstColumn = rows.map((row) => (row[0] ?? "").trim().toLowerCase());
  const isAdvancementTable =
    normalizedHead.some((cell) => /^(état|etat|state)$/.test(cell)) &&
    normalizedHead.some((cell) => /^(avancement|x(?:\\(mol\\))?)$/.test(cell) || /avancement/.test(cell)) &&
    firstColumn.some((cell) => /^(initial|initiale|début|debut)$/.test(cell)) &&
    firstColumn.some((cell) => /^(final|finale)$/.test(cell)) &&
    firstColumn.some((cell) => /^(en cours|intermédiaire|intermediaire|variation)$/.test(cell));
  // جداول الإشارة والتغيّرات وجداول التقدم الكيميائي تُقرأ من اليسار إلى اليمين.
  const dir = kind || isAdvancementTable ? "ltr" : containsArabic(source) ? "rtl" : "ltr";
  const renderRowCells = (cells: string[], rowKey: string, header = false) => {
    const rendered: ReactNode[] = [];
    for (let i = 0; i < cells.length; i++) {
      const cell = parseMulticolumnCell(cells[i]);
      const cellStyle = { textAlign: (cell.align ?? (kind ? "center" : aligns[i])) as any };
      if (header) {
        rendered.push(
          <th key={rowKey + "-" + i} colSpan={cell.colSpan} rowSpan={cell.rowSpan} style={cellStyle}>
            <MdCell text={cell.text} />
          </th>
        );
      } else {
        rendered.push(
          <td key={rowKey + "-" + i} colSpan={cell.colSpan} rowSpan={cell.rowSpan} style={cellStyle}>
            <MdCell text={cell.text} />
          </td>
        );
      }
      // Empty Markdown cells following a merged LaTeX cell are placeholders.
      i += Math.max(0, (cell.colSpan ?? 1) - 1);
    }
    return rendered;
  };
  return (
    <TableBlock variant="flat" mathKind={kind} advancement={isAdvancementTable}>
      <table className={`md-table${kind ? " md-table--math" : ""}${isAdvancementTable ? " md-table--advancement" : ""}`} dir={dir}>
        <thead>
          <tr>{renderRowCells(head, "head", true)}</tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri}>{renderRowCells(r, String(ri))}</tr>
          ))}
        </tbody>
      </table>
    </TableBlock>
  );
});

const CodeBlock = ({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) => {
  const [copied, setCopied] = useState(false);
  const text = String(children).trim();

  if (className === "language-mdtable") {
    return <MdTable source={text} />;
  }

  // Render SVG code blocks inline
  if (className === "language-svg" || text.startsWith("<svg")) {
    // تنقية صارمة: SVG يأتي من النموذج (وقد يتأثر بنص الصورة)، فلا نحقنه كما هو أبداً
    const safeSvg = DOMPurify.sanitize(text, { USE_PROFILES: { svg: true, svgFilters: true } });
    return (
      <div
        className="my-4 flex justify-center overflow-x-auto rounded-xl border border-border bg-card p-4"
        dangerouslySetInnerHTML={{ __html: safeSvg }}
      />
    );
  }

  // Render HTML table code blocks inline (مع زر تكبير الجدول)
  if (
    className === "language-html" ||
    (text.startsWith("<table") && text.endsWith("</table>"))
  ) {
    // تنظيف الـ HTML القادم من النموذج قبل عرضه (يمنع تنفيذ سكربتات أو أحداث مضمّنة)
    const html = renderMathInHtml(DOMPurify.sanitize(text));
    return (
      <TableBlock variant="light" tableClassName={HTML_TABLE_CLASS}>
        <div dangerouslySetInnerHTML={{ __html: html }} />
      </TableBlock>
    );
  }

  // ChatGPT-style code block
  const lang = className?.replace("language-", "") || "code";

  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);

    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="code-block-wrapper my-4 rounded-xl overflow-hidden border border-border">
      <div className="code-block-header flex items-center justify-between px-4 py-2 bg-muted/60">
        <span className="text-xs font-medium text-muted-foreground">
          {lang}
        </span>

        <button
          onClick={handleCopy}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-primary" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}

          {copied ? "Copied!" : "Copy"}
        </button>
      </div>

      <div className="code-block-body overflow-x-auto bg-[hsl(0_0%_8%)] p-4">
        <code className="text-sm font-mono text-[hsl(210_40%_90%)] whitespace-pre-wrap">
          {text}
        </code>
      </div>
    </div>
  );
};

// Fix LaTeX commands glued to units (e.g. \\cdotps → \\cdot s, \\cdotpL → \\cdotp L) which KaTeX can't parse.
const cleanLatex = (text: string) => {
  let t = text
    .replace(/\\cdotps\b/g, "\\cdot s")
    // \cdots^{-1} هو في الحقيقة \cdot s^{-1}؛ أما \cdots وحدها (نقاط الحذف) فنتركها
    .replace(/\\cdots(?=\s*\^)/g, "\\cdot s")
    .replace(/\\cdot(?=(?:m|Hz|kg|K|J|N|W|V|A|mol)\b)/g, "\\cdot ");
  // \cdotpL → \cdotp L (الأمر ملتصق بحرف الوحدة)
  t = t.replace(/\\cdotp(?=[A-Za-z])/g, "\\cdotp ");
  // داخل \text{...} لا تعمل أوامر الرياضيات (\cdot / \cdotp)، فنستبدلها بنقطة وسطية حقيقية
  t = t.replace(/\\(text|textrm)\{([^{}]*)\}/g, (m, cmd: string, inner: string) =>
    /\\cdot/.test(inner) ? `\\${cmd}{${inner.replace(/\s*\\cdotp?\s*/g, "·")}}` : m
  );
  return t;
};

const BADGE_STYLES: Record<string, string> = {
  FALSE: "bg-red-500/15 text-red-500",
  TRUE: "bg-green-500/15 text-green-500",
};
const CHOICE_STYLE = "bg-green-500/15 text-green-500";

const Badge = ({ value }: { value: string }) => {
  const isChoice = /^[A-F]$/.test(value);
  return (
    <span
      dir="ltr"
      className={`inline-flex items-center justify-center font-bold ${
        isChoice
          ? `h-7 w-7 rounded-full text-sm ${CHOICE_STYLE}`
          : `rounded-lg px-3 py-1 text-xs tracking-wide ${BADGE_STYLES[value]}`
      }`}
    >
      {value}
    </span>
  );
};

const wrapBadges = (text: string) =>
  text.replace(/\[\[(TRUE|FALSE|[A-F])\]\]\s*/g, "\n\n`badge:$1`\n\n");

const MarkdownRenderer = ({ content, fontSize = ANSWER_FONT_DEFAULT }: MarkdownRendererProps) => {
  const formatted = wrapBadges(
    wrapMarkdownTables(convertLatexDelimiters(cleanLatex(convertLatexTableEnvironments(content))))
  );

  return (
    <div
      className="
        markdown-content
        w-full
        [unicode-bidi:isolate]
      "
      dir="auto"
      style={{
        unicodeBidi: "isolate",
        // الحجم المختار × مقياس الشاشة (--ui-scale)، فيتبع نظام الكثافة دون إعادة رسم
        fontSize: "calc(" + String(fontSize) + "px * var(--ui-scale, 1))",
      }}
    >
      <ReactMarkdown
        remarkPlugins={[remarkMath]}
        rehypePlugins={[rehypeKatex, rehypeMathBlocks]}
        components={{
          img({ src, alt, ...props }) {
            const isDiagram = typeof src === "string" && src.startsWith("/media/diagrams/");
            return (
              <figure className={isDiagram ? "my-5 w-full overflow-hidden rounded-2xl border border-border bg-white p-3 sm:p-5" : "my-3"}>
                <img
                  {...props}
                  src={src}
                  alt={alt ?? "Illustration"}
                  loading="lazy"
                  className={isDiagram
                    ? "mx-auto block h-auto max-h-[560px] w-full max-w-[900px] object-contain"
                    : "h-auto max-w-full rounded-lg"}
                />
                {isDiagram && alt && (
                  <figcaption className="mt-2 text-center text-xs text-slate-600">{alt}</figcaption>
                )}
              </figure>
            );
          },
          /**
           * المعادلات المستقلة: عنصر <mathblock> يضيفه rehypeMathBlocks
           */
          mathblock: MathBlock,

          /**
           * الفقرات
           */
          p({ children, ...props }) {
            const text = getTextContent(children);
            const direction = containsArabic(text) ? "rtl" : "ltr";
            const onlyChild = Array.isArray(children) && children.length === 1 ? children[0] : children;
            const isBadgeParagraph =
              /^badge:(TRUE|FALSE|[A-F])$/.test(text.trim()) ||
              (isValidElement(onlyChild) && onlyChild.type === Badge);

            if (isBadgeParagraph) {
              return (
                <p {...props} dir="rtl" style={{ textAlign: "right", unicodeBidi: "isolate" }}>
                  {children}
                </p>
              );
            }

            // ملاحظة: النص هنا بعد تحويل الماركداون، فلا توجد ** حول الكلمات
            const isFinalAnswer =
              /^(=>|⇒|✅)\s/.test(text) ||
              /^\s*(Réponse finale|Résultat|Resultat|النتيجة النهائية|النتيجة|Final Answer)\s*[:：]/i.test(
                text
              );

            if (isFinalAnswer) {
              return (
                <div
                  dir={direction}
                  className="
                    final-answer-block
                    my-3
                    rounded-xl
                    px-4
                    py-3
                    text-center
                    font-medium
                    text-primary-foreground
                    bg-gradient-to-r
                    from-primary
                    to-secondary
                  "
                  style={{
                    direction,
                    unicodeBidi: "isolate",
                  }}
                >
                  <p {...props}>{children}</p>
                </div>
              );
            }

            return (
              <p
                {...props}
                dir={direction}
                style={{
                  direction,
                  unicodeBidi: "isolate",
                  textAlign: direction === "rtl" ? "right" : "left",
                }}
              >
                {children}
              </p>
            );
          },

          /**
           * العناوين
           */
          h1({ children, ...props }) {
            const direction = getDirection(children);

            return (
              <h1
                {...props}
                dir={direction}
                style={{
                  direction,
                  unicodeBidi: "isolate",
                  textAlign: direction === "rtl" ? "right" : "left",
                }}
              >
                {children}
              </h1>
            );
          },

          h2({ children, ...props }) {
            const direction = getDirection(children);

            return (
              <h2
                {...props}
                dir={direction}
                style={{
                  direction,
                  unicodeBidi: "isolate",
                  textAlign: direction === "rtl" ? "right" : "left",
                }}
              >
                {children}
              </h2>
            );
          },

          h3({ children, ...props }) {
            const direction = getDirection(children);

            return (
              <h3
                {...props}
                dir={direction}
                style={{
                  direction,
                  unicodeBidi: "isolate",
                  textAlign: direction === "rtl" ? "right" : "left",
                }}
              >
                {children}
              </h3>
            );
          },

          /**
           * خطوات الحل المرقّمة
           */
          ol({ children, start }) {
            return <StepBlock start={start}>{children}</StepBlock>;
          },

          /**
           * عناصر القوائم
           */
          li({ children, ...props }) {
            const direction = getDirection(children);

            return (
              <li
                {...props}
                dir={direction}
                style={{
                  direction,
                  unicodeBidi: "isolate",
                  textAlign: direction === "rtl" ? "right" : "left",
                }}
              >
                {children}
              </li>
            );
          },

          /**
           * الكود والمعادلات
           */
          code({ className, children, ...props }) {
            const badgeValue = String(children).trim().match(/^badge:(TRUE|FALSE|[A-F])$/)?.[1];
            if (badgeValue) return <Badge value={badgeValue} />;

            const isInline =
              !className && String(children).length < 100;

            if (isInline) {
              return (
                <code
                  className="bg-muted px-1.5 py-0.5 rounded text-sm"
                  dir="ltr"
                  style={{
                    direction: "ltr",
                    unicodeBidi: "isolate",
                  }}
                  {...props}
                >
                  {children}
                </code>
              );
            }

            return (
              <CodeBlock className={className}>
                {children}
              </CodeBlock>
            );
          },

          pre({ children }) {
            return <>{children}</>;
          },

          /**
           * جداول الماركداون (تعمل إن أضفت remark-gfm) مع زر التكبير
           */
          table({ children }) {
            return (
              <TableBlock>
                <table className="markdown-table">{children}</table>
              </TableBlock>
            );
          },
        } as Components}
      >
        {formatted}
      </ReactMarkdown>
    </div>
  );
};

export default memo(
  MarkdownRenderer,
  (prev, next) => prev.content === next.content && prev.fontSize === next.fontSize
);
