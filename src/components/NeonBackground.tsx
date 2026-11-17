import { memo, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";

const FOV = 55;
const LUXE = {
  champagne: "#e8c88a",
  gold: "#d4a574",
  amber: "#c8912e",
  pearl: "#f5efe0",
  bronze: "#8b6f47",
};

const backdropVert = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`;

const backdropFrag = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform vec2 uRes;
  varying vec2 vUv;
  void main() {
    vec2 aspect = vec2(uRes.x / max(uRes.y, 1.0), 1.0);
    vec2 p = (vUv - 0.5) * aspect;
    vec3 base = vec3(0.032, 0.026, 0.021);
    float d1 = length(p - vec2(0.0, 0.28));
    float warm = exp(-d1 * 2.4);
    float d2 = length(p - vec2(0.18, 0.5));
    float champagneGlow = exp(-d2 * 3.2);
    float sweep = sin((vUv.x * 1.6 + vUv.y * 1.1) - uTime * 0.06) * 0.5 + 0.5;
    sweep = pow(sweep, 3.5);
    float aurora = sweep
      * smoothstep(0.1, 0.7, vUv.y)
      * (1.0 - smoothstep(0.35, 1.0, vUv.y))
      * 0.09;
    float vig = smoothstep(0.0, 0.32, vUv.y)
      * (1.0 - smoothstep(0.68, 1.0, vUv.y));
    float vigX = smoothstep(0.0, 0.12, vUv.x)
      * (1.0 - smoothstep(0.88, 1.0, vUv.x));
    vec3 col = base;
    col += vec3(0.10, 0.065, 0.038) * warm;
    col += vec3(0.85, 0.68, 0.42) * champagneGlow * 0.09;
    col += vec3(0.95, 0.80, 0.55) * aurora;
    col *= 0.55 + 0.45 * vig * vigX;
    gl_FragColor = vec4(col, 1.0);
  }
`;

function Backdrop({ animate }: { animate: boolean }) {
  const mat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: backdropVert,
    fragmentShader: backdropFrag,
    depthWrite: false,
    depthTest: false,
    uniforms: {
      uTime: { value: 0 },
      uRes: { value: new THREE.Vector2(1, 1) },
    },
  }), []);
  useEffect(() => () => mat.dispose(), [mat]);
  useFrame((state, dt) => {
    if (animate) mat.uniforms.uTime.value += Math.min(dt, 0.05);
    mat.uniforms.uRes.value.set(state.size.width, state.size.height);
  });
  return (
    <mesh frustumCulled={false} renderOrder={-100}>
      <planeGeometry args={[2, 2]} />
      <primitive object={mat} attach="material" />
    </mesh>
  );
}

