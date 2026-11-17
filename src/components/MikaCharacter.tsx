import mikaModel from "@/assets/mika-mika.fbx.asset.json";
import mikaSkin from "@/assets/mika-skin.jpg.asset.json";
import mikaHair from "@/assets/mika-hair.webp.asset.json";
/**
 * MikaCharacter — شخصية ثلاثية الأبعاد (FBX) تعمل بنفس أوامر AuthCharacter:
 *   ref.current.play("wave" | "jump" | "spin" | "celebrate" | "shake" | "press" |
 *                    "typing-email" | "typing-password" | "hide-eyes" | "show-eyes" | "idle" | "walkIn" |
 *                    "dance" | "think" | "twerk" | "poleSpin")
 *   ref.current.playEntrance()
 * ونفس الـ props: coverEyes / mood / className / style.
 *
 * المتطلبات:  npm i three @react-three/fiber   (+ npm i -D @types/three)
 *   - React 18  → @react-three/fiber@^8
 *   - React 19  → @react-three/fiber@^9
 * الملفات: public/models/mika/{mika.fbx, skin.png, hair.png}
 */
import {
  forwardRef,
  memo,
  useEffect,
  useState,
  useImperativeHandle,
  useMemo,
  useRef,
  type CSSProperties,
  type MutableRefObject,
} from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { CharacterAction, CharacterHandle } from "./AuthCharacter";

type Mood = "happy" | "neutral" | "surprised" | "shy";

interface Props {
  coverEyes?: boolean;
  mood?: Mood;
  className?: string;
  style?: CSSProperties;
  /** كم عرض الحاوية يمتد الـ canvas على كل جانب (ليدخل الشخص من خارج الصندوق). 0 = بدون امتداد */
  bleed?: number;
}

/* ============================================================================
 * إعدادات قابلة للتعديل
 * ========================================================================== */
const ASSETS = {
  model: mikaModel.url,
  skin: mikaSkin.url,
  hair: mikaHair.url,
};

/** يبدأ تنزيل الملفات مبكراً (استدعِها في App.tsx أو main.tsx لتظهر الشخصية فوراً) */
let modelBuffer: Promise<ArrayBuffer> | null = null;
/** ملف النموذج يُحمَّل مرة واحدة فقط ويُشارَك بين التحميل المسبق والمحمّل (بدل تنزيله مرتين) */
const getModelBuffer = (): Promise<ArrayBuffer> => {
  if (!modelBuffer) {
    modelBuffer = fetch(ASSETS.model)
      .then((r) => {
        if (!r.ok) throw new Error(`model fetch failed: ${r.status}`);
        return r.arrayBuffer();
      })
      .catch((e) => {
        modelBuffer = null;
        throw e;
      });
  }
  return modelBuffer;
};
export const preloadMika = () => {
  if (typeof window === "undefined") return;
  getModelBuffer().catch(() => undefined);
  [ASSETS.skin, ASSETS.hair].forEach((u) => {
    const img = new Image();
    img.decoding = "async";
    img.src = u;
  });
};
preloadMika();

const HEIGHT = 1.6; // طول الشخصية بوحدات المشهد (يُضبط تلقائياً)
const FOV = 28;
const FRAME = 1.45; // الارتفاع الظاهر للكاميرا بالنسبة لطول الشخصية
const CAM_Y = HEIGHT * 0.6;
const CAM_Z = (FRAME * HEIGHT) / 2 / Math.tan(THREE.MathUtils.degToRad(FOV / 2));
const DEG = Math.PI / 180;

/** سرعة الحركات: 1 = السرعة الأصلية، أكبر = أبطأ وأهدأ (المشي لا يتأثر). عدّلها إذا أردت أسرع/أبطأ */
const ANIM_SLOWDOWN = 1.2;

/** إضاءة النيون — عدّل هذه القيم لتغيير الشعور العام (كلها آمنة بين 0 والضعف) */
const ENV_INTENSITY = 0.55; // انعكاس بيئي أهدأ وأفخم
const RIM_BASE = 1.7; // ضوءا حافة شامبانيا + بيرل

/** النموذج الأصلي بوضعية T (الذراعان أفقيان) — هذه الزاوية تُنزلهما بجانب الجسم كوضعية راحة */
const ARM_BASE = -75;

/** وضعية الذراعين عند تغطية العينين (درجات). عدّلها إذا بدت الأيدي بعيدة/قريبة. */
const ARM_REST = { Raise: 0, Fwd: 0, Horiz: 0, Elbow: 0, Eraise: 0 };
const ARM_COVER = { Raise: 5, Fwd: 50, Horiz: 30, Elbow: 125, Eraise: 0 };

/** أوزان الـ blendshapes للفم حسب المزاج (الأسماء بعد التطبيع: حروف صغيرة بدون رموز). */
const MOOD_MOUTH: Record<Mood, Record<string, number>> = {
  happy: { vrcvih: 0.45, a: 0.15 },
  neutral: {},
  surprised: { o: 0.85 },
  shy: { ch: 0.25 },
};
const MOUTH_KEYS = ["a", "o", "ch", "vrcvih", "vrcvou", "vrcvoh"];
/** إزاحة الرأس حسب المزاج (درجات) — بديل الحواجب */
const MOOD_HEAD: Record<Mood, { nod: number; tilt: number }> = {
  happy: { nod: 0, tilt: 0 },
  neutral: { nod: 0, tilt: 0 },
  surprised: { nod: -4, tilt: 0 },
  shy: { nod: 7, tilt: 6 },
};

/* ============================================================================
 * محرّك Tween صغير (بديل framer-motion للـ 3D) — يعمل داخل useFrame
 * ========================================================================== */
type Ease = (t: number) => number;

const bezier = (x1: number, y1: number, x2: number, y2: number): Ease => {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const X = (t: number) => ((ax * t + bx) * t + cx) * t;
  const Y = (t: number) => ((ay * t + by) * t + cy) * t;
  const dX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 6; i++) {
      const e = X(t) - x;
      const d = dX(t);
      if (Math.abs(e) < 1e-5 || Math.abs(d) < 1e-6) break;
      t -= e / d;
    }
    if (Math.abs(X(t) - x) > 1e-4) {
      let lo = 0, hi = 1;
      t = x;
      for (let i = 0; i < 20; i++) {
        if (X(t) < x) lo = t; else hi = t;
        t = (lo + hi) / 2;
      }
    }
    return Y(t);
  };
};
const spring = (freq = 9, decay = 6): Ease => (t) => (t >= 1 ? 1 : 1 - Math.exp(-decay * t) * Math.cos(freq * t));

const EASE = {
  linear: ((t) => t) as Ease,
  in: bezier(0.42, 0, 1, 1),
  out: bezier(0, 0, 0.58, 1),
  inOut: bezier(0.42, 0, 0.58, 1),
  page: bezier(0.22, 1, 0.36, 1),
  spring: spring(9, 6),
  bounce: spring(12, 5),
};

const REST = {
  // الجسم كله (x,y بوحدات المشهد، yaw/roll بالدرجات، sx/sy تمدد حول القدمين)
  x: 0, y: 0, z: 0, yaw: 0, roll: 0, sx: 1, sy: 1,
  // الجذع والرأس
  lean: 0, twist: 0, breath: 0,
  tilt: 0, nod: 0, headYaw: 0,
  // الحوض والساقان
  hipsTilt: 0, hipsSway: 0, legSpread: 0,
  // الذراعان: r = يمين الشخصية (يسار الشاشة) ، l = يسار الشخصية (يمين الشاشة)
  rRaise: 0, rFwd: 0, rHoriz: 0, rElbow: 0, rEraise: 0,
  lRaise: 0, lFwd: 0, lHoriz: 0, lElbow: 0, lEraise: 0,
  // الساقان
  rLeg: 0, lLeg: 0, rKnee: 0, lKnee: 0,
  // الوجه: pucker = شفتان للقبلة، smile = ابتسامة، kiss = تقدّم القلوب (0..1)
  pucker: 0, smile: 0, kiss: 0,
  // توهّج النيون: يرفع شدة إضاءة الحافة وحلقة الأرض (0..1)
  glow: 0, pole: 0,
  // ✨ v3: spot = شدّة الإضاءة المسرحية (0..1) | spark = انفجار الشرارات الذهبية (0..1) | camPush = تقريب الكاميرا السينمائي (0..1)
  spot: 0, spark: 0, camPush: 0,
};
type Key = keyof typeof REST;
type Pose = Record<Key, number>;
type Spec = number | number[];

interface Opts { ease?: Ease; times?: number[]; repeat?: boolean }
interface Track {
  frames: number[]; times: number[]; dur: number; ease: Ease;
  t: number; repeat: boolean; done: () => void;
}

class Anim {
  v: Pose = { ...REST };
  timeScale = 1;
  private tracks = new Map<Key, Track>();

  set(p: Partial<Pose>) { Object.assign(this.v, p); }

  start(spec: Partial<Record<Key, Spec>>, duration: number, opts: Opts = {}): Promise<void> {
    const ps: Promise<void>[] = [];
    for (const k of Object.keys(spec) as Key[]) {
      const s = spec[k] as Spec;
      const frames = Array.isArray(s) ? s : [this.v[k], s];
      ps.push(
        new Promise<void>((resolve) => {
          this.tracks.get(k)?.done(); // استبدال track قديم = إيقافه
          const n = frames.length;
          this.tracks.set(k, {
            frames,
            times: opts.times ?? frames.map((_, i) => (n === 1 ? 0 : i / (n - 1))),
            dur: Math.max(duration, 1e-3) * this.timeScale,
            ease: opts.ease ?? EASE.inOut,
            t: 0,
            repeat: !!opts.repeat,
            done: resolve,
          });
        })
      );
    }
    return Promise.all(ps).then(() => undefined);
  }

  /** إيقاف كل الحركات الجارية (تُحلّ الـ promises ليتابع الكود ويتحقق من alive()) */
  stop() {
    const all = [...this.tracks.values()];
    this.tracks.clear();
    all.forEach((t) => t.done());
  }

  tick(dt: number) {
    for (const [k, tr] of this.tracks) {
      tr.t += dt;
      let p = tr.t / tr.dur;
      if (tr.repeat) p %= 1;
      else if (p >= 1) {
        this.v[k] = tr.frames[tr.frames.length - 1];
        this.tracks.delete(k);
        tr.done();
        continue;
      }
      const { frames, times } = tr;
      let i = 0;
      while (i < frames.length - 2 && p >= times[i + 1]) i++;
      const t0 = times[i], t1 = times[i + 1] ?? t0;
      const local = t1 > t0 ? Math.min(1, Math.max(0, (p - t0) / (t1 - t0))) : 1;
      const a = frames[i], b = frames[i + 1] ?? a;
      this.v[k] = a + (b - a) * tr.ease(local);
    }
  }
}

