// remotion/data-cards.tsx
// The 8 data/chart footage archetypes as glass cards (spec: All 16 Archetypes).
// Each uses GlassCard, Advercase/Chirp, accent, ONE UntitledUI icon, and a
// UntitledUI-vocabulary primitive. layoutData shapes mirror LAYOUT_VALIDATORS.
import React from 'react';
import {interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {GlassCard} from './effects';
import {DISPLAY, BODY} from './footage-fonts';
import {Badge, ProgressBar, AnimatedCheck, CountUp} from './ui-elements';
import {BarChart01, TrendUp01, Zap, CheckCircle, Star01, GitBranch01, Dataflow01, SwitchHorizontal01} from '@untitledui/icons';

type CardTheme = {accent: string; ink: string; paper: string};
const HEAD = `${DISPLAY}, sans-serif`;
const TEXT = `${BODY}, sans-serif`;
const INK = '#FFFFFF';
const INK_SOFT = 'rgba(255,255,255,0.72)';

const useEnter = (delayFrames = 0) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const t = spring({frame: frame - delayFrames, fps, config: {damping: 15, stiffness: 110}});
  return {opacity: interpolate(t, [0, 1], [0, 1]), y: interpolate(t, [0, 1], [40, 0]), t};
};

const Shell: React.FC<{theme: CardTheme; children: React.ReactNode; width?: number}> = ({theme, children, width = 900}) => {
  const {opacity, y} = useEnter();
  return (
    <div style={{position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
      <div style={{opacity, transform: `translateY(${y}px)`}}>
        <GlassCard width={width} style={{fontFamily: TEXT}}>{children}</GlassCard>
      </div>
    </div>
  );
};

const Kicker: React.FC<{icon: React.ReactNode; text?: string; accent: string}> = ({icon, text, accent}) => (
  text ? <div style={{display: 'flex', alignItems: 'center', gap: 14, marginBottom: 30}}>
    {icon}<span style={{fontFamily: HEAD, fontSize: 30, fontWeight: 700, letterSpacing: '0.1em', color: INK_SOFT, textTransform: 'uppercase'}}>{text}</span>
  </div> : <div style={{marginBottom: 24}}>{icon}</div>
);

// ── stat ──────────────────────────────────────────────────────────────────────
export const StatCard: React.FC<{data: {value: string; label: string; subtext?: string}; theme: CardTheme}> = ({data, theme}) => (
  <Shell theme={theme} width={840}>
    <Kicker icon={<Zap size={48} color={theme.accent} />} accent={theme.accent} />
    <CountUp value={data.value} style={{fontFamily: HEAD, fontSize: 200, fontWeight: 700, lineHeight: 0.9, color: theme.accent, display: 'block'}} />
    <div style={{fontFamily: HEAD, fontSize: 46, fontWeight: 700, color: INK, marginTop: 18}}>{data.label}</div>
    {data.subtext ? <div style={{fontSize: 32, color: INK_SOFT, marginTop: 10}}>{data.subtext}</div> : null}
  </Shell>
);

// ── checklist ─────────────────────────────────────────────────────────────────
export const ChecklistCard: React.FC<{data: {title?: string; items: Array<{text: string}>; checked?: boolean}; theme: CardTheme}> = ({data, theme}) => {
  const {fps} = useVideoConfig();
  return (
    <Shell theme={theme}>
      <Kicker icon={<CheckCircle size={40} color={theme.accent} />} text={data.title} accent={theme.accent} />
      <div style={{display: 'flex', flexDirection: 'column', gap: 24}}>
        {data.items.map((it, i) => (
          <div key={i} style={{display: 'flex', alignItems: 'center', gap: 22}}>
            <AnimatedCheck delayFrames={i * Math.round(fps * 0.25)} color={theme.accent} />
            <span style={{fontFamily: HEAD, fontSize: 42, fontWeight: 600, color: INK}}>{it.text}</span>
          </div>
        ))}
      </div>
    </Shell>
  );
};

// ── bar-graph ─────────────────────────────────────────────────────────────────
export const BarGraphCard: React.FC<{data: {title?: string; unit?: string; bars: Array<{label: string; value: number}>}; theme: CardTheme}> = ({data, theme}) => {
  const {fps} = useVideoConfig();
  const max = Math.max(...data.bars.map((b) => b.value), 1);
  return (
    <Shell theme={theme} width={940}>
      <Kicker icon={<BarChart01 size={40} color={theme.accent} />} text={data.title} accent={theme.accent} />
      <div style={{display: 'flex', flexDirection: 'column', gap: 26}}>
        {data.bars.map((b, i) => (
          <div key={i}>
            <div style={{display: 'flex', justifyContent: 'space-between', marginBottom: 8}}>
              <span style={{fontFamily: HEAD, fontSize: 34, fontWeight: 600, color: INK}}>{b.label}</span>
              <span style={{fontFamily: HEAD, fontSize: 34, fontWeight: 700, color: theme.accent}}>{b.value}{data.unit || ''}</span>
            </div>
            <ProgressBar pct={(b.value / max) * 100} color={theme.accent} delayFrames={i * Math.round(fps * 0.18)} height={30} />
          </div>
        ))}
      </div>
    </Shell>
  );
};

// ── pie-chart ─────────────────────────────────────────────────────────────────
export const PieChartCard: React.FC<{data: {title?: string; slices: Array<{label: string; value: number}>}; theme: CardTheme}> = ({data, theme}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const total = data.slices.reduce((s, x) => s + x.value, 0) || 1;
  const sweep = interpolate(frame, [6, 6 + fps * 0.7], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const palette = [theme.accent, '#7fd49a', '#e0b87f', '#9b9be0', '#e08a87'];
  let acc = 0;
  const stops = data.slices.map((s, i) => {
    const start = (acc / total) * 360; acc += s.value;
    const end = (acc / total) * 360;
    return `${palette[i % palette.length]} ${start}deg ${end}deg`;
  }).join(', ');
  return (
    <Shell theme={theme} width={900}>
      <Kicker icon={<BarChart01 size={40} color={theme.accent} />} text={data.title} accent={theme.accent} />
      <div style={{display: 'flex', alignItems: 'center', gap: 48}}>
        <div style={{width: 320, height: 320, borderRadius: '50%', background: `conic-gradient(${stops})`, transform: `rotate(${interpolate(sweep, [0, 1], [-90, 270])}deg)`, mask: 'radial-gradient(circle, transparent 38%, #000 39%)', WebkitMask: 'radial-gradient(circle, transparent 38%, #000 39%)', opacity: sweep}} />
        <div style={{display: 'flex', flexDirection: 'column', gap: 16}}>
          {data.slices.map((s, i) => (
            <div key={i} style={{display: 'flex', alignItems: 'center', gap: 14}}>
              <div style={{width: 22, height: 22, borderRadius: 6, background: palette[i % palette.length]}} />
              <span style={{fontFamily: HEAD, fontSize: 34, fontWeight: 600, color: INK}}>{s.label}</span>
              <Badge label={`${Math.round((s.value / total) * 100)}%`} accent={theme.accent} />
            </div>
          ))}
        </div>
      </div>
    </Shell>
  );
};

// ── progress-graph ────────────────────────────────────────────────────────────
export const ProgressGraphCard: React.FC<{data: {title?: string; unit?: string; points: Array<{label: string; value: number}>}; theme: CardTheme}> = ({data, theme}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const W = 760, H = 300, pad = 20;
  const max = Math.max(...data.points.map((p) => p.value), 1);
  const min = Math.min(...data.points.map((p) => p.value), 0);
  const xy = data.points.map((p, i) => {
    const x = pad + (i / (data.points.length - 1)) * (W - pad * 2);
    const y = H - pad - ((p.value - min) / (max - min || 1)) * (H - pad * 2);
    return [x, y] as const;
  });
  const path = xy.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const draw = interpolate(frame, [6, 6 + fps * 0.8], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const len = 2000;
  return (
    <Shell theme={theme} width={900}>
      <Kicker icon={<TrendUp01 size={40} color={theme.accent} />} text={data.title} accent={theme.accent} />
      <svg width={W} height={H} style={{overflow: 'visible'}}>
        <path d={path} fill="none" stroke={theme.accent} strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={len} strokeDashoffset={interpolate(draw, [0, 1], [len, 0])} />
        {xy.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={interpolate(spring({frame: frame - (10 + i * Math.round(fps * 0.12)), fps, config: {damping: 12}}), [0, 1], [0, 9])} fill={theme.accent} />
        ))}
      </svg>
      <div style={{display: 'flex', justifyContent: 'space-between', marginTop: 10}}>
        {data.points.map((p, i) => <span key={i} style={{fontSize: 26, color: INK_SOFT}}>{p.label}</span>)}
      </div>
    </Shell>
  );
};

// ── comparison ────────────────────────────────────────────────────────────────
export const ComparisonCard: React.FC<{data: {leftTitle: string; rightTitle: string; leftItems: string[]; rightItems: string[]}; theme: CardTheme}> = ({data, theme}) => {
  const col = (title: string, items: string[], positive: boolean) => (
    <div style={{flex: 1, display: 'flex', flexDirection: 'column', gap: 16}}>
      <div style={{fontFamily: HEAD, fontSize: 36, fontWeight: 700, color: positive ? '#7fd49a' : INK_SOFT, marginBottom: 8}}>{title}</div>
      {items.map((it, i) => (
        <div key={i} style={{display: 'flex', alignItems: 'center', gap: 12}}>
          <span style={{fontSize: 34, color: positive ? '#7fd49a' : '#e08a87'}}>{positive ? '✓' : '✗'}</span>
          <span style={{fontFamily: HEAD, fontSize: 32, fontWeight: 600, color: INK}}>{it}</span>
        </div>
      ))}
    </div>
  );
  return (
    <Shell theme={theme} width={980}>
      <Kicker icon={<SwitchHorizontal01 size={40} color={theme.accent} />} accent={theme.accent} />
      <div style={{display: 'flex', alignItems: 'flex-start', gap: 40}}>
        {col(data.leftTitle, data.leftItems, false)}
        <div style={{fontFamily: HEAD, fontSize: 40, fontWeight: 800, color: theme.accent, alignSelf: 'center'}}>VS</div>
        {col(data.rightTitle, data.rightItems, true)}
      </div>
    </Shell>
  );
};

// ── motion-graphic (node flow) ────────────────────────────────────────────────
export const MotionGraphicCard: React.FC<{data: {title?: string; nodes: Array<{label: string}>; flow?: 'linear' | 'cycle' | 'hub'}; theme: CardTheme}> = ({data, theme}) => {
  const {fps} = useVideoConfig();
  const frame = useCurrentFrame();
  const node = (label: string, i: number) => {
    const t = spring({frame: frame - i * Math.round(fps * 0.22), fps, config: {damping: 14}});
    return (
      <div key={i} style={{padding: '18px 30px', borderRadius: 18, background: `${theme.accent}1f`, border: `2px solid ${theme.accent}`, fontFamily: HEAD, fontSize: 32, fontWeight: 700, color: INK, opacity: interpolate(t, [0, 1], [0, 1]), transform: `scale(${interpolate(t, [0, 1], [0.8, 1])})`}}>{label}</div>
    );
  };
  const flow = data.flow || 'linear';
  return (
    <Shell theme={theme} width={960}>
      <Kicker icon={<Dataflow01 size={40} color={theme.accent} />} text={data.title} accent={theme.accent} />
      {flow === 'hub' ? (
        <div style={{display: 'flex', flexWrap: 'wrap', gap: 18, justifyContent: 'center'}}>{data.nodes.map((n, i) => node(n.label, i))}</div>
      ) : (
        <div style={{display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 14, justifyContent: 'center'}}>
          {data.nodes.map((n, i) => (
            <React.Fragment key={i}>
              {node(n.label, i)}
              {i < data.nodes.length - 1 ? <span style={{fontSize: 40, color: `${theme.accent}aa`}}>{flow === 'cycle' ? '↻' : '→'}</span> : null}
            </React.Fragment>
          ))}
        </div>
      )}
    </Shell>
  );
};

// ── github-card ───────────────────────────────────────────────────────────────
export const GithubCard: React.FC<{data: {owner: string; repo: string; description?: string; language?: string; stars?: string | number; forks?: string | number}; theme: CardTheme}> = ({data, theme}) => (
  <Shell theme={theme} width={900}>
    <div style={{display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20}}>
      <GitBranch01 size={44} color={INK} />
      <span style={{fontFamily: TEXT, fontSize: 34, color: INK_SOFT}}>{data.owner}/</span>
      <span style={{fontFamily: HEAD, fontSize: 44, fontWeight: 700, color: INK}}>{data.repo}</span>
    </div>
    {data.description ? <div style={{fontSize: 34, color: INK_SOFT, lineHeight: 1.3, marginBottom: 26}}>{data.description}</div> : null}
    <div style={{display: 'flex', alignItems: 'center', gap: 16}}>
      {data.language ? <div style={{display: 'flex', alignItems: 'center', gap: 10}}><div style={{width: 18, height: 18, borderRadius: '50%', background: theme.accent}} /><span style={{fontSize: 30, color: INK}}>{data.language}</span></div> : null}
      {data.stars != null ? <div style={{display: 'flex', alignItems: 'center', gap: 8, color: INK}}><Star01 size={30} color="#e0b87f" /><span style={{fontSize: 30}}>{data.stars}</span></div> : null}
      {data.forks != null ? <Badge label={`${data.forks} forks`} accent={theme.accent} /> : null}
    </div>
  </Shell>
);
