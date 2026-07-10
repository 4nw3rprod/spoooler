// remotion/KineticCaption.tsx
// Selective kinetic typography captions (spec: "Caption system").
// One short phrase per beat; hero keyword 2.5-3x larger in accent color;
// word-by-word eased entrance synced to startSec timestamps.
import React from 'react';
import {interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {DISPLAY, BODY} from './footage-fonts';

export type CaptionWord = {
  text: string;
  scale: 's' | 'm' | 'hero';
  accent?: boolean;
  startSec: number; // output-timeline seconds (resolved by footage/edl.mjs)
};

export type CaptionData = {
  words: CaptionWord[];
  entrance: 'rise' | 'slide-x' | 'blur-reveal';
  anchor: 'auto' | 'top' | 'center' | 'bottom';
};

const SIZES: Record<CaptionWord['scale'], number> = {s: 44, m: 64, hero: 148};

export const KineticCaption: React.FC<{
  caption: CaptionData;
  accentColor: string;
  inkColor?: string;          // white over footage; theme ink over archetype halves
  beatStartSec: number;       // output-timeline start of the owning beat
  anchorOverride?: 'top' | 'center' | 'bottom';
}> = ({caption, accentColor, inkColor = '#FFFFFF', beatStartSec, anchorOverride}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const anchor = anchorOverride || (caption.anchor === 'auto' ? 'bottom' : caption.anchor);
  const justify = anchor === 'top' ? 'flex-start' : anchor === 'center' ? 'center' : 'flex-end';

  return (
    <div style={{
      position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: justify,
      paddingBottom: anchor === 'bottom' ? 360 : 0, paddingTop: anchor === 'top' ? 280 : 0,
      pointerEvents: 'none',
    }}>
      <div style={{display: 'flex', flexDirection: 'column', alignItems: 'flex-start', maxWidth: 920}}>
        {caption.words.map((w, i) => {
          // Word entrance begins at its own resolved timestamp (relative frames).
          const startFrame = Math.max(0, Math.round((w.startSec - beatStartSec) * fps));
          const t = spring({frame: frame - startFrame, fps, config: {damping: 16, stiffness: 130}});
          const opacity = interpolate(t, [0, 1], [0, 1]);
          const isBlur = caption.entrance === 'blur-reveal' || !caption.entrance;
          const offset = interpolate(t, [0, 1], [caption.entrance === 'rise' ? 46 : isBlur ? 26 : 0, 0]);
          const offsetX = interpolate(t, [0, 1], [caption.entrance === 'slide-x' ? -56 : 0, 0]);
          const blurPx = isBlur ? interpolate(t, [0, 1], [14, 0]) : 0;
          let size = SIZES[w.scale] ?? SIZES.m;
          if (w.scale === 'hero' && w.text.length > 8) {
            size = Math.max(68, Math.round(148 * (8 / w.text.length)));
          }
          return (
            <span key={i} style={{
              // Consistent sans system: Advercase (bold display) for the hero
              // keyword, Chirp for supporting words. No serif fallbacks.
              fontFamily: w.scale === 'hero' ? `${DISPLAY}, sans-serif` : `${BODY}, sans-serif`,
              fontSize: size,
              lineHeight: w.scale === 'hero' ? 1.2 : 1.1,
              fontWeight: w.scale === 'hero' ? 700 : 600,
              color: w.accent ? accentColor : inkColor,
              opacity,
              transform: `translate(${offsetX}px, ${offset}px)`,
              filter: blurPx > 0.1 ? `blur(${blurPx.toFixed(2)}px)` : undefined,
              // Doubled drop shadow for pop (spec) — two stacked shadows.
              textShadow: '0 2px 6px rgba(0,0,0,0.45), 0 6px 22px rgba(0,0,0,0.35)',
              letterSpacing: w.scale === 'hero' ? '-0.02em' : '0',
              // Hero entries are single keywords (kept on one line); supporting
              // entries can be multi-word phrases ("super easy to make") and must
              // wrap within the column rather than overflow the 1080px frame.
              whiteSpace: w.scale === 'hero' ? 'nowrap' : 'normal',
              textWrap: 'balance',
            }}>
              {w.scale === 'hero' ? w.text.toUpperCase() : w.text}
            </span>
          );
        })}
      </div>
    </div>
  );
};
