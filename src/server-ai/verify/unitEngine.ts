/**
 * Conservative SI dimension checker for explicit units in exam calculations.
 * It never guesses missing units: unknown or ambiguous expressions are skipped.
 */
export type Dimension = readonly [number, number, number, number, number, number, number];
// length, mass, time, current, temperature, amount, luminous intensity
const BASE: Record<string, Dimension> = {
  m: [1,0,0,0,0,0,0], kg: [0,1,0,0,0,0,0], g: [0,1,0,0,0,0,0],
  s: [0,0,1,0,0,0,0], A: [0,0,0,1,0,0,0], K: [0,0,0,0,1,0,0],
  mol: [0,0,0,0,0,1,0], cd: [0,0,0,0,0,0,1],
  L: [3,0,0,0,0,0,0], l: [3,0,0,0,0,0,0],
  Hz: [0,0,-1,0,0,0,0], N: [1,1,-2,0,0,0,0],
  Pa: [-1,1,-2,0,0,0,0], J: [2,1,-2,0,0,0,0],
  W: [2,1,-3,0,0,0,0], C: [0,0,1,1,0,0,0],
  V: [2,1,-3,-1,0,0,0], ohm: [2,1,-3,-2,0,0,0],
};
const PREFIX: Record<string, number> = {
  km: 1e3, cm: 1e-2, mm: 1e-3, um: 1e-6, nm: 1e-9,
  ms: 1e-3, us: 1e-6, min: 60, h: 3600,
  mg: 1e-6, g: 1e-3, mL: 1e-6, cL: 1e-5,
};
const same = (a: Dimension, b: Dimension) => a.every((v, i) => v === b[i]);
const add = (a: number[], b: Dimension, factor: number) => a.map((v, i) => v + b[i] * factor);

/** Parses a conservative unit grammar: m, cm, m.s^-1, kg/m^3, N.m, etc. */
export function parseUnitDimension(raw: string): Dimension | null {
  const source = raw.trim().replace(/\\(?:mathrm|text)\s*\{([^}]*)\}/g, "$1")
    .replace(/\\(?:cdot|times)/g, ".").replace(/[·⋅×]/g, ".")
    .replace(/\s+/g, "").replace(/[{}]/g, "");
  if (!source || source.length > 48 || !/^[A-Za-zµμ0-9./^+-]+$/.test(source)) return null;
  const parts = source.split(/([./])/);
  const out = [0,0,0,0,0,0,0];
  let sign = 1, expectUnit = true;
  for (const part of parts) {
    if (!part) continue;
    if (part === "." || part === "/") {
      if (expectUnit) return null;
      sign = part === "/" ? -1 : 1;
      expectUnit = true;
      continue;
    }
    if (!expectUnit) return null;
    const match = /^([A-Za-zµμ]+)(?:\^?\(?([+-]?\d+)\)?)?$/.exec(part);
    if (!match) return null;
    const symbol = match[1].replace(/[µμ]/g, "u");
    let dimension = BASE[symbol];
    if (!dimension) {
      const prefixed = PREFIX[symbol];
      if (prefixed) {
        const base = symbol === "km" || symbol === "cm" || symbol === "mm" || symbol === "um" || symbol === "nm" ? "m"
          : symbol === "ms" || symbol === "us" || symbol === "min" || symbol === "h" ? "s"
          : symbol === "mg" || symbol === "g" ? "kg"
          : symbol === "mL" || symbol === "cL" ? "L" : "";
        dimension = BASE[base];
      }
    }
    if (!dimension) return null;
    const power = match[2] === undefined ? 1 : Number(match[2]);
    if (!Number.isInteger(power) || Math.abs(power) > 6) return null;
    const next = add(out, dimension, sign * power);
    for (let i = 0; i < out.length; i++) out[i] = next[i];
    expectUnit = false;
  }
  return expectUnit ? null : out as unknown as Dimension;
}

export function unitsHaveSameDimension(left: string, right: string): boolean | null {
  const a = parseUnitDimension(left), b = parseUnitDimension(right);
  return a && b ? same(a, b) : null;
}

export interface UnitMismatch { left: string; right: string; line: string }
/** Only flags an equality containing exactly two explicitly marked units on one line. */
export function findUnitMismatches(answer: string): UnitMismatch[] {
  const found: UnitMismatch[] = [];
  for (const line of answer.split(/\r?\n/)) {
    if (!line.includes("=")) continue;
    const matches = [...line.matchAll(/\\(?:mathrm|text)\s*\{([^}]{1,24})\}/g)];
    if (matches.length !== 2) continue;
    const [left, right] = [matches[0][1], matches[1][1]];
    if (unitsHaveSameDimension(left, right) === false) found.push({ left, right, line: line.trim().slice(0, 180) });
  }
  return found;
}
