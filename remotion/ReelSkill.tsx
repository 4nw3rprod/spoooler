import React from 'react';
import {
  AbsoluteFill,
  Sequence,
  spring,
  useCurrentFrame,
  useVideoConfig,
  Img,
  Audio,
  staticFile,
} from 'remotion';
import {Video} from '@remotion/media';
import {TransitionSeries, linearTiming} from '@remotion/transitions';
import {fade} from '@remotion/transitions/fade';
import {slide} from '@remotion/transitions/slide';
import {wipe} from '@remotion/transitions/wipe';
import {clockWipe} from '@remotion/transitions/clock-wipe';
import {
  OVERSHOOT,
  SMOOTH,
  inOut,
  inOutStyle,
  mediaInOut,
  ease,
  blurIn,
  blurReveal,
  kenBurns,
  words as splitWords,
  hash01,
  readableInk,
  shade,
  rgba,
} from './motion';
import {loadFont as loadFraunces} from '@remotion/google-fonts/Fraunces';
import {loadFont as loadInter} from '@remotion/google-fonts/Inter';
import {BrandLogo, BrandChips, hasBrandLogo} from './brand-logos';
import {SceneEmoji, hasEmoji} from './emoji';

// ─────────────────────────────────────────────────────────────────────────────
// HUASHU REEL · v2 — cinematic editorial composition
// 1080×1920 · 30fps · audio-driven pacing · every element animates in AND out.
//
// Design language (from the Huashu skill): warm editorial paper, ONE saturated
// accent, Fraunces display serif + Inter sans, physical motion (expoOut/overshoot),
// Slow-Fast-Boom-Stop rhythm, real footage racked into focus inside device frames,
// grain + soft vignette for a printed-matter feel. No purple-gradient AI slop.
// ─────────────────────────────────────────────────────────────────────────────

const {fontFamily: FRAUNCES} = loadFraunces('normal', {weights: ['400', '500', '600', '700', '900'], subsets: ['latin']});
const {fontFamily: INTER} = loadInter('normal', {weights: ['400', '500', '600', '700'], subsets: ['latin']});

const FPS = 30;
const W = 1080;
const H = 1920;

// Default palette: BLACK background + WHITE text so on-screen copy is legible at
// all times (over any media). A strong scrim sits between media and text.
// `accent` is the one saturated colour (per-run overridable).
const BASE = {
  paper: '#0A0A0B',     // near-black background
  paper2: '#16161A',    // slightly lifted panel
  ink: '#FFFFFF',       // white primary text
  inkSoft: '#C7C7CF',   // soft white secondary
  accent: '#FF6A2B',    // warm rust/orange accent (high contrast on black)
};

type Theme = typeof BASE;

type MediaClip = {
  file: string;
  kind: 'image' | 'video';
  source?: string;
  role?: 'background' | 'frame';
  assetType?: string;
  orientation?: 'landscape' | 'portrait' | 'square' | 'unknown';
  alt?: string;
};

type SlideBase = {
  kicker?: string;
  subtext?: string;
  accentWord?: string;
  brands?: string[];
  mediaClips?: MediaClip[];
  audioFile?: string | null;
  durationInFrames: number;
  // Transition plan (set by the generator). transitionIn = visual style entering
  // this slide; cut = J/L/hard; audioLeadFrames = how early this slide's audio
  // begins (bleeding under the previous scene) for a J-cut.
  transitionIn?: string;
  cut?: 'J' | 'L' | 'hard';
  audioLeadFrames?: number;
  // Optional decorative animated emoji (Google Noto via @remotion/animated-emoji).
  // Set by the generator for hook/cta/proof slides when it fits the tone.
  emoji?: string;
};

type HookSlide = SlideBase & {type: 'hook'; headline: string; bgVariant?: string};
type StatSlide = SlideBase & {type: 'stat'; value: string; label: string; showRings?: boolean};
type StatementSlide = SlideBase & {type: 'statement'; lines: string[]; emphasisLine?: number; headline?: string};
type ProofSlide = SlideBase & {type: 'proof'; headline: string};
type CtaSlide = SlideBase & {type: 'cta'; headline: string; buttonLabel: string; buttonStyle?: string; brandMark?: string};

// Data-driven layouts (the expanded arsenal).
type ChecklistData = {title?: string; items: Array<{text: string; brand?: string}>; checked?: boolean};
type ComparisonData = {leftTitle: string; rightTitle: string; leftItems: string[]; rightItems: string[]; leftBrand?: string; rightBrand?: string};
type BarGraphData = {title?: string; unit?: string; bars: Array<{label: string; value: number; brand?: string}>};
type PieChartData = {title?: string; slices: Array<{label: string; value: number; brand?: string}>};
type ProgressGraphData = {title?: string; unit?: string; points: Array<{label: string; value: number}>};
type MotionGraphicData = {title?: string; nodes: Array<{label: string; brand?: string}>; flow?: 'linear' | 'cycle' | 'hub'};
// GitHub repo card — the scraper finds the repo URL and fills these from the
// GitHub API / page metadata. Renders the editorial repo-card layout.
type GithubCardData = {
  owner: string;
  repo: string;
  description?: string;
  language?: string;
  languageColor?: string;   // hex; defaults to a sensible per-language color
  stars?: string | number;
  forks?: string | number;
  visibility?: string;      // "Public" | "Private"
  url?: string;
};

type ChecklistSlide = SlideBase & {type: 'checklist'; headline: string; data: ChecklistData};
type ComparisonSlide = SlideBase & {type: 'comparison'; headline: string; data: ComparisonData};
type BarGraphSlide = SlideBase & {type: 'bar-graph'; headline: string; data: BarGraphData};
type PieChartSlide = SlideBase & {type: 'pie-chart'; headline: string; data: PieChartData};
type ProgressGraphSlide = SlideBase & {type: 'progress-graph'; headline: string; data: ProgressGraphData};
type MotionGraphicSlide = SlideBase & {type: 'motion-graphic'; headline: string; data: MotionGraphicData};
type GithubCardSlide = SlideBase & {type: 'github-card'; headline: string; data: GithubCardData};

type Slide =
  | HookSlide | StatSlide | StatementSlide | ProofSlide | CtaSlide
  | ChecklistSlide | ComparisonSlide | BarGraphSlide | PieChartSlide | ProgressGraphSlide | MotionGraphicSlide
  | GithubCardSlide;

type TextEffect = 'word-stagger' | 'line-fade' | 'scale-pop' | 'blur-reveal';

export type ReelSkillProps = {
  slides: Slide[];
  accentColor?: string;
  colorOverrides?: {primary?: string; secondary?: string; accent?: string; highlight?: string} | null;
  textEffect?: TextEffect;
  voiceoverAudioFile?: string;
  brandLogos?: Array<{name: string; file?: string}>;
  audioDriven?: boolean;
  // Word-level caption track from whisper.cpp alignment (optional). When present,
  // a synced caption line renders in the lower safe band, word-by-word.
  captions?: Array<{text: string; start: number; end: number; words?: Array<{text: string; start: number; end: number}>}>;
  alignedWords?: Array<{text: string; start: number; end: number}>;
  totalDurationInFrames: number;
};

// Resolve the active theme from overrides (kept warm/editorial by default).
function resolveTheme(props: ReelSkillProps): Theme {
  const o = props.colorOverrides || {};
  const accent = o.accent || props.accentColor || BASE.accent;
  return {
    paper: o.primary || BASE.paper,
    paper2: o.primary ? shade(o.primary, -0.04) : BASE.paper2,
    ink: o.secondary || BASE.ink,
    inkSoft: o.highlight || BASE.inkSoft,
    accent,
  };
}

