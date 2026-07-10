// remotion/ui-elements.tsx
// Reusable UntitledUI-vocabulary primitives for footage data cards. Presentational,
// frame-driven, no deps beyond remotion. (We re-create the UntitledUI LOOK at video
// scale rather than importing app-scale Tailwind components.)
import React from 'react';
import {interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';

const ease = (t: number) => interpolate(t, [0, 1], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});

// Pill/badge chip.
export const Badge: React.FC<{label: string; tone?: 'accent' | 'positive' | 'negative' | 'neutral'; accent?: string}> = ({label, tone = 'neutral', accent = '#4FB0FF'}) => {
  const bg = tone === 'accent' ? `${accent}26` : tone === 'positive' ? 'rgba(96,196,128,0.18)' : tone === 'negative' ? 'rgba(196,82,82,0.18)' : 'rgba(255,255,255,0.1)';
  const fg = tone === 'accent' ? accent : tone === 'positive' ? '#7fd49a' : tone === 'negative' ? '#e08a87' : 'rgba(255,255,255,0.85)';
  return (
    <span style={{display: 'inline-flex', alignItems: 'center', padding: '6px 16px', borderRadius: 999, background: bg, color: fg, fontSize: 26, fontWeight: 700, letterSpacing: '0.01em', border: `1px solid ${fg}33`}}>{label}</span>
  );
};

// Rounded progress/value bar that animates 0 → pct over ~0.6s after delayFrames.
export const ProgressBar: React.FC<{pct: number; color: string; delayFrames?: number; height?: number}> = ({pct, color, delayFrames = 0, height = 26}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const p = ease(interpolate(frame - delayFrames, [0, fps * 0.6], [0, 1])) * Math.max(0, Math.min(100, pct));
  return (
    <div style={{width: '100%', height, borderRadius: 999, background: 'rgba(255,255,255,0.1)', overflow: 'hidden'}}>
      <div style={{width: `${p}%`, height: '100%', borderRadius: 999, background: color}} />
    </div>
  );
};

// UntitledUI-style checkbox that ticks in.
export const AnimatedCheck: React.FC<{delayFrames?: number; color?: string; size?: number}> = ({delayFrames = 0, color = '#7fd49a', size = 40}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const t = spring({frame: frame - delayFrames, fps, config: {damping: 14, stiffness: 160}});
  return (
    <div style={{width: size, height: size, borderRadius: 10, background: `${color}22`, border: `2px solid ${color}`, display: 'flex', alignItems: 'center', justifyContent: 'center', transform: `scale(${interpolate(t, [0, 1], [0.6, 1])})`, opacity: interpolate(t, [0, 1], [0, 1])}}>
      <svg width={size * 0.6} height={size * 0.6} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 6 9 17l-5-5" strokeDasharray={24} strokeDashoffset={interpolate(t, [0, 1], [24, 0])} />
      </svg>
    </div>
  );
};

// Number that counts up from 0. Parses the numeric part of `value`, preserving a
// non-numeric suffix/prefix (e.g. "90%", "3x", "+412", "1.2K").
export const CountUp: React.FC<{value: string; fromZeroFrames?: number; style?: React.CSSProperties}> = ({value, fromZeroFrames = 18, style}) => {
  const frame = useCurrentFrame();
  const m = String(value).match(/^(\D*)(-?[\d.,]+)(.*)$/);
  if (!m) return <span style={style}>{value}</span>;
  const [, pre, numRaw, suf] = m;
  const target = parseFloat(numRaw.replace(/,/g, ''));
  const decimals = (numRaw.split('.')[1] || '').length;
  const t = ease(interpolate(frame, [0, fromZeroFrames], [0, 1]));
  const cur = (target * t).toFixed(decimals);
  return <span style={style}>{pre}{cur}{suf}</span>;
};

// On/off switch.
export const Toggle: React.FC<{on: boolean; accent?: string}> = ({on, accent = '#7fd49a'}) => (
  <div style={{width: 64, height: 36, borderRadius: 999, background: on ? accent : 'rgba(255,255,255,0.2)', position: 'relative', transition: 'none'}}>
    <div style={{position: 'absolute', top: 4, left: on ? 32 : 4, width: 28, height: 28, borderRadius: '50%', background: '#fff'}} />
  </div>
);
