import React from 'react';
import {Composition} from 'remotion';
import {ReelSkill, type ReelSkillProps} from './ReelSkill';
import {TalkingHeadReel, type TalkingHeadReelProps} from './TalkingHeadReel';

// Default props for Studio preview / when a run hasn't supplied props yet.
// These mirror the shape buildSimplifiedProps() emits (slides[] with kicker,
// archetype-specific fields, and durationInFrames that the generator derives
// from the per-scene voiceover audio).
const defaultProps: ReelSkillProps = {
  slides: [
    {
      type: 'hook',
      kicker: 'THE SHIFT',
      headline: 'Your phone is the remote',
      subtext: 'Run your whole build from your pocket while the work keeps moving.',
      accentWord: 'remote',
      bgVariant: 'orb',
      mediaClips: [],
      audioFile: null,
      durationInFrames: 96,
    },
    {
      type: 'stat',
      kicker: 'BY THE NUMBERS',
      value: '0',
      label: 'files ever leave your computer',
      subtext: 'Everything runs locally — the phone is only a window.',
      showRings: true,
      mediaClips: [],
      audioFile: null,
      durationInFrames: 114,
    },
    {
      type: 'proof',
      kicker: 'STEP 01',
      headline: 'Scan, then go',
      subtext: 'One terminal command gives you a QR code to your live session.',
      accentWord: 'Scan',
      mediaClips: [],
      audioFile: null,
      durationInFrames: 120,
    },
    {
      type: 'cta',
      kicker: 'YOUR MOVE',
      headline: 'Want the setup?',
      subtext: 'Comment and I will send the exact steps.',
      buttonLabel: 'Comment "LINK"',
      buttonStyle: 'pill',
      brandMark: 'ANTHROPIC',
      mediaClips: [],
      audioFile: null,
      durationInFrames: 96,
    },
  ],
  accentColor: '#C04A1A',
  colorOverrides: null,
  textEffect: 'word-stagger',
  audioDriven: false,
  totalDurationInFrames: 426,
};

// Footage-mode (TalkingHeadReel) preview defaults. The generator supplies real
// props from edit_plan.json at render time; these only drive the Studio preview.
const defaultFootageProps: TalkingHeadReelProps = {
  sourceVideo: '',
  cuts: [{start: 0, end: 4}],
  beats: [{
    fromCut: 0, toCut: 0, treatment: 'talking-head', zoom: true,
    outputStartSec: 0, outputEndSec: 4,
    caption: {
      entrance: 'rise', anchor: 'bottom',
      words: [
        {text: 'And', scale: 's', startSec: 0.2},
        {text: 'Honestly', scale: 'hero', accent: true, startSec: 0.6},
        {text: 'super easy to make', scale: 'm', startSec: 1.1},
      ],
    },
  }],
  accentColor: '#C04A1A',
  inkColor: '#2A2A28',
  paperColor: '#F7F2E9',
  viewfinder: false,
  vignette: true,
  totalDurationInFrames: 120,
};

export const ToolRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="ReelSkill"
        component={ReelSkill}
        durationInFrames={defaultProps.totalDurationInFrames}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={defaultProps}
        // Length follows the slides (which the generator sizes from the VO audio).
        calculateMetadata={({props}) => {
          const fromSlides = (props.slides || []).reduce((sum, s) => sum + (s.durationInFrames || 96), 0);
          return {
            durationInFrames: Math.max(120, fromSlides || props.totalDurationInFrames || 426),
          };
        }}
      />
      <Composition
        id="TalkingHeadReel"
        component={TalkingHeadReel}
        durationInFrames={defaultFootageProps.totalDurationInFrames}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={defaultFootageProps}
        // Derive length from the per-cut frame sum (same rounding the
        // composition uses to place cuts) so the timeline is always long
        // enough for every cut — never trust totalDurationInFrames here.
        calculateMetadata={({props}) => {
          const fromCuts = (props.cuts || []).reduce(
            (sum, c) => sum + Math.round((c.end - c.start) * 30),
            0,
          );
          return {durationInFrames: Math.max(60, fromCuts || props.totalDurationInFrames || 120)};
        }}
      />
    </>
  );
};
