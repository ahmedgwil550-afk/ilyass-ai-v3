/**
 * نظام كثافة الشاشة: يضبط حجم الواجهة كلها حسب شاشة الهاتف.
 *
 * المتصفح لا يكشف الـDPI الحقيقي، لكنه يكشف عرض الشاشة بوحدة CSS (وهي وحدة dp في أندرويد وpt في iOS).
 * هواتف اليوم متقاربة في العرض الفيزيائي (حوالي 2.7 إلى 3 إنش)، فإذا ظهر عرض أكبر من المعتاد
 * (مثلاً بعد تصغير "حجم العرض" في الإعدادات أو رفع الـDPI) فالبكسل صار أصغر فيزيائياً والنص
 * أصغر معه، فنكبّر الواجهة بنفس النسبة. لا نصغّر أبداً: الأساس مضبوط أصلاً للقراءة بدون zoom.
 *
 * التطبيق عبر متغير CSS واحد (--ui-scale) يضرب حجم خط الجذر، فيكبر كل ما هو بوحدة rem
 * (النصوص والهوامش والأيقونات) معاً، وخط الإجابات يضربه أيضاً.
 */

export const UI_SCALE_KEY = "ilyass-ui-scale-v1";
export const UI_SCALE_EVENT = "ilyass-ui-scale-change";
export const UI_SCALE_VAR = "--ui-scale";

/** عرض هاتف قياسي بوحدة CSS (iPhone 14 = 390): عنده يكون المقياس 1 */
export const REFERENCE_PHONE_WIDTH = 390;
/** أقصر ضلع للشاشة، أقل منه نعدّ الجهاز هاتفاً (الأجهزة اللوحية وسطح المكتب = 1) */
export const PHONE_MAX_SHORT_SIDE = 600;
export const AUTO_MIN = 1;
export const AUTO_MAX = 1.3;
export const MANUAL_MIN = 0.85;
export const MANUAL_MAX = 1.5;

export const SCALE_PRESETS = [
  { value: 0.9, ar: "صغير", fr: "Petit" },
  { value: 1, ar: "عادي", fr: "Normal" },
  { value: 1.15, ar: "كبير", fr: "Grand" },
  { value: 1.3, ar: "كبير جداً", fr: "Très grand" },
  { value: 1.45, ar: "ضخم", fr: "Énorme" },
] as const;

export type UiScaleChoice = "auto" | number;

export interface ScreenEnv {
  /** أقصر ضلع للشاشة (لا يتغير بتدوير الجهاز) */
  shortSide: number;
  longSide: number;
  /** كثافة البكسل: devicePixelRatio */
  dpr: number;
  /** اللمس هو المؤشر الأساسي (هاتف/لوحي) */
  coarse: boolean;
  /** عرض نافذة العرض الحالية */
  viewportWidth: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** المقياس التلقائي: هاتف فقط، من 1 إلى 1.3 بنسبة عرض الشاشة إلى الهاتف القياسي */
export function computeAutoScale(env: Pick<ScreenEnv, "shortSide" | "coarse">): number {
  const { shortSide, coarse } = env;
  if (!coarse || !(shortSide > 0) || shortSide >= PHONE_MAX_SHORT_SIDE) return 1;
  return round2(Math.min(AUTO_MAX, Math.max(AUTO_MIN, shortSide / REFERENCE_PHONE_WIDTH)));
}

/** قيمة محفوظة غير صالحة أو غائبة = تلقائي */
export function parseChoice(raw: string | null | undefined): UiScaleChoice {
  if (!raw || raw === "auto") return "auto";
  const n = Number(raw);
  return n >= MANUAL_MIN && n <= MANUAL_MAX ? round2(n) : "auto";
}

export function resolveScale(choice: UiScaleChoice, env: Pick<ScreenEnv, "shortSide" | "coarse">): number {
  return choice === "auto" ? computeAutoScale(env) : choice;
}

export function readScreenEnv(win: Window): ScreenEnv {
  const w = win.screen?.width || 0;
  const h = win.screen?.height || 0;
  return {
    shortSide: Math.min(w, h),
    longSide: Math.max(w, h),
    dpr: win.devicePixelRatio || 1,
    coarse: !!win.matchMedia?.("(pointer: coarse)").matches,
    viewportWidth: win.innerWidth || 0,
  };
}

export function readStoredChoice(win: Window): UiScaleChoice {
  try {
    return parseChoice(win.localStorage.getItem(UI_SCALE_KEY));
  } catch {
    return "auto";
  }
}

export function storeChoice(win: Window, choice: UiScaleChoice) {
  try {
    if (choice === "auto") win.localStorage.removeItem(UI_SCALE_KEY);
    else win.localStorage.setItem(UI_SCALE_KEY, String(choice));
  } catch {
    /* وضع خاص: يبقى الاختيار لهذه الجلسة فقط */
  }
}

/** يكتب المتغير فقط إذا تغيّر، حتى لا نُعيد حساب الأنماط بلا داعٍ */
export function applyUiScale(doc: Document, scale: number) {
  const value = String(round2(scale));
  const style = doc.documentElement.style;
  if (style.getPropertyValue(UI_SCALE_VAR) !== value) style.setProperty(UI_SCALE_VAR, value);
}

/** الكثافة التقريبية بالـdpi: 160 لكل وحدة dp (قياس أندرويد)، وهي تقدير وليست قياساً */
export const approxDpi = (dpr: number) => Math.round(dpr * 160);

/** المتصفح يعرض نسخة سطح المكتب على هاتف: العرض أكبر من أي شاشة هاتف فعلاً */
export function looksLikeDesktopSite(env: ScreenEnv): boolean {
  return env.coarse && env.shortSide > 0 && env.shortSide < PHONE_MAX_SHORT_SIDE && env.viewportWidth > env.longSide * 1.05;
}

/**
 * يُنفَّذ داخل <head> قبل أول رسم فلا يظهر وميض بالحجم القديم. نفس منطق الدوال أعلاه تماماً
 * (display-scale.test.ts يشغّله ويقارن نتيجته بها لعدة هواتف).
 */
export const UI_SCALE_BOOT_SCRIPT =
  `(function(){try{var w=window,s=w.screen||{},sh=Math.min(s.width||0,s.height||0),` +
  `co=!!(w.matchMedia&&w.matchMedia("(pointer: coarse)").matches),c=null,v,k;` +
  `try{c=w.localStorage.getItem(${JSON.stringify(UI_SCALE_KEY)})}catch(e){}` +
  `v=Number(c);` +
  `if(c&&c!=="auto"&&v>=${MANUAL_MIN}&&v<=${MANUAL_MAX}){k=v}` +
  `else{k=(co&&sh>0&&sh<${PHONE_MAX_SHORT_SIDE})?Math.min(${AUTO_MAX},Math.max(${AUTO_MIN},sh/${REFERENCE_PHONE_WIDTH})):1}` +
  `document.documentElement.style.setProperty(${JSON.stringify(UI_SCALE_VAR)},String(Math.round(k*100)/100))` +
  `}catch(e){}})();`;
