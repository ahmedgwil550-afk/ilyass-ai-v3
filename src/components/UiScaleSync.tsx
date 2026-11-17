import { useEffect } from "react";
import {
  UI_SCALE_EVENT,
  applyUiScale,
  readScreenEnv,
  readStoredChoice,
  resolveScale,
  type UiScaleChoice,
} from "@/lib/display-scale";

/**
 * يطبّق مقياس الواجهة على الصفحة ويتابع تغيّره من الإعدادات أو من تبويب آخر.
 * السكربت المضمَّن في <head> يضبط القيمة قبل أول رسم؛ هذا المكوّن يضمن نفس النتيجة إذا لم يعمل السكربت،
 * ويستجيب فوراً لأي تغيير. لا يرسم شيئاً.
 */
export default function UiScaleSync() {
  useEffect(() => {
    let choice: UiScaleChoice = readStoredChoice(window);
    const sync = () => applyUiScale(document, resolveScale(choice, readScreenEnv(window)));
    const onChange = (event: Event) => {
      const detail = (event as CustomEvent<UiScaleChoice>).detail;
      choice = detail === "auto" || typeof detail === "number" ? detail : readStoredChoice(window);
      sync();
    };
    sync();
    window.addEventListener(UI_SCALE_EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(UI_SCALE_EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);
  return null;
}
