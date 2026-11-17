/**
 * تقسيم نص الإجابة إلى أقسام عند العناوين (دالة نقية قابلة للاختبار).
 */
export interface AnswerSectionData {
  body: string;
  variant: "question" | "plain";
}

// عنوان سؤال مرقّم: "## 4. …" أو "## ❓ 4) …"
const QUESTION_HEADING = /^#{1,3}\s*(?:[❓?]\s*)?\d+\s*[.)\-–:]/u;
const HEADING = /^#{1,3}\s+\S/;

/**
 * يقسم نص الإجابة إلى أقسام عند العناوين (خارج كتل الكود ومعادلات $$ المفتوحة).
 * كل قسم مكتمل يبقى نصه ثابتاً أثناء البث، فلا يُعاد رسمه؛ يُحدَّث القسم الأخير فقط.
 */
export function splitSections(md: string): AnswerSectionData[] {
  const sections: AnswerSectionData[] = [];
  let lines: string[] = [];
  let inFence = false;
  let inMath = false;

  const flush = () => {
    const body = lines.join("\n");
    if (body.trim()) {
      sections.push({ body, variant: QUESTION_HEADING.test(lines.find((l) => l.trim()) ?? "") ? "question" : "plain" });
    }
    lines = [];
  };

  for (const line of md.split("\n")) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    if (!inFence && !inMath && HEADING.test(line) && lines.some((l) => l.trim())) flush();
    lines.push(line);
    if (!inFence) {
      const marks = (line.match(/\$\$/g) || []).length;
      if (marks % 2 === 1) inMath = !inMath;
    }
  }
  flush();
  return sections;
}
