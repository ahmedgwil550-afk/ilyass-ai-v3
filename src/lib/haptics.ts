/**
 * اهتزاز خفيف عند كل خطوة (مثل iPhone).
 * - Android/Chrome: navigator.vibrate.
 * - iOS Safari 17.4+: لا يدعم vibrate، لكن النقر على <input type="checkbox" switch> يُصدر اهتزازاً نظامياً.
 * يفشل بصمت إذا لم يكن مدعوماً.
 */
let label: HTMLLabelElement | null = null;

function iosSwitch(): HTMLLabelElement | null {
  if (typeof document === "undefined") return null;
  if (label && label.isConnected) return label;
  try {
    // نفس الأسلوب المعروف على iOS: label مخفي بـ display:none يحوي مفتاح switch، والنقر عليه برمجياً يُصدر الاهتزاز
    const input = document.createElement("input");
    input.type = "checkbox";
    input.setAttribute("switch", "");
    const l = document.createElement("label");
    l.setAttribute("aria-hidden", "true");
    l.style.display = "none";
    l.appendChild(input);
    (document.head || document.body).appendChild(l);
    label = l;
    return l;
  } catch {
    return null;
  }
}

export function hapticTick(ms = 8): void {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate(ms);
      return;
    }
    iosSwitch()?.click();
  } catch { /* غير مدعوم */ }
}