const srcOf = (file: string) => (/^https?:\/\//.test(file) ? file : staticFile(file));

// ── Rule-of-thirds safe zone ─────────────────────────────────────────────────
// Instagram's UI (caption, profile, action buttons, progress bar) crowds the top
// ~14% and bottom ~22% of the 1080×1920 frame. We keep ALL key content inside a
// centered safe band so nothing important is ever covered. These paddings define
// that band; layouts anchor their content to the vertical center of it.
const SAFE = {
  top: 300,      // ~15.6% — clear of caption/handle
  bottom: 470,   // ~24.5% — clear of action buttons + our progress rail
  side: 96,
};
const SAFE_H = H - SAFE.top - SAFE.bottom;           // usable height
const SAFE_CY = SAFE.top + SAFE_H / 2;               // vertical center of safe band

// Background = full-bleed STOCK video (role:'background'); frames = scraped
// product media (role:'frame'). Falls back gracefully if roles are absent.
function backgroundClip(clips: MediaClip[] = []): MediaClip | null {
  const bg = clips.find((c) => c.role === 'background');
  if (bg) return bg;
  // Legacy/no-role: prefer a video for the backdrop.
  return [...clips].sort((a, b) => (b.kind === 'video' ? 1 : 0) - (a.kind === 'video' ? 1 : 0))[0] || null;
}

function frameClips(clips: MediaClip[] = []): MediaClip[] {
  const frames = clips.filter((c) => c.role === 'frame');
  if (frames.length) return frames;
  // Legacy/no-role: any non-background clip can act as a frame.
  return clips.filter((c) => c.role !== 'background');
}

// Choose the best clip for a scene's primary "screen": prefer video, then
// landscape image, then anything. Matches the scraper's own priority.
function primaryClip(clips: MediaClip[] = []): MediaClip | null {
  if (!clips.length) return null;
  const rank = (c: MediaClip) =>
    (c.kind === 'video' ? 4 : 0) +
    (c.orientation === 'landscape' ? 2 : c.orientation === 'square' ? 1 : 0);
  return [...clips].sort((a, b) => rank(b) - rank(a))[0] || clips[0];
}

function secondaryClip(clips: MediaClip[] = [], primary?: MediaClip | null): MediaClip | null {
  return clips.find((c) => c !== primary) || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// ATMOSPHERE — grain + vignette give the warm "printed matter" feel and kill the
// flat digital look. Both are cheap CSS, no images.
// ─────────────────────────────────────────────────────────────────────────────
const Grain: React.FC<{opacity?: number}> = ({opacity = 0.05}) => (
  <AbsoluteFill
    style={{
      opacity,
      mixBlendMode: 'multiply',
      pointerEvents: 'none',
      backgroundImage:
        "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 240 240' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
      backgroundSize: '300px 300px',
    }}
  />
);

const Vignette: React.FC<{ink: string; strength?: number}> = ({ink, strength = 0.18}) => (
  <AbsoluteFill
    style={{
      pointerEvents: 'none',
      background: `radial-gradient(120% 80% at 50% 42%, transparent 55%, ${rgba(ink, strength)} 100%)`,
    }}
  />
);

// Ambient paper background with a very soft accent wash that slowly breathes —
// keeps the frame from ever being a dead flat color.
const PaperBg: React.FC<{theme: Theme; frame: number; warm?: boolean}> = ({theme, frame, warm}) => {
  const drift = Math.sin(frame / 80) * 0.5 + 0.5;
  return (
    <AbsoluteFill style={{background: theme.paper}}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(80% 55% at ${30 + drift * 12}% ${20 + drift * 8}%, ${rgba(theme.accent, warm ? 0.1 : 0.05)} 0%, transparent 60%)`,
        }}
      />
      <AbsoluteFill
        style={{
          background: `radial-gradient(70% 50% at ${75 - drift * 10}% ${85 - drift * 6}%, ${rgba(theme.ink, 0.05)} 0%, transparent 55%)`,
        }}
      />
    </AbsoluteFill>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// FULL-BLEED BACKGROUND MEDIA — the stock video that plays behind EVERY scene.
// Ken Burns drift + a STRONG dark scrim so white text is always readable on top.
// Racks into focus on entry, racks out at the tail.
// ─────────────────────────────────────────────────────────────────────────────
const BackgroundMedia: React.FC<{clip: MediaClip | null; theme: Theme; total: number; scrim?: number}> = ({clip, theme, total, scrim = 0.62}) => {
  const frame = useCurrentFrame();
  if (!clip?.file) {
    // No media → solid dark base with a faint accent glow so it's never flat.
    return <PaperBg theme={theme} frame={frame} />;
  }
  const kb = kenBurns(frame, {scaleFrom: 1.12, scaleAmp: 0.05, panAmp: 26});
  const io = mediaInOut(frame, total, {inDur: 24, outDur: 16});
  return (
    <AbsoluteFill style={{background: theme.paper}}>
      <AbsoluteFill style={{opacity: io.opacity, transform: `scale(${kb.scale * io.scale}) translate(${kb.x}px, ${kb.y}px)`, filter: io.blur > 0.2 ? `blur(${io.blur}px)` : undefined}}>
        {clip.kind === 'video' ? (
          <Video src={srcOf(clip.file)} style={{width: '100%', height: '100%', objectFit: 'cover'}} muted loop />
        ) : (
          <Img src={srcOf(clip.file)} style={{width: '100%', height: '100%', objectFit: 'cover'}} />
        )}
      </AbsoluteFill>
      {/* STRONG dark scrim — flat base layer guarantees minimum contrast everywhere */}
      <AbsoluteFill style={{background: rgba(theme.paper, scrim)} } />
      {/* Vertical gradient — darker at top & bottom (where text sits), lighter mid */}
      <AbsoluteFill
        style={{
          background: `linear-gradient(180deg, ${rgba(theme.paper, 0.82)} 0%, ${rgba(theme.paper, 0.45)} 32%, ${rgba(theme.paper, 0.45)} 64%, ${rgba(theme.paper, 0.9)} 100%)`,
        }}
      />
    </AbsoluteFill>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// DEVICE / BROWSER FRAME — the home for rectangular scraped product media. A
// landscape clip sits inside a browser-chrome card that floats with subtle
// parallax + tilt, animates in (rise+focus) and out (lift+blur). This is where
// "the actual product" shows up on screen.
// ─────────────────────────────────────────────────────────────────────────────
const BrowserFrame: React.FC<{
  clip: MediaClip | null;
  theme: Theme;
  total: number;
  frame: number;
  width?: number;
  delay?: number;
}> = ({clip, theme, total, frame, width = 760, delay = 6}) => {
  if (!clip?.file) return null;
  const io = inOut(frame, total, {inDelay: delay, inDur: 20, outDur: 14, distance: 60, dir: 'up', blurAmt: 6});
  const media = mediaInOut(frame, total, {inDur: 24, outDur: 14});
  const tilt = Math.sin((frame + delay) / 50) * 1.1;
  const floatY = Math.sin((frame + delay) / 38) * 8;
  const isLandscape = clip.orientation !== 'portrait';
  const frameH = isLandscape ? Math.round(width * 0.62) : Math.round(width * 1.1);
  const barH = 34;

  return (
    <div
      style={{
        position: 'absolute',
        width,
        opacity: io.opacity,
        transform: `translate3d(${io.x}px, ${io.y + floatY}px, 0) scale(${io.scale}) rotate(${tilt}deg)`,
        borderRadius: 16,
        overflow: 'hidden',
        background: theme.paper,
        border: `1px solid ${rgba(theme.ink, 0.1)}`,
        boxShadow: `0 30px 80px ${rgba(theme.ink, 0.22)}, 0 4px 14px ${rgba(theme.ink, 0.1)}`,
      }}
    >
      {/* browser chrome bar */}
      <div style={{height: barH, background: theme.paper2, display: 'flex', alignItems: 'center', gap: 7, paddingLeft: 16, borderBottom: `1px solid ${rgba(theme.ink, 0.08)}`}}>
        {['#E5715B', '#E6B34D', '#7FB069'].map((c, i) => (
          <div key={i} style={{width: 11, height: 11, borderRadius: '50%', background: c, opacity: 0.85}} />
        ))}
        <div style={{flex: 1, margin: '0 16px', height: 14, borderRadius: 7, background: rgba(theme.ink, 0.06)}} />
      </div>
      <div style={{position: 'relative', width: '100%', height: frameH, overflow: 'hidden', background: theme.paper2}}>
        <div style={{position: 'absolute', inset: 0, transform: `scale(${media.scale})`, filter: media.blur > 0.2 ? `blur(${media.blur}px)` : undefined, opacity: media.opacity}}>
          {clip.kind === 'video' ? (
            <Video src={srcOf(clip.file)} style={{width: '100%', height: '100%', objectFit: 'cover'}} muted loop />
          ) : (
            <Img src={srcOf(clip.file)} style={{width: '100%', height: '100%', objectFit: 'cover'}} />
          )}
        </div>
      </div>
    </div>
  );
};

// A bare floating media card (no browser chrome) — for stat/statement supporting
// imagery. Also in/out animated, rounded, soft-shadowed.
const MediaCard: React.FC<{
  clip: MediaClip | null;
  theme: Theme;
  total: number;
  frame: number;
  style?: React.CSSProperties;
  delay?: number;
  dir?: 'up' | 'down' | 'left' | 'right';
}> = ({clip, theme, total, frame, style, delay = 8, dir = 'up'}) => {
  if (!clip?.file) return null;
  const io = inOut(frame, total, {inDelay: delay, inDur: 20, outDur: 14, distance: 50, dir, blurAmt: 6});
  const media = mediaInOut(frame, total, {inDur: 22, outDur: 14});
  const floatY = Math.sin((frame + delay) / 42) * 7;
  return (
    <div
      style={{
        position: 'absolute',
        overflow: 'hidden',
        borderRadius: 14,
        border: `1px solid ${rgba(theme.ink, 0.1)}`,
        boxShadow: `0 24px 60px ${rgba(theme.ink, 0.2)}`,
        opacity: io.opacity,
        transform: `translate3d(${io.x}px, ${io.y + floatY}px, 0) scale(${io.scale})`,
        ...style,
      }}
    >
      <div style={{position: 'absolute', inset: 0, transform: `scale(${media.scale})`, filter: media.blur > 0.2 ? `blur(${media.blur}px)` : undefined, opacity: media.opacity}}>
        {clip.kind === 'video' ? (
          <Video src={srcOf(clip.file)} style={{width: '100%', height: '100%', objectFit: 'cover'}} muted loop />
        ) : (
          <Img src={srcOf(clip.file)} style={{width: '100%', height: '100%', objectFit: 'cover'}} />
        )}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// TEXT — every text element animates IN (blur/rise/stagger) and OUT (fade/drift).
// ─────────────────────────────────────────────────────────────────────────────

// Small editorial eyebrow label with an accent tick. In/out animated.
const Kicker: React.FC<{text: string; theme: Theme; total: number; frame: number; delay?: number; align?: 'left' | 'center'}> = ({text, theme, total, frame, delay = 2, align = 'center'}) => {
  if (!text) return null;
  const io = inOut(frame, total, {inDelay: delay, inDur: 14, outDur: 12, distance: 14, dir: 'up', blurAmt: 5});
  return (
    <div
      style={inOutStyle(io, {
        display: 'flex',
        alignItems: 'center',
        justifyContent: align === 'center' ? 'center' : 'flex-start',
        gap: 12,
        marginBottom: 22,
      })}
    >
      <div style={{width: 30, height: 2, background: theme.accent}} />
      <span style={{fontFamily: INTER, fontSize: 24, fontWeight: 600, letterSpacing: '0.32em', textTransform: 'uppercase', color: theme.accent}}>
        {text}
      </span>
    </div>
  );
};

// Kinetic headline: words reveal sequentially with blur+rise on the way IN, and
// the whole line drifts+fades OUT near the tail. accentWord is tinted + can be
// italic for editorial emphasis.
const KineticHeadline: React.FC<{
  text: string;
  theme: Theme;
  total: number;
  frame: number;
  size: number;
  accentWord?: string;
  effect?: TextEffect;
  align?: 'left' | 'center';
  delay?: number;
  weight?: number;
}> = ({text, theme, total, frame, size, accentWord, effect = 'word-stagger', align = 'center', delay = 4, weight = 600}) => {
  const ws = splitWords(text);
  // Whole-line OUT (applied to the wrapper so words leave together).
  const outStart = Math.max(delay + 18, total - 16);
  const outProg = ease(frame, [outStart, total], [0, 1], SMOOTH);
  const wrapStyle: React.CSSProperties = {
    display: 'flex',
    flexWrap: 'wrap',
    gap: `${Math.round(size * 0.08)}px ${Math.round(size * 0.26)}px`,
    justifyContent: align === 'center' ? 'center' : 'flex-start',
    padding: '0 8px',
    opacity: 1 - outProg,
    transform: `translateY(${outProg * -26}px)`,
    filter: outProg > 0.02 ? `blur(${outProg * 6}px)` : undefined,
  };

  const accentClean = (accentWord || '').replace(/[^\w%$₹+\-]/g, '').toLowerCase();

  return (
    <div style={wrapStyle}>
      {ws.map((word, i) => {
        const isAccent = accentClean && word.replace(/[^\w%$₹+\-]/g, '').toLowerCase() === accentClean;
        // line-fade reveals all words together; others stagger per word.
        const wDelay = effect === 'line-fade' ? delay : delay + i * 3;
        // blur-reveal: React Bits BlurText curve (blur+rise from below, per word).
        if (effect === 'blur-reveal') {
          const br = blurReveal(frame, wDelay, {direction: 'bottom', distance: size * 0.5, stepDur: 11, maxBlur: 12});
          return (
            <span
              key={i}
              style={{
                fontFamily: FRAUNCES,
                fontSize: size,
                lineHeight: 1.04,
                fontWeight: isAccent ? 900 : weight,
                fontStyle: isAccent ? 'italic' : 'normal',
                color: isAccent ? theme.accent : theme.ink,
                letterSpacing: '-0.02em',
                opacity: br.opacity,
                display: 'inline-block',
                transform: `translateY(${br.y}px)`,
                filter: br.blur > 0.2 ? `blur(${br.blur}px)` : undefined,
                willChange: 'transform, filter, opacity',
              }}
            >
              {word}
            </span>
          );
        }
        const b = blurIn(frame, wDelay, effect === 'scale-pop' ? 12 : 16, 16);
        const rise = ease(frame, [wDelay, wDelay + 16], [size * 0.32, 0]);
        const pop = effect === 'scale-pop' ? ease(frame, [wDelay, wDelay + 14], [0.86, 1], OVERSHOOT) : 1;
        return (
          <span
            key={i}
            style={{
              fontFamily: FRAUNCES,
              fontSize: size,
              lineHeight: 1.04,
              fontWeight: isAccent ? 900 : weight,
              fontStyle: isAccent ? 'italic' : 'normal',
              color: isAccent ? theme.accent : theme.ink,
              letterSpacing: '-0.02em',
              opacity: b.opacity,
              display: 'inline-block',
              transform: `translateY(${rise}px) scale(${pop})`,
              filter: b.blur > 0.2 ? `blur(${b.blur}px)` : undefined,
            }}
          >
            {word}
          </span>
        );
      })}
    </div>
  );
};

// Supporting sentence (standfirst). In/out animated, muted ink, Inter.
const Subtext: React.FC<{text?: string; theme: Theme; total: number; frame: number; delay?: number; align?: 'left' | 'center'; maxWidth?: number; size?: number}> = ({text, theme, total, frame, delay = 16, align = 'center', maxWidth = 740, size = 33}) => {
  if (!text) return null;
  const io = inOut(frame, total, {inDelay: delay, inDur: 16, outDur: 12, distance: 18, dir: 'up', blurAmt: 5});
  return (
    <div
      style={inOutStyle(io, {
        marginTop: 26,
        maxWidth,
        fontFamily: INTER,
        fontSize: size,
        fontWeight: 400,
        lineHeight: 1.4,
        color: theme.inkSoft,
        textAlign: align,
        textWrap: 'pretty' as React.CSSProperties['textWrap'],
      })}
    >
      {text}
    </div>
  );
};

// Thin progress rail at the very bottom — shows reel progress, animates in/out.
const ProgressRail: React.FC<{theme: Theme; progress: number; total: number; frame: number}> = ({theme, progress, total, frame}) => {
  const io = inOut(frame, total, {inDelay: 2, inDur: 12, outDur: 10, distance: 8, dir: 'down', blurAmt: 0});
  return (
    <div style={{position: 'absolute', left: 64, right: 64, bottom: 70, height: 3, borderRadius: 3, background: rgba(theme.ink, 0.1), opacity: io.opacity}}>
      <div style={{width: `${Math.round(progress * 100)}%`, height: '100%', borderRadius: 3, background: theme.accent}} />
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// CONCENTRIC RINGS — kinetic accent for stat slides. Rings scale + fade in, hold,
// then contract + fade out.
// ─────────────────────────────────────────────────────────────────────────────
const Rings: React.FC<{theme: Theme; total: number; frame: number}> = ({theme, total, frame}) => {
  const io = inOut(frame, total, {inDelay: 4, inDur: 26, outDur: 16, distance: 0, blurAmt: 0});
  return (
    <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', opacity: io.opacity}}>
      {[0, 1, 2, 3].map((i) => {
        const baseR = 260 + i * 150;
        const breathe = Math.sin((frame - i * 6) / 30) * 8;
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              width: baseR + breathe,
              height: baseR + breathe,
              borderRadius: '50%',
              border: `1.5px solid ${rgba(theme.accent, 0.18 - i * 0.03)}`,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// STAGE — the universal scene shell. Every scene renders through this so the
// rules are enforced in ONE place:
//   • full-bleed STOCK background video + strong dark scrim (text always legible)
//   • SCRAPED product media shown in small floating frames (distributed)
//   • all primary content vertically CENTERED in the rule-of-thirds safe band
//     (clear of Instagram's top/bottom UI)
//   • grain + vignette atmosphere
// `framePlacement` controls where product frames sit so they don't clash with
// the layout's own content.
// ─────────────────────────────────────────────────────────────────────────────
const Stage: React.FC<{
  slide: Slide;
  theme: Theme;
  total: number;
  align?: 'center' | 'left';
  framePlacement?: 'bottom' | 'hidden';
  children: React.ReactNode;
}> = ({slide, theme, total, align = 'center', framePlacement = 'bottom', children}) => {
  const frame = useCurrentFrame();
  const bg = backgroundClip(slide.mediaClips);
  const frames = framePlacement === 'hidden' ? [] : frameClips(slide.mediaClips);
  return (
    <AbsoluteFill style={{background: theme.paper}}>
      {/* 1. full-bleed stock background + scrim (or dark base if none) */}
      <BackgroundMedia clip={bg} theme={theme} total={total} />

      {/* 2. centered content inside the safe band */}
      <div
        style={{
          position: 'absolute',
          left: SAFE.side,
          right: SAFE.side,
          top: SAFE.top,
          height: SAFE_H,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: align === 'center' ? 'center' : 'flex-start',
        }}
      >
        {children}
      </div>

      {/* 3. scraped product frames, distributed near the lower third of the safe band */}
      {frames.length ? <FrameLayer clips={frames} theme={theme} total={total} /> : null}

      <Vignette ink={theme.ink} strength={0.22} />
      <Grain opacity={0.06} />
    </AbsoluteFill>
  );
};

// Renders 1-2 scraped product clips as small floating framed cards, anchored to
// the lower part of the safe band so they support (not cover) the headline.
const FrameLayer: React.FC<{clips: MediaClip[]; theme: Theme; total: number}> = ({clips, theme, total}) => {
  const frame = useCurrentFrame();
  const shown = clips.slice(0, 2);
  return (
    <div style={{position: 'absolute', left: 0, right: 0, top: SAFE_CY + SAFE_H * 0.18, display: 'flex', justifyContent: 'center', gap: 28}}>
      {shown.map((clip, i) => (
        <MiniFrame key={i} clip={clip} theme={theme} total={total} frame={frame} delay={14 + i * 6} width={shown.length > 1 ? 360 : 540} />
      ))}
    </div>
  );
};

// A compact framed product clip (browser-chrome look) for the FrameLayer.
const MiniFrame: React.FC<{clip: MediaClip; theme: Theme; total: number; frame: number; width: number; delay: number}> = ({clip, theme, total, frame, width, delay}) => {
  const io = inOut(frame, total, {inDelay: delay, inDur: 18, outDur: 14, distance: 44, dir: 'up', blurAmt: 5});
  const media = mediaInOut(frame, total, {inDur: 22, outDur: 14});
  const floatY = Math.sin((frame + delay) / 40) * 6;
  const isLandscape = clip.orientation !== 'portrait';
  const frameH = isLandscape ? Math.round(width * 0.6) : Math.round(width * 1.0);
  return (
    <div
      style={{
        width,
        opacity: io.opacity,
        transform: `translate3d(${io.x}px, ${io.y + floatY}px, 0) scale(${io.scale})`,
        borderRadius: 14,
        overflow: 'hidden',
        background: theme.paper2,
        border: `1px solid ${rgba(theme.ink, 0.16)}`,
        boxShadow: `0 24px 60px rgba(0,0,0,0.5)`,
      }}
    >
      <div style={{height: 28, background: theme.paper2, display: 'flex', alignItems: 'center', gap: 6, paddingLeft: 14, borderBottom: `1px solid ${rgba(theme.ink, 0.12)}`}}>
        {['#FF5F57', '#FEBC2E', '#28C840'].map((c, k) => <div key={k} style={{width: 9, height: 9, borderRadius: '50%', background: c}} />)}
      </div>
      <div style={{position: 'relative', width: '100%', height: frameH, overflow: 'hidden', background: '#000'}}>
        <div style={{position: 'absolute', inset: 0, transform: `scale(${media.scale})`, filter: media.blur > 0.2 ? `blur(${media.blur}px)` : undefined, opacity: media.opacity}}>
          {clip.kind === 'video' ? (
            <Video src={srcOf(clip.file)} style={{width: '100%', height: '100%', objectFit: 'cover'}} muted loop />
          ) : (
            <Img src={srcOf(clip.file)} style={{width: '100%', height: '100%', objectFit: 'cover'}} />
          )}
        </div>
      </div>
    </div>
  );
};

// ── HOOK ── full-bleed footage + giant editorial headline, word-reveal.
const HookScene: React.FC<{slide: HookSlide; theme: Theme; effect: TextEffect}> = ({slide, theme, effect}) => {
  const frame = useCurrentFrame();
  const total = slide.durationInFrames;
  const headlineSize = slide.headline.length > 40 ? 76 : slide.headline.length > 22 ? 92 : 112;
  return (
    <Stage slide={slide} theme={theme} total={total} align="center" framePlacement="hidden">
      {hasEmoji(slide.emoji) ? <SceneEmoji emoji={slide.emoji} total={total} size={132} delay={2} scale="2" style={{marginBottom: 18}} /> : null}
      <Kicker text={slide.kicker || 'WATCH THIS'} theme={theme} total={total} frame={frame} delay={2} />
      <KineticHeadline text={slide.headline} theme={theme} total={total} frame={frame} size={headlineSize} accentWord={slide.accentWord} effect={effect} delay={6} weight={700} />
      {slide.subtext ? <Subtext text={slide.subtext} theme={theme} total={total} frame={frame} delay={18} /> : null}
    </Stage>
  );
};

// ── STAT ── giant count-up numeral with rings.
const StatScene: React.FC<{slide: StatSlide; theme: Theme; effect: TextEffect}> = ({slide, theme}) => {
  const frame = useCurrentFrame();
  const total = slide.durationInFrames;
  const numericPart = slide.value.match(/[\d.]+/)?.[0] || '';
  const prefix = numericPart ? slide.value.split(numericPart)[0] : '';
  const suffix = numericPart ? slide.value.split(numericPart)[1] || '' : slide.value;
  const target = parseFloat(numericPart || '0');
  const countProg = ease(frame, [8, 46], [0, 1]);
  const display = numericPart ? (Math.round(target * countProg * 100) / 100).toString() : '';
  const numIo = inOut(frame, total, {inDelay: 6, inDur: 18, outDur: 14, distance: 40, dir: 'up', blurAmt: 10});

  return (
    <Stage slide={slide} theme={theme} total={total} align="center" framePlacement="hidden">
      {slide.showRings !== false ? <Rings theme={theme} total={total} frame={frame} /> : null}
      <Kicker text={slide.kicker || 'BY THE NUMBERS'} theme={theme} total={total} frame={frame} delay={2} />
      <div
        style={inOutStyle(numIo, {
          fontFamily: FRAUNCES,
          fontSize: 280,
          fontWeight: 900,
          lineHeight: 0.95,
          color: theme.accent,
          letterSpacing: '-0.04em',
        })}
      >
        {prefix}
        {display}
        {suffix}
      </div>
      <Subtext text={slide.label || slide.subtext} theme={theme} total={total} frame={frame} delay={26} size={38} maxWidth={820} align="center" />
    </Stage>
  );
};

// ── STATEMENT ── centered editorial declaration over the backdrop.
const StatementScene: React.FC<{slide: StatementSlide; theme: Theme; effect: TextEffect}> = ({slide, theme, effect}) => {
  const frame = useCurrentFrame();
  const total = slide.durationInFrames;
  const headline = slide.headline || (slide.lines || []).join(' ');
  const lineSize = headline.length > 48 ? 64 : headline.length > 28 ? 78 : 96;
  return (
    <Stage slide={slide} theme={theme} total={total} align="center" framePlacement="bottom">
      <Kicker text={slide.kicker || 'THE IDEA'} theme={theme} total={total} frame={frame} delay={2} />
      <KineticHeadline text={headline} theme={theme} total={total} frame={frame} size={lineSize} accentWord={slide.accentWord} effect={effect} align="center" delay={6} weight={600} />
      {slide.subtext ? <Subtext text={slide.subtext} theme={theme} total={total} frame={frame} delay={18} align="center" maxWidth={780} /> : null}
    </Stage>
  );
};

// ── PROOF (solution step) ── "show the product": headline + product frames.
const ProofScene: React.FC<{slide: ProofSlide; theme: Theme; effect: TextEffect}> = ({slide, theme, effect}) => {
  const frame = useCurrentFrame();
  const total = slide.durationInFrames;
  const size = slide.headline.length > 44 ? 60 : slide.headline.length > 22 ? 74 : 88;
  return (
    <Stage slide={slide} theme={theme} total={total} align="center" framePlacement="bottom">
      <Kicker text={slide.kicker || 'HOW IT WORKS'} theme={theme} total={total} frame={frame} delay={2} />
      <KineticHeadline text={slide.headline} theme={theme} total={total} frame={frame} size={size} accentWord={slide.accentWord} effect={effect} delay={6} weight={600} />
      {slide.subtext ? <Subtext text={slide.subtext} theme={theme} total={total} frame={frame} delay={16} maxWidth={760} size={31} /> : null}
    </Stage>
  );
};

// ── CTA ── brightest moment. Spring pill button + brand mark, centered.
const CtaScene: React.FC<{slide: CtaSlide; theme: Theme; effect: TextEffect}> = ({slide, theme, effect}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const total = slide.durationInFrames;
  const btnSpring = spring({frame: frame - 22, fps, config: {damping: 12, stiffness: 120, mass: 0.8}});
  const btnOut = ease(frame, [total - 14, total], [1, 0], SMOOTH);
  const size = slide.headline.length > 26 ? 84 : 104;
  return (
    <Stage slide={slide} theme={theme} total={total} align="center" framePlacement="hidden">
      {hasEmoji(slide.emoji) ? <SceneEmoji emoji={slide.emoji} total={total} size={120} delay={2} scale="2" style={{marginBottom: 14}} /> : null}
      <Kicker text={slide.kicker || 'YOUR MOVE'} theme={theme} total={total} frame={frame} delay={2} />
      <KineticHeadline text={slide.headline} theme={theme} total={total} frame={frame} size={size} accentWord={slide.accentWord} effect={effect} delay={6} weight={700} />
      {slide.subtext ? <Subtext text={slide.subtext} theme={theme} total={total} frame={frame} delay={16} size={34} /> : null}
      <div
        style={{
          marginTop: 48,
          padding: '26px 60px',
          borderRadius: 100,
          background: theme.accent,
            color: readableInk(theme.accent),
            fontFamily: INTER,
            fontSize: 38,
            fontWeight: 700,
            letterSpacing: '-0.01em',
            transform: `scale(${Math.max(0.0001, btnSpring) * btnOut})`,
            boxShadow: `0 18px 50px ${rgba(theme.accent, 0.45)}`,
          }}
        >
          {slide.buttonLabel}
        </div>
        {slide.brandMark ? (
          <div
            style={{
              marginTop: 40,
              fontFamily: INTER,
              fontSize: 24,
              fontWeight: 600,
              letterSpacing: '0.34em',
              textTransform: 'uppercase',
              color: theme.inkSoft,
              opacity: ease(frame, [30, 44], [0, 1]) * btnOut,
            }}
          >
            {slide.brandMark}
          </div>
        ) : null}
    </Stage>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// SHARED HEADER for data layouts — kicker + headline + subtext, all in/out
// animated, left-aligned editorial. Returns the vertical space it occupies.
// ─────────────────────────────────────────────────────────────────────────────
const SceneHeader: React.FC<{
  kicker?: string;
  headline: string;
  subtext?: string;
  theme: Theme;
  total: number;
  frame: number;
  accentWord?: string;
  effect: TextEffect;
  size?: number;
}> = ({kicker, headline, subtext, theme, total, frame, accentWord, effect, size = 70}) => (
  <div style={{display: 'flex', flexDirection: 'column', alignItems: 'flex-start'}}>
    <Kicker text={kicker || ''} theme={theme} total={total} frame={frame} delay={2} align="left" />
    <KineticHeadline text={headline} theme={theme} total={total} frame={frame} size={size} accentWord={accentWord} effect={effect} align="left" delay={5} weight={600} />
    {subtext ? <Subtext text={subtext} theme={theme} total={total} frame={frame} delay={14} align="left" maxWidth={840} size={29} /> : null}
  </div>
);

// Persistent brand "featuring" strip — bottom-anchored logo chips, in/out animated.
const BrandStrip: React.FC<{brands?: string[]; theme: Theme; total: number; frame: number}> = ({brands, theme, total, frame}) => {
  const list = (brands || []).filter((b) => hasBrandLogo(b)).slice(0, 3);
  if (!list.length) return null;
  const io = inOut(frame, total, {inDelay: 10, inDur: 16, outDur: 12, distance: 16, dir: 'down', blurAmt: 4});
  return (
    <div style={{position: 'absolute', left: 0, right: 0, bottom: 96, display: 'flex', justifyContent: 'center', ...inOutStyle(io)}}>
      <BrandChips names={list} ink={theme.ink} accent={theme.accent} paper={theme.paper} size={40} />
    </div>
  );
};

// Inline logo + label token used inside checklist/comparison/chart rows.
const LogoToken: React.FC<{brand?: string; label: string; theme: Theme; size?: number}> = ({brand, label, theme, size = 30}) => (
  <span style={{display: 'inline-flex', alignItems: 'center', gap: 10}}>
    {brand && hasBrandLogo(brand) ? <BrandLogo name={brand} size={size} ink={theme.ink} accent={theme.accent} /> : null}
    <span>{label}</span>
  </span>
);

// ─────────────────────────────────────────────────────────────────────────────
// DATA STAGE — shell for the data layouts (checklist/comparison/chart/graphic).
// Same rules as Stage (dark backdrop + scrim, grain/vignette) but content fills
// the safe band TOP-anchored (these layouts are tall), and there's no separate
// product-frame layer (their own logos/charts are the content).
// ─────────────────────────────────────────────────────────────────────────────
const DataStage: React.FC<{slide: Slide; theme: Theme; total: number; children: React.ReactNode}> = ({slide, theme, total, children}) => {
  const bg = backgroundClip(slide.mediaClips);
  return (
    <AbsoluteFill style={{background: theme.paper}}>
      <BackgroundMedia clip={bg} theme={theme} total={total} scrim={0.74} />
      <div
        style={{
          position: 'absolute',
          left: SAFE.side,
          right: SAFE.side,
          top: SAFE.top,
          height: SAFE_H,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
        }}
      >
        {children}
      </div>
      <Vignette ink={theme.ink} strength={0.2} />
      <Grain opacity={0.06} />
    </AbsoluteFill>
  );
};

// ── CHECKLIST ── staggered animated rows with a drawn checkmark, optional logos.
const ChecklistScene: React.FC<{slide: ChecklistSlide; theme: Theme; effect: TextEffect}> = ({slide, theme, effect}) => {
  const frame = useCurrentFrame();
  const total = slide.durationInFrames;
  const items = slide.data.items || [];
  return (
    <DataStage slide={slide} theme={theme} total={total}>
      <SceneHeader kicker={slide.kicker} headline={slide.data.title || slide.headline} subtext={slide.subtext} theme={theme} total={total} frame={frame} accentWord={slide.accentWord} effect={effect} size={58} />
      <div style={{marginTop: 44, display: 'flex', flexDirection: 'column', gap: 24}}>
          {items.map((it, i) => {
            const delay = 22 + i * 8;
            const io = inOut(frame, total, {inDelay: delay, inDur: 16, outDur: 12, distance: 40, dir: 'left', blurAmt: 5});
            const checkProg = ease(frame, [delay + 6, delay + 20], [0, 1], OVERSHOOT);
            return (
              <div key={i} style={inOutStyle(io, {display: 'flex', alignItems: 'center', gap: 24})}>
                {/* animated check token */}
                <div style={{width: 60, height: 60, borderRadius: 16, background: rgba(theme.accent, 0.16), border: `2px solid ${theme.accent}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none'}}>
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
                    <path d="M4 12.5 L10 18 L20 6" stroke={theme.accent} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
                      strokeDasharray="30" strokeDashoffset={30 - checkProg * 30} />
                  </svg>
                </div>
                <div style={{fontFamily: INTER, fontSize: 38, fontWeight: 600, color: theme.ink, display: 'flex', alignItems: 'center', gap: 12}}>
                  <LogoToken brand={it.brand} label={it.text} theme={theme} size={36} />
                </div>
              </div>
            );
          })}
      </div>
    </DataStage>
  );
};

