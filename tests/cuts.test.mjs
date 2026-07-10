// tests/cuts.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCutList, cutDurations, sourceToOutput, totalOutputSeconds} from '../footage/cuts.mjs';

const W = (text, start, end) => ({text, start, end});

test('buildCutList drops silences longer than the gap threshold', () => {
  const words = [W('hello', 0.1, 0.4), W('world', 0.5, 0.9), W('again', 2.5, 2.9)];
  const cuts = buildCutList(words, {totalDuration: 3.5});
  assert.equal(cuts.length, 2);
  // pad of 0.12 around each kept span, clamped to [0, totalDuration]
  assert.ok(Math.abs(cuts[0].start - 0.0) < 0.001);      // 0.1 - 0.12 clamps to 0
  assert.ok(Math.abs(cuts[0].end - 1.02) < 0.001);       // 0.9 + 0.12
  assert.ok(Math.abs(cuts[1].start - 2.38) < 0.001);     // 2.5 - 0.12
});

test('buildCutList drops filler words entirely', () => {
  const words = [W('so', 0.0, 0.2), W('um', 0.3, 0.6), W('basically', 0.7, 1.2)];
  const cuts = buildCutList(words, {totalDuration: 2});
  assert.equal(cuts.length, 1); // gap 0.2→0.7 = 0.5s < 0.7 threshold, stays one segment
  const text = cuts[0];
  assert.ok(text.start < 0.2 && text.end > 1.2);
});

test('buildCutList splits on a filler that creates a long gap', () => {
  const words = [W('so', 0.0, 0.2), W('um', 0.5, 1.4), W('basically', 1.6, 2.0)];
  // after dropping "um": gap 0.2→1.6 = 1.4s > 0.7 → split
  const cuts = buildCutList(words, {totalDuration: 3});
  assert.equal(cuts.length, 2);
});

test('buildCutList returns one full-length cut when there are no words', () => {
  const cuts = buildCutList([], {totalDuration: 10});
  assert.deepEqual(cuts, [{start: 0, end: 10}]);
});

test('sourceToOutput maps source time through collapsed cuts', () => {
  const cuts = [{start: 1, end: 3}, {start: 5, end: 6}];
  assert.equal(totalOutputSeconds(cuts), 3);
  assert.equal(sourceToOutput(1, cuts), 0);
  assert.equal(sourceToOutput(2.5, cuts), 1.5);
  assert.equal(sourceToOutput(5.5, cuts), 2.5);   // 2s from cut 0 + 0.5 into cut 1
  assert.equal(sourceToOutput(4, cuts), 2);       // inside a dropped gap → snaps to next cut start
  assert.deepEqual(cutDurations(cuts), [2, 1]);
});
