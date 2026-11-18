/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import {
  buildRecognition,
  containment,
  cropBoxFor,
  cropRect,
  describeWarning,
  extractJson,
  findSelection,
  flattenStructure,
  fullLabel,
  iou,
  labelOrdinal,
  missingOrdinals,
  parsePoints,
  selectionHint,
  toBox,
  unionBox,
  type RecognitionWarningCode,
} from "./recognition";

/** صفحة نظيفة: تمرينان، الأول بثلاثة أسئلة ونقط متسقة */
function cleanPage(): any {
  return {
    language: "fr",
    subject: "math",
    notes: "",
    exercises: [
      {
        label: "Exercice 1",
        points: 5,
        box_2d: [50, 50, 480, 950],
        statement: "Soit f la fonction définie sur R par f(x) = x^2 - 4x + 3.",
        statement_box_2d: [60, 60, 130, 940],
        givens: [{ kind: "formula", text: "f(x) = x^2 - 4x + 3", box_2d: [90, 300, 125, 700] }],
        questions: [
          { label: "1", text: "Calculer f(2).", points: 1.5, box_2d: [140, 60, 200, 940] },
          {
            label: "2",
            text: "Étudier le signe de f.",
            points: 2.5,
            box_2d: [210, 60, 360, 940],
            subquestions: [
              { label: "a", text: "Résoudre f(x) = 0.", points: 1, box_2d: [220, 80, 280, 920] },
              { label: "b", text: "En déduire le signe.", points: 1.5, box_2d: [290, 80, 350, 920] },
            ],
          },
          { label: "3", text: "Tracer la courbe.", points: 1, box_2d: [370, 60, 470, 940] },
        ],
      },
      {
        label: "Exercice 2",
        points: 3,
        box_2d: [500, 50, 950, 950],
        statement: "On considère la suite (u_n).",
        givens: [],
        questions: [
          { label: "1", text: "Calculer u_1.", points: 1, box_2d: [520, 60, 600, 940] },
          { label: "2", text: "Montrer que u_n est croissante.", points: 2, box_2d: [610, 60, 720, 940] },
        ],
      },
    ],
  };
}

describe("toBox", () => {
  it("يحوّل [ymin, xmin, ymax, xmax] من مقياس 1000 إلى كسور بالترتيب x, y, w, h", () => {
    expect(toBox([100, 200, 300, 600])).toEqual({ x: 0.2, y: 0.1, w: 0.4, h: 0.2 });
  });
  it("يصحّح الأزواج المعكوسة ويقصّ ما خرج عن الصورة", () => {
    expect(toBox([300, 600, 100, 200])).toEqual({ x: 0.2, y: 0.1, w: 0.4, h: 0.2 });
    expect(toBox([-50, -10, 500, 1200])).toEqual({ x: 0, y: 0, w: 1, h: 0.5 });
  });
  it("يقبل القيم الكسرية 0 إلى 1", () => {
    expect(toBox([0.1, 0.2, 0.3, 0.6])).toEqual({ x: 0.2, y: 0.1, w: 0.4, h: 0.2 });
  });
  it("يرفض المربع الضئيل والبيانات الفاسدة", () => {
    expect(toBox([100, 100, 102, 105])).toBe(undefined);
    expect(toBox([100, 100, 300])).toBe(undefined);
    expect(toBox("x")).toBe(undefined);
    expect(toBox([1, "a", 3, 4])).toBe(undefined);
    expect(toBox(null)).toBe(undefined);
  });
  it("يقبل أرقاماً مكتوبة نصاً", () => {
    expect(toBox(["100", "200", "300", "600"])).toEqual({ x: 0.2, y: 0.1, w: 0.4, h: 0.2 });
  });
});

describe("النقط", () => {
  it("يقرأ أرقاماً ونصوصاً بالفاصلة والأرقام العربية", () => {
    expect(parsePoints(2)).toBe(2);
    expect(parsePoints("1,5 pt")).toBe(1.5);
    expect(parsePoints("٢ ن")).toBe(2);
    expect(parsePoints("0.75")).toBe(0.75);
  });
  it("يرفض غير المعقول", () => {
    expect(parsePoints(0)).toBe(undefined);
    expect(parsePoints(-1)).toBe(undefined);
    expect(parsePoints(500)).toBe(undefined);
    expect(parsePoints("بلا نقط")).toBe(undefined);
    expect(parsePoints(null)).toBe(undefined);
  });
});

