/**
 * أثناء البث قد ينتهي النص في منتصف معادلة ($x_1 = \frac{v أو $$ ...) فتظهر أكواد LaTeX خام
 * وتقفز المعادلة عند اكتمالها. هذه الدالة تخفي المعادلة غير المكتملة حتى تكتمل.
 * استعملها فقط أثناء البث:  <MarkdownRenderer content={streaming ? stabilizeStreaming(text) : text} />
 */
export function stabilizeStreaming(md: string): string {
  let inBlock = false;
  let inInline = false;
  let start = -1;
  let inFence = false;

  for (let i = 0; i < md.length; i++) {
    const c = md[i];

    // كتل الكود ``` لا نلمس ما بداخلها
    if (!inBlock && !inInline && md.startsWith("```", i)) {
      inFence = !inFence;
      i += 2;
      continue;
    }
    if (inFence) continue;

    if (c === "\\") { i++; continue; } // \$ مهرّبة
    if (c !== "$") continue;

    if (md.startsWith("$$", i)) {
      if (inInline) continue;
      if (inBlock) { inBlock = false; start = -1; } else { inBlock = true; start = i; }
      i++;
    } else if (!inBlock) {
      if (inInline) { inInline = false; start = -1; } else { inInline = true; start = i; }
    }
  }

  let out = (inBlock || inInline) && start >= 0 ? md.slice(0, start) : md;

  // معادلة \( ... أو \[ ... لم تُغلق بعد
  for (const [open, close] of [["\\(", "\\)"], ["\\[", "\\]"]] as const) {
    const o = out.lastIndexOf(open);
    if (o !== -1 && out.indexOf(close, o + 2) === -1) out = out.slice(0, o);
  }

  // صف جدول ناقص (لم يُغلق بـ |): نخفيه حتى يكتمل كي لا تتبدل الأعمدة والأرقام مع كل دفعة
  const lastNl = out.lastIndexOf("\n");
  const lastLine = out.slice(lastNl + 1);
  const t = lastLine.trim();
  if (t.startsWith("|") && (t.length < 2 || !t.endsWith("|") || t.endsWith("\\|"))) {
    out = out.slice(0, lastNl + 1);
  }
  return out;
}
