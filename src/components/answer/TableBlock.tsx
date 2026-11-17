import { useState, type ReactNode } from "react";
import { Minus, Plus } from "lucide-react";
import ExpandableTable from "@/components/ExpandableTable";

/* ---------- اكتشاف tableau de signes / tableau de variations ---------- */
const stripMath = (c: string) => c.replace(/[$\s]/g, "").toLowerCase();
export type MathTableKind = "variations" | "signs" | null;

export const detectMathTable = (head: string[], rows: string[][]): MathTableKind => {
  if (!head.length || stripMath(head[0]) !== "x") return null;
  const firstCol = rows.map((r) => stripMath(r[0] ?? ""));
  const looksLikeFn = firstCol.some(
    (c) => /^(f|g|h|u|v)['′]?\(|^(f|g|h)\\prime|signe|variation|إشارة|تغيرات/.test(c) || /^[a-z]\(x\)/.test(c),
  );
  if (!looksLikeFn) return null;
  const all = rows.flat().join(" ");
  const hasArrows = /↗|↘|\\nearrow|\\searrow|\\uparrow|\\downarrow/.test(all);
  const hasDeriv = firstCol.some((c) => /['′]|\\prime/.test(c));
  const hasPlain = firstCol.some((c) => /^[a-z]\(x\)$/.test(c));
  return hasArrows || (hasDeriv && hasPlain) ? "variations" : "signs";
};

const MIN_SCALE = 70;
const MAX_SCALE = 170;
const SCALE_STEP = 10;

interface TableBlockProps {
  children: ReactNode;
  /** light = جدول HTML على خلفية بيضاء، theme = يتبع ألوان التطبيق، flat = بلا إطار */
  variant?: "theme" | "light" | "flat";
  tableClassName?: string;
  /** إن وُجد يظهر عنوان الجدول وشريط تكبير/تصغير خاص به (جداول الإشارة والتغيّرات) */
  mathKind?: MathTableKind;
  /** جدول تقدم كيميائي: عنوان واضح وأدوات تكبير مع الاحتفاظ بكل الأعمدة والصفوف. */
  advancement?: boolean;
}

/**
 * الجدول الاحترافي: تمرير أفقي على الهاتف، زر تكبير بملء الشاشة (ExpandableTable)،
 * وللجداول الرياضية عنوان وأزرار حجم خاصة بها. لا يكرّر منطق التمرير بل يعيد استعماله.
 */
export default function TableBlock({ children, variant = "theme", tableClassName, mathKind = null, advancement = false }: TableBlockProps) {
  const [scale, setScale] = useState(100);
  const isAr = typeof document !== "undefined" && document.documentElement.lang === "ar";

  const toolbar = mathKind || advancement ? (
    <div className="math-table-toolbar" dir="ltr">
      <span className="math-table-chip">
        {advancement
          ? (isAr ? "جدول التقدم الكيميائي" : "Tableau d'avancement")
          : mathKind === "variations"
            ? (isAr ? "جدول التغيّرات" : "Tableau de variations")
            : isAr ? "جدول الإشارة" : "Tableau de signes"}
      </span>
      <div className="math-table-font" role="group" aria-label={isAr ? "حجم الجدول" : "Taille du tableau"}>
        <button type="button" onClick={() => setScale((v) => Math.max(MIN_SCALE, v - SCALE_STEP))} disabled={scale <= MIN_SCALE} aria-label={isAr ? "تصغير الجدول" : "Réduire le tableau"}>
          <Minus className="h-3.5 w-3.5" />
        </button>
        <span className="tabular-nums">{scale}%</span>
        <button type="button" onClick={() => setScale((v) => Math.min(MAX_SCALE, v + SCALE_STEP))} disabled={scale >= MAX_SCALE} aria-label={isAr ? "تكبير الجدول" : "Agrandir le tableau"}>
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  ) : undefined;

  return (
    <ExpandableTable variant={variant} tableClassName={tableClassName} toolbar={toolbar} fontScale={mathKind || advancement ? scale : undefined}>
      {children}
    </ExpandableTable>
  );
}
