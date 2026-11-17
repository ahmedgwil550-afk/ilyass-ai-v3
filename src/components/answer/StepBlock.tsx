import type { ReactNode } from "react";

/** قائمة خطوات الحل مرقّمة بدوائر (CSS counters). عناصرها li يضبط MarkdownRenderer اتجاهها. */
export default function StepBlock({ start, children }: { start?: number; children: ReactNode }) {
  return (
    <ol className="step-block" start={start} style={start && start > 1 ? { counterReset: `step ${start - 1}` } : undefined}>
      {children}
    </ol>
  );
}
