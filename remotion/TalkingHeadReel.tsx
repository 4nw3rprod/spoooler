// remotion/TalkingHeadReel.tsx
// Footage-mode composition (spec: "Remotion composition: TalkingHeadReel").
// Base video = cut-list segments of the user's normalized master, played
// back-to-back as jump cuts. Per-beat layers: overlays, B-roll, captions,
// viewfinder, punch-in zoom.
import React from 'react';
import {AbsoluteFill, Img, OffthreadVideo, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {BottomFade, ViewfinderFrame, CinemaVignette, useBeatTransition} from './effects';
import {KineticCaption, type CaptionData} from './KineticCaption';
import {TweetCard, QuoteCard, NotificationStack, BeforeAfter, PhoneMockup, MythFact, TimelineCard, ReceiptCard} from './overlay-cards';
import {StatCard, BarGraphCard, PieChartCard, ProgressGraphCard, ChecklistCard, ComparisonCard, MotionGraphicCard, GithubCard} from './data-cards';

type Cut = {start: number; end: number};
type Beat = {
  fromCut: number; toCut: number;
  treatment: 'talking-head' | 'overlay' | 'broll' | 'frame-overlay' | 'split' | 'two-shot';
  layout?: 'split' | 'pip';
  archetype?: string;
  layoutData?: Record<string, unknown>;
  mediaRef?: string;          // broll / frame-overlay media (public-relative)
  mediaKind?: 'image' | 'video';
  zoom?: boolean;
  speaker?: string;           // dual-speaker: which speaker id to crop to (matches props.speakers[].id)
  caption?: CaptionData & {words: Array<{text: string; scale: 's' | 'm' | 'hero'; accent?: boolean; startSec: number}>};
  outputStartSec: number;
  outputEndSec: number;
};

export type TalkingHeadReelProps = {
  sourceVideo: string;        // public-relative master.mp4
  cuts: Cut[];
  beats: Beat[];
  accentColor: string;
  inkColor: string;
  paperColor: string;
  viewfinder: boolean;
  vignette?: boolean;         // curved dark top/bottom vignette (default on)
  masterWidth?: number;       // wide master width (px) for dual-speaker cropping
  masterHeight?: number;
  speakers?: Array<{id: string; cx: number; cy?: number}>; // normalized horizontal/vertical centres (0-1)
  totalDurationInFrames: number;
};

const FPS = 30;
const toFrames = (sec: number) => Math.round(sec * FPS);

// Single source of truth for cut→frame accumulation. Every cut's duration is
// rounded to whole frames, and the cumulative offset at each cut's START is
// derived from that same per-cut rounding. BaseTrack, BeatLayers and the
// composition's calculateMetadata all consume this so the base footage, the
// per-beat overlays/captions and the total length cannot drift apart.
function cutFrameTable(cuts: Cut[]): {starts: number[]; total: number} {
  const starts: number[] = [];
  let acc = 0;
  for (const c of cuts) {
    starts.push(acc);
    acc += toFrames(c.end - c.start);
  }
  return {starts, total: acc};
}

const OVERLAY_COMPONENTS: Record<string, React.FC<{data: never; theme: {accent: string; ink: string; paper: string}}>> = {
  'tweet-card': TweetCard as never,
  'quote-card': QuoteCard as never,
  'notification-stack': NotificationStack as never,
  'before-after': BeforeAfter as never,
  'phone-mockup': PhoneMockup as never,
  'myth-fact': MythFact as never,
  timeline: TimelineCard as never,
  receipt: ReceiptCard as never,
  stat: StatCard as never,
  'bar-graph': BarGraphCard as never,
  'pie-chart': PieChartCard as never,
  'progress-graph': ProgressGraphCard as never,
  checklist: ChecklistCard as never,
  comparison: ComparisonCard as never,
  'motion-graphic': MotionGraphicCard as never,
  'github-card': GithubCard as never,
};

// The base video track: one Sequence per cut, trimmed from the source.
const BaseTrack: React.FC<{props: TalkingHeadReelProps}> = ({props}) => {
  const {starts} = cutFrameTable(props.cuts);
  return (
    <>
      {props.cuts.map((cut, i) => {
        const durFrames = toFrames(cut.end - cut.start);
        const from = starts[i];
        const beat = props.beats.find((b) => i >= b.fromCut && i <= b.toCut);
        return (
          <Sequence key={i} from={from} durationInFrames={durFrames}>
            <BeatVideo cut={cut} beat={beat} props={props} />
          </Sequence>
        );
      })}
    </>
  );
};

// Styles the footage per the owning beat's treatment. The video element always
// renders (it carries the speech audio); B-roll layers cover it visually.
const BeatVideo: React.FC<{cut: Cut; beat?: Beat; props: TalkingHeadReelProps}> = ({cut, beat, props}) => {
  const frame = useCurrentFrame();
  const {durationInFrames} = useVideoConfig();
  const treatment = beat?.treatment || 'talking-head';

  const mw = props.masterWidth || 1080;
  const isWide = mw > 1200 && (props.speakers?.length || 0) > 0;
  const spk = beat?.speaker ? props.speakers?.find((s) => s.id === beat.speaker) : undefined;

  const rawVideo = (style: React.CSSProperties) => (
    <OffthreadVideo
      src={staticFile(props.sourceVideo)}
      startFrom={toFrames(cut.start)}
      endAt={toFrames(cut.end)}
      style={style}
    />
  );

  // A 1080×h window cropped to the active speaker with Ken Burns effect zoom/pan.
  const speakerWindow = (h: number, offsetY = 0) => {
    // 1. Determine speaker center cx (default 0.5 if not specified)
    const cx = spk ? spk.cx : 0.5;

    // 2. Determine scale factor for Ken Burns zoom
    // Landscape/wide master needs subtle zoom; Portrait master needs heavy zoom to crop out the other speaker.
    const baseScaleStart = isWide ? 1.05 : 2.4;
    const baseScaleEnd = isWide ? 1.15 : 2.7;
    const kScale = interpolate(
      frame,
      [0, durationInFrames],
      [baseScaleStart, baseScaleEnd],
      {extrapolateRight: 'clamp'}
    );

    // 3. Compute target translation tx, ty (transformOrigin: top-left)
    const tx = 540 - cx * mw * kScale;
    
    // Add a slight vertical pan for Ken Burns (pan up by 30px over the beat)
    const panY = interpolate(frame, [0, durationInFrames], [0, -30], {extrapolateRight: 'clamp'});
    
    // Align eyes vertically with the top third line of the viewport (rule of thirds).
    const cy = spk && typeof spk.cy === 'number' ? spk.cy : undefined;
    const targetYRatio = 0.33;
    const ty = cy !== undefined
      ? h * targetYRatio - cy * 1920 * kScale + panY
      : (h - 1920 * kScale) / 2 + offsetY + panY;

    // 4. Clamp translations to prevent black bars
    const minTx = 1080 - mw * kScale;
    const maxTx = 0;
    const clampedTx = Math.min(maxTx, Math.max(minTx, tx));

    const minTy = h - 1920 * kScale;
    const maxTy = 0;
    const clampedTy = Math.min(maxTy, Math.max(minTy, ty));

    return (
      <div style={{position: 'absolute', top: 0, left: 0, width: 1080, height: h, overflow: 'hidden'}}>
        {rawVideo({
          position: 'absolute',
          top: 0,
          left: 0,
          width: mw,
          height: 1920,
          transform: `translate(${clampedTx}px, ${clampedTy}px) scale(${kScale})`,
          transformOrigin: 'top left',
          maxWidth: 'none'
        })}
      </div>
    );
  };

  if (treatment === 'overlay') {
    // Cinematic bed: the speaker, blurred + darkened, sits behind the glass card
    // (one cheap filter:blur — NOT backdrop-filter). Falls back to dark if no frame.
    return (
      <AbsoluteFill style={{background: '#0c0c10'}}>
        <div style={{position: 'absolute', inset: 0, filter: 'blur(30px) brightness(0.5)', transform: 'scale(1.1)'}}>
          {speakerWindow(1920)}
        </div>
        <div style={{position: 'absolute', inset: 0, background: 'rgba(10,10,14,0.35)'}} />
      </AbsoluteFill>
    );
  }
  if (treatment === 'split') {
    // TOP half = archetype card over blurred speaker footage; BOTTOM half = sharp speaker.
    return (
      <AbsoluteFill>
        <div style={{position: 'absolute', top: 0, left: 0, width: 1080, height: 960, overflow: 'hidden'}}>
          <div style={{position: 'absolute', inset: 0, filter: 'blur(30px) brightness(0.55)', transform: 'scale(1.1)'}}>
            {speakerWindow(960)}
          </div>
          <div style={{position: 'absolute', inset: 0, background: 'rgba(12,12,16,0.2)'}} />
        </div>
        <div style={{position: 'absolute', top: 960, left: 0, width: 1080, height: 960, overflow: 'hidden'}}>
          {speakerWindow(960)}
        </div>
      </AbsoluteFill>
    );
  }
  if (treatment === 'two-shot') {
    // Both speakers: fit the full wide master to width, centred on a dark bed.
    if (isWide) {
      const h2 = Math.round((1920 * 1080) / mw);
      return (
        <AbsoluteFill style={{background: '#0b0b0d', alignItems: 'center', justifyContent: 'center'}}>
          {rawVideo({width: 1080, height: h2})}
        </AbsoluteFill>
      );
    }
    return <AbsoluteFill>{speakerWindow(1920)}</AbsoluteFill>;
  }
  // talking-head / frame-overlay / broll: full-frame footage (broll covers it).
  return (
    <AbsoluteFill>
      {speakerWindow(1920)}
    </AbsoluteFill>
  );
};

// Ken Burns component for B-roll layer
const BrollLayer: React.FC<{mediaRef: string; mediaKind: 'image' | 'video'}> = ({mediaRef, mediaKind}) => {
  const frame = useCurrentFrame();
  const {durationInFrames} = useVideoConfig();
  const brollScale = interpolate(
    frame,
    [0, durationInFrames],
    [1.05, 1.15],
    {extrapolateRight: 'clamp'}
  );
  const brollStyle: React.CSSProperties = {
    width: 1080,
    height: 1920,
    objectFit: 'cover',
    transform: `scale(${brollScale})`,
  };
  return (
    <div style={{width: 1080, height: 1920, overflow: 'hidden', position: 'relative'}}>
      {mediaKind === 'video' ? (
        <OffthreadVideo src={staticFile(mediaRef)} muted style={brollStyle} />
      ) : (
        <Img src={staticFile(mediaRef)} style={brollStyle} />
      )}
    </div>
  );
};

// One beat's overlay layers. Runs INSIDE the Sequence so useBeatTransition's
// hooks are valid. The card / B-roll / frame-overlay / split-card layers ride a
// per-beat transition envelope; captions (own entrance) and the viewfinder do
// not. The speaker base lives in BaseTrack and stays a hard cut.
const BeatLayer: React.FC<{
  beat: Beat;
  theme: {accent: string; ink: string; paper: string};
  accentColor: string;
  inkColor: string;
  viewfinder: boolean;
  beatStartSec: number;
}> = ({beat, theme, accentColor, inkColor, viewfinder, beatStartSec}) => {
  const tr = useBeatTransition();
  const Overlay = beat.archetype ? OVERLAY_COMPONENTS[beat.archetype] : null;
  const onFootage = beat.treatment === 'talking-head' || beat.treatment === 'broll'
    || beat.treatment === 'frame-overlay' || beat.treatment === 'two-shot' || beat.treatment === 'split';
  const animatedOverlay = (node: React.ReactNode) => (
    <div style={{position: 'absolute', inset: 0, opacity: tr.opacity, transform: `translateY(${tr.y}px) scale(${tr.scale})`, filter: tr.blur > 0.1 ? `blur(${tr.blur.toFixed(2)}px)` : undefined}}>{node}</div>
  );
  return (
    <>
      {beat.treatment === 'broll' && beat.mediaRef ? animatedOverlay(
        <BrollLayer mediaRef={beat.mediaRef} mediaKind={beat.mediaKind || 'image'} />
      ) : null}
      {beat.treatment === 'frame-overlay' && beat.mediaRef ? animatedOverlay(
        <div style={{position: 'absolute', left: 90, top: 270, width: 900, borderRadius: 28, overflow: 'hidden', boxShadow: '0 24px 70px rgba(0,0,0,0.45)', zIndex: 10}}>
          <Img src={staticFile(beat.mediaRef)} style={{width: '100%'}} />
        </div>
      ) : null}
      {beat.treatment === 'overlay' && Overlay ? animatedOverlay(
        <div style={{position: 'absolute', inset: 0}}>
          <Overlay data={beat.layoutData as never} theme={theme} />
        </div>
      ) : null}
      {beat.treatment === 'split' && Overlay ? animatedOverlay(
        // Card scaled into the TOP half (1080×960); speaker fills the bottom.
        // scale 0.7 makes the card large/legible; translateY = (960 - 1920*0.7)/2
        // re-centres the scaled 1920-tall block in the 960 half (card stays centred).
        <div style={{position: 'absolute', top: 0, left: 0, width: 1080, height: 960, overflow: 'hidden'}}>
          <div style={{position: 'absolute', top: 0, left: 0, width: 1080, height: 1920, transform: 'translateY(-192px) scale(0.7)', transformOrigin: 'top center'}}>
            <Overlay data={beat.layoutData as never} theme={theme} />
          </div>
        </div>
      ) : null}
      {beat.caption ? (
        <>
          {onFootage ? <BottomFade /> : null}
          <KineticCaption
            caption={beat.caption}
            accentColor={accentColor}
            inkColor={onFootage ? '#FFFFFF' : inkColor}
            beatStartSec={beatStartSec}
          />
        </>
      ) : null}
      {viewfinder && onFootage && beat.treatment !== 'broll' ? <ViewfinderFrame /> : null}
    </>
  );
};

// Per-beat layers above the base track: B-roll, archetype cards, frame
// overlays, captions, bottom fade, viewfinder.
const BeatLayers: React.FC<{props: TalkingHeadReelProps}> = ({props}) => {
  const theme = {accent: props.accentColor, ink: props.inkColor, paper: props.paperColor};
  const {starts} = cutFrameTable(props.cuts);
  return (
    <>
      {props.beats.map((beat, i) => {
        // Position beats from the SAME cut-frame table the base track uses, so
        // a beat's Sequence lines up frame-exactly with the cuts it tiles.
        const from = starts[beat.fromCut];
        const lastCut = props.cuts[beat.toCut];
        const end = starts[beat.toCut] + toFrames(lastCut.end - lastCut.start);
        const dur = Math.max(1, end - from);
        const beatStartSec = from / FPS;
        return (
          <Sequence key={i} from={from} durationInFrames={dur}>
            <BeatLayer
              beat={beat}
              theme={theme}
              accentColor={props.accentColor}
              inkColor={props.inkColor}
              viewfinder={props.viewfinder}
              beatStartSec={beatStartSec}
            />
          </Sequence>
        );
      })}
    </>
  );
};

export const TalkingHeadReel: React.FC<TalkingHeadReelProps> = (props) => (
  <AbsoluteFill style={{background: '#000'}}>
    <BaseTrack props={props} />
    <BeatLayers props={props} />
    {props.vignette !== false ? <CinemaVignette /> : null}
  </AbsoluteFill>
);
