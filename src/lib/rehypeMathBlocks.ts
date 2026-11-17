/**
 * بعد rehype-katex: يغلّف كل معادلة مستقلة (span.katex-display) بعنصر <mathblock>
 * يُربط في MarkdownRenderer بمكوّن MathBlock. لا ندخل داخل مخرجات KaTeX (آلاف الـ span)
 * فلا يتأثر زمن الرسم أثناء البث، ولا نستبدل مكوّن span لكل عقدة.
 */
type HastNode = {
  type: string;
  tagName?: string;
  properties?: { className?: unknown };
  children?: HastNode[];
};

const classList = (node: HastNode): string[] => {
  const cls = node.properties?.className;
  return Array.isArray(cls) ? cls.map(String) : typeof cls === "string" ? cls.split(/\s+/) : [];
};

export function rehypeMathBlocks() {
  return (tree: HastNode) => {
    const walk = (node: HastNode) => {
      if (!node.children) return;
      node.children = node.children.map((child) => {
        if (child.type !== "element") return child;
        const classes = classList(child);
        if (child.tagName === "span" && classes.includes("katex-display")) {
          return { type: "element", tagName: "mathblock", properties: {}, children: [child] };
        }
        if (!classes.includes("katex")) walk(child); // لا ننزل داخل معادلة مرسومة
        return child;
      });
    };
    walk(tree);
  };
}