// ── COMPARISON ── two columns with a center divider; each side can carry a logo.
const ComparisonScene: React.FC<{slide: ComparisonSlide; theme: Theme; effect: TextEffect}> = ({slide, theme, effect}) => {
  const frame = useCurrentFrame();
  const total = slide.durationInFrames;
  const d = slide.data;
  const leftIo = inOut(frame, total, {inDelay: 18, inDur: 18, outDur: 12, distance: 70, dir: 'left', blurAmt: 6});
  const rightIo = inOut(frame, total, {inDelay: 24, inDur: 18, outDur: 12, distance: 70, dir: 'right', blurAmt: 6});
  const dividerH = ease(frame, [22, 44], [0, 1]);
  const Col: React.FC<{title: string; items: string[]; brand?: string; io: typeof leftIo; tone: 'muted' | 'accent'}> = ({title, items, brand, io, tone}) => (
    <div style={inOutStyle(io, {flex: 1, display: 'flex', flexDirection: 'column', gap: 18})}>
      <div style={{display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8}}>
        {brand && hasBrandLogo(brand) ? <BrandLogo name={brand} size={44} ink={theme.ink} accent={theme.accent} /> : null}
        <span style={{fontFamily: FRAUNCES, fontSize: 48, fontWeight: 700, color: tone === 'accent' ? theme.accent : theme.ink}}>{title}</span>
      </div>
      {items.map((it, i) => (
        <div key={i} style={{display: 'flex', alignItems: 'flex-start', gap: 12, fontFamily: INTER, fontSize: 32, fontWeight: 500, color: theme.inkSoft, lineHeight: 1.3}}>
          <span style={{color: tone === 'accent' ? theme.accent : rgba(theme.ink, 0.4), fontSize: 30, lineHeight: 1.3}}>{tone === 'accent' ? '✓' : '–'}</span>
          <span>{it}</span>
        </div>
      ))}
    </div>
  );
  return (
    <DataStage slide={slide} theme={theme} total={total}>
        <SceneHeader kicker={slide.kicker} headline={slide.headline} subtext={slide.subtext} theme={theme} total={total} frame={frame} accentWord={slide.accentWord} effect={effect} size={56} />
        <div style={{marginTop: 50, display: 'flex', alignItems: 'flex-start', gap: 48, position: 'relative'}}>
          <Col title={d.leftTitle} items={d.leftItems} brand={d.leftBrand} io={leftIo} tone="muted" />
          <div style={{width: 2, alignSelf: 'stretch', background: rgba(theme.ink, 0.14), transformOrigin: 'top', transform: `scaleY(${dividerH})`}} />
          <Col title={d.rightTitle} items={d.rightItems} brand={d.rightBrand} io={rightIo} tone="accent" />
        </div>
    </DataStage>
  );
};

