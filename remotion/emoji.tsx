import React from 'react';
import {staticFile, useCurrentFrame} from 'remotion';
import {AnimatedEmoji, type CalculateEmojiSrc, type EmojiName} from '@remotion/animated-emoji';
import {inOut} from './motion';

// ─────────────────────────────────────────────────────────────────────────────
// ANIMATED EMOJI — Google Noto animated emoji via @remotion/animated-emoji, used
// to beautify hook / CTA / proof slides. Assets are self-hosted in public/emoji
// (run scripts/fetch-emoji.sh once). We point calculateSrc at that subfolder so
// it coexists with the rest of the run's public assets.
// ─────────────────────────────────────────────────────────────────────────────

// The curated set we ship in public/emoji. Keep in sync with scripts/fetch-emoji.sh.
export const SHIPPED_EMOJI: EmojiName[] = [
  'fire', 'star-struck', 'rocket', 'party-popper', 'light-bulb', 'thumbs-up',
  '100', 'sparkles', 'eyes', 'mind-blown', 'clap', 'folded-hands',
  'money-face', 'glowing-star', 'check-mark', 'sunglasses-face',
];

export function hasEmoji(name?: string): name is EmojiName {
  return Boolean(name) && (SHIPPED_EMOJI as string[]).includes(name as string);
}

// Resolve assets from public/emoji/<name>-<scale>x.<ext>.
const calcSrc: CalculateEmojiSrc = ({emoji, scale, format}) => {
  const extension = format === 'hevc' ? 'mp4' : 'webm';
  return staticFile(`emoji/${emoji}-${scale}x.${extension}`);
};

// A scene-aware emoji that fades + scales IN and OUT alongside the slide so it
// never pops or cuts (matches the "every element has in/out" rule).
export const SceneEmoji: React.FC<{
  emoji: EmojiName;
  total: number;
  size?: number;
  delay?: number;
  scale?: '0.5' | '1' | '2';
  style?: React.CSSProperties;
}> = ({emoji, total, size = 120, delay = 4, scale = '1', style}) => {
  const frame = useCurrentFrame();
  const io = inOut(frame, total, {inDelay: delay, inDur: 16, outDur: 14, distance: 22, dir: 'up', blurAmt: 4});
  return (
    <div
      style={{
        width: size,
        height: size,
        opacity: io.opacity,
        transform: `translate3d(${io.x}px, ${io.y}px, 0) scale(${io.scale})`,
        ...style,
      }}
    >
      <AnimatedEmoji emoji={emoji} scale={scale} calculateSrc={calcSrc} style={{width: size, height: size}} />
    </div>
  );
};
