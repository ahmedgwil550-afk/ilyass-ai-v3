import { describe, expect, it } from "vitest";
import {
  AUTO_MAX,
  UI_SCALE_BOOT_SCRIPT,
  UI_SCALE_KEY,
  UI_SCALE_VAR,
  applyUiScale,
  approxDpi,
  computeAutoScale,
  looksLikeDesktopSite,
  parseChoice,
  readScreenEnv,
  readStoredChoice,
  resolveScale,
  storeChoice,
  type ScreenEnv,
} from "./display-scale";

// عروض بوحدة CSS لهواتف حقيقية، والعرض الأكبر يقابل "حجم العرض: صغير" أو كثافة أعلى
const PHONES: Array<[string, number, number]> = [
  ["iPhone SE", 375, 667],
  ["iPhone 14", 390, 844],
  ["Galaxy S23", 360, 780],
  ["Pixel 7", 412, 915],
  ["Pixel مع تصغير حجم العرض", 450, 990],
  ["هاتف بكثافة عالية جداً", 540, 1170],
];

describe("computeAutoScale", () => {
  it("لا يصغّر أبداً: الهواتف حتى 390 تبقى 1", () => {
    expect(computeAutoScale({ shortSide: 360, coarse: true })).toBe(1);
    expect(computeAutoScale({ shortSide: 375, coarse: true })).toBe(1);
    expect(computeAutoScale({ shortSide: 390, coarse: true })).toBe(1);
  });

  it("يكبّر بنسبة عرض الشاشة إلى الهاتف القياسي حين يصغر البكسل فيزيائياً", () => {
    expect(computeAutoScale({ shortSide: 412, coarse: true })).toBe(1.06);
    expect(computeAutoScale({ shortSide: 450, coarse: true })).toBe(1.15);
    expect(computeAutoScale({ shortSide: 507, coarse: true })).toBe(1.3);
  });

  it("لا يتجاوز الحد الأقصى", () => {
    expect(computeAutoScale({ shortSide: 599, coarse: true })).toBe(AUTO_MAX);
    expect(computeAutoScale({ shortSide: 540, coarse: true })).toBe(AUTO_MAX);
  });

  it("اللوحي وسطح المكتب والمؤشر الدقيق = 1", () => {
    expect(computeAutoScale({ shortSide: 744, coarse: true })).toBe(1);
    expect(computeAutoScale({ shortSide: 1080, coarse: false })).toBe(1);
    expect(computeAutoScale({ shortSide: 450, coarse: false })).toBe(1);
  });

  it("قياسات ناقصة أو فاسدة = 1", () => {
    expect(computeAutoScale({ shortSide: 0, coarse: true })).toBe(1);
    expect(computeAutoScale({ shortSide: NaN, coarse: true })).toBe(1);
    expect(computeAutoScale({ shortSide: -5, coarse: true })).toBe(1);
  });

  it("تدوير الهاتف لا يغيّر النتيجة لأن القياس بأقصر ضلع", () => {
    const portrait = readScreenEnv(fakeWindow({ w: 412, h: 915, coarse: true }));
    const landscape = readScreenEnv(fakeWindow({ w: 915, h: 412, coarse: true }));
    expect(computeAutoScale(portrait)).toBe(computeAutoScale(landscape));
  });
});

describe("parseChoice / resolveScale", () => {
  it("القيم الغائبة أو غير الصالحة تعني تلقائي", () => {
    expect(parseChoice(null)).toBe("auto");
    expect(parseChoice(undefined)).toBe("auto");
    expect(parseChoice("")).toBe("auto");
    expect(parseChoice("auto")).toBe("auto");
    expect(parseChoice("abc")).toBe("auto");
    expect(parseChoice("1.3x")).toBe("auto");
    expect(parseChoice("0.5")).toBe("auto");
    expect(parseChoice("9")).toBe("auto");
  });

  it("الأرقام الصالحة تُقبل وتُقرَّب إلى منزلتين", () => {
    expect(parseChoice("1")).toBe(1);
    expect(parseChoice("1.15")).toBe(1.15);
    expect(parseChoice("1.234")).toBe(1.23);
    expect(parseChoice("0.85")).toBe(0.85);
    expect(parseChoice("1.5")).toBe(1.5);
  });

  it("الاختيار اليدوي يتفوّق على التقدير التلقائي", () => {
    const phone = { shortSide: 450, coarse: true };
    expect(resolveScale("auto", phone)).toBe(1.15);
    expect(resolveScale(1, phone)).toBe(1);
    expect(resolveScale(1.3, phone)).toBe(1.3);
    expect(resolveScale(0.9, { shortSide: 1080, coarse: false })).toBe(0.9);
  });
});

describe("التخزين", () => {
  it("يحفظ ويقرأ، و«تلقائي» يمسح المفتاح", () => {
    const win = fakeWindow({ w: 390, h: 844, coarse: true });
    expect(readStoredChoice(win)).toBe("auto");
    storeChoice(win, 1.3);
    expect(readStoredChoice(win)).toBe(1.3);
    storeChoice(win, "auto");
    expect(readStoredChoice(win)).toBe("auto");
    expect(win.localStorage.getItem(UI_SCALE_KEY)).toBe(null);
  });

  it("وضع التصفح الخاص (localStorage يرمي) لا يكسر شيئاً", () => {
    const win = fakeWindow({ w: 390, h: 844, coarse: true, throwingStorage: true });
    expect(readStoredChoice(win)).toBe("auto");
    storeChoice(win, 1.3);
    storeChoice(win, "auto");
  });
});

