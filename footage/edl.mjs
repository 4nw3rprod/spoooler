// footage/edl.mjs
// Edit Decision List: schema validation + caption timing resolution.
// The director (MCP client) authors this; we make it safe to render.
import {sourceToOutput, cutDurations} from './cuts.mjs';

export const TREATMENTS = ['talking-head', 'overlay', 'broll', 'frame-overlay', 'split', 'two-shot'];
export const OVERLAY_LAYOUTS = ['split', 'pip'];
export const CAPTION_ENTRANCES = ['blur-reveal', 'rise', 'slide-x'];
export const CAPTION_ANCHORS = ['auto', 'top', 'center', 'bottom'];

// layoutData validators per archetype — mirrors hasValidLayoutData in the
// generator for existing types, plus the 8 footage-mode archetypes.
const LAYOUT_VALIDATORS = {
  stat: (d) => Boolean(d?.value && d?.label),
  checklist: (d) => (d?.items || []).length >= 2,
  comparison: (d) => (d?.leftItems || []).length >= 1 && (d?.rightItems || []).length >= 1,
  'bar-graph': (d) => (d?.bars || []).length >= 2,
  'pie-chart': (d) => (d?.slices || []).length >= 2,
  'progress-graph': (d) => (d?.points || []).length >= 3,
  'motion-graphic': (d) => (d?.nodes || []).length >= 2,
  'github-card': (d) => Boolean(d?.owner && d?.repo),
  'tweet-card': (d) => Boolean(d?.handle && d?.text),
  'quote-card': (d) => Boolean(d?.text && d?.author),
  'notification-stack': (d) => (d?.notifications || []).length >= 1 && d.notifications.every((n) => n.app && n.title),
  'before-after': (d) => Boolean(d?.beforeRef && d?.afterRef),
  'phone-mockup': (d) => Boolean(d?.mediaRef),
  'myth-fact': (d) => Boolean(d?.myth && d?.fact),
  timeline: (d) => (d?.events || []).length >= 2,
  receipt: (d) => (d?.items || []).length >= 2,
};
// Human-readable requirement per archetype, for actionable downgrade warnings.
const LAYOUT_HINTS = {
  stat: 'needs {value, label}',
  checklist: 'needs items:[{text}] with >=2 items',
  comparison: 'needs {leftTitle,rightTitle,leftItems[>=1],rightItems[>=1]}',
  'bar-graph': 'needs bars:[{label,value}] with >=2 bars',
  'pie-chart': 'needs slices:[{label,value}] with >=2 slices',
  'progress-graph': 'needs points:[{label,value}] with >=3 points',
  'motion-graphic': 'needs nodes:[{label}] with >=2 nodes (+ flow)',
  'github-card': 'needs {owner, repo}',
  'tweet-card': 'needs {handle, text}',
  'quote-card': 'needs {text, author}',
  'notification-stack': 'needs notifications:[{app,title}] with >=1',
  'before-after': 'needs {beforeRef, afterRef}',
  'phone-mockup': 'needs {mediaRef}',
  'myth-fact': 'needs {myth, fact}',
  timeline: 'needs events:[{label}] with >=2',
  receipt: 'needs items:[{label,value}] with >=2',
};
// All 16 footage overlay archetypes (8 social/media + 8 data/chart).
export const OVERLAY_ARCHETYPES = [
  'tweet-card', 'quote-card', 'notification-stack', 'before-after',
  'phone-mockup', 'myth-fact', 'timeline', 'receipt',
  'stat', 'bar-graph', 'pie-chart', 'progress-graph',
  'checklist', 'comparison', 'motion-graphic', 'github-card',
];

