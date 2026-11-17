## Goal

Make ILYASS AI render any table inside answers using a clean, exam-style HTML template (Moroccan/French exam look) — instead of the current colored sign/variation tables.

## Scope

Update the AI system prompts so that whenever the question contains or requires a table (sign tables, variation tables, proportionality tables, fill-in-the-blank tables, data tables, etc.), the model returns ONE consistent HTML format that matches the exact template provided by the user.

No frontend changes are needed — `MarkdownRenderer.tsx` already renders ````html` blocks via `dangerouslySetInnerHTML`, so the template will display exactly as written.

## Files to update

1. `supabase/functions/solve/index.ts`
  - Replace the existing "الجداول" / sign-table / variation-table block (lines ~136–225) with a single unified rule using the new template.
  - Keep colored +/−/0 only inside cells when relevant (sign tables) — the outer wrapper, borders, padding, headers and dotted placeholders follow the new template exactly.
2. `supabase/functions/solve-pdf/index.ts`
  - Replace the short "إذا طُلب جدول..." instruction with the same unified table rule.
3. `supabase/functions/solve-geometry/index.ts`
  - Add the same table rule (short version) so geometry answers with tables stay consistent.

## New unified table rule (inserted into each system prompt)

```text
## الجداول (إلزامي):
عند وجود أي جدول في السؤال أو الحاجة لإنشاء جدول (tableau de signes,
tableau de variations, tableau de proportionnalité, جدول بيانات, جدول للملء…):
- استخدم دائماً HTML داخل بلوك ```html
- لا تستخدم جداول Markdown أبداً
- اتبع هذا القالب حرفياً:

<div style="margin-top:12px; border:1px solid #555; border-radius:8px; overflow:hidden;">
  <table style="width:100%; border-collapse:collapse; text-align:center; background:#ffffff;">
    <thead>
      <tr>
        <th style="border:1px solid #555; padding:10px; background:#f5f5f5; font-weight:bold;">Header</th>
        ...
      </tr>
    </thead>
    <tbody>
      <tr>
        <td style="border:1px solid #555; padding:10px;">valeur</td>
        ...
      </tr>
    </tbody>
  </table>
</div>

قواعد:
1. حافظ على نفس عدد الأعمدة/الصفوف الموجودة في السؤال.
2. الخلايا الفارغة للملء = "...................................." (نقاط).
3. إذا كان المحتوى عربياً: أضف dir="rtl" على <table>، وإلا اتركه LTR.
4. الحدود: 1px solid #555، border-collapse:collapse.
5. خلفية بيضاء، padding 10px، نص موسط، عرض 100%.
6. الرؤوس: bold + خلفية #f5f5f5.
7. ادعم colspan/rowspan عند الحاجة لدمج الخلايا.
8. لجداول الإشارات فقط: يمكن تلوين + بالأخضر، − بالأحمر، 0 بالأزرق داخل الخلية.
9. لا تضف أي CSS خارج style="..." inline.
10. لا تكتب شرحاً داخل بلوك html — فقط الجدول.
```

## Notes

- The frontend already supports inline HTML tables (see `MarkdownRenderer.tsx` `language-html` branch) so no rendering work is required.
- Colors for sign tables remain allowed but ins.
- Update the AI system prompts so that all tables are rendered using a unified exam-style HTML template.
  ## Files to Update
  1. `supabase/functions/solve/index.ts`
    - Locate the existing section that handles:
      - `## الجداول`
      - sign tables (`tableau de signes`)
      - variation tables (`tableau de variations`)
    - Replace that entire block with the unified table rule below.
  2. `supabase/functions/solve-pdf/index.ts`
    - Replace the short instruction beginning with:
      - `إذا طُلب جدول...`
    - Use the same unified table rule.
  3. `supabase/functions/solve-geometry/index.ts`
    - Add the same unified table rule (or a short version referencing it).
  ---
  ## Unified Table Rule to Insert
  ```text
  ## الجداول (إلزامي):
  عند وجود أي جدول في السؤال أو الحاجة لإنشاء جدول (tableau de signes,
  tableau de variations, tableau de proportionnalité, جدول بيانات, جدول للملء…):
  - استخدم دائماً HTML داخل بلوك ```html
  - لا تستخدم جداول Markdown أبداً
  - اتبع هذا القالب حرفياً:

  <div style="margin-top:12px; border:1px solid #555; border-radius:8px; overflow:hidden;">
    <table style="width:100%; border-collapse:collapse; text-align:center; background:#ffffff;">
      <thead>
        <tr>
          <th style="border:1px solid #555; padding:10px; background:#f5f5f5; font-weight:bold;">Header</th>
          ...
        </tr>
      </thead>
      <tbody>
        <tr>
          <td style="border:1px solid #555; padding:10px;">valeur</td>
          ...
        </tr>
      </tbody>
    </table>
  </div>

  قواعد:
  1. حافظ على نفس عدد الأعمدة/الصفوف الموجودة في السؤال.
  2. الخلايا الفارغة للملء = "...................................." (نقاط).
  3. إذا كان المحتوى عربياً: أضف dir="rtl" على <table>، وإلا اتركه LTR.
  4. الحدود: 1px solid #555، border-collapse:collapse.
  5. خلفية بيضاء، padding 10px، نص موسط، عرض 100%.
  6. الرؤوس: bold + خلفية #f5f5f5.
  7. ادعم colspan/rowspan عند الحاجة لدمج الخلايا.
  8. لجداول الإشارات فقط: يمكن تلوين + بالأخضر، − بالأحمر، 0 بالأزرق داخل الخلية.
  9. لا تضف أي CSS خارج style="..." inline.
  10. لا تكتب شرحاً داخل بلوك html — فقط الجدول.

  ```
  ---
  ## Important Notes
  - Do not modify frontend files.
  - `MarkdownRenderer.tsx` already renders ```html blocks using `dangerouslySetInnerHTML`.
  - Preserve colored `+`, `−`, and `0` inside cells for sign tables only.
  - All table types must use the exact same outer HTML structure.
  - No database, auth, or UI changes are required.
  ---
  ## Expected Result
  After this update, all generated tables (including:
  - sign tables,
  - variation tables,
  - proportionality tables,
  - fill-in-the-blank tables,
  - statistics/data tables)
  will render using a clean black-and-white exam-style design matching Moroccan/French official exam sheets.