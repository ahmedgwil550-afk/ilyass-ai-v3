import type { ReactNode } from "react";
import AnswerFontControl from "./AnswerFontControl";

interface Props {
  lang: "ar" | "fr";
  /** شعار/أيقونة بجانب العنوان */
  icon?: ReactNode;
  title?: string;
  /** إن مُرّرت يظهر شريط حجم الخط */
  fontSize?: number;
  onFontSizeChange?: (next: number) => void;
  /** أزرار إضافية (نسخ…) بجانب شريط الخط */
  actions?: ReactNode;
  children: ReactNode;
  /** يظهر أسفل الصندوق (مثل زر إنشاء صورة الحل) */
  footer?: ReactNode;
}

/** صندوق الإجابة: رأس (عنوان + أدوات) ثم المحتوى ثم التذييل. يستعمل كلاس ai-response-card الموجود. */
export default function AnswerBox({ lang, icon, title, fontSize, onFontSizeChange, actions, children, footer }: Props) {
  return (
    <div className="ai-response-card answer-box overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-1 py-2">
        <div className="flex min-w-0 items-center gap-2">
          {icon}
          <span className="truncate text-xs font-semibold text-primary/80">{title ?? (lang === "ar" ? "الإجابة" : "Réponse")}</span>
        </div>
        <div className="flex items-center gap-1">
          {fontSize !== undefined && onFontSizeChange && <AnswerFontControl size={fontSize} onChange={onFontSizeChange} lang={lang} />}
          {actions}
        </div>
      </div>
      <div className="px-1 py-2">{children}</div>
      {footer && <div className="px-1 py-2">{footer}</div>}
    </div>
  );
}
