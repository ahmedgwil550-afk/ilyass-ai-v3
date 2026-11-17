import { ANSWER_FONT_DEFAULT } from "@/hooks/use-answer-font";
import { memo, useMemo } from "react";
import MarkdownRenderer from "@/components/MarkdownRenderer";
import AnswerSection from "./AnswerSection";
import { splitSections } from "@/lib/answerSections";

interface Props {
  content: string;
  fontSize?: number;
}

/**
 * عارض الإجابات الغنية: يحلل النص إلى أقسام ويعرض كل قسم عبر MarkdownRenderer
 * (الذي يتولى المعادلات MathBlock والجداول TableBlock والخطوات StepBlock).
 * لا ينتظر اكتمال الإجابة: كل ما وصل يُعرض فوراً.
 */
function RichAnswerRenderer({ content, fontSize = ANSWER_FONT_DEFAULT }: Props) {
  const sections = useMemo(() => splitSections(content), [content]);
  return (
    <div className="rich-answer">
      {sections.map((section, index) => (
        <AnswerSection key={index} variant={section.variant}>
          <MarkdownRenderer content={section.body} fontSize={fontSize} />
        </AnswerSection>
      ))}
    </div>
  );
}

export default memo(RichAnswerRenderer);
