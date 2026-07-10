// ─────────────────────────────────────────────────────────────────────────────
// MOTION TOOLKIT — physics-based easings + helpers, distilled from the Huashu
// animation-best-practices reference. The single rule: elements behave like
// physical objects (weight, inertia, settle), never like "data" that snaps.
//   • expoOut  — fast launch, soft landing (default for entrances)
//   • overshoot — elastic settle for buttons / hero pops
//   • Slow-Fast-Boom-Stop pacing is expressed by how we distribute these.
// ─────────────────────────────────────────────────────────────────────────────
import {interpolate, Easing} from 'remotion';
import type React from 'react';

// cubic-bezier(0.16, 1, 0.3, 1) — the "expoOut" curve. Most entrances use this.
export const EXPO_OUT = Easing.bezier(0.16, 1, 0.3, 1);
// cubic-bezier(0.34, 1.56, 0.64, 1) — overshoot/elastic settle for emphasis.
export const OVERSHOOT = Easing.bezier(0.34, 1.56, 0.64, 1);
// Smooth symmetric ease for continuous ambient motion (pans, drifts).
export const SMOOTH = Easing.bezier(0.45, 0, 0.55, 1);

type EaseFn = (t: number) => number;

// Entrance: opacity + translateY rise with expoOut. `delay` staggers elements.
export function rise(frame: number, delay = 0, distance = 28, dur = 18) {
  const f = Math.max(0, frame - delay);
  const t = interpolate(f, [0, dur], [0, 1], {extrapolateRight: 'clamp', easing: EXPO_OUT});
  return {opacity: interpolate(f, [0, Math.min(12, dur)], [0, 1], {extrapolateRight: 'clamp'}), y: (1 - t) * distance};
}

// Blur-in reveal: text resolves from blurred → sharp. The Huashu signature for
// hero/word reveals. Returns px blur + opacity.
export function blurIn(frame: number, delay = 0, dur = 16, maxBlur = 14) {
  const f = Math.max(0, frame - delay);
  return {
    blur: interpolate(f, [0, dur], [maxBlur, 0], {extrapolateRight: 'clamp', easing: EXPO_OUT}),
    opacity: interpolate(f, [0, dur * 0.8], [0, 1], {extrapolateRight: 'clamp'}),
  };
}