// ── BAR GRAPH ── animated horizontal bars that grow with expoOut, value count-up.
const BarGraphScene: React.FC<{slide: BarGraphSlide; theme: Theme; effect: TextEffect}> = ({slide, theme, effect}) => {
  const frame = useCurrentFrame();
  const total = slide.durationInFrames;
  const bars = slide.data.bars || [];
  const max = Math.max(1, ...bars.map((b) => b.value));
  return (
    <DataStage slide={slide} theme={theme} total={total}>
        <SceneHeader kicker={slide.kicker} headline={slide.data.title || slide.headline} subtext={slide.subtext} theme={theme} total={total} frame={frame} accentWord={slide.accentWord} effect={effect} size={58} />
        <div style={{marginTop: 48, display: 'flex', flexDirection: 'column', gap: 28}}>
          {bars.map((b, i) => {
            const delay = 22 + i * 9;
            const io = inOut(frame, total, {inDelay: delay, inDur: 14, outDur: 12, distance: 30, dir: 'left', blurAmt: 4});
            const grow = ease(frame, [delay + 4, delay + 28], [0, 1]);
            const w = (b.value / max) * grow;
            const shown = Math.round(b.value * grow);
            const isTop = b.value === max;
            return (
              <div key={i} style={inOutStyle(io)}>
                <div style={{display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10}}>
                  {b.brand && hasBrandLogo(b.brand) ? <BrandLogo name={b.brand} size={36} ink={theme.ink} accent={theme.accent} /> : null}
                  <span style={{fontFamily: INTER, fontSize: 32, fontWeight: 600, color: theme.ink}}>{b.label}</span>
                  <span style={{marginLeft: 'auto', fontFamily: FRAUNCES, fontSize: 40, fontWeight: 800, color: isTop ? theme.accent : theme.inkSoft}}>
                    {shown}{slide.data.unit || ''}
                  </span>
                </div>
                <div style={{height: 26, borderRadius: 13, background: rgba(theme.ink, 0.08), overflow: 'hidden'}}>
                  <div style={{width: `${w * 100}%`, height: '100%', borderRadius: 13, background: isTop ? theme.accent : rgba(theme.accent, 0.55)}} />
                </div>
              </div>
            );
          })}
        </div>
    </DataStage>
  );
};

