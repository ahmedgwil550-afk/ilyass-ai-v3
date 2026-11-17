import type { ReactNode } from "react";

interface Props {
  /** question: عنوان سؤال مرقّم (4. …) يأخذ شريطاً جانبياً؛ plain: مقدّمة أو قسم عادي */
  variant?: "question" | "plain";
  children: ReactNode;
}

/** قسم مستقل داخل الإجابة (عنوانه ومحتواه). الغلاف بنيوي فقط؛ التنسيق في markdown-math.css. */
export default function AnswerSection({ variant = "plain", children }: Props) {
  return <section className={`answer-section answer-section--${variant}`}>{children}</section>;
}
