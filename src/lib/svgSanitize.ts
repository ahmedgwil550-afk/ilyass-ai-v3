/**
 * منظِّف SVG صارم لما يعيده النموذج عند إعادة رسم الشكل.
 *
 * لا نثق بأي وسم أو خاصية: نحلّل النص إلى شجرة، نُبقي قائمة بيضاء من الوسوم والخصائص،
 * نتحقق من قيمة كل خاصية بنمط ضيّق، ثم نعيد كتابة SVG جديداً من الصفر.
 * ما لا يمرّ يُحذف مع كل ما تحته. الجذر نكتبه نحن (viewBox ثابت) لا النموذج.
 * نقي (بلا DOM) ليعمل في الخادم والمتصفح والاختبارات.
 */

const TAGS = new Set(["svg", "g", "line", "polyline", "polygon", "path", "circle", "ellipse", "rect", "text", "tspan"]);
const SHAPES = new Set(["line", "polyline", "polygon", "path", "circle", "ellipse", "rect"]);

const NUM = /^-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?(?:px)?$/i;
const NUM_LIST = /^[\d\s.,\-+e]+$/i;
const PATH_D = /^[MmLlHhVvCcSsQqTtAaZz\d\s,.\-+eE]+$/;
const COLOR = /^(?:none|currentColor|#[0-9a-fA-F]{3,8}|rgba?\([\d\s.,%]+\)|[a-zA-Z]{3,20})$/;
const TRANSFORM = /^(?:\s*(?:translate|rotate|scale|matrix|skewX|skewY)\(\s*[-\d.,\s+e]+\))+\s*$/i;

const oneOf = (...vals: string[]) => (v: string) => vals.includes(v);
const re = (r: RegExp) => (v: string) => r.test(v);

const ATTRS: Record<string, (v: string) => boolean> = {
  x: re(NUM), y: re(NUM), x1: re(NUM), y1: re(NUM), x2: re(NUM), y2: re(NUM),
  cx: re(NUM), cy: re(NUM), r: re(NUM), rx: re(NUM), ry: re(NUM), dx: re(NUM), dy: re(NUM),
  width: re(NUM), height: re(NUM),
  "stroke-width": re(NUM), "font-size": re(NUM),
  opacity: re(NUM), "fill-opacity": re(NUM), "stroke-opacity": re(NUM),
  points: re(NUM_LIST), d: re(PATH_D),
  fill: re(COLOR), stroke: re(COLOR),
  "stroke-dasharray": (v) => v === "none" || /^[\d\s.,]+$/.test(v),
  "stroke-linecap": oneOf("butt", "round", "square"),
  "stroke-linejoin": oneOf("miter", "round", "bevel"),
  "fill-rule": oneOf("nonzero", "evenodd"),
  transform: re(TRANSFORM),
  "text-anchor": oneOf("start", "middle", "end"),
  "font-style": oneOf("normal", "italic"),
  "font-weight": (v) => v === "normal" || v === "bold" || /^[1-9]00$/.test(v),
  "font-family": re(/^[\w\s,'"\-]{1,80}$/),
  "dominant-baseline": oneOf("alphabetic", "middle", "central", "hanging"),
};

export const SVG_LIMITS = { maxChars: 120_000, maxElements: 1500, maxTextChars: 40 };

/** يستخرج أول <svg>…</svg> من رد النموذج (قد يكون في سياج Markdown أو بين كلام) */
export function extractSvg(text: string): string | null {
  const start = text.search(/<svg[\s>]/i);
  if (start < 0) return null;
  const end = text.toLowerCase().lastIndexOf("</svg>");
  if (end < start) return null;
  return text.slice(start, end + "</svg>".length);
}

const decodeEntities = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (_m, e: string) => {
    const k = e.toLowerCase();
    if (k === "lt") return "<";
    if (k === "gt") return ">";
    if (k === "amp") return "&";
    if (k === "quot") return '"';
    if (k === "apos") return "'";
    const code = k.startsWith("#x") ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
    return Number.isFinite(code) && code > 31 && code < 0x2fff ? String.fromCharCode(code) : "";
  });

const escText = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (s: string) => escText(s).replace(/"/g, "&quot;");

interface Node {
  tag: string;
  attrs: Record<string, string>;
  children: Array<Node | string>;
}

const TOKEN = new RegExp(
  [
    "<!--[\\s\\S]*?-->", // 0: تعليق
    "<!\\[CDATA\\[[\\s\\S]*?\\]\\]>", // CDATA
    "<\\?[\\s\\S]*?\\?>", // معالجة
    "<!DOCTYPE[^>]*>", // doctype
    "<\\/\\s*([a-zA-Z][\\w:-]*)\\s*>", // 1: إغلاق
    "<\\s*([a-zA-Z][\\w:-]*)((?:\\s+[^\\s=>\\/<\"']+(?:\\s*=\\s*(?:\"[^\"]*\"|'[^']*'|[^\\s>\"']+))?)*)\\s*(\\/?)>", // 2: اسم، 3: خصائص، 4: ذاتي الإغلاق
    "([^<]+)", // 5: نص
  ].join("|"),
  "iy",
);
const ATTR = /([^\s=>\/<"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+)))?/g;

function parseAttrs(src: string): Record<string, string> {
  const out: Record<string, string> = {};
  ATTR.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR.exec(src))) {
    const name = m[1].toLowerCase();
    if (name in out) continue;
    out[name] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return out;
}

/** يعيد جذر الشجرة المسموح بها، أو null إن كان النص معطوباً أو غير متوازن */
function parse(src: string): Node | null {
  TOKEN.lastIndex = 0;
  const stack: Node[] = [];
  let root: Node | null = null;
  let skip = 0; // عمق داخل شجرة فرعية ممنوعة
  let elements = 0;
  let pos = 0;
  while (pos < src.length) {
    TOKEN.lastIndex = pos;
    const m = TOKEN.exec(src);
    if (!m || m.index !== pos) return null; // نص غير مفهوم
    pos = TOKEN.lastIndex;
    if (m[1] !== undefined) {
      if (skip > 0) { skip--; continue; }
      const open = stack.pop();
      if (!open || open.tag !== m[1].toLowerCase()) return null;
      continue;
    }
    if (m[2] !== undefined) {
      const tag = m[2].toLowerCase();
      const selfClose = m[4] === "/";
      if (skip > 0) { if (!selfClose) skip++; continue; }
      const isRoot = stack.length === 0;
      const allowed = TAGS.has(tag) && (isRoot ? tag === "svg" : tag !== "svg");
      if (!allowed || (isRoot && root)) {
        if (!selfClose) skip = 1;
        if (isRoot && !root) return null; // أول عنصر ليس svg
        continue;
      }
      if (++elements > SVG_LIMITS.maxElements) return null;
      const attrs: Record<string, string> = {};
      for (const [k, v] of Object.entries(parseAttrs(m[3] ?? ""))) {
        const ok = ATTRS[k];
        if (ok && ok(v.trim())) attrs[k] = v.trim();
      }
      const node: Node = { tag, attrs, children: [] };
      if (stack.length) stack[stack.length - 1].children.push(node);
      else root = node;
      if (!selfClose) stack.push(node);
      continue;
    }
    if (m[5] !== undefined && skip === 0 && stack.length) {
      const top = stack[stack.length - 1];
      if (top.tag === "text" || top.tag === "tspan") {
        const t = decodeEntities(m[5]).replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
        if (t) top.children.push(t.slice(0, SVG_LIMITS.maxTextChars));
      }
    }
  }
  return stack.length === 0 && skip === 0 ? root : null;
}

function emit(node: Node, out: string[]): number {
  let shapes = 0;
  const a = { ...node.attrs };
  if (SHAPES.has(node.tag)) {
    shapes++;
    if (!("fill" in a)) a["fill"] = "none"; // الافتراضي في SVG أسود مملوء؛ نريد خطوطاً
    if (!("stroke" in a)) a["stroke"] = "#111";
    if (a["stroke"] !== "none" && !("stroke-width" in a)) a["stroke-width"] = "2";
  } else if (node.tag === "text" || node.tag === "tspan") {
    if (node.tag === "text") shapes++;
    if (!("fill" in a)) a["fill"] = "#111";
  }
  const attrs = Object.entries(a).map(([k, v]) => ` ${k}="${escAttr(v)}"`).join("");
  out.push(`<${node.tag}${attrs}>`);
  for (const c of node.children) {
    if (typeof c === "string") out.push(escText(c));
    else shapes += emit(c, out);
  }
  out.push(`</${node.tag}>`);
  return shapes;
}

/**
 * يعيد SVG نظيفاً بجذر viewBox="0 0 w h"، أو null إن لم يكن صالحاً/لا يحوي رسماً.
 * إحداثيات النموذج تُفسَّر في فضاء 0..w × 0..h.
 */
export function sanitizeSvg(raw: string, w: number, h: number): string | null {
  if (typeof raw !== "string" || !raw || raw.length > SVG_LIMITS.maxChars) return null;
  if (!(w > 0 && h > 0) || w > 4000 || h > 4000) return null;
  const svg = extractSvg(raw);
  if (!svg) return null;
  const root = parse(svg);
  if (!root || root.tag !== "svg") return null;
  const body: string[] = [];
  let shapes = 0;
  for (const c of root.children) {
    if (typeof c !== "string") shapes += emit(c, body);
  }
  if (shapes === 0) return null;
  const W = Math.round(w), H = Math.round(h);
  const out = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" preserveAspectRatio="none">${body.join("")}</svg>`;
  return out.length > SVG_LIMITS.maxChars ? null : out;
}
