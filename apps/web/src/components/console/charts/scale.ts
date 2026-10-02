// Pure chart math shared by the server-safe chart wrappers and the client plots.
// No React, no DOM: safe to import anywhere.

export type Tick = { value: number; label: string };

/** A "nice" axis maximum and step for 4-5 ticks. */
export function niceScale(max: number, ticks = 4): { max: number; step: number } {
  if (!(max > 0)) return { max: 1, step: 0.25 };
  const raw = max / ticks;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  return { max: Math.ceil(max / step - 1e-9) * step, step };
}

/** Tick values 0..max (inclusive) every `step`, labelled with `fmt`. */
export function makeTicks(max: number, step: number, fmt: (v: number) => string, offset = 0): Tick[] {
  const out: Tick[] = [];
  for (let i = 0; i * step <= max + step / 2; i++) {
    const v = i * step;
    out.push({ value: v, label: fmt(v + offset) });
  }
  return out;
}

type Pt = readonly [number, number];

const sign = (x: number) => (x < 0 ? -1 : 1);

/**
 * Tangents for monotone cubic interpolation (Fritsch-Carlson, as in d3's
 * curveMonotoneX). The curve passes through every point and never overshoots,
 * so a smoothed line never invents a peak or dip the data does not have.
 */
function tangents(p: Pt[]): number[] {
  const n = p.length;
  const m = new Array<number>(n).fill(0);
  if (n < 2) return m;
  const h = (i: number) => p[i + 1][0] - p[i][0];
  const s = (i: number) => {
    const dx = h(i);
    return dx ? (p[i + 1][1] - p[i][1]) / dx : 0;
  };
  for (let i = 1; i < n - 1; i++) {
    const h0 = h(i - 1);
    const h1 = h(i);
    const s0 = s(i - 1);
    const s1 = s(i);
    const q = (s0 * h1 + s1 * h0) / (h0 + h1 || 1);
    m[i] = (sign(s0) + sign(s1)) * Math.min(Math.abs(s0), Math.abs(s1), 0.5 * Math.abs(q)) || 0;
  }
  if (n === 2) {
    m[0] = m[1] = s(0);
  } else {
    // One-sided end tangents, clamped so the end segments stay monotone too.
    m[0] = (3 * s(0) - m[1]) / 2;
    m[n - 1] = (3 * s(n - 2) - m[n - 2]) / 2;
    if (sign(m[0]) !== sign(s(0)) || s(0) === 0) m[0] = 0;
    if (sign(m[n - 1]) !== sign(s(n - 2)) || s(n - 2) === 0) m[n - 1] = 0;
    if (Math.abs(m[0]) > 3 * Math.abs(s(0))) m[0] = 3 * s(0);
    if (Math.abs(m[n - 1]) > 3 * Math.abs(s(n - 2))) m[n - 1] = 3 * s(n - 2);
  }
  return m;
}

const f = (x: number) => (Math.round(x * 100) / 100).toString();

/** SVG path data for a smooth monotone curve through `p` (x ascending). */
export function smoothPath(p: Pt[], move = true): string {
  if (p.length === 0) return "";
  if (p.length === 1) return `${move ? "M" : "L"}${f(p[0][0])},${f(p[0][1])}`;
  const m = tangents(p);
  let d = `${move ? "M" : "L"}${f(p[0][0])},${f(p[0][1])}`;
  for (let i = 0; i < p.length - 1; i++) {
    const [x0, y0] = p[i];
    const [x1, y1] = p[i + 1];
    const dx = (x1 - x0) / 3;
    d += `C${f(x0 + dx)},${f(y0 + m[i] * dx)} ${f(x1 - dx)},${f(y1 - m[i + 1] * dx)} ${f(x1)},${f(y1)}`;
  }
  return d;
}

/** Split a series with gaps (null / NaN) into runs of consecutive points. */
export function runs(values: (number | null)[], X: (i: number) => number, Y: (v: number) => number): Pt[][] {
  const out: Pt[][] = [];
  let cur: Pt[] = [];
  values.forEach((v, i) => {
    if (v === null || !Number.isFinite(v)) {
      if (cur.length) out.push(cur);
      cur = [];
      return;
    }
    cur.push([X(i), Y(v)]);
  });
  if (cur.length) out.push(cur);
  return out;
}

/** Smooth line path for a series with gaps. */
export function linePath(values: (number | null)[], X: (i: number) => number, Y: (v: number) => number): string {
  return runs(values, X, Y)
    .filter((r) => r.length > 1)
    .map((r) => smoothPath(r))
    .join("");
}

/** Closed smooth area path down to `base` for a series with gaps. */
export function areaPath(values: (number | null)[], X: (i: number) => number, Y: (v: number) => number, base: number): string {
  return runs(values, X, Y)
    .filter((r) => r.length > 1)
    .map((r) => `${smoothPath(r)}L${f(r[r.length - 1][0])},${f(base)}L${f(r[0][0])},${f(base)}Z`)
    .join("");
}

/** Small stable hash for deterministic SVG ids (gradients) without hooks. */
export function hashId(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}