const armPose = (covered: boolean): Partial<Pose> => {
  const a = covered ? ARM_COVER : ARM_REST;
  const o: Record<string, number> = {};
  for (const s of ["r", "l"]) for (const [k, v] of Object.entries(a)) o[s + k] = v;
  return o as Partial<Pose>;
};

/* ============================================================================
 * الأوامر (نفس منطق AuthCharacter.run لكن بقيم ثلاثية الأبعاد)
 * ========================================================================== */
interface Ctx {
  coverEyes: () => boolean;
  reduced: () => boolean;
  ready: () => boolean;
  startX: () => number;
}
type RunOpts = { fromRest?: boolean; keep?: boolean };
const HOLD_POSE = new Set<CharacterAction>(["typing-email", "typing-password"]);

function createController(anim: Anim, ctx: Ctx) {
  const U = HEIGHT;
  let seq = 0;
  let manual = false;
  const covered = () => ctx.coverEyes() || manual;
  const dur = (d: number) => (ctx.reduced() ? 0 : d);

  const settle = async (id: number) => {
    await anim.start({ ...REST, ...armPose(covered()) }, dur(0.26), { ease: EASE.page });
    return id === seq;
  };

  const startIdle = (withHead = true, withArms = true) => {
    if (ctx.reduced()) return;

    // Idle أكثر حيوية: تنفّس هادئ، نقل الوزن بين القدمين، وحركات صغيرة
    // متزامنة للجذع والرأس والذراعين حتى لا تبدو Mika كأنها تمثال.
    const rep = { repeat: true, ease: EASE.inOut };
    anim.start({ y: [0, 0.012 * U, 0] }, 3.2, rep);
    anim.start({ breath: [0, 1, 0] }, 3.2, rep);
    anim.start({ roll: [0, 0.8, -0.8, 0] }, 5.2, rep);
    anim.start({ yaw: [0, 1.4, -1.1, 0] }, 6.4, rep);
    anim.start({ lean: [0, 0.7, -0.45, 0] }, 4.8, rep);
    anim.start({ twist: [0, 0.9, -0.7, 0] }, 5.6, rep);

    if (withHead) {
      anim.start({ tilt: [0, 2.2, -1.6, 0] }, 4.6, rep);
      anim.start({ nod: [0, -1.1, 0.6, 0] }, 5.8, rep);
      anim.start({ headYaw: [0, 2.2, -1.8, 0] }, 6.8, rep);
    }

    if (!covered() && withArms) {
      anim.start({ rRaise: [0, 2.8, 0], lRaise: [0, 2.8, 0] }, 3.4, rep);
      anim.start({ rFwd: [0, -1.2, 0], lFwd: [0, 1.2, 0] }, 4.2, rep);
      anim.start({ rLeg: [0, 0.7, 0], lLeg: [0, -0.7, 0] }, 5.2, rep);
    }
  };

  /** يُستدعى عند تغيّر coverEyes: الذراعان تتحرّكان لوضع التغطية/الراحة */
  const refreshCover = async () => {
    if (!ctx.ready()) return;
    const id = seq;
    await anim.start(armPose(covered()), dur(0.3), { ease: EASE.page });
    if (id !== seq || covered() || ctx.reduced()) return;
    anim.start({ rRaise: [0, 2.5, 0], lRaise: [0, 2.5, 0] }, 2.6, { repeat: true, ease: EASE.inOut });
  };

  /** قبلة بالفم واليد: اليد تقترب من الفم، شفتان مضمومتان، ثم تمتد اليد وتنطلق القلوب مع ابتسامة */
  const blowKiss = async (alive: () => boolean): Promise<boolean> => {
    const sleep = (s: number) => new Promise<void>((r) => setTimeout(r, s * 1000 * ANIM_SLOWDOWN));
    // 1) اليد تصل إلى الفم + شفتان للقبلة + الرأس يميل قليلاً
    await Promise.all([
      anim.start({ lRaise: 12, lFwd: 48, lHoriz: 18, lElbow: 112, lEraise: 0 }, 0.42, { ease: EASE.out }),
      anim.start({ pucker: 1, smile: 0, tilt: 7, nod: 5, headYaw: -5, yaw: 5 }, 0.38, { ease: EASE.out }),
    ]);
    if (!alive()) return false;
    await sleep(0.14);
    if (!alive()) return false;
    // 2) الإرسال: تمتدّ اليد للأمام والأعلى، تنطلق القلوب، وتنفتح الشفتان بابتسامة
    anim.start({ kiss: 1 }, 1.5, { ease: EASE.linear });
    anim.start({ pucker: 0 }, 0.16, { ease: EASE.out });
    anim.start({ smile: 1 }, 0.3, { ease: EASE.out });
    anim.start({ tilt: [7, 10, 6], nod: [5, -4, -2], headYaw: [-5, 4, 2] }, 1.0, { ease: EASE.inOut });
    await anim.start({ lRaise: 58, lFwd: 22, lHoriz: 12, lElbow: 18, lEraise: 0 }, 0.5, { ease: bezier(0.2, 0.85, 0.3, 1) });
    if (!alive()) return false;
    await sleep(0.95);
    if (!alive()) return false;
    anim.set({ kiss: 0 });
    await anim.start({ smile: 0, yaw: 0 }, 0.35, { ease: EASE.inOut });
    return alive();
  };

  const run = async (action: CharacterAction, opts: RunOpts = {}): Promise<boolean> => {
    const id = ++seq;
    const alive = () => id === seq;
    anim.stop();
    anim.set({ kiss: 0, pole: 0, z: 0, spot: 0, spark: 0, camPush: 0 });
    anim.timeScale = action === "walkIn" ? 1 : ANIM_SLOWDOWN;

    if (action === "hide-eyes" || action === "show-eyes") {
      manual = action === "hide-eyes";
      if (!(await settle(id))) return false;
      startIdle();
      return true;
    }
    if (action === "idle") {
      if (!(await settle(id))) return false;
      startIdle();
      return true;
    }
    if (action !== "walkIn" && !opts.fromRest && !(await settle(id))) return false;

    if (ctx.reduced()) {
      if (action === "walkIn") anim.set({ x: 0, yaw: 0 });
      return alive();
    }

    switch (action) {
      case "walkIn": {
        const STEP = 0.24, LEG = 22, ARM = 26;
        // المسافة محدودة: تظهر الشخصية خلال ~1.7 ثانية بدل المشي من أقصى حافة الشاشة
        const sx = Math.max(ctx.startX(), -1.8 * U);
        // عدد الخطوات يتناسب مع المسافة حتى تبقى سرعة المشي طبيعية
        const STEPS = Math.min(6, Math.max(3, Math.round(-sx / (1.8 * STEP * 2))));
        const poses = Array.from({ length: STEPS * 2 }, (_, k) => (k % 2 === 0 ? 1 : -1));
        const T = STEP * (poses.length + 1);
        const w = (f: (s: number) => number) => [0, ...poses.map(f), 0];
        const bob = (amp: number) => [0, ...poses.map((_, k) => (k % 2 === 0 ? 0 : amp)), 0];
        // يبدأ خارج الشاشة ويمشي جانبياً (وجهه نحو +X) ثم يلتفت للكاميرا في آخر لحظة
        anim.set({ x: sx, yaw: 90 });
        await Promise.all([
          anim.start({ x: 0 }, T, { ease: bezier(0.25, 0.6, 0.4, 1) }),
          anim.start({ yaw: [90, 90, 0] }, T, { times: [0, 0.9, 1], ease: EASE.inOut }),
          anim.start(
            {
              y: bob(0.012 * U),
              twist: w((s) => s * 5),
              headYaw: w((s) => -s * 4),
              tilt: w((s) => -s * 1.5),
              lLeg: w((s) => s * LEG),
              rLeg: w((s) => -s * LEG),
              lKnee: w((s) => (s < 0 ? 25 : 0)),
              rKnee: w((s) => (s > 0 ? 25 : 0)),
              lFwd: w((s) => -s * ARM),
              rFwd: w((s) => s * ARM),
            },
            T,
            { ease: EASE.inOut }
          ),
        ]);
        break;
      }

      case "spin": {
        await anim.start({ sy: 0.95, yaw: -12, lRaise: 35, rRaise: 35 }, 0.14, { ease: EASE.out });
        if (!alive()) return false;
        await Promise.all([
          anim.start({ yaw: 360 }, 0.75, { ease: bezier(0.45, 0, 0.2, 1) }),
          anim.start({ y: [0, 0.07 * U, 0] }, 0.75, { ease: EASE.inOut }),
          anim.start({ sy: 1 }, 0.3),
          anim.start({ rRaise: [35, 75, 75, 0], lRaise: [35, 75, 75, 0] }, 0.75, { times: [0, 0.25, 0.75, 1] }),
        ]);
        if (!alive()) return false;
        anim.set({ yaw: 0 });
        break;
      }

      case "jump": {
        // 1) تمهيد: انحناء + ضغط
        await Promise.all([
          anim.start({ y: -0.025 * U, sy: 0.93, sx: 1.04, lKnee: 30, rKnee: 30, lLeg: 20, rLeg: 20, lFwd: -30, rFwd: -30, nod: 6 }, 0.18, { ease: EASE.out }),
        ]);
        if (!alive()) return false;
        // 2) انطلاق: تمدد + ذراعان للأعلى
        await Promise.all([
          anim.start({ y: 0.22 * U }, 0.32, { ease: bezier(0.2, 0.9, 0.3, 1) }),
          anim.start({ sy: 1.05, sx: 0.97, lKnee: 20, rKnee: 20, lLeg: -8, rLeg: -8, lFwd: 0, rFwd: 0, nod: -8, tilt: -3 }, 0.28, { ease: EASE.out }),
          anim.start({ lRaise: 150, rRaise: 150 }, 0.32, { ease: EASE.out }),
        ]);
        if (!alive()) return false;
        // 3) سقوط + ضغط الهبوط
        await Promise.all([
          anim.start({ y: -0.015 * U, sy: 0.94, sx: 1.04, lKnee: 30, rKnee: 30, lLeg: 15, rLeg: 15, lRaise: 25, rRaise: 25, nod: 4, tilt: 0 }, 0.22, { ease: EASE.in }),
        ]);
        if (!alive()) return false;
        // 4) ارتداد
        await Promise.all([
          anim.start({ y: 0, sy: 1, sx: 1 }, 0.5, { ease: EASE.spring }),
          anim.start({ lKnee: 0, rKnee: 0, lLeg: 0, rLeg: 0, lRaise: 0, rRaise: 0, nod: 0 }, 0.25, { ease: EASE.inOut }),
        ]);
        break;
      }

      case "wave": {
        // تلويح طبيعي: ترفع يدها، تهزّها 3 مرات بإيقاع ناعم مع ميل الرأس وابتسامة، ثم تُرسل قبلة
        const swayAll = anim.start({ yaw: [0, 9, 9, 9, 0], roll: [0, 1.5, -1.5, 1, 0] }, 2.0, { ease: EASE.inOut });
        anim.start({ smile: 1 }, 0.35, { ease: EASE.out });
        anim.start({ tilt: [0, 7, 5, 7, 0], nod: [0, -2, 0, -2, 0] }, 1.9, { ease: EASE.inOut });
        await anim.start({ lRaise: 78, lHoriz: 22, lEraise: 70, lFwd: 8 }, 0.32, { ease: EASE.out });
        if (!alive()) return false;
        await anim.start({ lEraise: [70, 100, 40, 100, 40, 100, 40, 70] }, 1.15, { ease: EASE.inOut });
        if (!alive()) return false;
        await swayAll;
        if (!alive()) return false;
        if (!(await blowKiss(alive))) return false;
        break;
      }

      case "kiss": {
        if (!(await blowKiss(alive))) return false;
        break;
      }

      case "dance": {
        // رقصة قصيرة: 8 أنصاف إيقاع، الذراعان تتبادلان، الجسم يتمايل، والنيون ينبض مع الإيقاع
        const d = 2.6;
        const alt = (a: number, b: number) => [0, a, b, a, b, a, b, a, 0];
        await Promise.all([
          anim.start({ y: [0, 0.035 * U, 0, 0.035 * U, 0, 0.035 * U, 0, 0.035 * U, 0] }, d, { ease: EASE.inOut }),
          anim.start({ roll: alt(-4, 4), yaw: alt(14, -14), twist: alt(8, -8) }, d, { ease: EASE.inOut }),
          anim.start({ tilt: alt(6, -6), nod: alt(-3, 0) }, d, { ease: EASE.inOut }),
          anim.start({ lRaise: alt(120, 25), rRaise: alt(25, 120) }, d, { ease: EASE.inOut }),
          anim.start({ lKnee: alt(18, 0), rKnee: alt(0, 18) }, d, { ease: EASE.inOut }),
          anim.start({ glow: [0, 1, 0.35, 1, 0.35, 1, 0.35, 1, 0] }, d, { ease: EASE.inOut }),
          anim.start({ smile: 1 }, 0.3, { ease: EASE.out }),
        ]);
        break;
      }

      case "twerk": {
        // ─────────────────────────────────────────────────────────────
        // ✨ v5 — GTA-style twerk، الظهر + المؤخرة + الشعر + الأرجل:
        //   1) turn    →  دوران 180° (الظهر للكاميرا)، الشعر يتمايل مع الدوران
        //   2) drop    →  قرفصاء عميقة، اليدان على الركبتين، الكاميرا تقترب، الأضواء تشتعل
        //   3) pops    →  8 دفعات (~140 BPM): المؤخرة تندفع نحو الشاشة
        //   4) double  →  دفعتان سريعتان + تثبيت
        //   5) spin    →  دوران 180° أخرى (دورة كاملة 360°) + هزة شعر كبيرة، ثم عودة
        // ─────────────────────────────────────────────────────────────
        // ⚠️ درس v4 (من الفيديو، إطار بإطار):
        //   • الظهر: كتلة مسطّحة بلا خصر — لأن hipsTilt 46° جعل الجذع لوحاً
        //     مائلاً. في v5 أقصى ميل 40° + نبضة تنفّس (breath) تُحيي الظهر.
        //   • المؤخرة: تندمج مع الظهر — قرفصاء أعمق (ركب 88°) + وقفة أضيق
        //     (legSpread 12) تجعلها كتلة مستقلة في المنتصف.
        //   • الشعر: كعكة صغيرة مربوطة، لا شعر طويل منسدل — لا يتحرك إلا
        //     مع الرأس، لذلك الرأس يتحرك أكثر وبـتأخير (سوط): الدفعة في
        //     45% من النبضة بدل 30%، فيتبع الشعرُ المؤخرةَ كالسوط.
        //   • الأرجل: مفرّقة جداً على شكل V وتبدو مستقيمة من الخلف (الانثناء
        //     في مستوى أمامي/خلفي لا يُرى من الخلف) — وقفة أضيق + ركب أعمق.
        //   • الذراعان (جزء من مشكلة الظهر): كانتا ممدودتين جانبياً كالجناحين
        //     (raise 42 + ميل الجذع 46° = ذراع أفقية). في v5 اليدان على
        //     الركبتين وثابتتان أثناء الدفعات (المرفق فقط ينبض قليلاً).
        // ⚠️ الساقان تتبعان الحوض (legValue = hipsTilt + 55) — قاعدة v3.
        const BEATS = 8;
        const BEAT = 0.43;                 // ≈ 140 BPM
        const D = BEATS * BEAT;            // 3.44s
        const THIGH = 55;                  // زاوية الفخذ الأمامية في القرفصاء
        const BASE_TILT = 28;
        const POP_TILT = 40;
        const TUCK_TILT = 22;

        // مسار دفعات بزمن غير متماثل: الدفعة في أول frac من النبضة، الارتخاء بعدها
        // (frac أكبر = تأخير أكبر — للشعر: 0.45 فيتبع المؤخرة كالسوط)
        const beatPop = (base: number, pop: number, release: number = base, frac = 0.3) => {
          const frames = [base];
          const times = [0];
          for (let i = 0; i < BEATS; i++) {
            frames.push(pop, release);
            times.push((i + frac) / BEATS, (i + 1) / BEATS);
          }
          return { frames, times };
        };
        // حركة ثمانية (figure-8): دورة كاملة كل نبضتين، متأخرة ربع نبضة عن الدفعات
        const hipRoll = (amp: number) =>
          Array.from({ length: BEATS * 2 + 1 }, (_, i) => {
            const m = i % 4;
            return i === 0 || i === BEATS * 2 ? 0 : m === 1 ? amp : m === 3 ? -amp : 0;
          });

        // 1) Turn — دوران 180°، الظهر للكاميرا، الشعر يتمايل (0.5s)
        await anim.start(
          {
            yaw: 180,
            lRaise: 45, lFwd: 10, lElbow: 15,
            rRaise: 45, rFwd: 10, rElbow: 15,
            smile: 0.5,
            headYaw: [0, 25, 0],
          },
          0.5, { ease: EASE.inOut }
        );
        if (!alive()) return false;

        // 2) Drop — قرفصاء عميقة، اليدان على الركبتين (0.35s)
        await anim.start(
          {
            y: -0.15 * U, sy: 0.95, sx: 1.04,
            hipsTilt: BASE_TILT, hipsSway: 0, legSpread: 12,
            lKnee: 75, rKnee: 75, lLeg: BASE_TILT + THIGH, rLeg: BASE_TILT + THIGH,
            lean: 12,
            lRaise: 8, lFwd: 0, lElbow: 20, lHoriz: 8,
            rRaise: 8, rFwd: 0, rElbow: 20, rHoriz: -8,
            tilt: 6, nod: 8, smile: 0.7,
            glow: 0.4, camPush: 2.0, spot: 1.0,
          },
          0.35, { ease: EASE.out }
        );
        if (!alive()) return false;

        // 3) Main loop — 8 دفعات، المؤخرة نحو الشاشة (3.44s)
        const tilt = beatPop(BASE_TILT, POP_TILT, TUCK_TILT);
        const legs = { frames: tilt.frames.map((t) => t + THIGH), times: tilt.times };
        const knees = beatPop(75, 88);
        const bob = beatPop(-0.15 * U, -0.18 * U);
        const thrust = beatPop(0, 0.05 * U);
        const squash = beatPop(0.95, 0.92);
        const stretch = { frames: squash.frames.map((v) => 1.04 + (0.95 - v) * 1.5), times: squash.times };
        const elbows = beatPop(20, 26);
        const neon = beatPop(0.4, 1.0);
        const headBob = beatPop(8, 18, 6, 0.45); // سوط الشعر: يتأخر عن المؤخرة
        const rock = beatPop(12, 18, 10);
        const breath = beatPop(0, 0.3);
        await Promise.all([
          anim.start({ hipsTilt: tilt.frames }, D, { times: tilt.times, ease: EASE.inOut }),
          anim.start({ lLeg: legs.frames, rLeg: legs.frames }, D, { times: legs.times, ease: EASE.inOut }),
          anim.start({ lKnee: knees.frames, rKnee: knees.frames }, D, { times: knees.times, ease: EASE.inOut }),
          anim.start({ legSpread: beatPop(12, 16).frames }, D, { times: tilt.times, ease: EASE.inOut }),
          anim.start({ y: bob.frames, z: thrust.frames }, D, { times: bob.times, ease: EASE.inOut }),
          anim.start({ sy: squash.frames }, D, { times: squash.times, ease: EASE.inOut }),
          anim.start({ sx: stretch.frames }, D, { times: stretch.times, ease: EASE.inOut }),
          anim.start({ lElbow: elbows.frames, rElbow: elbows.frames }, D, { times: elbows.times, ease: EASE.inOut }),
          anim.start({ glow: neon.frames }, D, { times: neon.times, ease: EASE.inOut }),
          anim.start({ nod: headBob.frames }, D, { times: headBob.times, ease: EASE.inOut }),
          anim.start({ lean: rock.frames }, D, { times: rock.times, ease: EASE.inOut }),
          anim.start({ breath: breath.frames }, D, { times: breath.times, ease: EASE.inOut }),
          // figure-8 + تمايل الشعر والجسم: الحوض والرأس بطور معاكس
          anim.start({ hipsSway: hipRoll(13), twist: hipRoll(-7), tilt: hipRoll(5).map((v) => 6 + v), headYaw: hipRoll(-18), roll: hipRoll(3) }, D, { ease: EASE.inOut }),
        ]);
        if (!alive()) return false;

        // 4) Double-pop + freeze (0.5s + 0.35s hold)
        const fin = [22, 40, 26, 42, 38];
        await Promise.all([
          anim.start({ hipsTilt: fin }, 0.5, { times: [0, 0.22, 0.45, 0.68, 1], ease: EASE.inOut }),
          anim.start({ lLeg: fin.map((t) => t + THIGH), rLeg: fin.map((t) => t + THIGH) }, 0.5, { times: [0, 0.22, 0.45, 0.68, 1], ease: EASE.inOut }),
          anim.start(
            { y: [-0.15 * U, -0.18 * U, -0.15 * U, -0.18 * U, -0.16 * U], z: [0, 0.05 * U, 0, 0.05 * U, 0.02 * U], lKnee: [75, 90, 75, 90, 82], rKnee: [75, 90, 75, 90, 82] },
            0.5, { times: [0, 0.22, 0.45, 0.68, 1], ease: EASE.inOut }
          ),
          anim.start({ smile: 0.9, glow: 1 }, 0.3, { ease: EASE.out }),
        ]);
        if (!alive()) return false;
        await new Promise<void>(r => setTimeout(r, 350 * ANIM_SLOWDOWN));
        if (!alive()) return false;

        // 5) Spin back — إكمال الدورة 360° + هزة شعر كبيرة (0.6s)
        await anim.start(
          {
            yaw: 360,
            y: [-0.16 * U, 0.03 * U, 0],
            hipsTilt: 0, hipsSway: 0, legSpread: 0, lean: 0, twist: 0, roll: 0,
            lKnee: 0, rKnee: 0, lLeg: 0, rLeg: 0, z: 0, sy: 1, sx: 1, breath: 0,
            lRaise: [8, 70, 0], lFwd: [0, 10, 0], lElbow: [20, 20, 0], lHoriz: [8, 0, 0],
            rRaise: [8, 70, 0], rFwd: [0, 10, 0], rElbow: [20, 20, 0], rHoriz: [-8, 0, 0],
            tilt: 0, nod: 0, smile: 0.7, glow: 0, camPush: 0, spot: 0,
            headYaw: [0, -28, 0],
          },
          0.6, { ease: EASE.inOut }
        );
        if (!alive()) return false;
        anim.set({ yaw: 0 }); // 360° ≡ 0° — حتى لا تدور 360° عكسياً في الـ settle
        break;
      }
      case "poleSpin": {
        // ─────────────────────────────────────────────────────────────
        // ✨ v3 choreography (~6s):
        //   1) 0.5s  approach  →  تقترب، تمدّ اليد اليمنى، العمود يظهر + الكاميرا تقترب
        //   2) 0.4s  lift      →  ترفع جسمها، ثني الرُكبة اليسرى على العمود
        //   3) 1.0s  spin      →  دورتان كاملتان تصاعديتان (fireman spin) + مقصّ الساقين + طفو خفيف
        //   4) 0.5s  arch      →  وضعية "outside hook" بقوس ظهر درامي + انفجار شرارات ذهبية
        //   5) 0.6s  descend   →  تنزلق عائدة مع دوران عكسي
        //   6) 0.4s  release   →  تحرّر العمود وتعود لوقفتها
        //   7) 1.1s  finale    →  انحناء مسرحي (bow) + ابتسامة، ثم عودة هادئة
        // ─────────────────────────────────────────────────────────────
        const U = HEIGHT;
        const R = 0.20 * U;              // نصف قطر المدار
        const Y_LIFT   = 0.10 * U;       // ارتفاع المرحلة 2
        const Y_PEAK   = 0.22 * U;       // أعلى نقطة
        const SPINS    = 2;
        const STEPS    = 48;

        // تقدّم مُمهَّد (smoothstep) — يمنع الانطلاقة المفاجئة
        const smooth = (t: number) => t * t * (3 - 2 * t);
        const yawAt = (a: number) => -(a * 180 / Math.PI + 90);

        // ── Phase 1: Approach + reach (0.5s) ─────────────────────
        await Promise.all([
          anim.start(
            {
              rRaise: 165, rHoriz: -6, rElbow: 8,
              lRaise: 22,  lFwd:  18,  lElbow: 35,
              lean: 10, tilt: 5, nod: 3, headYaw: 6,
              lLeg: 12, rLeg: -6, lKnee: 20,
            },
            0.5, { ease: EASE.out }
          ),
          anim.start({ pole: 1, spot: 1, camPush: 1, x: R * 0.55, z: 0, yaw: 0 }, 0.5, { ease: EASE.out }),
        ]);
        if (!alive()) return false;

        // ── Phase 2: Lift + knee hook (0.4s) ─────────────────────
        const θ0 = 0;
        await anim.start(
          {
            x: Math.cos(θ0) * R, z: Math.sin(θ0) * R, y: Y_LIFT,
            yaw: yawAt(θ0),
            rRaise: 172, rElbow: 0,
            lRaise: 78,  lFwd: 12, lElbow: 22,
            lLeg: 80, lKnee: 95, rLeg: 42, rKnee: 12,
            lean: 18, tilt: -8, hipsTilt: -14,
          },
          0.4, { ease: EASE.out }
        );
        if (!alive()) return false;

        // ── Phase 3: Fireman spin, ascending (1.0s, 2 turns) ─────
        const prog3  = Array.from({ length: STEPS + 1 }, (_, i) => smooth(i / STEPS));
        const angles3 = prog3.map(p => θ0 + p * Math.PI * 2 * SPINS);
        await anim.start(
          {
            x:    angles3.map(a => Math.cos(a) * R),
            z:    angles3.map(a => Math.sin(a) * R),
            // طفو خفيف (±0.8% من الطول) يمنح الدوران إحساساً بالهواء بدل الخط المستقيم
            y:    prog3.map(p => Y_LIFT + (Y_PEAK - Y_LIFT) * p + Math.sin(p * Math.PI * 2) * 0.008 * U),
            yaw:  angles3.map(yawAt),
            lean: [18, 12, 8, 12, 18],       // موجات خفيفة مع الدوران
            twist: [0, 6, -6, 6, 0],
            // ✨ v3: مقصّ الساقين — يفتح ويغلق مع الدوران (الإطار الأول يطابق نهاية المرحلة 2)
            lLeg: [80, 62, 80, 62, 80],
            rLeg: [42, 20, 42, 20, 42],
          },
          1.0, { ease: EASE.linear }
        );
        if (!alive()) return false;

        // ── Phase 4: Arch hold — outside hook (0.5s) ─────────────
        // ✨ v3: انفجار الشرارات الذهبية عند ذروة القوس (يعمل بالتوازي، لا يوقف الرقصة)
        anim.start({ spark: [0, 1, 0.55, 0] }, 1.6, { ease: EASE.inOut });
        await anim.start(
          {
            lean: -20, twist: -8,
            tilt: -22, nod: -10, headYaw: 10,
            hipsTilt: 22, hipsSway: 8, legSpread: 12,
            rRaise: 176, rElbow: 0,
            lRaise: 128, lFwd: -12, lHoriz: -18, lElbow: 6,
            lLeg: 88, lKnee: 102,
            rLeg: 48, rKnee: 4,
            smile: 0.55,
            breath: [0, 1, 0],               // تنفّس خفيف أثناء التثبيت
          },
          0.5, { ease: EASE.out }
        );
        if (!alive()) return false;
        await new Promise<void>(r => setTimeout(r, 350 * ANIM_SLOWDOWN));
        if (!alive()) return false;

        // ── Phase 5: Descend, reverse spin (0.6s) ────────────────
        const θEnd  = θ0 + SPINS * Math.PI * 2;
        const prog5 = Array.from({ length: STEPS + 1 }, (_, i) => smooth(i / STEPS));
        const angles5 = prog5.map(p => θEnd - p * Math.PI * 2);
        await Promise.all([
          anim.start(
            {
              x:   angles5.map(a => Math.cos(a) * R),
              z:   angles5.map(a => Math.sin(a) * R),
              y:   prog5.map(p => Y_PEAK * (1 - p)),
              yaw: angles5.map(yawAt),
            },
            0.6, { ease: EASE.linear }
          ),
          anim.start(
            {
              lean:     [-20, -6, 0],
              twist:    [-8,   0, 0],
              tilt:     [-22,  0, 0],
              nod:      [-10,  0, 0],
              headYaw:  [ 10,  0, 0],
              hipsTilt: [ 22,  0, 0],
              hipsSway: [  8,  0, 0],
              legSpread:[ 12,  0, 0],
              lLeg:     [ 88, 30, 0], lKnee: [102, 40, 0],
              rLeg:     [ 48, 18, 0], rKnee: [  4, 15, 0],
              lRaise:   [128, 60, 25], lFwd: [-12, 8, 0], lHoriz: [-18, 0, 0],
            },
            0.6, { times: [0, 0.55, 1], ease: EASE.inOut }
          ),
        ]);
        if (!alive()) return false;

        // ── Phase 6: Release + return (0.4s) ─────────────────────
        const yawNorm = ((yawAt(θEnd) % 360) + 540) % 360 - 180;
        anim.set({ yaw: yawNorm }); // طيّ الدوران لزاوية مكافئة (بدون قفزة بصرية)
        await Promise.all([
          anim.start(
            {
              x: 0, z: 0, y: 0, yaw: 0,
              rRaise: [176, 40, 0], rElbow: [0, 22, 0],
              lRaise: [25, 10, 0],  lFwd:  [0, 0, 0],
              lean: 0, tilt: 0, nod: 0, headYaw: 0,
              hipsTilt: 0, hipsSway: 0, legSpread: 0,
              lLeg: 0, rLeg: 0, lKnee: 0, rKnee: 0,
              smile: 0,
              pole: 0, spot: 0,
            },
            0.4, { ease: EASE.inOut }
          ),
        ]);
        if (!alive()) return false;

        // ── Phase 7: Finale bow (0.45s + 0.3s hold + 0.35s return) ── ✨ v3
        await anim.start(
          {
            lean: 14, nod: 12, tilt: 0, headYaw: 0,
            rRaise: 45, rFwd: 10, rElbow: 10,
            lRaise: 45, lFwd: 10, lElbow: 10,
            smile: 0.85,
          },
          0.45, { ease: EASE.inOut }
        );
        if (!alive()) return false;
        await new Promise<void>(r => setTimeout(r, 300 * ANIM_SLOWDOWN));
        if (!alive()) return false;
        await anim.start(
          {
            lean: 0, nod: 0,
            rRaise: 0, rFwd: 0, rElbow: 0,
            lRaise: 0, lFwd: 0, lElbow: 0,
            smile: 0, camPush: 0, spark: 0,
          },
          0.35, { ease: EASE.inOut }
        );
        if (!alive()) return false;
        break;
      }

      case "think": {
        // وضعية التفكير (أثناء انتظار تسجيل الدخول): اليد قرب الفم والرأس مائل، والنيون ينبض ببطء
        await Promise.all([
          anim.start({ lRaise: 12, lFwd: 48, lHoriz: 18, lElbow: 112, lEraise: 0 }, 0.45, { ease: EASE.out }),
          anim.start({ tilt: 8, nod: -4, headYaw: -6 }, 0.45, { ease: EASE.out }),
        ]);
        if (!alive()) return false;
        anim.start({ nod: [-4, -7, -4], tilt: [8, 11, 8] }, 2.4, { repeat: true, ease: EASE.inOut });
        anim.start({ glow: [0, 0.55, 0] }, 1.8, { repeat: true, ease: EASE.inOut });
        break;
      }

      case "celebrate": {
        const d = 1.1;
        await Promise.all([
          anim.start({ glow: [0, 1, 0.4, 1, 0] }, d, { ease: EASE.inOut }),
          anim.start({ y: [0, 0.12 * U, 0, 0.09 * U, 0] }, d, { ease: EASE.inOut }),
          anim.start({ yaw: [0, 15, -15, 8, 0] }, d, { ease: EASE.inOut }),
          anim.start({ sy: [1, 1.05, 0.95, 1.04, 1], sx: [1, 0.97, 1.04, 0.98, 1] }, d, { ease: EASE.inOut }),
          anim.start({ tilt: [0, -6, 6, -4, 0] }, d, { ease: EASE.inOut }),
          anim.start({ lRaise: [0, 150, 30, 150, 0], rRaise: [0, 150, 30, 150, 0] }, d, { ease: EASE.inOut }),
          anim.start({ lKnee: [0, 15, 0, 12, 0], rKnee: [0, 15, 0, 12, 0] }, d, { ease: EASE.inOut }),
        ]);
        break;
      }

      case "shake":
        await Promise.all([
          anim.start({ x: [0, -0.035 * U, 0.035 * U, -0.03 * U, 0.03 * U, -0.01 * U, 0], roll: [0, -4, 4, -3, 3, -1, 0] }, 0.55, { ease: EASE.inOut }),
          anim.start({ headYaw: [0, 25, -25, 18, -18, 6, 0] }, 0.55, { ease: EASE.inOut }),
        ]);
        break;

      case "press":
        await Promise.all([
          anim.start({ y: 0.03 * U, sy: 1.05, sx: 0.98, nod: 8 }, 0.15, { ease: EASE.out }),
        ]);
        if (!alive()) return false;
        await Promise.all([anim.start({ y: 0, sy: 1, sx: 1, nod: 0 }, 0.5, { ease: EASE.bounce })]);
        break;

      case "typing-email":
        await anim.start({ tilt: -8, nod: 5, headYaw: -8 }, 0.35, { ease: EASE.spring });
        break;
      case "typing-password":
        await anim.start({ tilt: 8, nod: 5, headYaw: 8 }, 0.35, { ease: EASE.spring });
        break;
    }

    if (!alive()) return false;
    if (opts.keep) return true;
    if (action === "think") {
      startIdle(false, false); // التفكير يبقى حتى يصل الرد (الذراع لا تتأثر بالـ idle)
      return true;
    }
    if (HOLD_POSE.has(action)) {
      startIdle(false); // وضعية الكتابة تبقى (لا تُصفّر)
      return true;
    }
    if (await settle(id)) {
      startIdle();
      return true;
    }
    return false;
  };

  const playEntrance = async () => {
    if (!(await run("walkIn", { keep: true }))) return;
    if (!(await run("spin", { fromRest: true, keep: true }))) return;
    if (!(await run("jump", { fromRest: true, keep: true }))) return;
    await run("wave", { fromRest: true });
  };

  return {
    play: async (a: CharacterAction) => { await run(a); },
    playEntrance,
    refreshCover,
  };
}