// ── Blur-reveal (React Bits "BlurText" port) ────────────────────────────────
// A frame-driven re-implementation of the React Bits <BlurText/> animation. The
// original uses motion/react + IntersectionObserver (viewport-triggered), which
// can't work in Remotion's headless frame-by-frame render. This reproduces the
// exact two-step keyframe curve deterministically from the timeline frame:
//   from:  blur(10px) opacity 0   y ±distance
//   mid:   blur(5px)  opacity 0.5 y ∓(distance*0.1)
//   to:    blur(0px)  opacity 1   y 0
// `direction` 'bottom' rises from below (y:+→0); 'top' drops from above (y:-→0).
// `stepDur` is the per-step duration in frames (React Bits default 0.35s ≈ 10.5f).
export function blurReveal(
  frame: number,
  delay = 0,
  {direction = 'bottom' as 'top' | 'bottom', distance = 50, stepDur = 11, maxBlur = 10} = {},
) {
  const f = Math.max(0, frame - delay);
  const total = stepDur * 2; // two steps (from→mid→to)
  const sign = direction === 'bottom' ? 1 : -1;
  // Piecewise to match the original keyframes precisely.
  const blur = f <= stepDur
    ? interpolate(f, [0, stepDur], [maxBlur, maxBlur * 0.5], {extrapolateRight: 'clamp', easing: SMOOTH})
    : interpolate(f, [stepDur, total], [maxBlur * 0.5, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EXPO_OUT});
  const opacity = f <= stepDur
    ? interpolate(f, [0, stepDur], [0, 0.5], {extrapolateRight: 'clamp'})
    : interpolate(f, [stepDur, total], [0.5, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const y = f <= stepDur
    ? interpolate(f, [0, stepDur], [sign * distance, -sign * distance * 0.1], {extrapolateRight: 'clamp', easing: SMOOTH})
    : interpolate(f, [stepDur, total], [-sign * distance * 0.1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EXPO_OUT});
  return {blur, opacity, y};
}

// Generic eased interpolate.
export function ease(frame: number, input: [number, number], output: [number, number], easing: EaseFn = EXPO_OUT, clamp = true) {
  return interpolate(frame, input, output, {
    easing,
    extrapolateLeft: clamp ? 'clamp' : 'extend',
    extrapolateRight: clamp ? 'clamp' : 'extend',
  });
}

// Continuous Ken Burns drift for background media — slow scale + counter-pan so
// the frame always feels alive without being distracting.
export function kenBurns(frame: number, {scaleFrom = 1.08, scaleAmp = 0.06, panAmp = 22, speed = 0.18} = {}) {
  const s = scaleFrom + Math.sin((frame * speed) / 10) * scaleAmp;
  const x = Math.sin((frame * speed) / 13) * panAmp;
  const y = Math.cos((frame * speed) / 17) * panAmp * 0.6;
  return {scale: s, x, y};
}

// Focus-pull: a media element "racks into focus" — blur+desaturate → sharp — over
// the first `dur` frames. The cinematic way to introduce footage.
export function focusPull(frame: number, delay = 0, dur = 20) {
  const f = Math.max(0, frame - delay);
  return {
    blur: ease(f, [0, dur], [10, 0]),
    scale: ease(f, [0, dur], [1.12, 1]),
    opacity: ease(f, [0, Math.min(10, dur)], [0, 1]),
  };
}

// Exit fade for the tail of a scene (kept short; transitions handle most of it).
export function tailOut(frame: number, total: number, dur = 8) {
  return interpolate(frame, [total - dur, total], [1, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
}

// ── IN + OUT lifecycle ──────────────────────────────────────────────────────
// Core requirement: EVERY element animates in AND out. This returns a combined
// transform for an element living inside a scene of `total` frames:
//   • IN  (inDelay … inDelay+inDur): rise + blur-in with expoOut
//   • HOLD: fully present
//   • OUT (total-outDur … total): fall + blur-out (mirror of the entrance)
// `dir` controls travel direction so different elements exit differently and the
// scene feels choreographed rather than uniform.
export type InOut = {opacity: number; x: number; y: number; blur: number; scale: number};

export function inOut(
  frame: number,
  total: number,
  {
    inDelay = 0,
    inDur = 16,
    outDur = 14,
    distance = 26,
    dir = 'up' as 'up' | 'down' | 'left' | 'right',
    blurAmt = 10,
    scaleIn = 0.985,
  } = {},
): InOut {
  const fIn = Math.max(0, frame - inDelay);
  const inProg = interpolate(fIn, [0, inDur], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EXPO_OUT});
  const inOpacity = interpolate(fIn, [0, Math.min(12, inDur)], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});

  // OUT starts near the tail. Slight ease-in so the exit accelerates away.
  const outStart = Math.max(inDelay + inDur, total - outDur);
  const outProg = interpolate(frame, [outStart, total], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: SMOOTH});

  const sign = dir === 'down' || dir === 'right' ? 1 : -1;
  const axis = dir === 'left' || dir === 'right' ? 'x' : 'y';

  // Enter from +distance (in the natural direction), rest at 0, then leave by
  // sliding `distance*0.8` further in the exit direction.
  const enterOffset = (1 - inProg) * distance * (dir === 'down' || dir === 'right' ? -1 : 1);
  const travel = enterOffset + outProg * distance * 0.8 * sign;

  const opacity = Math.min(inOpacity, 1 - outProg);
  const blur = (1 - inProg) * blurAmt + outProg * blurAmt * 0.7;
  const scale = scaleIn + (1 - scaleIn) * inProg - outProg * 0.04;

  return {
    opacity: Math.max(0, opacity),
    x: axis === 'x' ? travel : 0,
    y: axis === 'y' ? travel : 0,
    blur,
    scale,
  };
}

// Convenience: turn an InOut into a ready-to-spread CSS style object.
export function inOutStyle(io: InOut, extra: React.CSSProperties = {}): React.CSSProperties {
  return {
    opacity: io.opacity,
    transform: `translate3d(${io.x}px, ${io.y}px, 0) scale(${io.scale})`,
    filter: io.blur > 0.15 ? `blur(${io.blur}px)` : undefined,
    ...extra,
  };
}

// Media-specific in/out: focus-pull IN (blur+scale down to sharp), then a gentle
// scale-up + blur OUT so footage "racks out" instead of cutting.
export function mediaInOut(frame: number, total: number, {inDur = 20, outDur = 14} = {}) {
  const inB = ease(frame, [0, inDur], [12, 0]);
  const inS = ease(frame, [0, inDur], [1.14, 1]);
  const inO = ease(frame, [0, Math.min(10, inDur)], [0, 1]);
  const outStart = Math.max(inDur, total - outDur);
  const outO = ease(frame, [outStart, total], [1, 0], SMOOTH);
  const outS = ease(frame, [outStart, total], [1, 1.06], SMOOTH);
  const outB = ease(frame, [outStart, total], [0, 8], SMOOTH);
  return {opacity: Math.min(inO, outO), scale: inS * outS, blur: Math.max(inB, outB)};
}

// Split a string into words, preserving a stable index for staggering.
export function words(text: string): string[] {
  return String(text || '').trim().split(/\s+/).filter(Boolean);
}

// Hash a string → 0..1, for deterministic per-scene variation (drift direction etc).
export function hash01(seed: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h >>> 0) / 4294967295;
}

// Readable contrast color (#fff or near-black ink) for a given hex background.
export function readableInk(hex: string, light = '#F7F4EF', dark = '#1A1714'): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return dark;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  // Relative luminance.
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return lum > 0.55 ? dark : light;
}

// Lighten/darken a hex by amount (-1..1) for subtle tonal layering.
export function shade(hex: string, amount: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const t = amount < 0 ? 0 : 255;
  const p = Math.abs(amount);
  r = Math.round((t - r) * p + r);
  g = Math.round((t - g) * p + g);
  b = Math.round((t - b) * p + b);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

// Hex → rgba string with alpha.
export function rgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return `rgba(0,0,0,${alpha})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
