import { useCallback, useEffect, useState } from "react";

/** حجم خط الإجابات: مصدر واحد لشريط الإجابة ولشريط الإعدادات الجانبي. */
export const ANSWER_FONT_MIN = 14;
export const ANSWER_FONT_MAX = 28;
/** 18px: مقروء على الجوال للعربية والفرنسية دون zoom (14px القديمة كانت صغيرة) */
export const ANSWER_FONT_DEFAULT = 18;

const KEY = "ilyass-answer-font-size-v2";
const OLD_KEY = "ilyass-answer-font-size";
const OLD_DEFAULT = 14;
const EVENT = "ilyass-answer-font-size-change";

export const clampAnswerFont = (value: number) =>
  Math.max(ANSWER_FONT_MIN, Math.min(ANSWER_FONT_MAX, Math.round(Number.isFinite(value) ? value : ANSWER_FONT_DEFAULT)));

const read = (): number => {
  try {
    let raw = localStorage.getItem(KEY);
    if (raw === null) {
      // من اختار حجماً غير الافتراضي القديم (14) يحتفظ به؛ أما من بقي على 14 فينتقل للحجم الجديد
      const old = Number(localStorage.getItem(OLD_KEY));
      raw = Number.isFinite(old) && old > 0 && old !== OLD_DEFAULT ? String(old) : null;
    }
    if (raw === null) return ANSWER_FONT_DEFAULT;
    const saved = Number(raw);
    return saved >= ANSWER_FONT_MIN && saved <= ANSWER_FONT_MAX ? Math.round(saved) : ANSWER_FONT_DEFAULT;
  } catch {
    return ANSWER_FONT_DEFAULT;
  }
};

export function useAnswerFontSize(): [number, (next: number | ((prev: number) => number)) => void] {
  const [size, setSizeState] = useState<number>(() => (typeof window === "undefined" ? ANSWER_FONT_DEFAULT : read()));

  // أي مكوّن يغيّر الحجم يبلّغ الباقين (شريط الإجابة + الإعدادات)
  useEffect(() => {
    const onChange = (event: Event) => {
      const value = (event as CustomEvent<number>).detail;
      if (typeof value === "number") setSizeState(clampAnswerFont(value));
    };
    window.addEventListener(EVENT, onChange);
    return () => window.removeEventListener(EVENT, onChange);
  }, []);

  const setSize = useCallback((next: number | ((prev: number) => number)) => {
    setSizeState((prev) => {
      const value = clampAnswerFont(typeof next === "function" ? next(prev) : next);
      try { localStorage.setItem(KEY, String(value)); } catch { /* وضع خاص */ }
      // خارج دورة الرسم الحالية حتى لا نحدّث مكوّناً آخر أثناء رسم هذا
      queueMicrotask(() => window.dispatchEvent(new CustomEvent(EVENT, { detail: value })));
      return value;
    });
  }, []);

  return [size, setSize];
}