/* ============================================================================
 * تحميل النموذج + ربط العظام
 * ========================================================================== */
interface RB {
  b: THREE.Object3D;
  R: THREE.Quaternion; // دوران الراحة المحلي
  P: THREE.Quaternion; // دوران الأب في وضع الراحة (بإطار الشخصية)
  Pi: THREE.Quaternion;
  s: number; // جهة الذراع: +1 / -1 على محور X
}
interface MorphRef { mesh: THREE.Mesh; i: number }
interface Rig {
  root: THREE.Group;
  hips?: RB; spine?: RB; chest?: RB; neck?: RB; head?: RB;
  eyes: RB[];
  arm: { r?: RB; l?: RB };
  elbow: { r?: RB; l?: RB };
  leg: { r?: RB; l?: RB };
  knee: { r?: RB; l?: RB };
  morphs: Map<string, MorphRef[]>;
  dispose: () => void;
}

const BLANK_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const norm = (s: string) =>
  s.toLowerCase().replace(/(::)?(geometry|subdeformer)$/g, "").replace(/[^a-z0-9]/g, "");

async function loadRig(): Promise<Rig> {
  // مسارات الصور داخل الـ FBX هي مسارات ويندوز (لن تُوجد) — نستبدلها بصورة فارغة ثم نركّب خاماتنا
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => (/\.(png|jpe?g|tga|bmp)(\?|$)/i.test(url) && !url.startsWith("data:") ? BLANK_PNG : url));
  const texLoader = new THREE.TextureLoader();
  const [fbx, skinTex, hairTex] = await Promise.all([
    getModelBuffer().then((buf) => new FBXLoader(manager).parse(buf, "")),
    texLoader.loadAsync(ASSETS.skin),
    texLoader.loadAsync(ASSETS.hair),
  ]);
  for (const t of [skinTex, hairTex]) {
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 16;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
  }
  // MeshStandardMaterial: لمعة خفيفة على الجلد والشعر بدل السطح المسطّح (Lambert)
  const skinMat = new THREE.MeshStandardMaterial({ map: skinTex, roughness: 0.72, metalness: 0 });
  // alphaToCoverage + MSAA = حواف شعر ناعمة بدل الحواف المسنّنة
  const clothMat = new THREE.MeshStandardMaterial({
    map: hairTex, alphaTest: 0.5, alphaToCoverage: true, side: THREE.DoubleSide, roughness: 0.55, metalness: 0,
  });

  const morphs = new Map<string, MorphRef[]>();
  const oldMats: THREE.Material[] = [];
  fbx.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.frustumCulled = false;
    const pick = (mat: THREE.Material) => {
      oldMats.push(mat);
      return /skin/i.test(mat.name) ? skinMat : clothMat;
    };
    m.material = Array.isArray(m.material) ? m.material.map(pick) : pick(m.material);
    if (m.morphTargetDictionary) {
      for (const [name, i] of Object.entries(m.morphTargetDictionary)) {
        const k = norm(name);
        if (!morphs.has(k)) morphs.set(k, []);
        morphs.get(k)!.push({ mesh: m, i });
      }
    }
  });
  // للتشخيص: أسماء الـ blendshapes المتاحة (افتح الـ Console واكتب window.__mikaMorphs)
  if (typeof window !== "undefined") (window as unknown as { __mikaMorphs?: string[] }).__mikaMorphs = [...morphs.keys()];
  oldMats.forEach((m) => {
    (m as THREE.MeshPhongMaterial).map?.dispose();
    m.dispose();
  });

  const byName = (...names: string[]) => {
    for (const n of names) {
      const o = fbx.getObjectByName(n) ?? fbx.getObjectByName(n.replace(/ /g, "_"));
      if (o) return o;
    }
    return undefined;
  };
  const wpos = (o?: THREE.Object3D) => (o ? new THREE.Vector3().setFromMatrixPosition(o.matrixWorld) : null);

  // 1) توجيه الشخصية ليكون وجهها نحو +Z (اتجاه الكاميرا) — من اتجاه القدم
  const rig = new THREE.Group();
  rig.add(fbx);
  rig.updateMatrixWorld(true);
  const ankle = wpos(byName("Left ankle")), toe = wpos(byName("Left toe"));
  if (ankle && toe) {
    const f = toe.sub(ankle);
    f.y = 0;
    if (f.lengthSq() > 1e-8) rig.rotation.y = -Math.atan2(f.x, f.z);
  }

  // 2) ضبط الحجم والموضع: القدمان على y=0 والجسم في المنتصف
  rig.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(rig, true);
  const size = box.getSize(new THREE.Vector3());
  rig.scale.setScalar(size.y > 1e-6 ? HEIGHT / size.y : 1);
  rig.updateMatrixWorld(true);
  // الحجم موحّد حول نقطة الأصل، فالصندوق الجديد = القديم × المعامل (يتجنب مسحاً ثانياً بطيئاً لكل رؤوس الجسم)
  const k = size.y > 1e-6 ? HEIGHT / size.y : 1;
  const box2 = new THREE.Box3(box.min.clone().multiplyScalar(k), box.max.clone().multiplyScalar(k));
  rig.position.set(-(box2.min.x + box2.max.x) / 2, -box2.min.y, -(box2.min.z + box2.max.z) / 2);
  rig.updateMatrixWorld(true);

  // 3) تخزين وضع الراحة لكل عظمة نتحكم بها
  const rigQi = rig.getWorldQuaternion(new THREE.Quaternion()).invert();
  const hipsPos = wpos(byName("Hips"));
  const mk = (o: THREE.Object3D | undefined, withSide = false): RB | undefined => {
    if (!o || !o.parent) return undefined;
    const pw = o.parent.getWorldQuaternion(new THREE.Quaternion());
    const P = rigQi.clone().multiply(pw);
    let s = 1;
    if (withSide) {
      const p = wpos(o);
      if (p && hipsPos) s = p.x - hipsPos.x < 0 ? -1 : 1;
    }
    return { b: o, R: o.quaternion.clone(), P, Pi: P.clone().invert(), s };
  };
  const pair = (l: string[], r: string[], side = false) => ({ l: mk(byName(...l), side), r: mk(byName(...r), side) });

  const eyes: RB[] = [];  fbx.traverse((o) => {
    if (/^(left|right)_?eye$/i.test(o.name)) {
      const rb = mk(o);
      if (rb) eyes.push(rb);
    }
  });

  return {
    root: rig,
    hips: mk(byName("Hips")),
    spine: mk(byName("Spine")),
    chest: mk(byName("Chest")),
    neck: mk(byName("Neck")),
    head: mk(byName("Head")),
    eyes,
    arm: pair(["Left arm"], ["Right arm"], true),
    elbow: pair(["Left elbow"], ["Right elbow"], true),
    leg: pair(["Left Leg", "Left leg"], ["Right Leg", "Right leg"], true),
    knee: pair(["Left knee"], ["Right knee"], true),
    morphs,
    dispose: () => {
      rig.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.geometry.dispose();
      });
      skinMat.dispose();
      clothMat.dispose();
      skinTex.dispose();
      hairTex.dispose();
    },
  };
}

