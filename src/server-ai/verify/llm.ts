/**
 * واجهة النموذج المحقِّق + قراءة JSON منه بتساهل + تعقيم الادعاءات.
 * النموذج هنا ناقل فقط: كل ما يعيده يُفحص شكلاً ومضموناً قبل أن يصل إلى الكود الحاسم.
 */
import type { Claim } from "./claims";

export type LlmRole = "extract" | "solve" | "compare" | "reread" | "method";
export interface LlmRequest {
  role: LlmRole;
  system: string;
  user: string;
  /** أجزاء image_url بصيغة OpenAI (لمرحلة الحل المستقل عندما يكون الامتحان صورة) */
  images?: any[];
  maxTokens: number;
  signal?: AbortSignal;
}
/** يعيد نص رد النموذج، أو null عند أي فشل (لا يرمي أبداً في الاستعمال العادي). */
export type LlmFn = (req: LlmRequest) => Promise<string | null>;

export interface ChatLlmOptions {
  chatUrl: string;
  key: string;
  /** اسم النموذج لكل دور */
  model: (role: LlmRole) => string;
}

/** محوّل عام لواجهة chat/completions المتوافقة مع OpenAI (غير متدفقة). */
export function makeChatLlm(o: ChatLlmOptions): LlmFn {
  return async (req) => {
    try {
      const model = o.model(req.role);
      const content = req.images?.length ? [...req.images, { type: "text", text: req.user }] : req.user;
      const isGpt = model.startsWith("gpt-") || model.startsWith("openai/gpt-");
      const res = await fetch(o.chatUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${o.key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [{ role: "system", content: req.system }, { role: "user", content }],
          stream: false,
          ...(isGpt ? { max_completion_tokens: req.maxTokens } : { max_tokens: req.maxTokens }),
          ...(/gpt-6/.test(model) ? { reasoning_effort: "low" } : {}),
        }),
        signal: req.signal,
      });
      if (!res.ok) { console.error("verify llm", req.role, model, res.status); return null; }
      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content;
      return typeof text === "string" && text.trim() ? text.trim() : null;
    } catch (e) {
      if (!req.signal?.aborted) console.error("verify llm failed", req.role, e);
      return null;
    }
  };
}

/** يقرأ JSON من رد قد يحوي سياج markdown أو كلاماً قبله وبعده. */
export function parseJsonLoose(text: string): unknown | null {
  const t = text.replace(/^﻿/, "").trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(t)?.[1];
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  const slice = a !== -1 && b > a ? t.slice(a, b + 1) : undefined;
  for (const c of [fenced, t, slice]) {
    if (!c) continue;
    try { return JSON.parse(c); } catch { /* جرّب التالي */ }
  }
  return null;
}

const asStr = (x: unknown, max = 300): string | null => {
  if (typeof x === "number" && Number.isFinite(x)) return String(x);
  return typeof x === "string" && x.trim() && x.length <= max ? x.trim() : null;
};
const matchForm = (s: string) => s.replace(/\\left|\\right/g, "").replace(/[\s$]/g, "");

export interface SanitizedClaims { claims: Claim[]; discarded: number }

/**
 * يعقّم ادعاءات النموذج: نوع معروف، حقول نصية بحدود طول، وأهم شيء:
 * "quote" يجب أن يوجد حرفياً في الإجابة، وإلا حُذف الادعاء (مضاد للتلفيق).
 */
