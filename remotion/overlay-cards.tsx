// remotion/overlay-cards.tsx
// The 8 footage-mode overlay archetypes (spec: "8 new archetypes").
import React from 'react';
import {Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {RoundedFrame, GlassCard} from './effects';
import {CheckCircle, XClose, Clock, Lightbulb01, BarChart01} from '@untitledui/icons';
import {DISPLAY, BODY} from './footage-fonts';

type CardTheme = {accent: string; ink: string; paper: string};

// Brand type system for cards: Advercase (display) for headings/labels, Chirp
// for body. Card roots default to BODY; headings override to DISPLAY.
const HEAD = `${DISPLAY}, sans-serif`;
const TEXT = `${BODY}, sans-serif`;

// Light-on-dark text inks for glass cards.
const INK = '#FFFFFF';
const INK_SOFT = 'rgba(255,255,255,0.72)';
const INK_FAINT = 'rgba(255,255,255,0.5)';

const useEnter = (delayFrames = 0) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const t = spring({frame: frame - delayFrames, fps, config: {damping: 15, stiffness: 110}});
  return {opacity: interpolate(t, [0, 1], [0, 1]), y: interpolate(t, [0, 1], [40, 0]), t};
};

const CardShell: React.FC<{theme: CardTheme; children: React.ReactNode; width?: number; blur?: number}> = ({theme, children, width = 880, blur = 24}) => {
  const {opacity, y} = useEnter();
  return (
    <div style={{position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
      <div style={{opacity, transform: `translateY(${y}px)`}}>
        <GlassCard width={width} blur={blur} style={{fontFamily: TEXT}}>
          {children}
        </GlassCard>
      </div>
    </div>
  );
};

// ── tweet-card ────────────────────────────────────────────────────────────────
export const TweetCard: React.FC<{data: {handle: string; name?: string; text: string; likes?: string; avatarRef?: string}; theme: CardTheme}> = ({data, theme}) => (
  <CardShell theme={theme}>
    <div style={{display: 'flex', gap: 20, alignItems: 'center', marginBottom: 28}}>
      {data.avatarRef
        ? <Img src={staticFile(data.avatarRef)} style={{width: 92, height: 92, borderRadius: '50%', objectFit: 'cover'}} />
        : <div style={{width: 92, height: 92, borderRadius: '50%', background: 'rgba(255,255,255,0.14)'}} />}
      <div>
        <div style={{fontFamily: HEAD, fontSize: 38, fontWeight: 700, color: INK}}>{(data.name || data.handle).toUpperCase()}</div>
        <div style={{fontSize: 30, color: INK_SOFT}}>@{data.handle.replace(/^@/, '')}</div>
      </div>
    </div>
    <div style={{fontSize: 46, lineHeight: 1.25, color: INK, fontWeight: 600}}>{data.text}</div>
    {data.likes ? <div style={{marginTop: 30, fontSize: 30, color: INK_FAINT}}>♥ {data.likes}</div> : null}
  </CardShell>
);

// ── quote-card ────────────────────────────────────────────────────────────────
export const QuoteCard: React.FC<{data: {text: string; author: string; role?: string}; theme: CardTheme}> = ({data, theme}) => (
  <CardShell theme={theme}>
    <Lightbulb01 size={56} color={theme.accent} />
    <div style={{fontSize: 52, lineHeight: 1.25, color: INK, fontFamily: HEAD, fontWeight: 700, marginTop: 20}}>{data.text.toUpperCase()}</div>
    <div style={{marginTop: 36, fontSize: 34, fontWeight: 700, color: INK, fontFamily: TEXT}}>— {data.author}</div>
    {data.role ? <div style={{fontSize: 28, color: INK_SOFT, marginTop: 4}}>{data.role}</div> : null}
  </CardShell>
);

// ── notification-stack ────────────────────────────────────────────────────────
export const NotificationStack: React.FC<{data: {notifications: Array<{app: string; title: string; body?: string; time?: string}>}; theme: CardTheme}> = ({data, theme}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  return (
    <div style={{position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', gap: 22, alignItems: 'center', justifyContent: 'center', fontFamily: TEXT}}>
      {data.notifications.map((n, i) => {
        const t = spring({frame: frame - i * Math.round(fps * 0.45), fps, config: {damping: 13, stiffness: 140}});
        return (
          <div key={i} style={{
            width: 860, background: 'rgba(250,250,250,0.96)', borderRadius: 36, padding: '26px 32px',
            opacity: interpolate(t, [0, 1], [0, 1]),
            transform: `translateY(${interpolate(t, [0, 1], [-60, 0])}px) scale(${interpolate(t, [0, 1], [0.92, 1])})`,
            boxShadow: '0 14px 40px rgba(0,0,0,0.30)',
          }}>
            <div style={{display: 'flex', justifyContent: 'space-between', marginBottom: 6}}>
              <span style={{fontSize: 26, fontWeight: 700, color: '#5a5a5e', letterSpacing: '0.04em'}}>{n.app.toUpperCase()}</span>
              <span style={{fontSize: 26, color: '#8e8e93'}}>{n.time || 'now'}</span>
            </div>
            <div style={{fontSize: 36, fontWeight: 700, color: '#111'}}>{n.title}</div>
            {n.body ? <div style={{fontSize: 32, color: '#3a3a3c', marginTop: 4}}>{n.body}</div> : null}
          </div>
        );
      })}
    </div>
  );
};

// ── before-after ──────────────────────────────────────────────────────────────
export const BeforeAfter: React.FC<{data: {beforeRef: string; afterRef: string; beforeLabel?: string; afterLabel?: string}; theme: CardTheme}> = ({data, theme}) => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();
  // Wipe sweeps 8%→92% over the middle of the beat.
  const wipe = interpolate(frame, [Math.round(fps * 0.5), Math.max(fps, durationInFrames - fps)], [8, 92], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const label = (text: string, side: 'left' | 'right') => (
    <div style={{position: 'absolute', top: 36, [side]: 36, background: 'rgba(0,0,0,0.65)', color: '#fff', fontSize: 30, fontWeight: 700, padding: '10px 22px', borderRadius: 999}}>{text}</div>
  );
  return (
    <div style={{position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
      <RoundedFrame radii={[40, 10, 40, 10]} style={{position: 'relative', width: 920, height: 760}}>
        <Img src={staticFile(data.beforeRef)} style={{position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover'}} />
        <div style={{position: 'absolute', inset: 0, clipPath: `inset(0 0 0 ${wipe}%)`}}>
          <Img src={staticFile(data.afterRef)} style={{width: '100%', height: '100%', objectFit: 'cover'}} />
        </div>
        <div style={{position: 'absolute', top: 0, bottom: 0, left: `${wipe}%`, width: 4, background: theme.accent}} />
        {label(data.beforeLabel || 'BEFORE', 'left')}
        {label(data.afterLabel || 'AFTER', 'right')}
      </RoundedFrame>
    </div>
  );
};

// ── phone-mockup ──────────────────────────────────────────────────────────────
export const PhoneMockup: React.FC<{data: {mediaRef: string; scroll?: boolean}; theme: CardTheme}> = ({data, theme}) => {
  const frame = useCurrentFrame();
  const {durationInFrames} = useVideoConfig();
  const scrollY = data.scroll ? interpolate(frame, [0, durationInFrames], [0, -260], {extrapolateRight: 'clamp'}) : 0;
  const {opacity, y} = useEnter();
  return (
    <div style={{position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
      <div style={{
        opacity, transform: `translateY(${y}px)`,
        width: 460, height: 940, borderRadius: 64, background: '#0c0c0e', padding: 14,
        boxShadow: '0 30px 80px rgba(0,0,0,0.45)',
      }}>
        <div style={{width: '100%', height: '100%', borderRadius: 52, overflow: 'hidden', position: 'relative'}}>
          <Img src={staticFile(data.mediaRef)} style={{width: '100%', transform: `translateY(${scrollY}px)`}} />
          <div style={{position: 'absolute', top: 14, left: '50%', transform: 'translateX(-50%)', width: 120, height: 34, borderRadius: 18, background: '#0c0c0e'}} />
        </div>
      </div>
    </div>
  );
};

// ── myth-fact ─────────────────────────────────────────────────────────────────
export const MythFact: React.FC<{data: {myth: string; fact: string}; theme: CardTheme}> = ({data, theme}) => {
  const panel = (kind: 'myth' | 'fact', text: string, delay: number) => {
    const {opacity, y} = useEnter(delay);
    const isMyth = kind === 'myth';
    return (
      <div style={{
        opacity, transform: `translateY(${y}px)`,
        background: isMyth ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.1)', borderRadius: 32, padding: '40px 44px', width: 860,
        borderLeft: `10px solid ${isMyth ? '#b3433f' : '#3f7d4e'}`,
      }}>
        <div style={{display: 'flex', alignItems: 'center', gap: 10, fontFamily: HEAD, fontSize: 28, fontWeight: 700, letterSpacing: '0.1em', color: isMyth ? '#e08a87' : '#7fd49a', marginBottom: 10}}>
          {isMyth ? <XClose size={30} color="#e08a87" /> : <CheckCircle size={30} color="#7fd49a" />}
          {isMyth ? 'MYTH' : 'FACT'}
        </div>
        <div style={{fontFamily: HEAD, fontSize: 44, fontWeight: 700, lineHeight: 1.2, color: isMyth ? 'rgba(255,255,255,0.85)' : INK}}>{text.toUpperCase()}</div>
      </div>
    );
  };
  return (
    <div style={{position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', gap: 30, alignItems: 'center', justifyContent: 'center'}}>
      {panel('myth', data.myth, 0)}
      {panel('fact', data.fact, 12)}
    </div>
  );
};

// ── timeline ──────────────────────────────────────────────────────────────────
export const TimelineCard: React.FC<{data: {title?: string; events: Array<{label: string; sublabel?: string}>}; theme: CardTheme}> = ({data, theme}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  return (
    <CardShell theme={theme} width={920}>
      {data.title ? <div style={{display: 'flex', alignItems: 'center', gap: 14, fontFamily: HEAD, fontSize: 30, fontWeight: 700, letterSpacing: '0.1em', color: INK_SOFT, marginBottom: 34}}><Clock size={40} color={theme.accent} />{data.title.toUpperCase()}</div> : null}
      <div style={{display: 'flex', flexDirection: 'column', gap: 0}}>
        {data.events.map((e, i) => {
          const t = spring({frame: frame - i * Math.round(fps * 0.4), fps, config: {damping: 15, stiffness: 120}});
          return (
            <div key={i} style={{display: 'flex', gap: 26, opacity: interpolate(t, [0, 1], [0, 1])}}>
              <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center'}}>
                <div style={{width: 22, height: 22, borderRadius: '50%', background: theme.accent}} />
                {i < data.events.length - 1 ? <div style={{width: 3, flex: 1, minHeight: 54, background: `${theme.accent}66`}} /> : null}
              </div>
              <div style={{paddingBottom: 34}}>
                <div style={{fontFamily: HEAD, fontSize: 42, fontWeight: 700, color: INK, lineHeight: 1.05}}>{e.label.toUpperCase()}</div>
                {e.sublabel ? <div style={{fontFamily: TEXT, fontSize: 30, color: INK_SOFT, marginTop: 4}}>{e.sublabel}</div> : null}
              </div>
            </div>
          );
        })}
      </div>
    </CardShell>
  );
};

// ── receipt ───────────────────────────────────────────────────────────────────
export const ReceiptCard: React.FC<{data: {title?: string; items: Array<{label: string; value: string}>; total?: string}; theme: CardTheme}> = ({data, theme}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const mono = 'ui-monospace, "SF Mono", Menlo, monospace';
  const row = (label: string, value: string, i: number, bold = false) => {
    const t = spring({frame: frame - i * Math.round(fps * 0.35), fps, config: {damping: 18, stiffness: 160}});
    return (
      <div key={`${label}-${i}`} style={{display: 'flex', justifyContent: 'space-between', fontFamily: mono, fontSize: bold ? 44 : 36, fontWeight: bold ? 800 : 500, color: INK, padding: '12px 0', opacity: interpolate(t, [0, 1], [0, 1]), borderTop: bold ? '3px dashed rgba(255,255,255,0.4)' : 'none'}}>
        <span>{label}</span><span>{value}</span>
      </div>
    );
  };
  return (
    <CardShell theme={theme} width={820}>
      <div style={{display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, fontFamily: mono, fontSize: 30, letterSpacing: '0.18em', color: INK_SOFT, marginBottom: 26}}><BarChart01 size={40} color={theme.accent} />{(data.title || 'Receipt').toUpperCase()}</div>
      {data.items.map((it, i) => row(it.label, it.value, i))}
      {data.total ? row('TOTAL', data.total, data.items.length, true) : null}
    </CardShell>
  );
};
