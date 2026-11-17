/**
 * حدّ الاستعمال اليومي لكل جهاز/مستخدم.
 * المسار الأول: دالة قاعدة البيانات consume_daily_usage (ذرّية). إن فشلت لأي سبب (migration لم تُطبَّق،
 * دالة معطوبة، ...) نعمل بمسار احتياطي مباشر على جدول daily_usage كي لا يتوقف التطبيق كله بسبب عطب في قاعدة البيانات.
 * المسار الاحتياطي أقل صرامة تحت الضغط المتوازي (قراءة ثم كتابة)، ويُسجَّل تحذير عند كل استعماله.
 * فشل المسارين معاً يعني أن خدمة الحصة غير متاحة فعلاً (ok: false).
 */
export interface QuotaInput {
  url: string;
  key: string;
  deviceId: string;
  limit: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  /** تاريخ اليوم بصيغة YYYY-MM-DD (UTC)؛ للاختبار */
  today?: string;
}
export type QuotaResult =
  | { ok: true; allowed: boolean; remaining: number; via: "rpc" | "table" }
  | { ok: false; status: number };

const bodyOf = async (r: Response) => (await r.text().catch(() => "")).slice(0, 300);

export async function consumeDailyQuota(i: QuotaInput): Promise<QuotaResult> {
  const f = i.fetchImpl ?? fetch;
  const headers = { apikey: i.key, Authorization: `Bearer ${i.key}`, "Content-Type": "application/json" };
  const base = i.url.replace(/\/$/, "");

  /* 1) الدالة الذرّية */
  let rpcStatus = 0;
  try {
    const r = await f(`${base}/rest/v1/rpc/consume_daily_usage`, {
      method: "POST", headers, signal: i.signal,
      body: JSON.stringify({ p_device_id: i.deviceId, p_daily_limit: i.limit }),
    });
    rpcStatus = r.status;
    if (r.ok) {
      const rows = await r.json();
      const q = Array.isArray(rows) ? rows[0] : rows;
      if (q && typeof q.allowed === "boolean") {
        return { ok: true, allowed: q.allowed, remaining: Number.isFinite(q.remaining) ? q.remaining : 0, via: "rpc" };
      }
      rpcStatus = 500; // رد غير متوقع الشكل
    } else {
      console.error("daily quota rpc failed", r.status, await bodyOf(r));
    }
  } catch (e) {
    if (i.signal?.aborted) return { ok: false, status: 499 };
    console.error("daily quota rpc error", e);
    rpcStatus = 503;
  }

  /* 2) مسار احتياطي مباشر على الجدول */
  console.warn("daily quota: falling back to direct table access (apply migration 20261116000400)");
  const today = i.today ?? new Date().toISOString().slice(0, 10);
  const table = `${base}/rest/v1/daily_usage`;
  try {
    const sel = await f(`${table}?device_id=eq.${encodeURIComponent(i.deviceId)}&request_date=eq.${today}&select=request_count,id`, { headers, signal: i.signal });
    if (!sel.ok) { console.error("daily quota table read failed", sel.status, await bodyOf(sel)); return { ok: false, status: sel.status || rpcStatus || 503 }; }
    const rows = await sel.json();
    const row = Array.isArray(rows) ? rows[0] : null;
    const count = Number(row?.request_count ?? 0);
    if (row && count >= i.limit) return { ok: true, allowed: false, remaining: 0, via: "table" };

    const write = row
      ? await f(`${table}?id=eq.${encodeURIComponent(String(row.id))}`, { method: "PATCH", headers: { ...headers, Prefer: "return=minimal" }, signal: i.signal, body: JSON.stringify({ request_count: count + 1, updated_at: new Date().toISOString() }) })
      : await f(table, { method: "POST", headers: { ...headers, Prefer: "return=minimal" }, signal: i.signal, body: JSON.stringify({ device_id: i.deviceId, request_date: today, request_count: 1 }) });
    // 409: طلب متوازٍ أنشأ الصف قبلنا؛ الاستهلاك قليل فنسمح بدل أن نمنع تلميذاً
    if (!write.ok && write.status !== 409) { console.error("daily quota table write failed", write.status, await bodyOf(write)); return { ok: false, status: write.status || 503 }; }
    return { ok: true, allowed: true, remaining: Math.max(i.limit - count - 1, 0), via: "table" };
  } catch (e) {
    if (!i.signal?.aborted) console.error("daily quota table error", e);
    return { ok: false, status: i.signal?.aborted ? 499 : 503 };
  }
}