export function sanitizeClaims(raw: unknown, answer: string): SanitizedClaims {
  const list = (raw as any)?.claims;
  if (!Array.isArray(list)) return { claims: [], discarded: 0 };
  const hay = matchForm(answer);
  const claims: Claim[] = [];
  let discarded = 0;
  for (const c of list.slice(0, 14)) {
    const t = c?.type;
    const quote = asStr(c?.quote, 200);
    if (!quote || quote.length < 4 || !hay.includes(matchForm(quote))) { discarded++; continue; }
    const q = asStr(c?.q, 12) ?? undefined;
    const base = { ...(q ? { q } : {}), quote };
    const v = asStr(c?.variable, 1);
    let out: Claim | null = null;
    if (t === "equation") {
      const lhs = asStr(c.lhs), rhs = asStr(c.rhs);
      const sols = Array.isArray(c.solutions) ? c.solutions.slice(0, 8).map((s: unknown) => asStr(s, 80)) : null;
      const dom = Array.isArray(c.domain) && c.domain.length === 2 ? [asStr(c.domain[0], 40), asStr(c.domain[1], 40)] : null;
      if (lhs && rhs && v && sols && sols.every((s: string | null) => s !== null)) {
        out = { type: "equation", ...base, lhs, rhs, variable: v, solutions: sols as string[], ...(dom && dom[0] && dom[1] ? { domain: [dom[0], dom[1]] as [string, string] } : {}), ...(c.complete === false ? { complete: false } : {}) };
      }
    } else if (t === "derivative") {
      const f = asStr(c.f), df = asStr(c.df);
      if (f && df && v) out = { type: "derivative", ...base, f, df, variable: v };
    } else if (t === "equality") {
      const left = asStr(c.left), right = asStr(c.right);
      if (left && right) out = { type: "equality", ...base, left, right };
    } else if (t === "value") {
      const expr = asStr(c.expr), value = asStr(c.value, 60);
      let vars: Record<string, string> | undefined;
      if (c.vars && typeof c.vars === "object") {
        vars = {};
        for (const [k, val] of Object.entries(c.vars).slice(0, 6)) { const s = asStr(val, 60); if (/^[A-Za-z]$/.test(k) && s) vars[k] = s; }
      }
      if (expr && value) out = { type: "value", ...base, expr, value, ...(vars && Object.keys(vars).length ? { vars } : {}) };
    } else if (t === "limit") {
      const f = asStr(c.f), to = asStr(c.to, 40), value = asStr(c.value, 60);
      if (f && v && to && value) out = { type: "limit", ...base, f, variable: v, to, value, ...(c.side === "+" || c.side === "-" ? { side: c.side } : {}) };
    } else if (t === "integral") {
      const f = asStr(c.f), from = asStr(c.from, 40), to = asStr(c.to, 40), value = asStr(c.value, 60);
      if (f && v && from && to && value) out = { type: "integral", ...base, f, variable: v, from, to, value };
    }
    if (out) claims.push(out); else discarded++;
  }
  return { claims, discarded };
}

export interface CompareResult {
  q: string;
  status: "agree" | "disagree" | "unsure" | "missing";
  answerValue: string;
  independentValue: string;
  note: string;
  /** مقطع من إجابة التلميذ (منقول حرفياً) يوضح موضع الاختلاف؛ لا يُحفظ إلا إن وُجد في الإجابة فعلاً */
  answerQuote?: string;
}

const COMPARE_STATUSES = new Set(["agree", "disagree", "unsure", "missing"]);

/** `answer` اختياري: عند تمريره يُتحقق من أن answer_quote موجود حرفياً فيه وإلا أُسقط (دون إسقاط النتيجة نفسها). */
export function sanitizeComparison(raw: unknown, answer?: string): CompareResult[] {
  const list = (raw as any)?.results;
  if (!Array.isArray(list)) return [];
  const hay = answer === undefined ? null : matchForm(answer);
  const out: CompareResult[] = [];
  for (const r of list.slice(0, 24)) {
    if (!COMPARE_STATUSES.has(r?.status)) continue;
    const q = asStr(r.q, 12) ?? "";
    if (r.status === "missing" && !q) continue; // "غائب" بلا رقم سؤال لا يُعتمد
    const quote = asStr(r.answer_quote, 120);
    const quoteOk = quote && quote.length >= 4 && hay !== null && hay.includes(matchForm(quote));
    out.push({
      q,
      status: r.status,
      answerValue: asStr(r.answer_value, 120) ?? "",
      independentValue: asStr(r.independent_value, 120) ?? "",
      note: asStr(r.note, 200) ?? "",
      ...(quoteOk ? { answerQuote: quote! } : {}),
    });
  }
  return out;
}

export type MethodKind = "out_of_program" | "missing_justification" | "structure";
export interface MethodNote { q?: string; kind: MethodKind; quote: string; note: string; confidence: "high" | "medium" }
const METHOD_KINDS = new Set(["out_of_program", "missing_justification", "structure"]);

/** ملاحظات المنهج: نوع من قائمة بيضاء، اقتباس حرفي من الإجابة وإلا سقطت، وثقة high/medium فقط (low أو غيابها = تُسقط). */
export function sanitizeMethodNotes(raw: unknown, answer: string): MethodNote[] {
  const list = (raw as any)?.notes;
  if (!Array.isArray(list)) return [];
  const hay = matchForm(answer);
  const out: MethodNote[] = [];
  for (const n of list.slice(0, 8)) {
    if (!METHOD_KINDS.has(n?.kind)) continue;
    if (n.confidence !== "high" && n.confidence !== "medium") continue;
    const quote = asStr(n.quote, 160), note = asStr(n.note, 240);
    if (!quote || quote.length < 6 || !note || !hay.includes(matchForm(quote))) continue;
    const q = asStr(n.q, 12);
    out.push({ ...(q ? { q } : {}), kind: n.kind, quote, note, confidence: n.confidence });
    if (out.length >= 4) break;
  }
  return out;
}