/* ---- تحريك العظام: دوران بإحداثيات الشخصية (X=يسار الشخصية، Y=أعلى، Z=أمام) ---- */
const AX = new THREE.Vector3(1, 0, 0);
const AY = new THREE.Vector3(0, 1, 0);
const AZ = new THREE.Vector3(0, 0, 1);
const _D = new THREE.Quaternion();
const _a = new THREE.Quaternion();

const drive = (rb: RB | undefined, D: THREE.Quaternion) => {
  if (rb) rb.b.quaternion.copy(rb.Pi).multiply(D).multiply(rb.P).multiply(rb.R);
};
const _B = new THREE.Quaternion();
const _Bi = new THREE.Quaternion();
const driveArm = (rb: RB | undefined, raise: number, fwd: number, horiz: number) => {
  if (!rb) return;
  _D.setFromAxisAngle(AY, -rb.s * horiz * DEG);
  _D.multiply(_a.setFromAxisAngle(AX, -fwd * DEG));
  _D.multiply(_a.setFromAxisAngle(AZ, rb.s * (ARM_BASE + raise) * DEG));
  drive(rb, _D);
};
const driveElbow = (rb: RB | undefined, flex: number, eraise: number) => {
  if (!rb) return;
  // المرفق يُحرَّك بمحاور "الذراع النازلة" لا بمحاور وضعية T
  _B.setFromAxisAngle(AZ, rb.s * ARM_BASE * DEG);
  _Bi.copy(_B).invert();
  _D.setFromAxisAngle(AX, -flex * DEG);
  _D.multiply(_a.setFromAxisAngle(AZ, rb.s * eraise * DEG));
  _D.premultiply(_Bi).multiply(_B);
  drive(rb, _D);
};
const driveXYZ = (rb: RB | undefined, rx: number, ry: number, rz: number) => {
  if (!rb) return;
  _D.setFromAxisAngle(AY, ry * DEG);
  _D.multiply(_a.setFromAxisAngle(AX, rx * DEG));
  _D.multiply(_a.setFromAxisAngle(AZ, rz * DEG));
  drive(rb, _D);
};