describe("applyUiScale", () => {
  it("يكتب المتغير ولا يعيد كتابته إذا لم يتغيّر", () => {
    const { doc, writes } = fakeDocument();
    applyUiScale(doc, 1.15);
    applyUiScale(doc, 1.15);
    applyUiScale(doc, 1.3);
    expect(writes).toEqual([[UI_SCALE_VAR, "1.15"], [UI_SCALE_VAR, "1.3"]]);
  });
});

describe("سكربت <head> مطابق للدوال", () => {
  const stored: Array<string | null> = [null, "auto", "1", "1.15", "1.45", "0.9", "9", "abc", ""];

  it("نفس النتيجة لكل هاتف ولكل قيمة محفوظة", () => {
    const devices: Array<[string, number, number, boolean]> = [
      ...PHONES.map(([name, w, h]) => [name, w, h, true] as [string, number, number, boolean]),
      ["iPad mini", 744, 1133, true],
      ["لابتوب", 1920, 1080, false],
    ];
    for (const [name, w, h, coarse] of devices) {
      for (const value of stored) {
        const expected = resolveScale(parseChoice(value), readScreenEnv(fakeWindow({ w, h, coarse })));
        const actual = runBootScript(fakeWindow({ w, h, coarse, stored: value }));
        expect(`${name} [${value}] ${actual}`).toBe(`${name} [${value}] ${expected}`);
      }
    }
  });

  it("يعمل في الوضع الخاص وبلا matchMedia", () => {
    expect(runBootScript(fakeWindow({ w: 450, h: 990, coarse: true, throwingStorage: true }))).toBe(1.15);
    expect(runBootScript(fakeWindow({ w: 450, h: 990, coarse: true, noMatchMedia: true }))).toBe(1);
  });

  it("لا يرمي أبداً حتى لو كان window ناقصاً", () => {
    const { doc } = fakeDocument();
    const run = new Function("window", "document", UI_SCALE_BOOT_SCRIPT);
    run({}, doc);
    run({ screen: null, matchMedia: () => { throw new Error("x"); } }, doc);
    expect(true).toBe(true);
  });
});

describe("مؤشرات مساعدة", () => {
  const env = (o: Partial<ScreenEnv>): ScreenEnv => ({ shortSide: 412, longSide: 915, dpr: 2.625, coarse: true, viewportWidth: 412, ...o });

  it("نسخة سطح المكتب على الهاتف تُكتشف، والوضع الأفقي لا", () => {
    expect(looksLikeDesktopSite(env({ viewportWidth: 980 }))).toBe(true);
    expect(looksLikeDesktopSite(env({ viewportWidth: 412 }))).toBe(false);
    expect(looksLikeDesktopSite(env({ viewportWidth: 915 }))).toBe(false);
    expect(looksLikeDesktopSite(env({ shortSide: 744, longSide: 1133, viewportWidth: 1280 }))).toBe(false);
    expect(looksLikeDesktopSite(env({ coarse: false, viewportWidth: 1280 }))).toBe(false);
  });

  it("الـdpi التقريبي من كثافة البكسل", () => {
    expect(approxDpi(2.625)).toBe(420);
    expect(approxDpi(3)).toBe(480);
    expect(approxDpi(1)).toBe(160);
  });
});

// ---------- أدوات الاختبار ----------

interface FakeOpts {
  w: number;
  h: number;
  coarse: boolean;
  stored?: string | null;
  throwingStorage?: boolean;
  noMatchMedia?: boolean;
}

function fakeWindow(o: FakeOpts): Window {
  const data = new Map<string, string>();
  if (o.stored !== undefined && o.stored !== null) data.set(UI_SCALE_KEY, o.stored);
  const storage = o.throwingStorage
    ? {
        getItem: () => { throw new Error("denied"); },
        setItem: () => { throw new Error("denied"); },
        removeItem: () => { throw new Error("denied"); },
      }
    : {
        getItem: (k: string) => (data.has(k) ? (data.get(k) as string) : null),
        setItem: (k: string, v: string) => { data.set(k, v); },
        removeItem: (k: string) => { data.delete(k); },
      };
  return {
    screen: { width: o.w, height: o.h },
    devicePixelRatio: 2.625,
    innerWidth: o.w,
    matchMedia: o.noMatchMedia ? undefined : (q: string) => ({ matches: q.includes("pointer: coarse") && o.coarse }),
    localStorage: storage,
  } as unknown as Window;
}

function fakeDocument() {
  const writes: Array<[string, string]> = [];
  const values = new Map<string, string>();
  const doc = {
    documentElement: {
      style: {
        getPropertyValue: (k: string) => values.get(k) ?? "",
        setProperty: (k: string, v: string) => { values.set(k, v); writes.push([k, v]); },
      },
    },
  } as unknown as Document;
  return { doc, writes };
}

function runBootScript(win: Window): number {
  const { doc, writes } = fakeDocument();
  new Function("window", "document", UI_SCALE_BOOT_SCRIPT)(win, doc);
  expect(writes.length).toBe(1);
  expect(writes[0][0]).toBe(UI_SCALE_VAR);
  return Number(writes[0][1]);
}
