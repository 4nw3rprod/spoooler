// tests/edl.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {validateEditPlan, resolveCaptionTimings} from '../footage/edl.mjs';

const basePlan = () => ({
  cuts: [{start: 0, end: 4}, {start: 6, end: 10}],
  beats: [
    {fromCut: 0, toCut: 0, treatment: 'talking-head', zoom: true,
      caption: {words: [{text: 'And', scale: 's'}, {text: 'Honestly', scale: 'hero', accent: true}], entrance: 'rise', anchor: 'auto'}},
    {fromCut: 1, toCut: 1, treatment: 'overlay', layout: 'split',
      archetype: 'tweet-card', layoutData: {handle: '@outgrow', text: 'most viewers scroll on'}},
  ],
});

test('valid plan passes and is normalized', () => {
  const res = validateEditPlan(basePlan(), {sourceDuration: 12});
  assert.equal(res.ok, true);
  assert.equal(res.plan.beats.length, 2);
});

test('data archetypes now validate as overlays (stat)', () => {
  const plan = {cuts: [{start: 0, end: 5}], beats: [{fromCut: 0, toCut: 0, treatment: 'overlay', archetype: 'stat', layoutData: {value: '90%', label: 'faster'}}]};
  const res = validateEditPlan(plan, {sourceDuration: 10});
  assert.equal(res.ok, true);
  assert.equal(res.plan.beats[0].treatment, 'overlay');  // NOT downgraded
});

test('bar-graph with too few bars gives an actionable warning + downgrade', () => {
  const plan = {cuts: [{start: 0, end: 5}], beats: [{fromCut: 0, toCut: 0, treatment: 'overlay', archetype: 'bar-graph', layoutData: {bars: [{label: 'a', value: 1}]}}]};
  const res = validateEditPlan(plan, {sourceDuration: 10});
  assert.equal(res.plan.beats[0].treatment, 'talking-head');  // downgraded
  assert.match(res.warnings.join(' '), /bar-graph/);
});

test('invalid stat layoutData gives an actionable warning naming the fields', () => {
  const plan = {cuts: [{start: 0, end: 5}], beats: [{fromCut: 0, toCut: 0, treatment: 'overlay', archetype: 'stat', layoutData: {}}]};
  const res = validateEditPlan(plan, {sourceDuration: 10});
  assert.equal(res.plan.beats[0].treatment, 'talking-head');
  assert.match(res.warnings.join(' '), /stat.*needs.*value.*label/);
});

test('blur-reveal caption entrance is preserved (not rewritten to rise)', () => {
  const plan = {cuts: [{start: 0, end: 5}], beats: [{fromCut: 0, toCut: 0, treatment: 'talking-head', caption: {entrance: 'blur-reveal', anchor: 'bottom', words: [{text: 'hi', scale: 'hero'}]}}]};
  const res = validateEditPlan(plan, {sourceDuration: 10});
  assert.equal(res.plan.beats[0].caption.entrance, 'blur-reveal');
});

test('cuts outside source duration are rejected', () => {
  const plan = basePlan();
  plan.cuts[1].end = 99;
  const res = validateEditPlan(plan, {sourceDuration: 12});
  assert.equal(res.ok, false);
  assert.match(res.errors.join(' '), /source duration/);
});

test('beats must cover all cuts contiguously', () => {
  const plan = basePlan();
  plan.beats = [plan.beats[0]]; // cut 1 uncovered
  const res = validateEditPlan(plan, {sourceDuration: 12});
  assert.equal(res.ok, false);
  assert.match(res.errors.join(' '), /cover/i);
});

test('invalid archetype layoutData downgrades the beat to talking-head', () => {
  const plan = basePlan();
  plan.beats[1].layoutData = {}; // stat requires {value, label}
  const res = validateEditPlan(plan, {sourceDuration: 12});
  assert.equal(res.ok, true);
  assert.equal(res.plan.beats[1].treatment, 'talking-head');
  assert.match(res.warnings.join(' '), /downgraded/i);
});