/** قلوب القبلة: تأخير الانطلاق، الاتجاه (x يمين الشاشة، y أعلى، z نحو الكاميرا)، الحجم، دوران خفيف */
const HEARTS = [
  { delay: 0.0, dx: 0.9, dy: 0.5, dz: 0.9, size: 1.0, rot: 0.3 },
  { delay: 0.12, dx: 1.15, dy: 0.95, dz: 1.0, size: 0.75, rot: -0.4 },
  { delay: 0.24, dx: 0.7, dy: 0.85, dz: 1.2, size: 0.6, rot: 0.5 },
  { delay: 0.36, dx: 1.3, dy: 0.45, dz: 0.8, size: 0.85, rot: -0.25 },
  { delay: 0.45, dx: 0.95, dy: 1.15, dz: 1.1, size: 0.5, rot: 0.2 },
];
const _mouth = new THREE.Vector3();

const makeHeartTexture = () => {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  g.translate(64, 60);
  g.shadowColor = "rgba(255,60,120,0.7)";
  g.shadowBlur = 14;
  const grad = g.createLinearGradient(0, -40, 0, 50);
  grad.addColorStop(0, "#ff8fb8");
  grad.addColorStop(1, "#ff2d6f");
  g.fillStyle = grad;
  g.beginPath();
  g.moveTo(0, 42);
  g.bezierCurveTo(-62, -2, -40, -46, -16, -40);
  g.bezierCurveTo(-6, -38, 0, -30, 0, -24);
  g.bezierCurveTo(0, -30, 6, -38, 16, -40);
  g.bezierCurveTo(40, -46, 62, -2, 0, 42);
  g.closePath();
  g.fill();
  g.shadowBlur = 0;
  g.fillStyle = "rgba(255,255,255,0.55)";
  g.beginPath();
  g.ellipse(-22, -22, 9, 5, -0.7, 0, Math.PI * 2);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
};