describe("ترقيم الأسئلة", () => {
  it("رقم الترتيب من صيغ مختلفة", () => {
    const table: Array<[string, number | null]> = [
      ["1", 1], ["3)", 3], ["a", 1], ["b)", 2], ["1-a", 1], ["2-b", 2], ["2.3", 3], ["Question 4", 4],
      ["أ-", 1], ["ب", 2], ["ج", 3], ["هـ", 5], ["١", 1], ["السؤال الأول", null], ["", null],
    ];
    for (const [label, want] of table) expect(`${label} → ${labelOrdinal(label)}`).toBe(`${label} → ${want}`);
  });
  it("الأرقام الناقصة بين الإخوة", () => {
    expect(missingOrdinals(["1", "2", "3"])).toEqual([]);
    expect(missingOrdinals(["1", "2", "4"])).toEqual([3]);
    expect(missingOrdinals(["2", "3"])).toEqual([1]);
    expect(missingOrdinals(["a", "c"])).toEqual([2]);
    expect(missingOrdinals(["أ", "ج"])).toEqual([2]);
    expect(missingOrdinals(["1", "الثاني"])).toBe(null);
    expect(missingOrdinals([])).toEqual([]);
  });
});

describe("extractJson", () => {
  it("يقبل JSON خاماً ومحاطاً بكلام وداخل سياج", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('هذه النتيجة: {"a":{"b":2}} شكراً')).toEqual({ a: { b: 2 } });
    expect(extractJson('```json\n{"a":[1,2]}\n```')).toEqual({ a: [1, 2] });
  });
  it("يعيد null لغير الصالح", () => {
    expect(extractJson("لا شيء هنا")).toBe(null);
    expect(extractJson("{ not json }")).toBe(null);
    expect(extractJson("")).toBe(null);
  });
});

describe("هندسة المربعات", () => {
  it("الاتحاد والاحتواء والتقاطع", () => {
    const a = { x: 0.1, y: 0.1, w: 0.2, h: 0.2 };
    const b = { x: 0.2, y: 0.2, w: 0.2, h: 0.2 };
    expect(unionBox([a, b, undefined])).toEqual({ x: 0.1, y: 0.1, w: 0.3, h: 0.3 });
    expect(unionBox([undefined])).toBe(undefined);
    expect(Math.round(containment({ x: 0.15, y: 0.15, w: 0.1, h: 0.1 }, a) * 100)).toBe(100);
    expect(containment({ x: 0.7, y: 0.7, w: 0.1, h: 0.1 }, a)).toBe(0);
    expect(Math.round(iou(a, a) * 100)).toBe(100);
    expect(iou(a, { x: 0.5, y: 0.5, w: 0.1, h: 0.1 })).toBe(0);
  });
});

describe("buildRecognition: الصفحة السليمة", () => {
  const r = buildRecognition(cleanPage());

  it("يعيد البنية كاملة بلا تحذيرات", () => {
    expect(r.status).toBe("ok");
    expect(r.warnings).toEqual([]);
    expect(r.language).toBe("fr");
    expect(r.subject).toBe("math");
    expect(r.exercises.length).toBe(2);
    expect(r.exercises[0].questions.map((q) => q.label)).toEqual(["1", "2", "3"]);
    expect(r.exercises[0].questions[1].children.map((q) => q.label)).toEqual(["a", "b"]);
    expect(r.exercises[0].confidence).toBe("high");
  });

  it("المعرّفات ثابتة وهرمية", () => {
    expect(r.exercises[0].id).toBe("e1");
    expect(r.exercises[0].givens[0].id).toBe("e1-g1");
    expect(r.exercises[0].questions[1].id).toBe("e1-q2");
    expect(r.exercises[0].questions[1].children[0].id).toBe("e1-q2-s1");
  });

  it("مربع التمرين يشمل أبناءه", () => {
    const box = r.exercises[0].box!;
    expect(box.x <= 0.05).toBe(true);
    expect(box.y <= 0.05).toBe(true);
    expect(box.x + box.w >= 0.95).toBe(true);
    expect(box.y + box.h >= 0.47).toBe(true);
  });
});