test('overlay beats without archetype are rejected', () => {
  const plan = basePlan();
  delete plan.beats[1].archetype;
  const res = validateEditPlan(plan, {sourceDuration: 12});
  assert.equal(res.ok, false);
});

test('validateEditPlan does not mutate the caller plan', () => {
  const plan = basePlan();
  delete plan.beats[0].caption.entrance; // validator normalizes this on its copy
  delete plan.beats[0].caption.anchor;
  const snapshot = JSON.parse(JSON.stringify(plan));
  validateEditPlan(plan, {sourceDuration: 12});
  assert.deepEqual(plan, snapshot);
});

test('prototype-chain archetypes like "toString" downgrade safely (not a valid overlay)', () => {
  const plan = basePlan();
  plan.beats[1].archetype = 'toString';
  const res = validateEditPlan(plan, {sourceDuration: 12});
  assert.equal(res.ok, true);
  assert.equal(res.plan.beats[1].treatment, 'talking-head');
  assert.match(res.warnings.join(' '), /not available as an overlay/);
});

test('an unknown archetype downgrades to talking-head with a warning', () => {
  const plan = basePlan();
  // an archetype with no overlay renderer → downgrade.
  plan.beats[1] = {fromCut: 1, toCut: 1, treatment: 'overlay', layout: 'split',
    archetype: 'not-a-real-archetype', layoutData: {value: '90%', label: 'of viewers scroll on'}};
  const res = validateEditPlan(plan, {sourceDuration: 12});
  assert.equal(res.ok, true);
  assert.equal(res.plan.beats[1].treatment, 'talking-head');
  assert.equal(res.plan.beats[1].archetype, undefined);
  assert.match(res.warnings.join(' '), /not available as an overlay in v1 — downgraded to talking-head/);
});

test('a valid tweet-card overlay still passes', () => {
  const res = validateEditPlan(basePlan(), {sourceDuration: 12});
  assert.equal(res.ok, true);
  assert.equal(res.plan.beats[1].treatment, 'overlay');
  assert.equal(res.plan.beats[1].archetype, 'tweet-card');
});

test('caption with zero hero words produces a warning', () => {
  const plan = basePlan();
  plan.beats[0].caption.words = [{text: 'And', scale: 's'}, {text: 'Honestly', scale: 's'}];
  const res = validateEditPlan(plan, {sourceDuration: 12});
  assert.equal(res.ok, true);
  assert.match(res.warnings.join(' '), /no hero word/);
});

test('missing sourceDuration fails validation', () => {
  const res = validateEditPlan(basePlan(), {sourceDuration: undefined});
  assert.equal(res.ok, false);
  assert.match(res.errors.join(' '), /sourceDuration must be a positive number/);
});

test('resolveCaptionTimings maps caption words to transcript word times in output timeline', () => {
  const plan = validateEditPlan(basePlan(), {sourceDuration: 12}).plan;
  const transcriptWords = [
    {text: 'And', start: 0.5, end: 0.7},
    {text: 'honestly', start: 0.8, end: 1.3},
    {text: 'this', start: 1.4, end: 1.6},
  ];
  const out = resolveCaptionTimings(plan, transcriptWords);
  const cap = out.beats[0].caption;
  assert.ok(Math.abs(cap.words[0].startSec - 0.5) < 0.001);  // cut 0 starts at source 0 → output 0.5
  assert.ok(Math.abs(cap.words[1].startSec - 0.8) < 0.001);  // case-insensitive match
});

test('caption words with no transcript match fall back to even stagger from beat start', () => {
  const plan = validateEditPlan(basePlan(), {sourceDuration: 12}).plan;
  const out = resolveCaptionTimings(plan, []);
  const cap = out.beats[0].caption;
  assert.equal(cap.words[0].startSec, 0);
  assert.ok(cap.words[1].startSec > cap.words[0].startSec);
});
