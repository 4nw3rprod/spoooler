// footage/cuts.mjs
// Pure cut-list math for footage mode. No I/O — testable in isolation.
//
// A "cut" is a kept segment of the SOURCE timeline: {start, end} in seconds.
// The OUTPUT timeline is all cuts played back-to-back (jump cuts).

const DEFAULT_FILLERS = new Set(['um', 'uh', 'uhm', 'erm', 'hmm', 'mmm']);

const normWord = (s) => String(s || '').toLowerCase().replace(/[^a-z']/g, '');

// words: [{text, start, end}] from whisper. Returns sorted, non-overlapping cuts.
export function buildCutList(words, {totalDuration, silenceGap = 0.7, pad = 0.12, fillers = DEFAULT_FILLERS} = {}) {
  if (!Number.isFinite(totalDuration) || totalDuration <= 0) {
    throw new Error('buildCutList: totalDuration (seconds) is required');
  }
  const kept = (words || []).filter((w) => !fillers.has(normWord(w.text)) && w.end > w.start);
  if (!kept.length) return [{start: 0, end: totalDuration}];

  const segments = [];
  let segStart = kept[0].start;
  let segEnd = kept[0].end;
  for (let i = 1; i < kept.length; i += 1) {
    const w = kept[i];
    if (w.start - segEnd > silenceGap) {
      segments.push({start: segStart, end: segEnd});
      segStart = w.start;
    }
    segEnd = Math.max(segEnd, w.end);
  }
  segments.push({start: segStart, end: segEnd});

  // Pad each segment, clamp, then merge any that now touch/overlap.
  const padded = segments.map((s) => ({
    start: Math.max(0, s.start - pad),
    end: Math.min(totalDuration, s.end + pad),
  }));
  const merged = [];
  for (const s of padded) {
    const prev = merged[merged.length - 1];
    if (prev && s.start - prev.end < 0.15) prev.end = Math.max(prev.end, s.end);
    else merged.push({...s});
  }
  return merged.map((s) => ({start: round3(s.start), end: round3(s.end)}));
}

export const cutDurations = (cuts) => cuts.map((c) => round3(c.end - c.start));

export const totalOutputSeconds = (cuts) => round3(cuts.reduce((sum, c) => sum + (c.end - c.start), 0));

// Map a SOURCE-timeline second to the OUTPUT timeline. Times inside a dropped
// gap snap forward to the start of the next kept cut.
export function sourceToOutput(t, cuts) {
  let acc = 0;
  for (const c of cuts) {
    if (t < c.start) return round3(acc);
    if (t <= c.end) return round3(acc + (t - c.start));
    acc += c.end - c.start;
  }
  return round3(acc);
}

const round3 = (n) => Math.round(n * 1000) / 1000;