// ── PIE / DONUT ── animated sweep with a legend; slices in accent tints.
const PieChartScene: React.FC<{slide: PieChartSlide; theme: Theme; effect: TextEffect}> = ({slide, theme, effect}) => {
  const frame = useCurrentFrame();
  const total = slide.durationInFrames;
  const slices = slide.data.slices || [];
  const sum = Math.max(1, slices.reduce((s, x) => s + x.value, 0));
  const sweep = ease(frame, [22, 56], [0, 1]);
  const R = 230, CX = 270, CY = 270, RING = 70;
  const tints = [theme.accent, shade(theme.accent, 0.28), shade(theme.accent, 0.5), rgba(theme.ink, 0.3)];
  let acc = 0;
  const arcs = slices.map((s, i) => {
    const frac = s.value / sum;
    const start = acc * 2 * Math.PI;
    const end = (acc + frac) * 2 * Math.PI * sweep + (acc * 2 * Math.PI) * (1 - sweep);
    acc += frac;
    const a0 = start - Math.PI / 2;
    const a1 = (acc * 2 * Math.PI * sweep + start * (1 - sweep)) - Math.PI / 2;
    const large = (a1 - a0) > Math.PI ? 1 : 0;
    const x0 = CX + R * Math.cos(a0), y0 = CY + R * Math.sin(a0);
    const x1 = CX + R * Math.cos(a1), y1 = CY + R * Math.sin(a1);
    return {d: `M ${x0} ${y0} A ${R} ${R} 0 ${large} 1 ${x1} ${y1}`, color: tints[i % tints.length], pct: Math.round(frac * 100), label: s.label, brand: s.brand};
  });
  const pieIo = inOut(frame, total, {inDelay: 16, inDur: 18, outDur: 12, distance: 30, dir: 'left', blurAmt: 5});
  return (
    <DataStage slide={slide} theme={theme} total={total}>
        <SceneHeader kicker={slide.kicker} headline={slide.data.title || slide.headline} subtext={slide.subtext} theme={theme} total={total} frame={frame} accentWord={slide.accentWord} effect={effect} size={56} />
        <div style={{marginTop: 36, display: 'flex', alignItems: 'center', gap: 36, ...inOutStyle(pieIo)}}>
          <svg width="540" height="540" viewBox="0 0 540 540" style={{flex: 'none'}}>
            {arcs.map((a, i) => (
              <path key={i} d={a.d} fill="none" stroke={a.color} strokeWidth={RING} strokeLinecap="butt" />
            ))}
          </svg>
          <div style={{display: 'flex', flexDirection: 'column', gap: 20}}>
            {arcs.map((a, i) => {
              const lio = inOut(frame, total, {inDelay: 30 + i * 7, inDur: 14, outDur: 10, distance: 24, dir: 'right', blurAmt: 4});
              return (
                <div key={i} style={inOutStyle(lio, {display: 'flex', alignItems: 'center', gap: 14})}>
                  <div style={{width: 26, height: 26, borderRadius: 7, background: a.color, flex: 'none'}} />
                  {a.brand && hasBrandLogo(a.brand) ? <BrandLogo name={a.brand} size={34} ink={theme.ink} accent={theme.accent} /> : null}
                  <span style={{fontFamily: INTER, fontSize: 32, fontWeight: 600, color: theme.ink}}>{a.label}</span>
                  <span style={{fontFamily: FRAUNCES, fontSize: 36, fontWeight: 800, color: theme.accent}}>{a.pct}%</span>
                </div>
              );
            })}
          </div>
        </div>
    </DataStage>
  );
};

