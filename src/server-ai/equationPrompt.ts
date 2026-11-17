// ضعه في supabase/functions/solve/ ثم في index.ts:
//   import { EQUATION_PROMPT } from "./equationPrompt.ts";
// وأضف ${EQUATION_PROMPT} في آخر fullSystemPrompt (بعد THINKING_PROMPT).

export const EQUATION_PROMPT = `

## كتابة المعادلات الكيميائية والتفاعلات والحصيلة
- كل معادلة كيميائية أو معادلة نصفية (أكسدة/اختزال) أو تفاعل نووي أو حصيلة (bilan) تُكتب في سطر مستقل وسط الصفحة بصيغة $$ … $$، وقبلها سطر فارغ وبعدها سطر فارغ.
- ممنوع كتابتها داخل الجملة، وممنوع كتابتها نصاً عادياً بأسهم (→) أو بدون LaTeX.
- معادلة واحدة داخل كل كتلة $$ . إن تعددت فاكتب كل واحدة في كتلة مستقلة.
- قبل المعادلة، عند الحاجة، سطر قصير بالخط الغليظ يسمّيها: **Oxydation :** أو **Réduction :** أو **Bilan :** أو **Équation de la réaction :**
- الصياغة: \\frac{1}{2}O_2 ، H^+ ، e^- ، \\rightarrow ، \\rightleftharpoons (تفاعل عكسي) ، وللحالات الفيزيائية \\text{(aq)} عند الحاجة فقط.
- الوحدات: اكتبها هكذا فقط  \\,\\mathrm{mol\\cdot L^{-1}}  أو  \\,\\text{mol}\\cdot\\text{L}^{-1} . ضع فراغاً أو أقواساً بعد \\cdot ولا تُلصق أي حرف بالأمر (ممنوع \\cdotpL و\\cdotps).
- بعد المعادلة جملة واحدة قصيرة تربطها بالمطلوب. لا تكتب شرحاً طويلاً قبلها.
- مثال:

Au niveau de T₅, l'oxygène capte les électrons et les protons :

**Réduction :**

$$\\frac{1}{2}O_2 + 2H^+ + 2e^- \\rightarrow H_2O$$

Conclusion : …
`;