describe("buildRecognition: كشف المشكلات بالكود", () => {
  it("سؤال ناقص من الترقيم يُنبَّه إليه", () => {
    const page = cleanPage();
    page.exercises[1].questions = [
      { label: "1", text: "a", points: 1, box_2d: [520, 60, 600, 940] },
      { label: "3", text: "c", points: 2, box_2d: [610, 60, 720, 940] },
    ];
    const r = buildRecognition(page);
    const gap = r.warnings.find((w) => w.code === "label_gap");
    expect(gap?.detail).toBe("2");
    expect(gap?.targetId).toBe("e2");
    expect(r.exercises[1].confidence).toBe("medium");
    expect(r.status).toBe("partial");
  });

  it("مجموع نقط الأسئلة المخالف لنقط التمرين يُنبَّه إليه", () => {
    const page = cleanPage();
    page.exercises[0].points = 6;
    const r = buildRecognition(page);
    expect(r.warnings.find((w) => w.code === "points_mismatch")?.detail).toBe("5/6");
  });

  it("مجموع نقط الفروع يُقارن بنقط سؤالها", () => {
    const page = cleanPage();
    (page.exercises[0].questions[1] as { points: number }).points = 3;
    const r = buildRecognition(page);
    const w = r.warnings.find((x) => x.code === "points_mismatch" && x.targetId === "e1-q2");
    expect(w?.detail).toBe("2.5/3");
  });

  it("لا مقارنة للنقط إن غابت نقطة سؤال واحد", () => {
    const page = cleanPage();
    delete (page.exercises[0].questions[2] as { points?: number }).points;
    expect(buildRecognition(page).warnings.some((w) => w.code === "points_mismatch")).toBe(false);
  });

  it("سؤال خارج مربع تمرينه يُسقَط مربعه ولا يدخل في اتحاده، وتنخفض ثقته", () => {
    const page = cleanPage();
    page.exercises[1].questions[1].box_2d = [10, 60, 60, 940]; // أعلى الصفحة، بعيداً عن التمرين الثاني
    const r = buildRecognition(page);
    const q = r.exercises[1].questions[1];
    expect(r.warnings.some((w) => w.code === "box_outside_parent" && w.targetId === "e2-q2")).toBe(true);
    expect(q.box).toBe(undefined);
    expect(q.confidence).toBe("low");
    expect(r.exercises[1].box!.y >= 0.45).toBe(true);
    expect(r.status).toBe("partial");
  });

  it("ترقيم مكرر ومربعان متداخلان", () => {
    const page = cleanPage();
    page.exercises[1].questions = [
      { label: "1", text: "a", points: 1, box_2d: [520, 60, 700, 940] },
      { label: "1", text: "b", points: 2, box_2d: [530, 60, 690, 940] },
    ];
    const r = buildRecognition(page);
    expect(r.warnings.some((w) => w.code === "duplicate_label")).toBe(true);
    expect(r.warnings.some((w) => w.code === "box_overlap")).toBe(true);
  });

  it("عنصر بلا مربع يُوسم ولا يُخترع له موضع", () => {
    const page = cleanPage();
    delete (page.exercises[1].questions[0] as { box_2d?: number[] }).box_2d;
    const r = buildRecognition(page);
    expect(r.exercises[1].questions[0].box).toBe(undefined);
    expect(r.warnings.some((w) => w.code === "no_box" && w.targetId === "e2-q1")).toBe(true);
    expect(r.exercises[1].questions[0].confidence).toBe("medium");
  });

  it("تغطية المربعات الضعيفة تجعل النتيجة جزئية، وانعدامها يجعلها غير موثوقة", () => {
    const strip = (o: unknown): unknown => {
      if (Array.isArray(o)) return o.map(strip);
      if (o && typeof o === "object") {
        return Object.fromEntries(Object.entries(o).filter(([k]) => !k.includes("box")).map(([k, v]) => [k, strip(v)]));
      }
      return o;
    };
    const none = buildRecognition(strip(cleanPage()));
    expect(none.status).toBe("unreliable");
    expect(none.warnings.some((w) => w.code === "low_box_coverage")).toBe(true);
  });

  it("لا تمارين = غير موثوق", () => {
    expect(buildRecognition({ exercises: [] }).status).toBe("unreliable");
    expect(buildRecognition({ exercises: [] }).warnings[0].code).toBe("no_exercises");
  });

  it("مدخلات فاسدة لا ترمي", () => {
    for (const bad of [null, undefined, "نص", 5, [], { exercises: "x" }, { exercises: [null, 3, "a"] }]) {
      expect(buildRecognition(bad).status).toBe("unreliable");
    }
  });

  it("يقصّ النصوص الطويلة ويسقط الأسئلة الفارغة", () => {
    const r = buildRecognition({
      exercises: [{ label: "E", box_2d: [0, 0, 900, 900], questions: [{ label: "1", text: "x".repeat(2000), box_2d: [10, 10, 100, 900] }, {}, { label: "", text: "" }] }],
    });
    expect(r.exercises[0].questions.length).toBe(1);
    expect(r.exercises[0].questions[0].text.length).toBe(260);
  });

  it("المادة واللغة المجهولتان تصبحان null و unknown", () => {
    const r = buildRecognition({ language: "klingon", subject: "astrology", exercises: [] });
    expect(r.language).toBe("unknown");
    expect(r.subject).toBe(null);
  });
});

