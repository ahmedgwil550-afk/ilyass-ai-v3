import { useCallback, useEffect, useState } from "react";
import {
  UI_SCALE_EVENT,
  readScreenEnv,
  readStoredChoice,
  resolveScale,
  storeChoice,
  type ScreenEnv,
  type UiScaleChoice,
} from "@/lib/display-scale";

/**
 * حجم الواجهة للإعدادات: الاختيار الحالي (تلقائي أو رقم)، ما تكتشفه الشاشة، والمقياس المطبَّق فعلاً.
 * التطبيق على الصفحة نفسه يتولاه UiScaleSync الموجود في الجذر، فهذا الـhook للقراءة والتغيير فقط.
 * الحالة الأولية ثابتة (تلقائي بلا قياسات) حتى يطابق رسم الخادم ثم تُملأ بعد التركيب.
 */
export function useUiScale() {
  const [choice, setChoiceState] = useState<UiScaleChoice>("auto");
  const [env, setEnv] = useState<ScreenEnv | null>(null);

  useEffect(() => {
    setEnv(readScreenEnv(window));
    setChoiceState(readStoredChoice(window));
    const onChange = (event: Event) => {
      const detail = (event as CustomEvent<UiScaleChoice>).detail;
      setChoiceState(detail === "auto" || typeof detail === "number" ? detail : readStoredChoice(window));
    };
    window.addEventListener(UI_SCALE_EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(UI_SCALE_EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  const setChoice = useCallback((next: UiScaleChoice) => {
    storeChoice(window, next);
    window.dispatchEvent(new CustomEvent<UiScaleChoice>(UI_SCALE_EVENT, { detail: next }));
  }, []);

  const scale = env ? resolveScale(choice, env) : 1;
  return { choice, setChoice, env, scale };
}