// ── PROGRESS GRAPH ── a line/area trend that draws on, with point dots + labels.
const ProgressGraphScene: React.FC<{slide: ProgressGraphSlide; theme: Theme; effect: TextEffect}> = ({slide, theme, effect}) => {
  const frame = useCurrentFrame();
  const total = slide.durationInFrames;
  const pts = slide.data.points || [];
  const max = Math.max(1, ...pts.map((p) => p.value));
  const min = Math.min(0, ...pts.map((p) => p.value));
  const GW = 900, GH = 440, PAD = 40;
  const xy = pts.map((p, i) => {
    const x = PAD + (i / Math.max(1, pts.length - 1)) * (GW - PAD * 2);
    const y = GH - PAD - ((p.value - min) / Math.max(1, max - min)) * (GH - PAD * 2);
    return {x, y, ...p};
  });
  const draw = ease(frame, [24, 64], [0, 1]);
  // Build the polyline path, revealed by stroke-dashoffset.
  const pathD = xy.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const areaD = `${pathD} L ${xy[xy.length - 1]?.x ?? PAD} ${GH - PAD} L ${PAD} ${GH - PAD} Z`;
  const len = 1600;
  const gio = inOut(frame, total, {inDelay: 16, inDur: 18, outDur: 12, distance: 30, dir: 'up', blurAmt: 5});
  return (
    <DataStage slide={slide} theme={theme} total={total}>
        <SceneHeader kicker={slide.kicker} headline={slide.data.title || slide.headline} subtext={slide.subtext} theme={theme} total={total} frame={frame} accentWord={slide.accentWord} effect={effect} size={58} />
        <div style={{marginTop: 44, ...inOutStyle(gio)}}>
          <svg width={GW} height={GH} viewBox={`0 0 ${GW} ${GH}`} style={{maxWidth: '100%'}}>
            <defs>
              <linearGradient id="area" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={rgba(theme.accent, 0.28)} />
                <stop offset="100%" stopColor={rgba(theme.accent, 0)} />
              </linearGradient>
            </defs>
            {/* baseline */}
            <line x1={PAD} y1={GH - PAD} x2={GW - PAD} y2={GH - PAD} stroke={rgba(theme.ink, 0.12)} strokeWidth="2" />
            <path d={areaD} fill="url(#area)" opacity={draw} />
            <path d={pathD} fill="none" stroke={theme.accent} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round"
              strokeDasharray={len} strokeDashoffset={len - draw * len} />
            {xy.map((p, i) => {
              const dotIn = ease(frame, [24 + (i / Math.max(1, xy.length)) * 36, 24 + (i / Math.max(1, xy.length)) * 36 + 8], [0, 1], OVERSHOOT);
              return (
                <g key={i}>
                  <circle cx={p.x} cy={p.y} r={10 * dotIn} fill={theme.paper} stroke={theme.accent} strokeWidth="4" />
                  <text x={p.x} y={GH - 8} textAnchor="middle" fontFamily={INTER} fontSize="22" fill={theme.inkSoft} opacity={dotIn}>{p.label}</text>
                </g>
              );
            })}
          </svg>
        </div>
    </DataStage>
  );
};

