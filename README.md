# ILYASS AI Homework Helper

A web-based AI-powered homework and exam helper that uses AI to provide answers and solutions to exercises and exam questions.



Core Features:



Submit questions via text input or image upload

Get AI-generated answers and step-by-step solutions

Support for multiple subjects (math, science, etc.)

View solution history

Visual References:

Inspired by Photomath and Socratic by Google, known for their clean educational interfaces and clear solution presentation.



Style Guide:



Colors: Primary #6366F1 (indigo), Secondary #8B5CF6 (purple), Background #F9FAFB (light grey), Text #111827 (dark grey), Accent #10B981 (green), Success #34D399 (light green)

Design: Inter/Poppins/Roboto fonts, card-based layout for questions and answers, clear typography hierarchy, 20px spacing, mobile-friendly responsive design with prominent input area and organized solution display



Console

npm run dev

Secrets

Secrets

SESSION_SECRET

••••••••

AI_INTEGRATIONS_OPENAI_BASE_URL

••••••••

AI_INTEGRATIONS_OPENAI_API_KEY

••••••••

Configurations

Configurations are similar to secrets, but should only be used for non-sensitive information. They're useful for having a variable that's different between your published app and when testing on Replit.

Preview

/



Agent

A web-based AI-powered homework and exam helper that uses AI to provide answers and solutions to exercises and exam questions.



Core Features:



Submit questions via text input or image upload

Get AI-generated answers and step-by-step solutions

Support for multiple subjects (math, science, etc.)

View solution history

Visual References:

Inspired by Photomath and Socratic by Google, known for their clean educational interfaces and clear solution presentation.



Style Guide:



Colors: Primary #6366F1 (indigo), Secondary #8B5CF6 (purple), Background #F9FAFB (light grey), Text #111827 (dark grey), Accent #10B981 (green), Success #34D399 (light green)

Design: Inter/Poppins/Roboto fonts, card-based layout for questions and answers, clear typography hierarchy, 20px spacing, mobile-friendly responsive design with prominent input area and organized solution display

Want users to get these changes? Republish this App.

Published apps not available

There is an issue preventing you from publishing. You may be able to resolve this using the Publishing pane.

اريد أن تجعله لا يخطأ في قراءة السؤال إدا تم إرسال صورة يجب عليه عدم الخطأ في السؤال وأيضا في الإجابات يجاوب منظم كما في الورقة



ولكنه بطيء جدا



هل يمكنك أن تجعل هناك سجل



السجل موجود بالفعل في التطبيق! يمكنك الوصول إليه من خلال الضغط على "History" في القائمة الجانبية. هناك ستجد جميع الأسئلة السابقة مع إجاباتها.



هل تقصد شيئاً مختلفاً عن سجل الأسئلة الموجود؟ مثلاً سجل دخول للمستخدمين (تسجيل حساب وتسجيل دخول)؟



ماذا تقصد بالسجل؟



سجل الأسئلة والإجابات السابقة (موجود بالفعل في صفحة History)

سجل الأسئلة والإجابات السابقة موجود بالفعل في التطبيق. يمكنك الوصول إليه بالضغط على "History" في القائمة الجانبية على اليسار. هناك ستجد جميع الأسئلة التي طرحتها سابقاً مع إجاباتها الكاملة، ويمكنك الضغط على أي سؤال لرؤية الحل مرة أخرى.



للعلم انا اريده أن يشتغل للتانوي ويكون يقدر يحل المساؤل والمعادلات والسائلة المتعلقة بالمستوى الثانوي

وأيضا اريدك أن تسميه ILYASS AI



هل يعتمد على API



نعم، التطبيق يعتمد على OpenAI API لتوليد الإجابات والحلول. تحديداً يستخدم نموذج gpt-4.1-mini الذي يوفر إجابات سريعة ودقيقة.



الطريقة التي يعمل بها:



تكتب سؤالك أو ترفع صورة للسؤال

التطبيق يرسل السؤال إلى OpenAI API

الإجابة تظهر تدريجياً (streaming) بدل انتظار الإجابة الكاملة

مفتاح الـ API مُدار تلقائياً من خلال نظام Replit، فلا تحتاج لإعداده يدوياً.



هل تريد تعديل شيء معين أو نشر التطبيق؟



✅ الحل (إذا كنت تستعمل React)

ثبت هذه المكتبات:

Bash

Copy code

npm install react-markdown remark-math rehype-katex katex

ثم في الكود:

Javascript

Copy code

import ReactMarkdown from "react-markdown";

import remarkMath from "remark-math";

import rehypeKatex from "rehype-katex";

import "katex/dist/katex.min.css";



<ReactMarkdown

remarkPlugins={[remarkMath]}

rehypePlugins={[rehypeKatex]}



{response}

</ReactMarkdown>

🔥 الآن سيظهر كل LaTeX بشكل جميل.



لي:

هل مشروعك React؟

أم HTML عادي؟

أم Next.js؟



المشروع مبني بـ React مع Vite للواجهة الأمامية، و Express.js للخادم الخلفي. كلاهما بـ TypeScript.



هل تريد تعديل شيء معين؟



✅ الحل الصحيح 100% لـ React + Vite + TS

1️⃣ تأكد أنك ثبت هذه الحزم:

Bash

Copy code

npm install react-markdown remark-math rehype-katex katex

2️⃣ في ملف العرض (مثلاً Message.tsx أو Chat.tsx)

ضع هذا بالضبط:

Tsx

Copy code

import ReactMarkdown from "react-markdown";

import remarkMath from "remark-math";

import rehypeKatex from "rehype-katex";

import "katex/dist/katex.min.css";



type Props = {

content: string;

};



export default function MarkdownRenderer({ content }: Props) {

return (

<ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]} >

{content}

</ReactMarkdown>

);

}

3️⃣ المهم جداً 🔴

تأكد أن الرد القادم من الـ API يحتوي على:

✔ Inline math

Copy code



$ x^2 + 1 $

✔ Block math

Copy code



$$

\frac{x}{4x^2+1}

$$

⚠ إذا كان بدون $ أو $$ فلن يشتغل.

🔥 المشكل عندك غالباً هنا:

في الصورة التي أرسلتها يظهر:

Copy code



[ P_1 : (\exists x \in \mathbb{R}) ... ]

أنت تستعمل ( و )

لكن remark-math يشتغل مع:

Copy code



$ ... $

$$ ... $$

✅ الحل النهائي

قبل عرض النص، قم بتحويل:

Copy code



(...)

إلى:

Copy code



$...$

و

Copy code



[...]

إلى:

Copy code



$$...$$

مثلاً:

Tsx

Copy code

const formatted = content

.replace(/\(/g, "$")

.replace(/\)/g, "$")

.replace(/\[/g, "$$")

.replace(/\]/g, "$$");

ثم:

Tsx

Copy code

<MarkdownRenderer content={formatted} />

للعلم انا اريده أن يشتغل للتانوي ويكون يقدر يحل المساؤل والمعادلات والسائلة المتعلقة بالمستوى الثانوي

وأيضا اريدك أن تسميه ILYASS AI

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/77b0597f-4976-44ca-ad84-6c0f57a9d15c).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
