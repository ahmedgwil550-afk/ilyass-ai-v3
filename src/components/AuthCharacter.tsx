import { forwardRef, memo, useImperativeHandle, useEffect, useState, useRef } from "react";
import { motion, useAnimationControls, useMotionValue, useSpring, useTransform, useReducedMotion } from "framer-motion";

export type CharacterAction =
  | "idle"
  | "walkIn"
  | "spin"
  | "jump"
  | "wave"
  | "kiss"
  | "celebrate"
  | "shake"
  | "press"
  | "typing-email"
  | "typing-password"
  | "hide-eyes"
  | "show-eyes"
  | "dance"
  | "think"
  | "twerk"
  | "poleSpin";

export interface CharacterHandle {
  play: (action: CharacterAction) => Promise<void>;
  playEntrance: () => Promise<void>;
}

interface Props {
  coverEyes?: boolean;
  mood?: "happy" | "neutral" | "surprised" | "shy";
  className?: string;
  style?: React.CSSProperties;
}

const AuthCharacter = forwardRef<CharacterHandle, Props>(function AuthCharacter(
  { coverEyes = false, mood = "happy", className, style },
  ref
) {
  const reducedMotion = useReducedMotion();
  const sequence = useRef(0);
  const bodyCtl = useAnimationControls();
  const headCtl = useAnimationControls();
  const leftArmCtl = useAnimationControls();
  const rightArmCtl = useAnimationControls();
  const leftLegCtl = useAnimationControls();
  const rightLegCtl = useAnimationControls();
  const torsoCtl = useAnimationControls();

  const [blink, setBlink] = useState(false);
  useEffect(() => {
    let alive = true;
    const loop = async () => {
      while (alive) {
        await new Promise((r) => setTimeout(r, 2400 + Math.random() * 2800));
        if (!alive) return;
        if (document.hidden || reducedMotion) continue;
        setBlink(true);
        await new Promise((r) => setTimeout(r, 130));
        setBlink(false);
      }
    };
    loop();
    return () => { alive = false; };
  }, [reducedMotion]);

  const eyeX = useMotionValue(0);
  const eyeY = useMotionValue(0);
  const eyeXs = useSpring(eyeX, { stiffness: 200, damping: 18 });
  const eyeYs = useSpring(eyeY, { stiffness: 200, damping: 18 });
  const rootRef = useRef<SVGSVGElement>(null);

  // Pointer tracking is sampled once per frame; it never re-renders the form or SVG.
  useEffect(() => {
    let frame = 0;
    let position: { x: number; y: number } | null = null;
    const update = () => {
      frame = 0;
      const r = rootRef.current?.getBoundingClientRect();
      if (!r || !position || coverEyes) return;
      const dx = position.x - (r.left + r.width / 2);
      const dy = position.y - (r.top + r.height * 0.3);
      const len = Math.hypot(dx, dy) || 1;
      eyeX.set((dx / len) * Math.min(5, len / 40));
      eyeY.set((dy / len) * Math.min(5, len / 40));
    };
    const move = (e: PointerEvent) => {
      position = { x: e.clientX, y: e.clientY };
      if (!frame) frame = requestAnimationFrame(update);
    };
    if (coverEyes || reducedMotion) { eyeX.set(0); eyeY.set(0); }
    else window.addEventListener("pointermove", move, { passive: true });
    return () => { window.removeEventListener("pointermove", move); cancelAnimationFrame(frame); };
  }, [coverEyes, reducedMotion, eyeX, eyeY]);

  const ease = [0.22, 1, 0.36, 1] as const;
  const settle = async (id: number) => {
    const transition = { duration: reducedMotion ? 0 : 0.26, ease };
    await Promise.all([
      bodyCtl.start({ y: 0, rotate: 0, scale: 1, transition }),
      torsoCtl.start({ rotate: 0, scaleX: 1, scaleY: 1, transition }),
      headCtl.start({ y: 0, rotate: 0, transition }),
      leftArmCtl.start({ rotate: coverEyes ? -150 : 6, transition }),
      rightArmCtl.start({ rotate: coverEyes ? 150 : -6, transition }),
      leftLegCtl.start({ rotate: 0, transition }),
      rightLegCtl.start({ rotate: 0, transition }),
    ]);
    return id === sequence.current;
  };

  const startIdle = () => {
    if (reducedMotion) return;
    bodyCtl.start({ y: [0, -5, 0], transition: { duration: 2.4, repeat: Infinity, ease: "easeInOut" } });
    headCtl.start({ rotate: [0, 1.5, -1.5, 0], transition: { duration: 3.6, repeat: Infinity, ease: "easeInOut" } });
  };

  useEffect(() => {
    // Eye-covering is a joint rotation, not a detached overlay.
    const transition = { duration: reducedMotion ? 0 : 0.3, ease };
    leftArmCtl.start({ rotate: coverEyes ? -150 : 6, transition });
    rightArmCtl.start({ rotate: coverEyes ? 150 : -6, transition });
  }, [coverEyes, reducedMotion, leftArmCtl, rightArmCtl]);

  const play = async (action: CharacterAction) => {
    const id = ++sequence.current;
    // Stop old timelines at their interpolated pose, then blend into the next pose.
    [bodyCtl, headCtl, torsoCtl, leftArmCtl, rightArmCtl, leftLegCtl, rightLegCtl].forEach((ctl) => ctl.stop());
    if (action === "idle") { if (await settle(id)) startIdle(); return; }
    if (action !== "walkIn" && !(await settle(id))) return;
    if (reducedMotion) {
      if (action === "walkIn") await bodyCtl.start({ x: 0, transition: { duration: 0 } });
      return;
    }
    switch (action) {
      case "walkIn": {
        // Coordinated walk cycle: opposite arm/leg, gentle torso sway & head bob
        const STEPS = 6;
        const STEP_DUR = 0.22;
        const LEG_AMP = 18;     // degrees
        const ARM_AMP = 22;     // degrees (opposite to same-side leg)

        const headBob = headCtl.start({
          y: [0, -2, 0, -2, 0, -2, 0],
          transition: { duration: STEP_DUR * STEPS * 2, ease: "easeInOut" },
        });

        const limbCycle = (async () => {
          for (let i = 0; i < STEPS; i++) {
            if (id !== sequence.current) return;
            // Pose A: left leg forward, right arm forward
            await Promise.all([
              leftLegCtl.start({ rotate: -LEG_AMP, transition: { duration: STEP_DUR, ease: "easeInOut" } }),
              rightLegCtl.start({ rotate: LEG_AMP, transition: { duration: STEP_DUR, ease: "easeInOut" } }),
              leftArmCtl.start({ rotate: LEG_AMP, transition: { duration: STEP_DUR, ease: "easeInOut" } }),
              rightArmCtl.start({ rotate: -ARM_AMP, transition: { duration: STEP_DUR, ease: "easeInOut" } }),
            ]);
            if (id !== sequence.current) return;
            // Pose B: mirrored
            await Promise.all([
              leftLegCtl.start({ rotate: LEG_AMP, transition: { duration: STEP_DUR, ease: "easeInOut" } }),
              rightLegCtl.start({ rotate: -LEG_AMP, transition: { duration: STEP_DUR, ease: "easeInOut" } }),
              leftArmCtl.start({ rotate: -ARM_AMP, transition: { duration: STEP_DUR, ease: "easeInOut" } }),
              rightArmCtl.start({ rotate: ARM_AMP, transition: { duration: STEP_DUR, ease: "easeInOut" } }),
            ]);
          }
          if (id !== sequence.current) return;
          // Settle to neutral
          await Promise.all([
            leftLegCtl.start({ rotate: 0, transition: { duration: 0.25 } }),
            rightLegCtl.start({ rotate: 0, transition: { duration: 0.25 } }),
            leftArmCtl.start({ rotate: 6, transition: { duration: 0.25 } }),
            rightArmCtl.start({ rotate: -6, transition: { duration: 0.25 } }),
          ]);
        })();

        const travel = bodyCtl.start({
          x: 0,
          y: [0, -3, 0, -3, 0],
          transition: { duration: STEP_DUR * STEPS * 2, ease: "linear" },
        });

        await Promise.all([travel, limbCycle, headBob]);
        break;
      }
      case "spin":
        await bodyCtl.start({
          rotate: 360, scale: [1, 1.08, 1],
          transition: { duration: 0.75, ease: "easeInOut" },
        });
        if (id !== sequence.current) return;
        bodyCtl.set({ rotate: 0 });
        break;
      case "jump": {
        // Anticipation -> launch -> apex -> landing -> settle, all joints in sync
        // 1. Crouch (knees bend, arms swing back)
        await Promise.all([
          bodyCtl.start({ y: 14, transition: { duration: 0.18, ease: "easeOut" } }),

          leftLegCtl.start({ rotate: -10, transition: { duration: 0.18 } }),
          rightLegCtl.start({ rotate: 10, transition: { duration: 0.18 } }),
          leftArmCtl.start({ rotate: 35, transition: { duration: 0.18 } }),
          rightArmCtl.start({ rotate: -35, transition: { duration: 0.18 } }),
          headCtl.start({ y: 4, transition: { duration: 0.18 } }),
        ]);
        if (id !== sequence.current) return;
        // 2. Launch + apex (arms swing up, legs extend & tuck slightly)
        await Promise.all([
          bodyCtl.start({ y: -110, transition: { duration: 0.32, ease: [0.2, 0.9, 0.3, 1] } }),

          leftLegCtl.start({ rotate: -8, transition: { duration: 0.32 } }),
          rightLegCtl.start({ rotate: 8, transition: { duration: 0.32 } }),
          leftArmCtl.start({ rotate: -40, transition: { duration: 0.32 } }),
          rightArmCtl.start({ rotate: 40, transition: { duration: 0.32 } }),
          headCtl.start({ y: -3, transition: { duration: 0.32 } }),
        ]);
        if (id !== sequence.current) return;
        // 3. Landing (squash again)
        await Promise.all([
          bodyCtl.start({ y: 8, transition: { duration: 0.22, ease: "easeIn" } }),

          leftLegCtl.start({ rotate: -6, transition: { duration: 0.22 } }),
          rightLegCtl.start({ rotate: 6, transition: { duration: 0.22 } }),
          leftArmCtl.start({ rotate: 20, transition: { duration: 0.22 } }),
          rightArmCtl.start({ rotate: -20, transition: { duration: 0.22 } }),
        ]);
        if (id !== sequence.current) return;
        // 4. Settle back to neutral
        await Promise.all([
          bodyCtl.start({ y: 0, transition: { type: "spring", stiffness: 240, damping: 18 } }),

          leftLegCtl.start({ rotate: 0, transition: { duration: 0.25 } }),
          rightLegCtl.start({ rotate: 0, transition: { duration: 0.25 } }),
          leftArmCtl.start({ rotate: 6, transition: { duration: 0.25 } }),
          rightArmCtl.start({ rotate: -6, transition: { duration: 0.25 } }),
          headCtl.start({ y: 0, transition: { duration: 0.25 } }),
        ]);
        break;
      }
      case "wave": {
        // Slight body lean + head tilt toward the waving arm; shoulder stays anchored
        const lean = bodyCtl.start({
          rotate: [0, -3, -3, -3, 0],
          transition: { duration: 1.1, ease: "easeInOut" },
        });
        const tilt = headCtl.start({
          rotate: [0, 6, 6, 6, 0],
          transition: { duration: 1.1, ease: "easeInOut" },
        });
        // Lift right arm overhead from the shoulder joint
        await rightArmCtl.start({ rotate: -140, transition: { duration: 0.28, ease: "easeOut" } });
        for (let i = 0; i < 3; i++) {
          if (id !== sequence.current) return;
          await rightArmCtl.start({ rotate: -160, transition: { duration: 0.16, ease: "easeInOut" } });
          if (id !== sequence.current) return;
          await rightArmCtl.start({ rotate: -115, transition: { duration: 0.16, ease: "easeInOut" } });
        }
        if (id !== sequence.current) return;
        await rightArmCtl.start({ rotate: -6, transition: { duration: 0.3, ease: "easeIn" } });
        await Promise.all([lean, tilt]);
        break;
      }
      case "celebrate":
        await Promise.all([
          bodyCtl.start({
            y: [0, -70, 0, -50, 0], rotate: [0, 10, -10, 5, 0],
            transition: { duration: 1.1 },
          }),

          leftArmCtl.start({ rotate: [6, -160, -20, -160, 6], transition: { duration: 1.1 } }),
          rightArmCtl.start({ rotate: [-6, 160, 20, 160, -6], transition: { duration: 1.1 } }),
          leftLegCtl.start({ rotate: [0, -8, 0, -6, 0], transition: { duration: 1.1 } }),
          rightLegCtl.start({ rotate: [0, 8, 0, 6, 0], transition: { duration: 1.1 } }),
        ]);
        break;
      case "shake":
        await bodyCtl.start({
          x: [0, -12, 12, -10, 10, -4, 0], rotate: [0, -4, 4, -3, 3, -1, 0],
          transition: { duration: 0.55 },
        });
        break;
      case "press":
        await Promise.all([
          bodyCtl.start({ y: -14, scale: 1.05, transition: { duration: 0.15 } }),

        ]);
        await Promise.all([
          bodyCtl.start({ y: 0, scale: 1, transition: { type: "spring", bounce: 0.55, duration: 0.5 } }),

        ]);
        break;
      case "typing-email":
        await headCtl.start({ rotate: -8, transition: { type: "spring", stiffness: 220, damping: 16 } });
        break;
      case "typing-password":
        await headCtl.start({ rotate: 8, transition: { type: "spring", stiffness: 220, damping: 16 } });
        break;

    }
    if (id === sequence.current && await settle(id)) startIdle();
  };

  const playEntrance = async () => {
    const previous = sequence.current;
    await play("walkIn");
    if (sequence.current !== previous + 1) return;
    await play("spin");
    if (sequence.current !== previous + 2) return;
    await play("jump");
    if (sequence.current !== previous + 3) return;
    await play("wave");
  };

  useImperativeHandle(ref, () => ({ play, playEntrance }));
  useEffect(() => () => { sequence.current++; [bodyCtl, headCtl, torsoCtl, leftArmCtl, rightArmCtl, leftLegCtl, rightLegCtl].forEach((ctl) => ctl.stop()); }, [bodyCtl, headCtl, torsoCtl, leftArmCtl, rightArmCtl, leftLegCtl]);

  // Pupil transforms — base coords match new face center
  const pupilL_cx = useTransform(eyeXs, (v) => 115 + v);
  const pupilL_cy = useTransform(eyeYs, (v) => 115 + v);
  const pupilR_cx = useTransform(eyeXs, (v) => 185 + v);
  const pupilR_cy = useTransform(eyeYs, (v) => 115 + v);
  const glintL_cx = useTransform(pupilL_cx, (v) => v - 5);
  const glintL_cy = useTransform(pupilL_cy, (v) => v - 5);
  const glintR_cx = useTransform(pupilR_cx, (v) => v - 5);
  const glintR_cy = useTransform(pupilR_cy, (v) => v - 5);
  const subGlintL_cy = useTransform(pupilL_cy, (v) => v + 5);
  const subGlintR_cy = useTransform(pupilR_cy, (v) => v + 5);

  // Mouth path by mood (face center ~150, 165)
  const mouthPath =
    mood === "surprised"
      ? "M140 160 Q150 178 160 160 Q150 172 140 160 Z"
      : mood === "shy"
      ? "M138 165 Q150 170 162 165"
      : mood === "neutral"
      ? "M135 165 Q150 168 165 165"
      : "M135 160 C145 175, 155 175, 165 160";

  return (
    <motion.svg
      ref={rootRef}
      viewBox="0 0 300 400"
      animate={bodyCtl}
      initial={{ x: -360, y: 0, rotate: 0, scale: 1 }}
      className={className}
      style={{ overflow: "visible", ...style }}
      aria-label="Animated character"
    >
      <defs>
        <linearGradient id="hoodieGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ff6e8f" />
          <stop offset="55%" stopColor="#ef4174" />
          <stop offset="100%" stopColor="#b71f50" />
        </linearGradient>
        <linearGradient id="hoodieShade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#000" stopOpacity="0" />
          <stop offset="100%" stopColor="#000" stopOpacity="0.2" />
        </linearGradient>
        <radialGradient id="skinGrad" cx="0.38" cy="0.32" r="0.85">
          <stop offset="0%" stopColor="#fff1de" />
          <stop offset="60%" stopColor="#ffd6ab" />
          <stop offset="100%" stopColor="#d9a87c" />
        </radialGradient>
        <linearGradient id="hairGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2a2454" />
          <stop offset="100%" stopColor="#1a1a3a" />
        </linearGradient>
        <linearGradient id="pantsGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#445183" />
          <stop offset="100%" stopColor="#26305c" />
        </linearGradient>
      </defs>

      {/* Ground shadow */}
      <ellipse cx="150" cy="392" rx="60" ry="8" fill="rgba(0,0,0,0.28)" />

      {/* === TORSO (hoodie body, drawn first so limbs overlap at joints) === */}
      <motion.g animate={torsoCtl} style={{ originX: "150px", originY: "260px" }}>
        <rect x="95" y="200" width="110" height="120" rx="25" fill="url(#hoodieGrad)" />
        <rect x="95" y="200" width="110" height="120" rx="25" fill="url(#hoodieShade)" />
        {/* hem band */}
        <rect x="95" y="310" width="110" height="12" rx="6" fill="#b71f50" opacity="0.85" />
        {/* kangaroo pocket */}
        <path d="M112 255 Q150 265 188 255 L182 288 Q150 294 118 288 Z"
          fill="rgba(0,0,0,0.18)" stroke="rgba(255,255,255,0.12)" strokeWidth="0.8" />
        {/* collar seam */}
        <path d="M95 240 Q150 250 205 240" stroke="rgba(0,0,0,0.08)" strokeWidth="3" fill="none" />
        {/* drawstrings */}
        <line x1="140" y1="210" x2="140" y2="240" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" />
        <line x1="160" y1="210" x2="160" y2="240" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" />
        <circle cx="140" cy="243" r="2.4" fill="#ffffff" />
        <circle cx="160" cy="243" r="2.4" fill="#ffffff" />
      </motion.g>

      {/* === SHOULDER JOINTS (visual anchor under the arms) === */}
      <circle cx="95" cy="205" r="10" fill="#b71f50" />
      <circle cx="205" cy="205" r="10" fill="#b71f50" />

      {/* === ARMS (pivot exactly at shoulder joint) === */}
      <g transform="translate(95 205)"><motion.g animate={leftArmCtl} style={{ transformOrigin: "0px 0px" }}><g transform="translate(-95 -205)">
        {/* upper arm sleeve hugs the torso */}
        <rect x="85" y="205" width="20" height="110" rx="10" fill="url(#hoodieGrad)" />
        <rect x="85" y="205" width="20" height="110" rx="10" fill="url(#hoodieShade)" />
        {/* cuff */}
        <rect x="83" y="307" width="24" height="10" rx="4" fill="#b71f50" />
        {/* HAND */}
        <g>
          <path d="M85 318 Q80 325 83 335 Q88 345 95 345 Q105 345 108 335 Q111 325 105 318 Q100 314 95 314 Q90 314 85 318 Z"
            fill="url(#skinGrad)" stroke="#d9a87c" strokeWidth="1.2" />
          {/* thumb */}
          <path d="M82 322 Q77 326 79 332 Q82 335 86 332 Z" fill="url(#skinGrad)" stroke="#d9a87c" strokeWidth="1" />
          {/* fingers */}
          <path d="M90 327 Q90 338 91 343" stroke="#d9a87c" strokeWidth="1" fill="none" opacity="0.7" />
          <path d="M96 326 Q96 339 97 344" stroke="#d9a87c" strokeWidth="1" fill="none" opacity="0.7" />
          <path d="M102 327 Q102 338 101 343" stroke="#d9a87c" strokeWidth="1" fill="none" opacity="0.7" />
        </g>
      </g></motion.g></g>
      <g transform="translate(205 205)"><motion.g animate={rightArmCtl} style={{ transformOrigin: "0px 0px" }}><g transform="translate(-205 -205)">
        <rect x="195" y="205" width="20" height="110" rx="10" fill="url(#hoodieGrad)" />
        <rect x="195" y="205" width="20" height="110" rx="10" fill="url(#hoodieShade)" />
        <rect x="193" y="307" width="24" height="10" rx="4" fill="#b71f50" />
        <g>
          <path d="M195 318 Q190 325 193 335 Q198 345 205 345 Q215 345 218 335 Q221 325 215 318 Q210 314 205 314 Q200 314 195 318 Z"
            fill="url(#skinGrad)" stroke="#d9a87c" strokeWidth="1.2" />
          <path d="M218 322 Q223 326 221 332 Q218 335 214 332 Z" fill="url(#skinGrad)" stroke="#d9a87c" strokeWidth="1" />
          <path d="M200 327 Q200 338 201 343" stroke="#d9a87c" strokeWidth="1" fill="none" opacity="0.7" />
          <path d="M206 326 Q206 339 207 344" stroke="#d9a87c" strokeWidth="1" fill="none" opacity="0.7" />
          <path d="M212 327 Q212 338 211 343" stroke="#d9a87c" strokeWidth="1" fill="none" opacity="0.7" />
        </g>
      </g></motion.g></g>

      {/* === HIP JOINTS === */}
      <circle cx="127.5" cy="320" r="8" fill="#26305c" />
      <circle cx="172.5" cy="320" r="8" fill="#26305c" />

      {/* === LEGS (pivot at hip joint, tucked under torso) === */}
      <g transform="translate(127.5 320)"><motion.g animate={leftLegCtl} style={{ transformOrigin: "0px 0px" }}><g transform="translate(-127.5 -320)">
        <rect x="112" y="320" width="31" height="55" rx="10" fill="url(#pantsGrad)" />
        <rect x="132" y="322" width="9" height="51" rx="4" fill="rgba(0,0,0,0.18)" />
        {/* shoe */}
        <rect x="110" y="372" width="35" height="13" rx="4" fill="#ffffff" stroke="#9aa0b0" strokeWidth="1" />
        <rect x="110" y="380" width="35" height="5" rx="2" fill="#2a2d36" />
        <rect x="114" y="375" width="27" height="2" rx="1" fill="#ef4174" />
      </g></motion.g></g>
      <g transform="translate(172.5 320)"><motion.g animate={rightLegCtl} style={{ transformOrigin: "0px 0px" }}><g transform="translate(-172.5 -320)">
        <rect x="157" y="320" width="31" height="55" rx="10" fill="url(#pantsGrad)" />
        <rect x="177" y="322" width="9" height="51" rx="4" fill="rgba(0,0,0,0.18)" />
        <rect x="155" y="372" width="35" height="13" rx="4" fill="#ffffff" stroke="#9aa0b0" strokeWidth="1" />
        <rect x="155" y="380" width="35" height="5" rx="2" fill="#2a2d36" />
        <rect x="159" y="375" width="27" height="2" rx="1" fill="#ef4174" />
      </g></motion.g></g>

      {/* === HEAD === */}
      <motion.g animate={headCtl} style={{ originX: "150px", originY: "195px" }}>
        {/* neck */}
        <rect x="138" y="188" width="24" height="20" fill="url(#skinGrad)" />
        <path d="M138 204 Q150 210 162 204 L162 208 Q150 212 138 208 Z" fill="rgba(0,0,0,0.2)" />

        {/* ears */}
        <circle cx="75" cy="125" r="10" fill="url(#skinGrad)" stroke="#d9a87c" strokeWidth="1" />
        <ellipse cx="76" cy="126" rx="3" ry="5" fill="#c98a5f" opacity="0.5" />
        <circle cx="225" cy="125" r="10" fill="url(#skinGrad)" stroke="#d9a87c" strokeWidth="1" />
        <ellipse cx="224" cy="126" rx="3" ry="5" fill="#c98a5f" opacity="0.5" />

        {/* face */}
        <circle cx="150" cy="120" r="75" fill="url(#skinGrad)" stroke="rgba(0,0,0,0.1)" strokeWidth="1" />
        {/* shading on right side */}
        <path d="M210 80 Q225 105 225 130 Q220 165 180 185 Q205 160 210 130 Q210 100 210 80 Z"
          fill="rgba(120,60,30,0.10)" />

        {/* HAIR */}
        <path d="M150 45 C210 45, 228 95, 225 125
                 Q215 100, 198 96
                 Q188 80, 168 84
                 Q150 70, 132 84
                 Q112 80, 102 96
                 Q85 100, 75 125
                 C72 95, 90 45, 150 45 Z"
          fill="url(#hairGrad)" />
        {/* hair shine */}
        <path d="M120 60 Q140 52 160 56 Q145 64 130 68 Q122 66 120 60 Z" fill="#fff" opacity="0.18" />

        {/* EYEBROWS */}
        <motion.path
          d="M100 87 C108 80, 128 80, 132 88"
          stroke="#1a1a3a" strokeWidth="4" strokeLinecap="round" fill="none"
          animate={{ y: coverEyes ? -4 : 0, rotate: coverEyes ? -8 : 0 }}
          style={{ originX: "115px", originY: "85px" }}
        />
        <motion.path
          d="M168 88 C172 80, 192 80, 200 87"
          stroke="#1a1a3a" strokeWidth="4" strokeLinecap="round" fill="none"
          animate={{ y: coverEyes ? -4 : 0, rotate: coverEyes ? 8 : 0 }}
          style={{ originX: "185px", originY: "85px" }}
        />

        {/* EYES */}
        <g>
          {/* socket shadow */}
          <ellipse cx="115" cy="117" rx="20" ry="19" fill="#000" opacity="0.06" />
          <ellipse cx="185" cy="117" rx="20" ry="19" fill="#000" opacity="0.06" />
          {/* sclera */}
          <ellipse cx="115" cy="115" rx="18" ry={blink ? 1 : 18} fill="#ffffff" />
          <ellipse cx="185" cy="115" rx="18" ry={blink ? 1 : 18} fill="#ffffff" />
          {!blink && (
            <>
              <motion.circle r="11" fill="#222244" cx={pupilL_cx} cy={pupilL_cy} />
              <motion.circle r="11" fill="#222244" cx={pupilR_cx} cy={pupilR_cy} />
              <motion.circle r="5" fill="#ffffff" cx={glintL_cx} cy={glintL_cy} />
              <motion.circle r="5" fill="#ffffff" cx={glintR_cx} cy={glintR_cy} />
              <motion.circle r="1.6" fill="#ffffff" opacity="0.8"
                cx={pupilL_cx} cy={subGlintL_cy} />
              <motion.circle r="1.6" fill="#ffffff" opacity="0.8"
                cx={pupilR_cx} cy={subGlintR_cy} />
            </>
          )}
        </g>

        {/* cheeks blush */}
        <ellipse cx="115" cy="155" rx="20" ry="10" fill="#ffb2a5" opacity="0.55" />
        <ellipse cx="185" cy="155" rx="20" ry="10" fill="#ffb2a5" opacity="0.55" />

        {/* nose */}
        <path d="M150 135 L150 145" stroke="#d9a87c" strokeWidth="3" strokeLinecap="round" />

        {/* mouth */}
        <motion.path d={mouthPath} stroke="#801a1a" strokeWidth="3" strokeLinecap="round"
          fill={mood === "happy" || mood === "surprised" ? "#7a2238" : "none"} />
        {mood === "happy" && (
          <path d="M142 164 Q150 168 158 164 Q150 166 142 164 Z" fill="#ffffff" opacity="0.85" />
        )}
      </motion.g>
    </motion.svg>
  );
});

export default memo(AuthCharacter);