export function validateEditPlan(plan, {sourceDuration}) {
  const errors = [];
  const warnings = [];
  const hasValidSourceDuration = Number.isFinite(sourceDuration) && sourceDuration > 0;
  if (!hasValidSourceDuration) errors.push('sourceDuration must be a positive number');
  const cuts = Array.isArray(plan?.cuts) ? plan.cuts.map((c) => ({start: Number(c.start), end: Number(c.end)})) : [];

  if (!cuts.length) errors.push('cuts: at least one cut is required');
  for (let i = 0; i < cuts.length; i += 1) {
    const c = cuts[i];
    if (!(c.end > c.start)) errors.push(`cuts[${i}]: end must be > start`);
    if (hasValidSourceDuration && (c.start < 0 || c.end > sourceDuration + 0.05)) errors.push(`cuts[${i}]: outside source duration (${sourceDuration}s)`);
    if (i > 0 && c.start < cuts[i - 1].end) errors.push(`cuts[${i}]: overlaps previous cut`);
  }

  const beats = Array.isArray(plan?.beats)
    ? plan.beats.map((b) => ({
        ...b,
        caption: b.caption
          ? {...b.caption, words: Array.isArray(b.caption.words) ? b.caption.words.map((w) => ({...w})) : b.caption.words}
          : b.caption,
      }))
    : [];
  if (!beats.length) errors.push('beats: at least one beat is required');

  // Beats must partition cuts: contiguous fromCut..toCut covering 0..cuts.length-1.
  let expect = 0;
  for (let i = 0; i < beats.length; i += 1) {
    const b = beats[i];
    if (b.fromCut !== expect) errors.push(`beats[${i}]: fromCut=${b.fromCut} but expected ${expect} — beats must cover cuts contiguously`);
    if (!(Number.isInteger(b.toCut) && b.toCut >= b.fromCut && b.toCut < cuts.length)) {
      errors.push(`beats[${i}]: toCut out of range`);
      break;
    }
    expect = b.toCut + 1;
  }
  if (!errors.length && expect !== cuts.length) errors.push(`beats do not cover all cuts (covered ${expect}/${cuts.length})`);

  for (let i = 0; i < beats.length; i += 1) {
    const b = beats[i];
    if (!TREATMENTS.includes(b.treatment)) { errors.push(`beats[${i}]: unknown treatment "${b.treatment}"`); continue; }
    // overlay (full-screen card) and split (card top / speaker bottom) both
    // require a valid footage archetype + layoutData.
    if (b.treatment === 'overlay' || b.treatment === 'split') {
      if (!b.archetype) { errors.push(`beats[${i}]: ${b.treatment} beat requires an archetype`); continue; }
      // v1 ships only the 8 footage cards as overlays. Legacy slide archetypes
      // and unknown archetypes have no renderer, so downgrade to plain footage
      // rather than render a blank half. Never render a broken card.
      if (!OVERLAY_ARCHETYPES.includes(b.archetype)) {
        warnings.push(`beats[${i}]: archetype "${b.archetype}" not available as an overlay in v1 — downgraded to talking-head`);
        b.treatment = 'talking-head';
        delete b.archetype; delete b.layoutData; delete b.layout;
        continue;
      }
      b.layout = OVERLAY_LAYOUTS.includes(b.layout) ? b.layout : 'split';
      const check = LAYOUT_VALIDATORS[b.archetype];
      if (check && !check(b.layoutData)) {
        // Same philosophy: never render a broken card — fall back to footage.
        warnings.push(`beats[${i}] ${b.archetype}: layoutData invalid — ${LAYOUT_HINTS[b.archetype] || 'see list_layouts'} (downgraded to talking-head)`);
        b.treatment = 'talking-head';
        delete b.archetype; delete b.layoutData; delete b.layout;
      }
    }
    if (b.treatment === 'broll' && !b.mediaRef) {
      warnings.push(`beats[${i}]: broll beat has no mediaRef yet — attach one before render`);
    }
    if (b.caption) {
      const words = Array.isArray(b.caption.words) ? b.caption.words : [];
      if (!words.length || !words.every((w) => w.text)) errors.push(`beats[${i}].caption: words[] with text required`);
      const heroCount = words.filter((w) => w.scale === 'hero').length;
      if (heroCount > 1) warnings.push(`beats[${i}].caption: more than one hero word — keep exactly one`);
      if (heroCount === 0) warnings.push(`beats[${i}].caption: no hero word — mark exactly one word as scale "hero"`);
      b.caption.entrance = CAPTION_ENTRANCES.includes(b.caption.entrance) ? b.caption.entrance : 'blur-reveal';
      b.caption.anchor = CAPTION_ANCHORS.includes(b.caption.anchor) ? b.caption.anchor : 'auto';
    }
  }

  return errors.length ? {ok: false, errors, warnings} : {ok: true, plan: {cuts, beats}, warnings, errors: []};
}

// Attach output-timeline startSec to each caption word by matching it against
// the transcript words within the beat's source range. Fallback: even stagger.
export function resolveCaptionTimings(plan, transcriptWords) {
  const {cuts, beats} = plan;
  const durs = cutDurations(cuts);
  const cutOutStart = [];
  let acc = 0;
  for (const d of durs) { cutOutStart.push(acc); acc += d; }

  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9']/g, '');
  const beatsOut = beats.map((b) => {
    const beatSrcStart = cuts[b.fromCut].start;
    const beatSrcEnd = cuts[b.toCut].end;
    const beatOutStart = cutOutStart[b.fromCut];
    const beatOutEnd = cutOutStart[b.toCut] + durs[b.toCut];
    const out = {...b, outputStartSec: beatOutStart, outputEndSec: round3(beatOutEnd)};
    if (!b.caption) return out;

    const inBeat = (transcriptWords || []).filter((w) => w.start >= beatSrcStart - 0.05 && w.start <= beatSrcEnd + 0.05);
    let cursor = 0;
    const words = b.caption.words.map((w, idx) => {
      const target = norm(w.text.split(/\s+/)[0]); // multi-word entries match on first word
      let startSec = null;
      for (let j = cursor; j < inBeat.length; j += 1) {
        if (norm(inBeat[j].text) === target) { startSec = sourceToOutput(inBeat[j].start, cuts); cursor = j + 1; break; }
      }
      if (startSec === null) {
        // even stagger across the first 60% of the beat
        const span = (beatOutEnd - beatOutStart) * 0.6;
        startSec = round3(beatOutStart + (span * idx) / Math.max(1, b.caption.words.length));
      }
      return {...w, startSec};
    });
    out.caption = {...b.caption, words};
    return out;
  });
  return {...plan, beats: beatsOut};
}

const round3 = (n) => Math.round(n * 1000) / 1000;
