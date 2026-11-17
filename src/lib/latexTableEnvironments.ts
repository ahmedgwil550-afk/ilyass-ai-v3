type LatexTableEnvironment = "tabular" | "array";

const readGroup = (source: string, start: number): { value: string; end: number } | null => {
  if (source[start] !== "{") return null;
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    if (source[i] === "\\" && i + 1 < source.length) {
      i++;
      continue;
    }
    if (source[i] === "{") depth++;
    if (source[i] === "}") {
      depth--;
      if (depth === 0) return { value: source.slice(start + 1, i), end: i + 1 };
    }
  }
  return null;
};

const splitLatexRows = (source: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let depth = 0;

  const pushCell = () => {
    row.push(cell.trim());
    cell = "";
  };
  const pushRow = () => {
    pushCell();
    if (row.some((value) => value.length > 0)) rows.push(row);
    row = [];
  };

  for (let i = 0; i < source.length; i++) {
    const ch = source[i];

    if (ch === "\\" && i + 1 < source.length) {
      const next = source[i + 1];
      if (next === "\\" && depth === 0) {
        pushRow();
        i++;
        while (i + 1 < source.length && /\s/.test(source[i + 1])) i++;
        if (source[i + 1] === "[") {
          const close = source.indexOf("]", i + 2);
          if (close !== -1) i = close;
        }
        continue;
      }
      if (/[a-zA-Z]/.test(next)) {
        let end = i + 1;
        while (end + 1 < source.length && /[a-zA-Z]/.test(source[end + 1])) end++;
        const command = source.slice(i + 1, end + 1);
        if (["hline", "toprule", "midrule", "bottomrule", "smallskip"].includes(command)) {
          i = end;
          continue;
        }
        if (command === "cline") {
          const group = readGroup(source, end + 1);
          if (group) i = group.end - 1;
          else i = end;
          continue;
        }
      }
      cell += ch + next;
      i++;
      continue;
    }

    if (ch === "{") depth++;
    else if (ch === "}") depth = Math.max(0, depth - 1);

    if (ch === "&" && depth === 0) {
      pushCell();
      continue;
    }
    cell += ch;
  }

  if (cell.trim() || row.length) pushRow();
  return rows;
};

const alignmentFromSpec = (spec: string): string[] => {
  const result: string[] = [];
  for (let i = 0; i < spec.length; i++) {
    if (spec[i] === "l" || spec[i] === "c" || spec[i] === "r") {
      result.push(spec[i] === "l" ? ":---" : spec[i] === "r" ? "---:" : ":---:");
    } else if (spec[i] === "p" || spec[i] === "m" || spec[i] === "b") {
      if (spec[i + 1] === "{") {
        const group = readGroup(spec, i + 1);
        if (group) i = group.end - 1;
      }
      result.push(":---:");
    }
  }
  return result;
};

const escapeMarkdownCell = (value: string): string =>
  value.replace(/(^|[^\\])\|/g, "$1\\|").replace(/\r?\n/g, " ");

const toMarkdownTable = (rows: string[][], spec: string, isArray: boolean): string | null => {
  if (!rows.length) return null;
  const columns = Math.max(rows[0].length, ...rows.map((row) => row.length));
  if (!columns || columns > 24 || rows.length > 80) return null;

  const alignments = alignmentFromSpec(spec);
  const separator = Array.from({ length: columns }, (_, i) => alignments[i] ?? ":---:");
  const normalize = (row: string[]) =>
    Array.from({ length: columns }, (_, i) => {
      const value = row[i] ?? "";
      const cell = isArray && value && !/^\s*\$[\s\S]*\$\s*$/.test(value)
        ? "$" + value + "$"
        : value;
      return escapeMarkdownCell(cell);
    });

  const output = [
    "| " + normalize(rows[0]).join(" | ") + " |",
    "| " + separator.join(" | ") + " |",
    ...rows.slice(1).map((row) => "| " + normalize(row).join(" | ") + " |"),
  ];
  return " \n\n\`\`\`mdtable\n" + output.join("\n") + "\n\`\`\`\n\n";
};

/**
 * Convert supported LaTeX tabular/array environments to the app's safe Markdown-table
 * pipeline. It deliberately leaves malformed or oversized environments untouched.
 */
export const convertLatexTableEnvironments = (input: string): string => {
  let output = "";
  let cursor = 0;
  const beginPattern = /\\begin\{(tabular|array)\}/g;
  let match: RegExpExecArray | null;

  while ((match = beginPattern.exec(input)) !== null) {
    const precedingLines = input.slice(0, match.index).match(/^\s*(?:```|~~~)/gm) ?? [];
    if (precedingLines.length % 2 === 1) continue;

    const environment = match[1] as LatexTableEnvironment;
    while (/\s/.test(input[beginPattern.lastIndex] ?? "")) beginPattern.lastIndex++;
    const spec = readGroup(input, beginPattern.lastIndex);
    if (!spec) continue;

    const endToken = "\\end{" + environment + "}";
    const end = input.indexOf(endToken, spec.end);
    if (end === -1) continue;

    const rows = splitLatexRows(input.slice(spec.end, end));
    const table = toMarkdownTable(rows, spec.value, environment === "array");
    if (!table) continue;

    let prefixEnd = match.index;
    let suffixStart = end + endToken.length;
    if (environment === "array") {
      const before = input.slice(cursor, prefixEnd);
      const trimmedBefore = before.trimEnd();
      if (trimmedBefore.endsWith("\\[") || trimmedBefore.endsWith("$$")) {
        prefixEnd = cursor + trimmedBefore.length - 2;
      }
      const after = input.slice(suffixStart);
      const trimmedAfter = after.trimStart();
      const leadingWhitespace = after.length - trimmedAfter.length;
      if (trimmedAfter.startsWith("\\]") || trimmedAfter.startsWith("$$")) {
        suffixStart += leadingWhitespace + 2;
      }
    }
    output += input.slice(cursor, prefixEnd);
    output += table;
    cursor = suffixStart;
    beginPattern.lastIndex = cursor;
  }

  return cursor === 0 ? input : output + input.slice(cursor);
};
