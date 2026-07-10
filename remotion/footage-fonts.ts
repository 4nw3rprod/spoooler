// Local brand fonts for footage-mode reels. Loaded via the FontFace API guarded
// by delayRender so they're ready before Remotion captures any frame.
//   • Advercase (Bold 700 / Regular 400) — display / headlines / hero captions
//   • Chirp (Regular 400)                — body / supporting caption text
import {staticFile, delayRender, continueRender} from 'remotion';

export const DISPLAY = 'Advercase';
export const BODY = 'Chirp';

const handle = delayRender('Loading footage fonts');

const faces = [
  new FontFace(DISPLAY, `url(${staticFile('fonts/Advercase-Bold.ttf')}) format('truetype'), url(${staticFile('fonts/Advercase-Bold.otf')}) format('opentype')`, {weight: '700', display: 'swap'}),
  new FontFace(DISPLAY, `url(${staticFile('fonts/Advercase-Regular.ttf')}) format('truetype'), url(${staticFile('fonts/Advercase-Regular.otf')}) format('opentype')`, {weight: '400', display: 'swap'}),
  new FontFace(BODY, `url(${staticFile('fonts/Chirp-Regular.ttf')}) format('truetype')`, {weight: '400', display: 'swap'}),
];

Promise.all(
  faces.map((f) => f.load().then((loaded) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (document.fonts as any).add(loaded);
  })),
)
  .then(() => continueRender(handle))
  .catch(() => continueRender(handle));
