import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { consumeDailyQuota } from "./quota";

const DEVICE = "11111111-1111-4111-8111-111111111111";
const base = { url: "https://db.example", key: "svc", deviceId: DEVICE, limit: 3, today: "2026-11-16" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

let errors: unknown[][] = [];
const realError = console.error, realWarn = console.warn;
beforeEach(() => { errors = []; console.error = (...a: unknown[]) => { errors.push(a); }; console.warn = () => {}; });
afterEach(() => { console.error = realError; console.warn = realWarn; });

/** يحاكي PostgREST: دالة (تنجح أو تفشل) وجدول daily_usage في الذاكرة */
function fakeDb(opts: { rpc: "ok" | "broken" | "missing" | "garbage"; rpcAllowed?: boolean; rows?: { id: string; request_count: number }[]; tableStatus?: number }) {
  const calls: string[] = [];
  const rows = opts.rows ?? [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push(`${method} ${url.replace(base.url, "")}`);
    if (url.includes("/rpc/consume_daily_usage")) {
      if (opts.rpc === "ok") return json([{ allowed: opts.rpcAllowed ?? true, remaining: 2, request_count: 1 }]);
      if (opts.rpc === "garbage") return json({ nothing: true });
      return opts.rpc === "missing" ? json({ code: "PGRST202" }, 404) : json({ code: "42P01", message: 'invalid reference to FROM-clause entry for table "daily_usage"' }, 400);
    }
    if (opts.tableStatus && opts.tableStatus >= 400) return json({ message: "denied" }, opts.tableStatus);
    if (method === "GET") return json(rows);
    return new Response(null, { status: 204 });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe("consumeDailyQuota", () => {
  it("المسار الذرّي حين تعمل الدالة (بلا مسّ بالجدول)", async () => {
    const db = fakeDb({ rpc: "ok" });
    expect(await consumeDailyQuota({ ...base, fetchImpl: db.fetchImpl })).toEqual({ ok: true, allowed: true, remaining: 2, via: "rpc" });
    expect(db.calls).toHaveLength(1);
  });

  it("الدالة تقول «ممنوع» = ممنوع، ولا مسار احتياطي", async () => {
    const db = fakeDb({ rpc: "ok", rpcAllowed: false });
    expect(await consumeDailyQuota({ ...base, fetchImpl: db.fetchImpl })).toMatchObject({ ok: true, allowed: false, via: "rpc" });
    expect(db.calls).toHaveLength(1);
  });

  for (const rpc of ["broken", "missing", "garbage"] as const) {
    it(`الدالة ${rpc}: المسار الاحتياطي يُنشئ صف اليوم الأول`, async () => {
      const db = fakeDb({ rpc });
      expect(await consumeDailyQuota({ ...base, fetchImpl: db.fetchImpl })).toEqual({ ok: true, allowed: true, remaining: 2, via: "table" });
      expect(db.calls.at(-1)).toBe("POST /rest/v1/daily_usage");
    });
  }

  it("الاحتياطي يزيد العدّاد بـ PATCH ثم يمنع عند الحدّ", async () => {
    const inc = fakeDb({ rpc: "broken", rows: [{ id: "abc", request_count: 2 }] });
    expect(await consumeDailyQuota({ ...base, fetchImpl: inc.fetchImpl })).toEqual({ ok: true, allowed: true, remaining: 0, via: "table" });
    expect(inc.calls.at(-1)).toBe("PATCH /rest/v1/daily_usage?id=eq.abc");

    const full = fakeDb({ rpc: "broken", rows: [{ id: "abc", request_count: 3 }] });
    expect(await consumeDailyQuota({ ...base, fetchImpl: full.fetchImpl })).toEqual({ ok: true, allowed: false, remaining: 0, via: "table" });
    expect(full.calls.some((c) => c.startsWith("PATCH") || c.startsWith("POST /rest/v1/daily_usage"))).toBe(false);
  });

  it("المسارات الفاشلة تُسجَّل مع نص الخطأ", async () => {
    await consumeDailyQuota({ ...base, fetchImpl: fakeDb({ rpc: "broken" }).fetchImpl });
    expect(JSON.stringify(errors)).toContain("invalid reference to FROM-clause entry");
  });

  it("فشل الدالة والجدول معاً = الخدمة غير متاحة", async () => {
    const r = await consumeDailyQuota({ ...base, fetchImpl: fakeDb({ rpc: "broken", tableStatus: 401 }).fetchImpl });
    expect(r).toEqual({ ok: false, status: 401 });
  });

  it("انقطاع الشبكة لا يرمي", async () => {
    const down = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    expect(await consumeDailyQuota({ ...base, fetchImpl: down })).toEqual({ ok: false, status: 503 });
  });

  it("تعارض 409 عند الإنشاء المتوازي يُسمَح به", async () => {
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      if (url.includes("/rpc/")) return json({}, 500);
      if ((init?.method ?? "GET") === "GET") return json([]);
      return json({ code: "23505" }, 409);
    }) as unknown as typeof fetch;
    expect(await consumeDailyQuota({ ...base, fetchImpl })).toMatchObject({ ok: true, allowed: true, via: "table" });
  });
});