// ── MOTION GRAPHIC ── an AI-directed flow diagram: nodes connected by animated
// arrows. flow = linear (left→right), cycle (ring), or hub (center + spokes).
const MotionGraphicScene: React.FC<{slide: MotionGraphicSlide; theme: Theme; effect: TextEffect}> = ({slide, theme, effect}) => {
  const frame = useCurrentFrame();
  const total = slide.durationInFrames;
  const nodes = slide.data.nodes || [];
  const flow = slide.data.flow || 'linear';
  const CW = 920, CH = 620;

  // Compute node positions per flow type.
  const positions = nodes.map((_, i) => {
    if (flow === 'cycle') {
      const a = (i / nodes.length) * 2 * Math.PI - Math.PI / 2;
      return {x: CW / 2 + Math.cos(a) * 240, y: CH / 2 + Math.sin(a) * 220};
    }
    if (flow === 'hub') {
      if (i === 0) return {x: CW / 2, y: CH / 2};
      const a = ((i - 1) / Math.max(1, nodes.length - 1)) * 2 * Math.PI - Math.PI / 2;
      return {x: CW / 2 + Math.cos(a) * 280, y: CH / 2 + Math.sin(a) * 230};
    }
    // linear: lay out in a centered row (wrap to 2 rows if >3)
    const perRow = nodes.length > 3 ? Math.ceil(nodes.length / 2) : nodes.length;
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    const rowCount = nodes.length > 3 ? 2 : 1;
    return {
      x: (CW / (perRow + 1)) * (col + 1),
      y: rowCount === 1 ? CH / 2 : (CH / 3) * (row + 1),
    };
  });

  // Edges: linear/cycle connect sequential; hub connects center→spokes.
  const edges: Array<[number, number]> = [];
  if (flow === 'hub') {
    for (let i = 1; i < nodes.length; i += 1) edges.push([0, i]);
  } else {
    for (let i = 0; i < nodes.length - 1; i += 1) edges.push([i, i + 1]);
    if (flow === 'cycle' && nodes.length > 2) edges.push([nodes.length - 1, 0]);
  }

  const gio = inOut(frame, total, {inDelay: 14, inDur: 18, outDur: 12, distance: 24, dir: 'up', blurAmt: 5});
  return (
    <DataStage slide={slide} theme={theme} total={total}>
        <SceneHeader kicker={slide.kicker} headline={slide.data.title || slide.headline} subtext={slide.subtext} theme={theme} total={total} frame={frame} accentWord={slide.accentWord} effect={effect} size={56} />
      <div style={{marginTop: 24, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
        <div style={{position: 'relative', width: CW, height: CH, transform: 'scale(0.82)', transformOrigin: 'top center', ...inOutStyle(gio)}}>
          <svg width={CW} height={CH} style={{position: 'absolute', inset: 0}}>
            <defs>
              <marker id="arrow" markerWidth="12" markerHeight="12" refX="8" refY="6" orient="auto">
                <path d="M0 0 L9 6 L0 12 Z" fill={theme.accent} />
              </marker>
            </defs>
            {edges.map(([a, b], i) => {
              const pa = positions[a], pb = positions[b];
              if (!pa || !pb) return null;
              const drawAt = 26 + i * 7;
              const p = ease(frame, [drawAt, drawAt + 16], [0, 1]);
              const x = pa.x + (pb.x - pa.x) * p;
              const y = pa.y + (pb.y - pa.y) * p;
              return <line key={i} x1={pa.x} y1={pa.y} x2={x} y2={y} stroke={theme.accent} strokeWidth="3" strokeDasharray="2 8" strokeLinecap="round" markerEnd={p > 0.92 ? 'url(#arrow)' : undefined} opacity={0.7} />;
            })}
          </svg>
          {nodes.map((n, i) => {
            const pos = positions[i];
            const delay = 22 + i * 8;
            const nio = inOut(frame, total, {inDelay: delay, inDur: 14, outDur: 10, distance: 20, dir: 'up', blurAmt: 4});
            const isHub = flow === 'hub' && i === 0;
            return (
              <div
                key={i}
                style={inOutStyle(nio, {
                  position: 'absolute',
                  left: pos.x,
                  top: pos.y,
                  transform: `translate(-50%, -50%) translate3d(${nio.x}px, ${nio.y}px, 0) scale(${nio.scale})`,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 10,
                  padding: '22px 30px',
                  borderRadius: 18,
                  background: isHub ? theme.accent : theme.paper,
                  border: `2px solid ${isHub ? theme.accent : rgba(theme.ink, 0.16)}`,
                  boxShadow: `0 18px 44px ${rgba(theme.ink, 0.16)}`,
                  minWidth: 150,
                })}
              >
                {n.brand && hasBrandLogo(n.brand) ? <BrandLogo name={n.brand} size={52} ink={isHub ? theme.paper : theme.ink} accent={theme.accent} /> : null}
                <span style={{fontFamily: INTER, fontSize: 28, fontWeight: 700, color: isHub ? readableInk(theme.accent) : theme.ink, textAlign: 'center'}}>{n.label}</span>
              </div>
            );
          })}
        </div>
      </div>
    </DataStage>
  );
};

// ── GITHUB CARD ── editorial port of the GitHub repo card. The scraper finds the
// repo URL and fills `data` (owner/repo/desc/lang/stars/forks). Renders a single
// hero card — icon + owner/repo link + Public badge, clamped description, and a
// footer with the language dot, stars (count-up), and forks (count-up). All
// in/out animated; nothing is fetched at render time.
const GH_LANG_COLORS: Record<string, string> = {
  javascript: '#f1e05a', typescript: '#3178c6', python: '#3572A5', go: '#00ADD8',
  rust: '#dea584', java: '#b07219', 'c++': '#f34b7d', c: '#555555', 'c#': '#178600',
  ruby: '#701516', php: '#4F5D95', swift: '#F05138', kotlin: '#A97BFF', dart: '#00B4AB',
  shell: '#89e051', html: '#e34c26', css: '#563d7c', vue: '#41b883', svelte: '#ff3e00',
};

function parseStatNumber(value?: string | number): {target: number; suffix: string; raw: string} {
  if (value == null) return {target: 0, suffix: '', raw: '0'};
  const raw = String(value).trim();
  const m = raw.match(/^([\d.]+)\s*([kKmM]?)/);
  if (!m) return {target: 0, suffix: '', raw};
  const n = parseFloat(m[1]) || 0;
  const suffix = m[2] || '';
  return {target: n, suffix, raw};
}

const GithubCardScene: React.FC<{slide: GithubCardSlide; theme: Theme; effect: TextEffect}> = ({slide, theme, effect}) => {
  const frame = useCurrentFrame();
  const total = slide.durationInFrames;
  const d = slide.data;
  const owner = d.owner || 'owner';
  const repo = d.repo || 'repository';
  const language = d.language || '';
  const langColor = d.languageColor || GH_LANG_COLORS[language.toLowerCase()] || theme.accent;
  const visibility = d.visibility || 'Public';

  // Card lifts in (rise + focus) and drifts out — same physical motion as frames.
  const cardIo = inOut(frame, total, {inDelay: 14, inDur: 20, outDur: 14, distance: 64, dir: 'up', blurAmt: 6});
  const floatY = Math.sin((frame + 14) / 42) * 6;

  // Count-up stars + forks for a kinetic beat.
  const stars = parseStatNumber(d.stars);
  const forks = parseStatNumber(d.forks);
  const countProg = ease(frame, [30, 58], [0, 1]);
  const fmtCount = (s: {target: number; suffix: string; raw: string}) => {
    if (!s.suffix && Number.isInteger(s.target)) return String(Math.round(s.target * countProg));
    // Keep the suffix (k/m) and animate the numeric part.
    const v = s.target * countProg;
    return `${s.suffix ? v.toFixed(1) : Math.round(v)}${s.suffix}`;
  };

  // GitHub repo glyph (book) + star + fork glyphs as inline SVG (from the card).
  const ICON = 'M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 1 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8ZM5 12.25a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 0 1.5h-2.5a.75.75 0 0 1-.75-.75Z';
  const STAR = 'M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.75.75 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.574a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Z';
  const FORK = 'M5 3.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm0 2.122a2.25 2.25 0 1 0-1.5 0v4.256a2.251 2.251 0 1 0 1.5 0V5.372Zm8-.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm0 2.122a2.25 2.25 0 1 0-1.5 0v4.256a2.251 2.251 0 1 0 1.5 0V7.244ZM11.5 1.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm7.25 0a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z';
  const muted = rgba(theme.ink, 0.55);
  const hairline = rgba(theme.ink, 0.12);

  return (
    <DataStage slide={slide} theme={theme} total={total}>
      <SceneHeader kicker={slide.kicker || 'ON GITHUB'} headline={slide.headline} subtext={slide.subtext} theme={theme} total={total} frame={frame} accentWord={slide.accentWord} effect={effect} size={56} />
      <div style={{marginTop: 56, display: 'flex', justifyContent: 'center'}}>
        <div
          style={{
            width: 820,
            padding: 44,
            borderRadius: 22,
            background: theme.paper2,
            border: `1px solid ${hairline}`,
            boxShadow: `0 36px 90px ${rgba(theme.ink, 0.25)}`,
            opacity: cardIo.opacity,
            transform: `translate3d(${cardIo.x}px, ${cardIo.y + floatY}px, 0) scale(${cardIo.scale})`,
            filter: cardIo.blur > 0.2 ? `blur(${cardIo.blur}px)` : undefined,
          }}
        >
          {/* Header: icon + owner/repo + visibility badge */}
          <div style={{display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20, flexWrap: 'wrap'}}>
            <svg width="34" height="34" viewBox="0 0 16 16" fill={muted}><path d={ICON} /></svg>
            <span style={{fontFamily: INTER, fontSize: 38, fontWeight: 700}}>
              <span style={{color: theme.inkSoft}}>{owner}</span>
              <span style={{color: muted, margin: '0 8px'}}>/</span>
              <span style={{color: theme.accent}}>{repo}</span>
            </span>
            <span style={{fontFamily: INTER, fontSize: 22, fontWeight: 600, color: muted, padding: '4px 16px', borderRadius: 999, border: `1px solid ${hairline}`, background: rgba(theme.ink, 0.05)}}>
              {visibility}
            </span>
          </div>

          {/* Description (≈2-line clamp) */}
          {d.description ? (
            <p style={{fontFamily: INTER, fontSize: 30, lineHeight: 1.4, color: theme.inkSoft, margin: '0 0 36px 0', maxWidth: 720, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden'}}>
              {d.description}
            </p>
          ) : <div style={{height: 16}} />}

          {/* Footer: language dot + stars + forks */}
          <div style={{display: 'flex', alignItems: 'center', gap: 44, fontFamily: INTER, fontSize: 28, fontWeight: 600, color: muted}}>
            {language ? (
              <div style={{display: 'flex', alignItems: 'center', gap: 12}}>
                <span style={{width: 20, height: 20, borderRadius: '50%', background: langColor, display: 'inline-block'}} />
                <span>{language}</span>
              </div>
            ) : null}
            <div style={{display: 'flex', alignItems: 'center', gap: 10}}>
              <svg width="26" height="26" viewBox="0 0 16 16" fill={muted}><path d={STAR} /></svg>
              <span style={{color: theme.ink, fontVariantNumeric: 'tabular-nums'}}>{fmtCount(stars)}</span>
            </div>
            <div style={{display: 'flex', alignItems: 'center', gap: 10}}>
              <svg width="26" height="26" viewBox="0 0 16 16" fill={muted}><path d={FORK} /></svg>
              <span style={{color: theme.ink, fontVariantNumeric: 'tabular-nums'}}>{fmtCount(forks)}</span>
            </div>
          </div>
        </div>
      </div>
    </DataStage>
  );
};

// Slide dispatcher.
const SlideRenderer: React.FC<{slide: Slide; theme: Theme; effect: TextEffect}> = ({slide, theme, effect}) => {
  switch (slide.type) {
    case 'hook': return <HookScene slide={slide} theme={theme} effect={effect} />;
    case 'stat': return <StatScene slide={slide} theme={theme} effect={effect} />;
    case 'statement': return <StatementScene slide={slide} theme={theme} effect={effect} />;
    case 'proof': return <ProofScene slide={slide} theme={theme} effect={effect} />;
    case 'cta': return <CtaScene slide={slide} theme={theme} effect={effect} />;
    case 'checklist': return <ChecklistScene slide={slide} theme={theme} effect={effect} />;
    case 'comparison': return <ComparisonScene slide={slide} theme={theme} effect={effect} />;
    case 'bar-graph': return <BarGraphScene slide={slide} theme={theme} effect={effect} />;
    case 'pie-chart': return <PieChartScene slide={slide} theme={theme} effect={effect} />;
    case 'progress-graph': return <ProgressGraphScene slide={slide} theme={theme} effect={effect} />;
    case 'motion-graphic': return <MotionGraphicScene slide={slide} theme={theme} effect={effect} />;
    case 'github-card': return <GithubCardScene slide={slide} theme={theme} effect={effect} />;
    default: return <StatementScene slide={slide as StatementSlide} theme={theme} effect={effect} />;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// CAPTION TRACK — whisper-aligned word-level captions. Renders the active line
// in the lower safe band (clear of IG UI + our progress rail), with the current
// word highlighted in the accent. Each line fades in/out so nothing pops.
// ─────────────────────────────────────────────────────────────────────────────
type CaptionLine = {text: string; start: number; end: number; words?: Array<{text: string; start: number; end: number}>};

const CaptionTrack: React.FC<{theme: Theme; captions: CaptionLine[]}> = ({theme, captions}) => {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  if (!captions?.length) return null;
  // Find the active line (small lookahead so it appears just before the word).
  const active = captions.find((c) => t >= c.start - 0.05 && t <= c.end + 0.18);
  if (!active) return null;

  // Per-line fade in/out (in seconds, mapped to opacity).
  const fadeIn = ease(t, [active.start - 0.05, active.start + 0.12], [0, 1]);
  const fadeOut = ease(t, [active.end - 0.05, active.end + 0.18], [1, 0]);
  const opacity = Math.min(fadeIn, fadeOut);
  const lift = (1 - fadeIn) * 12;

  const wordList = active.words && active.words.length ? active.words : null;
  return (
    <div
      style={{
        position: 'absolute',
        left: SAFE.side,
        right: SAFE.side,
        // Sit in the lower third, above the progress rail and IG action column.
        bottom: 250,
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'center',
        gap: '6px 12px',
        opacity,
        transform: `translateY(${lift}px)`,
        pointerEvents: 'none',
      }}
    >
      {(wordList || [{text: active.text, start: active.start, end: active.end}]).map((w, i) => {
        const isCurrent = wordList ? t >= w.start - 0.02 && t <= w.end + 0.08 : false;
        return (
          <span
            key={i}
            style={{
              fontFamily: INTER,
              fontSize: 40,
              fontWeight: 700,
              lineHeight: 1.15,
              color: isCurrent ? theme.accent : theme.ink,
              letterSpacing: '-0.01em',
              textShadow: `0 2px 18px ${rgba(theme.paper, 0.9)}, 0 1px 3px ${rgba(theme.paper, 0.8)}`,
              transform: isCurrent ? 'scale(1.06)' : 'scale(1)',
              transition: 'none',
            }}
          >
            {w.text}
          </span>
        );
      })}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// ROOT — visuals via TransitionSeries with PER-BOUNDARY transition styles; audio
// rendered in a separate timeline layer so we can do real J-cuts (audio leads the
// visual) and L-cuts (audio trails). A persistent progress rail + brand watermark
// overlay the whole reel.
// ─────────────────────────────────────────────────────────────────────────────
const TRANSITION_FRAMES = 12; // ~0.4s — the visual overlap window between scenes

// Map a transition style id → a Remotion transition presentation. Return type is
// `any` because the per-style presentations have incompatible prop generics that
// don't unify, but all are valid TransitionPresentation at runtime.
function presentationFor(style?: string): any {
  switch (style) {
    case 'slide-left': return slide({direction: 'from-right'});
    case 'slide-up': return slide({direction: 'from-bottom'});
    case 'wipe': return wipe({direction: 'from-left'});
    case 'clock-wipe': return clockWipe({width: W, height: H});
    case 'fade':
    default: return fade();
  }
}

export const ReelSkill: React.FC<ReelSkillProps> = (props) => {
  const theme = resolveTheme(props);
  const effect: TextEffect = (['word-stagger', 'line-fade', 'scale-pop', 'blur-reveal'] as const).includes(props.textEffect as TextEffect)
    ? (props.textEffect as TextEffect)
    : 'word-stagger';
  const slides = (props.slides || []).filter(Boolean);
  const hasPerSceneAudio = slides.some((s) => s.audioFile);

  // Compute each scene's visual START frame on the master timeline. With
  // TransitionSeries, scenes OVERLAP by TRANSITION_FRAMES, so scene k starts at
  // Σ(prev durations) − k*TRANSITION_FRAMES.
  const starts: number[] = [];
  let cursor = 0;
  slides.forEach((s, i) => {
    starts[i] = cursor;
    cursor += Math.max(40, s.durationInFrames || 96) - (i < slides.length - 1 ? TRANSITION_FRAMES : 0);
  });

  return (
    <AbsoluteFill style={{background: theme.paper, fontFamily: FRAUNCES}}>
      {/* ── AUDIO LAYER (J/L cuts) ───────────────────────────────────────────
          Each scene's VO is placed at its visual start, but shifted earlier by
          audioLeadFrames for a J-cut (audio enters under the previous scene).
          L-cuts emerge naturally: a scene's audio that's longer than its trimmed
          visual keeps playing as the next visual has already begun. */}
      {hasPerSceneAudio
        ? slides.map((s, i) =>
            s.audioFile ? (
              <Sequence key={`a-${i}`} from={Math.max(0, starts[i] - (s.audioLeadFrames || 0))}>
                <Audio src={srcOf(s.audioFile)} />
              </Sequence>
            ) : null,
          )
        : props.voiceoverAudioFile
        ? <Audio src={srcOf(props.voiceoverAudioFile)} />
        : null}

      {/* ── VISUAL LAYER ─────────────────────────────────────────────────── */}
      <TransitionSeries>
        {slides.flatMap((slide, index) => {
          const dur = Math.max(40, slide.durationInFrames || 96);
          const sceneEl = (
            <TransitionSeries.Sequence key={`s-${index}`} durationInFrames={dur}>
              <SlideRenderer slide={slide} theme={theme} effect={effect} />
            </TransitionSeries.Sequence>
          );
          if (index === slides.length - 1) return [sceneEl];
          // The transition INTO the NEXT slide uses that slide's transitionIn style.
          const nextStyle = slides[index + 1]?.transitionIn;
          return [
            sceneEl,
            <TransitionSeries.Transition
              key={`t-${index}`}
              presentation={presentationFor(nextStyle)}
              timing={linearTiming({durationInFrames: TRANSITION_FRAMES})}
            />,
          ];
        })}
      </TransitionSeries>

      <LogoWatermark theme={theme} brands={props.brandLogos?.map((b) => b.name) || []} />
      {props.captions?.length ? <CaptionTrack theme={theme} captions={props.captions} /> : null}
      <ProgressRailOverlay theme={theme} slides={slides} />
    </AbsoluteFill>
  );
};

// Small persistent brand watermark in the top-right — keeps the sponsor/brand
// present across the whole reel (per the Huashu "brand must be recognizable" rule).
const LogoWatermark: React.FC<{theme: Theme; brands: string[]}> = ({theme, brands}) => {
  const frame = useCurrentFrame();
  const {durationInFrames} = useVideoConfig();
  const brand = (brands || []).find((b) => hasBrandLogo(b));
  if (!brand) return null;
  const io = inOut(frame, durationInFrames, {inDelay: 12, inDur: 16, outDur: 14, distance: 10, dir: 'up', blurAmt: 0});
  return (
    <div style={{position: 'absolute', top: 70, right: 64, opacity: io.opacity * 0.9, display: 'flex', alignItems: 'center', gap: 10}}>
      <BrandLogo name={brand} size={44} ink={theme.ink} accent={theme.accent} />
    </div>
  );
};

// Progress rail driven by the GLOBAL frame across the whole reel (not per scene).
const ProgressRailOverlay: React.FC<{theme: Theme; slides: Slide[]}> = ({theme, slides}) => {
  const frame = useCurrentFrame();
  const {durationInFrames} = useVideoConfig();
  const progress = Math.max(0, Math.min(1, frame / Math.max(1, durationInFrames)));
  const io = inOut(frame, durationInFrames, {inDelay: 6, inDur: 16, outDur: 14, distance: 8, dir: 'down', blurAmt: 0});
  return (
    <div style={{position: 'absolute', left: 70, right: 70, bottom: 64, height: 4, borderRadius: 4, background: rgba(theme.ink, 0.1), opacity: io.opacity}}>
      <div style={{width: `${progress * 100}%`, height: '100%', borderRadius: 4, background: theme.accent, transition: 'none'}} />
      {/* segment ticks so it reads as "slides" */}
      {slides.map((_, i) => (
        <div key={i} style={{position: 'absolute', top: -2, left: `${(i / slides.length) * 100}%`, width: 2, height: 8, background: rgba(theme.paper, 0.8)}} />
      ))}
    </div>
  );
};

export default ReelSkill;