function makeBokehTexture() {
  const S = 128;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d")!;
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, "rgba(255,255,255,0.85)");
  gr.addColorStop(0.22, "rgba(255,255,255,0.42)");
  gr.addColorStop(0.5, "rgba(255,255,255,0.12)");
  gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr;
  g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function BokehOrbs({ animate }: { animate: boolean }) {
  const groupRef = useRef<THREE.Group>(null);
  const tex = useMemo(() => makeBokehTexture(), []);
  useEffect(() => () => tex.dispose(), [tex]);
  const orbs = useMemo(() => {
    const palette = [LUXE.champagne, LUXE.gold, LUXE.amber, LUXE.pearl];
    return Array.from({ length: 16 }, (_, i) => ({
      mat: new THREE.SpriteMaterial({
        map: tex,
        color: palette[i % palette.length],
        transparent: true,
        opacity: 0.35,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
      pos: [
        (Math.random() - 0.5) * 13,
        (Math.random() - 0.25) * 7,
        -3 - Math.random() * 13,
      ] as [number, number, number],
      size: 0.35 + Math.random() * 1.3,
      speed: 0.04 + Math.random() * 0.07,
      phase: Math.random() * Math.PI * 2,
      baseOpacity: 0.18 + Math.random() * 0.28,
    }));
  }, [tex]);
  useEffect(() => () => orbs.forEach((o) => o.mat.dispose()), [orbs]);
  useFrame((state) => {
    if (!animate) return;
    const t = state.clock.elapsedTime;
    const g = groupRef.current;
    if (!g) return;
    orbs.forEach((o, i) => {
      const child = g.children[i] as THREE.Sprite | undefined;
      if (!child) return;
      child.position.x = o.pos[0] + Math.sin(t * o.speed + o.phase) * 0.4;
      child.position.y = o.pos[1] + Math.cos(t * o.speed * 0.75 + o.phase) * 0.55;
      o.mat.opacity = o.baseOpacity * (0.7 + 0.3 * Math.sin(t * o.speed * 1.5 + o.phase));
    });
  });
  return (
    <group ref={groupRef}>
      {orbs.map((o, i) => (
        <sprite key={i} position={o.pos} scale={[o.size, o.size, 1]} material={o.mat} />
      ))}
    </group>
  );
}

const dustVert = /* glsl */ `
  attribute float aSeed;
  uniform float uTime;
  uniform float uPx;
  varying float vAlpha;
  void main() {
    vec3 p = position;
    p.y = mod(p.y + uTime * (0.04 + aSeed * 0.08) + 2.0, 12.0) - 2.0;
    p.x += sin(uTime * 0.12 + aSeed * 25.0) * 0.20;
    p.z += cos(uTime * 0.10 + aSeed * 18.0) * 0.15;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = (1.0 + aSeed * 2.6) * uPx * (4.0 / -mv.z);
    float edgeY = smoothstep(-2.0, 0.5, p.y)
      * (1.0 - smoothstep(6.0, 10.0, p.y));
    vAlpha = (0.22 + 0.5 * sin(uTime * 0.6 + aSeed * 40.0)) * edgeY;
  }
`;

const dustFrag = /* glsl */ `
  precision highp float;
  uniform vec3 uColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = 1.0 - smoothstep(0.0, 0.5, d);
    gl_FragColor = vec4(uColor, a * a * vAlpha);
  }
`;

function GoldDust({ count, animate }: { count: number; animate: boolean }) {
  const { geometry, material } = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 22;
      pos[i * 3 + 1] = Math.random() * 12 - 2;
      pos[i * 3 + 2] = -2 - Math.random() * 18;
      seed[i] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    const m = new THREE.ShaderMaterial({
      vertexShader: dustVert,
      fragmentShader: dustFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uPx: { value: Math.min(typeof window !== "undefined" ? window.devicePixelRatio : 1, 1.5) },
        uColor: { value: new THREE.Color(LUXE.champagne) },
      },
    });
    return { geometry: g, material: m };
  }, [count]);
  useEffect(() => () => {
    geometry.dispose();
    material.dispose();
  }, [geometry, material]);
  useFrame((_, dt) => {
    if (animate) material.uniforms.uTime.value += Math.min(dt, 0.05);
  });
  return <points geometry={geometry} material={material} frustumCulled={false} />;
}

function CameraRig({ animate }: { animate: boolean }) {
  const camera = useThree((s) => s.camera);
  const pointer = useRef({ x: 0, y: 0, cx: 0, cy: 0 });
  useEffect(() => {
    camera.lookAt(0, 0, 0);
  }, [camera]);
  useEffect(() => {
    if (!animate) return;
    const move = (e: PointerEvent) => {
      pointer.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      pointer.current.y = (e.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener("pointermove", move, { passive: true });
    return () => window.removeEventListener("pointermove", move);
  }, [animate]);
  useFrame((_, dt) => {
    const p = pointer.current;
    const k = 1 - Math.exp(-2.2 * Math.min(dt, 0.05));
    p.cx += (p.x - p.cx) * k;
    p.cy += (p.y - p.cy) * k;
    camera.position.set(p.cx * 0.35, -p.cy * 0.18, 5);
    camera.lookAt(0, 0, 0);
  });
  return null;
}

interface Props {
  className?: string;
}

const NeonBackground = ({ className }: Props) => {
  const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const small = typeof window !== "undefined" && window.innerWidth < 640;
  const animate = !reduced;
  return (
    <div className={className} aria-hidden="true" style={{ pointerEvents: "none", background: "#050403" }}>
      <Canvas
        dpr={[1, small ? 1.2 : 1.5]}
        frameloop={animate ? "always" : "demand"}
        gl={{
          alpha: true,
          antialias: !small,
          powerPreference: "high-performance",
          stencil: false,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.05,
        }}
        camera={{ fov: FOV, near: 0.1, far: 120, position: [0, 0, 5] }}
        style={{ width: "100%", height: "100%", background: "transparent" }}
      >
        <Backdrop animate={animate} />
        <CameraRig animate={animate} />
        <BokehOrbs animate={animate} />
        <GoldDust count={small ? 80 : 160} animate={animate} />
      </Canvas>
    </div>
  );
};

export default memo(NeonBackground);
