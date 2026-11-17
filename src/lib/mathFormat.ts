/**
 * Convert LaTeX delimiters from \(...\) and \[...\] to $...$ and $$...$$
 * so remark-math can parse them properly.
 */
export function convertLatexDelimiters(text: string): string {
  // Convert \[...\] to $$...$$  (block math)
  let result = text.replace(/\\\[([\s\S]*?)\\\]/g, '\n$$$$\n$1\n$$$$\n');
  // Convert \(...\) to $...$ (inline math)
  result = result.replace(/\\\(([\s\S]*?)\\\)/g, ' $$$1$$ ');
  // Put every $$...$$ block on its own lines so it never swallows surrounding text
  result = result.replace(/\$\$([\s\S]+?)\$\$/g, (_m, body: string) => `\n\n$$\n${body.trim()}\n$$\n\n`);
  // Headings / question numbers glued mid-line move to a new line
  result = result.replace(/([^\n#])[ \t]*\n?[ \t]*(#{1,4} )/g, '$1\n\n$2');
  return result.replace(/\n{3,}/g, '\n\n');
}