describe("للواجهة", () => {
  const r = buildRecognition(cleanPage());

  it("القائمة المسطّحة بالترتيب والمستويات", () => {
    const flat = flattenStructure(r);
    expect(flat.map((i) => `${i.level}:${i.id}`)).toEqual([
      "0:e1", "1:e1-g1", "1:e1-q1", "1:e1-q2", "2:e1-q2-s1", "2:e1-q2-s2", "1:e1-q3",
      "0:e2", "1:e2-q1", "1:e2-q2",
    ]);
    expect(flat.find((i) => i.id === "e1-q2-s1")?.parentLabel).toBe("2");
  });

  it("مستطيل القصّ داخل حدود الصورة دائماً", () => {
    const rect = cropRect({ x: 0, y: 0, w: 1, h: 1 }, 800, 1200);
    expect(rect).toEqual({ sx: 0, sy: 0, sw: 800, sh: 1200 });
    const mid = cropRect({ x: 0.1, y: 0.2, w: 0.5, h: 0.3 }, 1000, 1000, 0.01);
    expect(mid).toEqual({ sx: 90, sy: 190, sw: 520, sh: 320 });
    const edge = cropRect({ x: 0.95, y: 0.95, w: 0.05, h: 0.05 }, 1000, 1000, 0.05);
    expect(edge.sx + edge.sw <= 1000).toBe(true);
    expect(edge.sy + edge.sh <= 1000).toBe(true);
  });

  it("الاختيار والقصّ والترقيم الكامل والنص الإرشادي", () => {
    const sub = findSelection(r, "e1-q2-s2")!;
    expect(sub.question?.label).toBe("b");
    expect(sub.parent?.label).toBe("2");
    expect(fullLabel(sub)).toBe("2-b");
    expect(cropBoxFor(sub)).toEqual(r.exercises[0].box);
    expect(selectionHint(sub, "ar")).toBe("حلّ السؤال 2-b فقط من Exercice 1، معتمداً على معطيات التمرين الظاهرة في الصورة.");
    expect(selectionHint(sub, "fr").startsWith("Résous uniquement la question 2-b de Exercice 1")).toBe(true);

    const ex = findSelection(r, "e2")!;
    expect(selectionHint(ex, "ar")).toBe("حلّ Exercice 2 كاملاً.");
    expect(selectionHint(ex, "fr")).toBe("Résous Exercice 2 en entier.");
    expect(findSelection(r, "nope")).toBe(null);
  });

  it("الترقيم الكامل لا يكرر الأب إذا كان داخلاً في الفرع", () => {
    const page = cleanPage();
    (page.exercises[0].questions[1].subquestions as Array<{ label: string }>)[0].label = "2-a";
    (page.exercises[0].questions[1].subquestions as Array<{ label: string }>)[1].label = "2-b";
    const rr = buildRecognition(page);
    expect(fullLabel(findSelection(rr, "e1-q2-s1")!)).toBe("2-a");
  });

  it("لكل تحذير نص بالعربية وبالفرنسية", () => {
    const codes: RecognitionWarningCode[] = [
      "no_exercises", "label_gap", "duplicate_label", "points_mismatch", "box_outside_parent", "box_overlap", "no_box", "low_box_coverage",
    ];
    for (const code of codes) {
      for (const lang of ["ar", "fr"] as const) {
        const text = describeWarning({ code, detail: "3" }, lang);
        expect(typeof text === "string" && text.length > 10).toBe(true);
      }
    }
    expect(describeWarning({ code: "label_gap", detail: "3" }, "ar").includes("3")).toBe(true);
  });
});