/** ✨ v3: شرارات ذهبية حول العمود — انفجار عند ذروة القوس + غبار خفيف طوال الرقص */
const SPARKS = Array.from({ length: 12 }, (_, i) => {
  const a = (i / 12) * Math.PI * 2;
  return {
    angle: a,
    radius: 0.16 + (i % 3) * 0.09,                       // حول مدار العمود
    height: (0.15 + (((i * 37) % 100) / 100) * 0.75) * HEIGHT, // من الركبة إلى فوق الرأس
    size: 0.05 + (((i * 53) % 10) / 100) * 0.06,
    speed: 1.6 + (i % 4) * 0.5,                          // سرعة الوميض
    phase: (i * 0.7) % (Math.PI * 2),
  };
});
const makeSparkTexture = () => {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, "rgba(255, 250, 230, 1)");
  gr.addColorStop(0.25, "rgba(255, 220, 150, 0.9)");
  gr.addColorStop(0.6, "rgba(232, 200, 138, 0.35)");
  gr.addColorStop(1, "rgba(232, 200, 138, 0)");
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  // وميض نجمي: خطان متقاطعان
  g.strokeStyle = "rgba(255, 240, 200, 0.9)";
  g.lineWidth = 2;
  g.beginPath(); g.moveTo(32, 6); g.lineTo(32, 58); g.moveTo(6, 32); g.lineTo(58, 32); g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
};

/** حلقة نيون على الأرض تحت الشخصية (HUD): قرص متوهّج + حلقة رفيعة + أقواس تدور */
/** هالة ذهبية ناعمة تحت الشخصية — pedestal فاخر بدل النيون */
const makePadTexture = () => {
  const S = 256;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d")!;
  g.translate(S / 2, S / 2);
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, S / 2);
  gr.addColorStop(0, "rgba(255, 235, 200, 0.35)");
  gr.addColorStop(0.35, "rgba(232, 200, 138, 0.18)");
  gr.addColorStop(0.70, "rgba(200, 145, 46, 0.05)");
  gr.addColorStop(1, "rgba(200, 145, 46, 0)");
  g.fillStyle = gr;
  g.beginPath();
  g.arc(0, 0, S / 2, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = "rgba(245, 225, 180, 0.65)";
  g.lineWidth = 1.2;
  g.shadowColor = "rgba(232, 200, 138, 0.9)";
  g.shadowBlur = 8;
  g.beginPath();
  g.arc(0, 0, S * 0.33, 0, Math.PI * 2);
  g.stroke();
  g.shadowBlur = 4;
  g.beginPath();
  g.arc(0, 0, S * 0.18, 0, Math.PI * 2);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
};

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const damp = (cur: number, target: number, rate: number, dt: number) => cur + (target - cur) * (1 - Math.exp(-rate * dt));

/* ============================================================================
 * المشهد
 * ========================================================================== */
interface SceneProps {
  coverEyes: boolean;
  mood: Mood;
  api: MutableRefObject<CharacterHandle | null>;
  onReady: () => void;
}

