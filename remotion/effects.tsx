// remotion/effects.tsx
// Shared visual-effects vocabulary for footage mode (per spec):
//  • per-corner rounded media frames  • duo-color long shadow
//  • feathered bottom fade            • viewfinder frame
import React from 'react';
import {interpolate, useCurrentFrame, useVideoConfig} from 'remotion';

export const RoundedFrame: React.FC<{
  radii?: [number, number, number, number]; // TL TR BR BL — asymmetric by default
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({radii = [48, 8, 48, 8], children, style}) => (
  <div style={{
    borderRadius: `${radii[0]}px ${radii[1]}px ${radii[2]}px ${radii[3]}px`,
    overflow: 'hidden',
    ...style,
  }}>
    {children}
  </div>
);

// Long shadow approximated as N stacked drop-shadows fading between two colors.
export function longShadowFilter(colorA: string, colorB: string, length = 60, steps = 6): string {
  const shadows: string[] = [];
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const d = Math.round((length / steps) * i);
    const color = t < 0.5 ? colorA : colorB;
    const alpha = (1 - t) * 0.35;
    shadows.push(`drop-shadow(${d}px ${d}px 0 ${withAlpha(color, alpha)})`);
  }
  return shadows.join(' ');
}

const withAlpha = (hex: string, a: number): string => {
  const h = hex.replace('#', '');
  // Guard non-hex input (e.g. a stray colorOverride) — fall back to opaque-ish
  // black rather than emitting rgba(NaN, NaN, NaN, …) which kills the filter.
  if (!/^([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(h)) return `rgba(0, 0, 0, ${a.toFixed(3)})`;
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a.toFixed(3)})`;
};

// Soft black gradient behind the caption zone — legibility without a solid bar.
export const BottomFade: React.FC<{height?: number; opacity?: number}> = ({height = 620, opacity = 0.55}) => (
  <div style={{
    position: 'absolute', left: 0, right: 0, bottom: 0, height,
    background: `linear-gradient(to top, rgba(0,0,0,${opacity}) 0%, rgba(0,0,0,${opacity * 0.5}) 45%, rgba(0,0,0,0) 100%)`,
    pointerEvents: 'none',
  }} />
);

// Curved dark vignette anchored at the TOP and BOTTOM edges. Two wide ellipses
// centered just outside the frame darken the top/bottom in a curved, feathered
// band while leaving the center bright — adds cinematic depth and pulls the eye
// to the middle. `strength` is the peak edge darkness (0-1); `spread` is how far
// each band reaches toward center (as a % of height).
export const CinemaVignette: React.FC<{strength?: number; spread?: number}> = ({strength = 0.7, spread = 58}) => (
  <div style={{
    position: 'absolute', inset: 0, pointerEvents: 'none',
    background: [
      `radial-gradient(150% ${spread}% at 50% -8%, rgba(0,0,0,${strength}) 0%, rgba(0,0,0,${strength * 0.55}) 32%, rgba(0,0,0,0) 70%)`,
      `radial-gradient(150% ${spread}% at 50% 108%, rgba(0,0,0,${strength}) 0%, rgba(0,0,0,${strength * 0.55}) 32%, rgba(0,0,0,0) 70%)`,
    ].join(', '),
  }} />
);

// Dark frosted glass card shell. Translucent tint by default (lean — used over
// already-blurred beds / dark areas). Pass blur>0 for a real backdrop-filter
// ONLY when placed over SHARP footage (never stack with a blurred bed).
export const GlassCard: React.FC<{
  children: React.ReactNode;
  width?: number;
  blur?: number;
  style?: React.CSSProperties;
}> = ({children, width = 880, blur = 0, style}) => (
  <div style={{
    width,
    padding: '52px 56px',
    borderRadius: 40,
    background: 'rgba(18,18,24,0.52)',
    ...(blur > 0 ? {backdropFilter: `blur(${blur}px)`, WebkitBackdropFilter: `blur(${blur}px)`} : {}),
    border: '1.5px solid rgba(255,255,255,0.18)',
    boxShadow: '0 24px 70px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.22)',
    color: '#FFFFFF',
    ...style,
  }}>
    {children}
  </div>
);

// Per-beat entrance/exit envelope for cards & B-roll (NOT speaker beats — those
// stay hard cuts). Returns values to apply to the beat's wrapper. Cheap:
// opacity + transform + a short blur-in only (never a full-frame per-frame blur).
export function useBeatTransition(opts: {inSec?: number; outSec?: number} = {}): {opacity: number; blur: number; y: number; scale: number} {
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();
  const inF = Math.max(1, Math.round((opts.inSec ?? 0.25) * fps));
  const outF = Math.max(1, Math.round((opts.outSec ?? 0.18) * fps));
  const enter = interpolate(frame, [0, inF], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const exit = interpolate(frame, [durationInFrames - outF, durationInFrames], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  return {
    opacity: Math.min(enter, exit),
    blur: interpolate(enter, [0, 1], [10, 0]),
    y: interpolate(enter, [0, 1], [14, 0]),
    scale: interpolate(enter, [0, 1], [0.985, 1]),
  };
}

// Thin white inset border with crop-mark ticks at edge midpoints (the
// camera-viewfinder look from the reference frame).
export const ViewfinderFrame: React.FC<{inset?: number; color?: string}> = ({inset = 52, color = 'rgba(255,255,255,0.85)'}) => {
  const tick = 22;
  const mid = (axis: 'h' | 'v', pos: 'start' | 'end'): React.CSSProperties => ({
    position: 'absolute',
    background: color,
    ...(axis === 'h'
      ? {width: 1.5, height: tick, left: '50%', marginLeft: -0.75, [pos === 'start' ? 'top' : 'bottom']: inset - tick / 2}
      : {height: 1.5, width: tick, top: '50%', marginTop: -0.75, [pos === 'start' ? 'left' : 'right']: inset - tick / 2}),
  } as React.CSSProperties);
  return (
    <div style={{position: 'absolute', inset: 0, pointerEvents: 'none'}}>
      <div style={{position: 'absolute', inset, border: `1.5px solid ${color}`}} />
      <div style={mid('h', 'start')} />
      <div style={mid('h', 'end')} />
      <div style={mid('v', 'start')} />
      <div style={mid('v', 'end')} />
    </div>
  );
};