function Scene({ coverEyes, mood, api, onReady }: SceneProps) {
  const get = useThree((s) => s.get);
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);

  // R3F يوجّه الكاميرا نحو (0,0,0) افتراضياً — نعيدها أفقية نحو منتصف الشخصية
  useEffect(() => {
    camera.lookAt(0, CAM_Y, 0);
    camera.updateProjectionMatrix();
  }, [camera]);

  // إضاءة بيئية ناعمة: تعطي لمعة واقعية للجلد والشعر (بدون ملف HDR خارجي)
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const env = pmrem.fromScene(room, 0.04);
    scene.environment = env.texture;
    scene.environmentIntensity = ENV_INTENSITY;
    room.dispose();
    return () => {
      scene.environment = null;
      env.dispose();
      pmrem.dispose();
    };
  }, [gl, scene]);

  const bodyRef = useRef<THREE.Group>(null);
  const holderRef = useRef<THREE.Group>(null);
  const shadowRef = useRef<THREE.Mesh>(null);
  const shadowSoftRef = useRef<THREE.Mesh>(null);
  const padRef = useRef<THREE.Mesh>(null);
  const poleGroupRef = useRef<THREE.Group>(null);
  // ✨ v3: مراجع المسرح — الهالة النجمية، الأضواء، الحلقات الأرضية، الشرارات
  const poleGlowRef = useRef<THREE.Sprite>(null);
  const poleSpotRef = useRef<THREE.SpotLight>(null);
  const poleRimRef = useRef<THREE.SpotLight>(null);
  const ringRef = useRef<THREE.Group>(null);
  const sparkRefs = useRef<THREE.Sprite[]>([]);
  const sparkTex = useMemo(() => makeSparkTexture(), []);
  useEffect(() => () => sparkTex.dispose(), [sparkTex]);
  const rimLRef = useRef<THREE.DirectionalLight>(null);
  const rimRRef = useRef<THREE.DirectionalLight>(null);
  const padLightRef = useRef<THREE.PointLight>(null);
  const padTex = useMemo(() => makePadTexture(), []);
  useEffect(() => () => padTex.dispose(), [padTex]);
  const heartRefs = useRef<THREE.Sprite[]>([]);
  const heartTex = useMemo(() => makeHeartTexture(), []);
  useEffect(() => () => heartTex.dispose(), [heartTex]);
  const rigRef = useRef<Rig | null>(null);

  const coverRef = useRef(coverEyes);
  coverRef.current = coverEyes;
  const moodRef = useRef(mood);
  moodRef.current = mood;
  const reducedRef = useRef(false);

  const anim = useMemo(() => {
    const a = new Anim();
    a.set({ x: -20 }); // خارج الشاشة حتى يبدأ walkIn
    return a;
  }, []);

  const ctl = useMemo(
    () =>
      createController(anim, {
        coverEyes: () => coverRef.current,
        reduced: () => reducedRef.current,
        ready: () => !!rigRef.current,
        startX: () => {
          const { size, gl } = get();
          const r = gl.domElement.getBoundingClientRect();
          const upp = (FRAME * HEIGHT) / Math.max(1, size.height); // وحدات المشهد لكل بكسل
          const toScreenLeft = r.left + r.width / 2; // بُعد الشخصية عن حافة الشاشة اليسرى
          const canvasHalf = (r.width / 2) * upp - 0.5 * HEIGHT;
          return -Math.min(toScreenLeft * upp + 0.7 * HEIGHT, canvasHalf);
        },
      }),
    [anim, get]
  );

  // ظل الأرض
  const shadowTex = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d")!;
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, "rgba(0,0,0,0.75)");
    gr.addColorStop(0.35, "rgba(0,0,0,0.42)");
    gr.addColorStop(0.7, "rgba(0,0,0,0.12)");
    gr.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  }, []);
  useEffect(() => () => shadowTex.dispose(), [shadowTex]);

  // تفضيل تقليل الحركة
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const upd = () => (reducedRef.current = mq.matches);
    upd();
    mq.addEventListener?.("change", upd);
    return () => mq.removeEventListener?.("change", upd);
  }, []);

  // تحميل النموذج
  useEffect(() => {
    let cancelled = false;
    let loaded: Rig | null = null;
    loadRig()
      .then((rig) => {
        if (cancelled) return rig.dispose();
        loaded = rig;
        holderRef.current?.add(rig.root);
        rigRef.current = rig;
        api.current = { play: (a) => ctl.play(a), playEntrance: () => ctl.playEntrance() };
        onReady();
      })
      .catch((e) => console.error("[MikaCharacter] failed to load model", e));
    return () => {
      cancelled = true;
      anim.stop();
      api.current = null;
      rigRef.current = null;
      if (loaded) {
        loaded.root.removeFromParent();
        loaded.dispose();
      }
    };
  }, [anim, ctl, api, onReady]);

  // تغطية العينين عند تغيّر الـ prop
  useEffect(() => {
    ctl.refreshCover();
  }, [coverEyes, ctl]);

  // نظر الشخصية نحو المؤشر
  const look = useRef({ tx: 0, ty: 0, hx: 0, hy: 0, ex: 0, ey: 0 });
  useEffect(() => {
    let frame = 0;
    let pos: { x: number; y: number } | null = null;
    const update = () => {
      frame = 0;
      if (!pos) return;
      const r = gl.domElement.getBoundingClientRect();
      const dx = pos.x - (r.left + r.width / 2);
      const dy = pos.y - (r.top + r.height * 0.28);
      const len = Math.hypot(dx, dy) || 1;
      const k = Math.min(1, len / 300);
      look.current.tx = (dx / len) * k;
      look.current.ty = (dy / len) * k;
    };
    const move = (e: PointerEvent) => {
      pos = { x: e.clientX, y: e.clientY };
      if (!frame) frame = requestAnimationFrame(update);
    };
    window.addEventListener("pointermove", move, { passive: true });
    return () => {
      window.removeEventListener("pointermove", move);
      cancelAnimationFrame(frame);
    };
  }, [gl]);

  // رمشة + مزاج
  const blink = useRef({ next: 1.5, t: -1, double: false });
  const mouth = useRef<Record<string, number>>({});
  const moodHead = useRef({ nod: 0, tilt: 0 });
  const clock = useRef(0);

  useFrame((_, delta) => {
    const rig = rigRef.current;
    const body = bodyRef.current;
    if (shadowRef.current) shadowRef.current.visible = !!rig;
    if (shadowSoftRef.current) shadowSoftRef.current.visible = !!rig;
    if (padRef.current) padRef.current.visible = !!rig;
    if (!rig || !body) return;
    const dt = Math.min(delta, 0.05);
    clock.current += dt;
    anim.tick(dt);
    const v = anim.v;
    const reduced = reducedRef.current;
    const covered = coverRef.current;

    // --- إضاءة النيون: نبض هادئ + توهّج عند الحركات ---
    const pulse = 0.5 + 0.5 * Math.sin(clock.current * 1.4);
    const glow = clamp(v.glow, 0, 1);
    if (rimLRef.current) rimLRef.current.intensity = RIM_BASE * (0.85 + 0.3 * pulse) + glow * 1.6;
    if (rimRRef.current) rimRRef.current.intensity = RIM_BASE * (1.15 - 0.3 * pulse) + glow * 1.6;
    if (padLightRef.current) {
      padLightRef.current.position.x = v.x;
      padLightRef.current.position.z = v.z + 0.9;
      padLightRef.current.intensity = 1.0 + 0.25 * pulse + glow * 1.4;
    }

    // --- الجسم كله ---
    body.position.set(v.x, v.y, v.z);
    body.rotation.set(0, v.yaw * DEG, -v.roll * DEG);
    body.scale.set(v.sx, v.sy, v.sx);
    const sh = shadowRef.current;
    const softSh = shadowSoftRef.current;
    const pad = padRef.current;
    const k = 1 - clamp(v.y / (HEIGHT * 0.6), 0, 0.55);
    // الظل ينزاح قليلاً بعيداً عن الضوء الرئيسي (يمين-أمام) ليبدو كظل حقيقي
    const shX = v.x - 0.05 * HEIGHT;
    if (sh) {
      sh.position.set(shX, 0.002, v.z - 0.03 * HEIGHT);
      sh.scale.set(HEIGHT * 0.75 * k, HEIGHT * 0.75 * k, 1);
      (sh.material as THREE.MeshBasicMaterial).opacity = 0.9 * k;
    }
    if (softSh) {
      softSh.position.set(shX, 0.001, v.z - 0.06 * HEIGHT);
      softSh.scale.set(HEIGHT * 1.5 * k, HEIGHT * 1.5 * k, 1);
      (softSh.material as THREE.MeshBasicMaterial).opacity = 0.4 * k;
    }
    if (pad) {
      const ps = HEIGHT * 0.9 * (1 + 0.03 * pulse) * (0.9 + 0.1 * k);
      pad.position.x = v.x;
      pad.position.z = v.z;
      pad.scale.set(ps, ps, 1);
      pad.rotation.z = reduced ? 0 : clock.current * 0.5;
      (pad.material as THREE.MeshBasicMaterial).opacity = (0.55 + 0.25 * pulse + 0.2 * glow) * k;
    }

    // --- النظر نحو المؤشر ---
    const L = look.current;
    const w = ((v.yaw % 360) + 540) % 360 - 180;
    const gate = reduced || covered ? 0 : clamp(1 - Math.abs(w) / 40, 0, 1);
    L.hx = damp(L.hx, L.tx * gate, 5, dt);
    L.hy = damp(L.hy, L.ty * gate, 5, dt);
    L.ex = damp(L.ex, L.tx * gate, 14, dt);
    L.ey = damp(L.ey, L.ty * gate, 14, dt);

    // --- مزاج الرأس ---
    const mh = MOOD_HEAD[moodRef.current];
    moodHead.current.nod = damp(moodHead.current.nod, covered ? 0 : mh.nod, 6, dt);
    moodHead.current.tilt = damp(moodHead.current.tilt, covered ? 0 : mh.tilt, 6, dt);

    // --- العظام ---
    driveXYZ(rig.hips, v.hipsTilt, 0, v.hipsSway);
    driveXYZ(rig.spine, 0, v.twist, -v.lean);
    if (rig.chest) {
      const b = rig.chest.b;
      b.scale.set(1 + 0.01 * v.breath, 1 + 0.015 * v.breath, 1 + 0.01 * v.breath);
    }
    const hy = v.headYaw + L.hx * 28;
    const hn = v.nod + L.hy * 14 + moodHead.current.nod;
    const ht = -(v.tilt + moodHead.current.tilt);
    driveXYZ(rig.neck, hn * 0.35, hy * 0.35, ht * 0.35);
    driveXYZ(rig.head, hn * 0.65, hy * 0.65, ht * 0.65);
    rig.eyes.forEach((e) => driveXYZ(e, L.ey * 8, L.ex * 12, 0));

    driveArm(rig.arm.r, v.rRaise, v.rFwd, v.rHoriz);
    driveArm(rig.arm.l, v.lRaise, v.lFwd, v.lHoriz);
    driveElbow(rig.elbow.r, v.rElbow, v.rEraise);
    driveElbow(rig.elbow.l, v.lElbow, v.lEraise);
    driveXYZ(rig.leg.r, -v.rLeg, 0, rig.leg.r ? rig.leg.r.s * v.legSpread : 0);
    driveXYZ(rig.leg.l, -v.lLeg, 0, rig.leg.l ? rig.leg.l.s * v.legSpread : 0);
    driveXYZ(rig.knee.r, v.rKnee, 0, 0);
    driveXYZ(rig.knee.l, v.lKnee, 0, 0);

    // --- الـ blendshapes: رمشة + فم ---
    const setMorph = (key: string, val: number) => {
      const refs = rig.morphs.get(key);
      if (!refs) return;
      for (const { mesh, i } of refs) if (mesh.morphTargetInfluences) mesh.morphTargetInfluences[i] = val;
    };
    const B = blink.current;
    let lid = 0;
    if (!reduced && !document.hidden) {
      if (B.t < 0 && clock.current > B.next) {
        B.t = 0;
        B.double = Math.random() < 0.2;
      }
      if (B.t >= 0) {
        B.t += dt;
        lid = B.t < 0.07 ? B.t / 0.07 : B.t < 0.2 ? 1 - (B.t - 0.07) / 0.13 : 0;
        if (B.t >= 0.2) {
          B.t = -1;
          B.next = clock.current + (B.double ? 0.12 : 2.4 + Math.random() * 2.8);
          B.double = false;
        }
      }
    }
    setMorph("blink", clamp(lid, 0, 1));

    const target = MOOD_MOUTH[moodRef.current];
    const P = clamp(v.pucker, 0, 1);
    const S = clamp(v.smile, 0, 1);
    const extra: Record<string, number> = { vrcvou: 0.85 * P, o: 0.3 * P, vrcvih: 0.55 * S, a: 0.12 * S };
    for (const k of MOUTH_KEYS) {
      const cur = mouth.current[k] ?? 0;
      const base = (target[k] ?? 0) * (1 - P);
      const nv = damp(cur, clamp(base + (extra[k] ?? 0), 0, 1), 14, dt);
      mouth.current[k] = nv;
      setMorph(k, nv);
    }

    // --- قلوب القبلة: تنطلق من الفم نحو يمين الشاشة (جهة اليد اليسرى للشخصية) ---
    const K = v.kiss;
    const hs = heartRefs.current;
    if (K > 0.001 && rig.head) {
      rig.head.b.updateWorldMatrix(true, false);
      rig.head.b.getWorldPosition(_mouth);
      _mouth.y += 0.07;
      _mouth.z += 0.12;
      HEARTS.forEach((h, i) => {
        const s = hs[i];
        if (!s) return;
        const p = clamp((K - h.delay) / 0.55, 0, 1);
        if (p <= 0 || p >= 1) { s.visible = false; return; }
        const e = 1 - Math.pow(1 - p, 2);
        s.visible = true;
        s.position.set(
          _mouth.x + h.dx * e * HEIGHT * 0.6,
          _mouth.y + (h.dy * e + Math.sin(p * Math.PI) * 0.05) * HEIGHT * 0.5 + p * 0.1,
          _mouth.z + h.dz * e * HEIGHT * 0.5
        );
        const size = h.size * HEIGHT * 0.1 * Math.pow(Math.sin(p * Math.PI), 0.5);
        s.scale.set(size, size, 1);
        s.material.rotation = h.rot * (1 - p);
        s.material.opacity = Math.min(1, (1 - p) * 2.2);
      });
    } else {
      for (const s of hs) if (s && s.visible) s.visible = false;
    }

    // ───── Pole & stage feedback ───── ✨ v3
    const p = clamp(v.pole, 0, 1);
    const s = clamp(v.spot, 0, 1);

    if (poleGroupRef.current) {
      poleGroupRef.current.visible = p > 0.01;
      poleGroupRef.current.children.forEach(child => {
        const m = (child as THREE.Mesh).material as THREE.MeshStandardMaterial;
        if (m) m.opacity = p;
      });
    }

    if (poleGlowRef.current) {
      poleGlowRef.current.visible = p > 0.01;
      const mat = poleGlowRef.current.material as THREE.SpriteMaterial;
      const pulse = 0.5 + 0.5 * Math.sin(clock.current * 3.2);
      mat.opacity = p * (0.4 + 0.5 * pulse) * (0.5 + 0.5 * s);
      const sc = 0.5 + 0.12 * Math.sin(clock.current * 2.6);
      poleGlowRef.current.scale.set(sc, sc, 1);
    }

    if (poleSpotRef.current) {
      poleSpotRef.current.intensity = s * 18;
      // تتبع خفيف للشخصية — يمنح إحساساً مسرحياً
      poleSpotRef.current.position.x = v.x * 0.35;
      poleSpotRef.current.position.z = 0.5 + v.z * 0.15;
    }

    if (poleRimRef.current) {
      poleRimRef.current.intensity = s * 6;
    }

    // ───── Floor rings: تدوران ببطء في اتجاهين متعاكسين ─────
    if (ringRef.current) {
      ringRef.current.visible = p > 0.01;
      ringRef.current.children.forEach((child, i) => {
        const m = (child as THREE.Mesh).material as THREE.MeshBasicMaterial;
        if (m) m.opacity = p * (i === 0 ? 0.55 : 0.35);
        child.rotation.z = clock.current * (i === 0 ? 0.22 : -0.16);
      });
    }

    // ───── Gold sparkles: انفجار عند القوس + غبار خفيف طوال الرقص ─────
    const sp = clamp(v.spark, 0, 1);
    const dust = Math.max(sp, p * 0.18);
    sparkRefs.current.forEach((spr, i) => {
      if (!spr) return;
      const cfg = SPARKS[i];
      if (dust <= 0.01) { spr.visible = false; return; }
      const tw = 0.35 + 0.65 * Math.abs(Math.sin(clock.current * cfg.speed + cfg.phase));
      const rise = Math.sin(clock.current * 0.7 + cfg.phase) * 0.06;
      spr.visible = true;
      spr.position.set(
        Math.cos(cfg.angle + clock.current * 0.12) * cfg.radius,
        cfg.height + rise,
        Math.sin(cfg.angle + clock.current * 0.12) * cfg.radius
      );
      const sc = cfg.size * (0.8 + 0.4 * tw);
      spr.scale.set(sc, sc, 1);
      (spr.material as THREE.SpriteMaterial).opacity = dust * tw;
    });

    // ───── Camera dolly-in: تقريب سينمائي خفيف أثناء العرض ─────
    const cp = clamp(v.camPush, 0, 1);
    camera.position.z = CAM_Z * (1 - 0.09 * cp);
    camera.position.y = CAM_Y + 0.06 * cp;
    camera.lookAt(0, CAM_Y + 0.02 * cp, 0);
  });

  return (
    <>
      {/* بيئة دافئة: سماء عاجية + أرض برونزية */}
      <hemisphereLight args={["#f5efe0", "#3d3228", 1.15]} />
      {/* ضوء رئيسي دافئ */}
      <directionalLight position={[2, 4, 5]} intensity={1.95} color="#fff6ea" />
      {/* ضوء تعبئة دافئ بدل الأزرق البارد */}
      <directionalLight position={[-3, 2, 3]} intensity={0.6} color="#e8dcc8" />
      {/* ضوءا حافة: شامبانيا + بيرل */}
      <directionalLight ref={rimLRef} position={[-3, 2.5, -4]} intensity={RIM_BASE} color="#e8c88a" />
      <directionalLight ref={rimRRef} position={[3, 2.5, -4]} intensity={RIM_BASE} color="#f5e6c8" />
      {/* هالة ذهبية أرضية على الساقين */}
      <pointLight ref={padLightRef} position={[0, 0.05, 0.9]} intensity={1.0} distance={3.5} decay={2} color="#e8c88a" />

      {/* ظل ناعم عريض + ظل تلامس مركّز */}
      <mesh ref={shadowSoftRef} rotation-x={-Math.PI / 2} position={[0, 0.001, 0]} renderOrder={-4}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial map={shadowTex} transparent depthWrite={false} />
      </mesh>
      <mesh ref={shadowRef} rotation-x={-Math.PI / 2} position={[0, 0.002, 0]} renderOrder={-3}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial map={shadowTex} transparent depthWrite={false} />
      </mesh>
      {/* حلقة نيون على الأرض */}
      <mesh ref={padRef} rotation-x={-Math.PI / 2} position={[0, 0.004, 0]} renderOrder={-2}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial map={padTex} transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>

      {/* ─────────── Pole — العمود الفاخر (يظهر فقط أثناء poleSpin) ─────────── */}
      {/* قاعدة برونزية مشطوفة */}
      <group ref={poleGroupRef} visible={false}>
        <mesh position={[0, 0.012, 0]}>
          <cylinderGeometry args={[0.20, 0.22, 0.024, 40]} />
          <meshStandardMaterial
            color="#5c4530" metalness={0.9} roughness={0.32}
            transparent opacity={0} toneMapped={false}
          />
        </mesh>
        {/* بروز صغير فوق القاعدة */}
        <mesh position={[0, 0.036, 0]}>
          <cylinderGeometry args={[0.055, 0.075, 0.022, 24]} />
          <meshStandardMaterial
            color="#8b6f47" metalness={0.95} roughness={0.25}
            transparent opacity={0} toneMapped={false}
          />
        </mesh>
        {/* العمود الكروم — مخروطي بلطف */}
        <mesh position={[0, HEIGHT * 0.75, 0]}>
          <cylinderGeometry args={[0.018, 0.024, HEIGHT * 1.5, 40, 1, true]} />
          <meshStandardMaterial
            color="#e8dcc8" metalness={1.0} roughness={0.06}
            envMapIntensity={2.2} transparent opacity={0} toneMapped={false}
          />
        </mesh>
        {/* كرة أعلى العمود — تتوهّج قليلاً */}
        <mesh position={[0, HEIGHT * 1.5, 0]}>
          <sphereGeometry args={[0.042, 20, 20]} />
          <meshStandardMaterial
            color="#f5e6c8" metalness={1} roughness={0.15}
            emissive="#e8c88a" emissiveIntensity={0.5}
            transparent opacity={0} toneMapped={false}
          />
        </mesh>
      </group>

      {/* هالة نجمية أعلى العمود — تنبض بلطف */}
      <sprite ref={poleGlowRef} position={[0, HEIGHT * 1.5, 0]} scale={[0.55, 0.55, 1]} visible={false}>
        <spriteMaterial
          map={padTex}
          color="#f0d89c"
          transparent opacity={0}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </sprite>

      {/* إضاءة مسرحية دافئة من فوق — تظهر أثناء الرقص فقط */}
      <spotLight
        ref={poleSpotRef}
        position={[0, HEIGHT * 2.4, 0.5]}
        target-position={[0, 0, 0]}
        angle={0.55}
        penumbra={0.85}
        intensity={0}
        color="#fff6ea"
        distance={5}
        decay={2}
      />
      {/* ✨ v3: حافة باردة من الخلف — تباين فاخر مع الدفء الأمامي */}
      <spotLight
        ref={poleRimRef}
        position={[-1.4, HEIGHT * 1.9, -1.2]}
        target-position={[0, 0, 0]}
        angle={0.5}
        penumbra={1}
        intensity={0}
        color="#a8c0ff"
        distance={4}
        decay={2}
      />

      {/* ✨ v3: حلقتان ذهبيتان حول القاعدة — تدوران ببطء في اتجاهين متعاكسين */}
      <group ref={ringRef} visible={false} position={[0, 0.006, 0]} rotation-x={-Math.PI / 2}>
        {/* ✨ v3.1: أقواس جزئية (270° و 225°) بدل دوائر كاملة — الدائرة الكاملة
            منتظمة فدورانها ما كانش يبان إطلاقاً، أما الفجوة فحركتها مقروءة فوراً */}
        <mesh>
          <ringGeometry args={[0.30, 0.315, 64, 1, 0, Math.PI * 1.5]} />
          <meshBasicMaterial color="#e8c88a" transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} side={THREE.DoubleSide} />
        </mesh>
        <mesh>
          <ringGeometry args={[0.38, 0.388, 64, 1, Math.PI * 0.6, Math.PI * 1.25]} />
          <meshBasicMaterial color="#f0d89c" transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} side={THREE.DoubleSide} />
        </mesh>
      </group>

      {/* ✨ v3: شرارات ذهبية حول العمود */}
      {SPARKS.map((_, i) => (
        <sprite
          key={`spark-${i}`}
          visible={false}
          renderOrder={9}
          ref={(el) => { if (el) sparkRefs.current[i] = el as THREE.Sprite; }}
        >
          <spriteMaterial map={sparkTex} transparent depthWrite={false} toneMapped={false} />
        </sprite>
      ))}

      <group ref={bodyRef}>
        <group ref={holderRef} />
      </group>

      {HEARTS.map((_, i) => (
        <sprite
          key={i}
          visible={false}
          renderOrder={10}
          ref={(el) => { if (el) heartRefs.current[i] = el as THREE.Sprite; }}
        >
          <spriteMaterial map={heartTex} transparent depthWrite={false} depthTest={false} toneMapped={false} />
        </sprite>
      ))}
    </>
  );
}

/* ============================================================================
 * المكوّن العام (نفس واجهة الاستخدام القديمة)
 * ========================================================================== */
interface Deferred { promise: Promise<void>; resolve: () => void }
const createDeferred = (): Deferred => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};

const MikaCharacter = forwardRef<CharacterHandle, Props>(function MikaCharacter(
  { coverEyes = false, mood = "happy", className, style, bleed = 2.5 },
  ref
) {
  const api = useRef<CharacterHandle | null>(null);
  const ready = useRef<Deferred | undefined>(undefined);
  if (!ready.current) ready.current = createDeferred();

  // الأوامر تنتظر حتى يكتمل تحميل النموذج، فيمكن استدعاؤها فوراً من useEffect
  useImperativeHandle(
    ref,
    () => ({
      play: async (action: CharacterAction) => {
        await ready.current!.promise;
        await api.current?.play(action);
      },
      playEntrance: async () => {
        await ready.current!.promise;
        await api.current?.playEntrance();
      },
    }),
    []
  );

  const [shown, setShown] = useState(false);
  const onReady = useMemo(
    () => () => {
      ready.current!.resolve();
      setShown(true);
    },
    []
  );

  return (
    <div className={className} style={{ position: "relative", ...style }} role="img" aria-label="Animated 3D character">
      <div
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: `${-bleed * 100}%`,
          width: `${(1 + 2 * bleed) * 100}%`,
          pointerEvents: "none",
          zIndex: 0,
          opacity: shown ? 1 : 0,
          transition: "opacity 0.5s ease-out",
        }}
      >
        <Canvas
          flat
          dpr={[1, Math.min(typeof window !== "undefined" && window.innerWidth < 640 ? 1.35 : 1.75, typeof window !== "undefined" ? Math.max(1, window.devicePixelRatio || 1) : 1.5)]}
          gl={{ alpha: true, antialias: true, powerPreference: "high-performance", stencil: false, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.08 }}
          camera={{ fov: FOV, position: [0, CAM_Y, CAM_Z], near: 0.1, far: 100 }}
          style={{ width: "100%", height: "100%", background: "transparent" }}
          onCreated={({ gl, camera }) => {
            gl.setClearColor(0x000000, 0);
            gl.outputColorSpace = THREE.SRGBColorSpace;
            gl.toneMapping = THREE.ACESFilmicToneMapping;
            gl.toneMappingExposure = 1.08;
            camera.lookAt(0, CAM_Y, 0);
          }}
        >
          <Scene coverEyes={coverEyes} mood={mood} api={api} onReady={onReady} />
        </Canvas>
      </div>
    </div>
  );
});

export default memo(MikaCharacter);