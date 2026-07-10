#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Instagram Reel Tool · MCP Server (stdio transport)
//
// Lets Codex (or any MCP host) drive this reel pipeline as a set
// of structured tools. The host AI provides the creative strategy directly —
// no Groq/Cerebras LLM calls. Scrapling and stock-media tools are still local
// because they hit live APIs.
//
// Tools surface (high-level):
//   • create_run               — mint a new run slug and reset state
//   • transcribe_source        — IG URL or local video → transcript (Stage 1)
//   • set_strategy             — caller-authored hook + scenes + voiceover    (Stage 2 fast path; skips LLM)
//   • extract_entities        — LLM extracts per-scene product/brand names   (Stage 1.5; feeds scrape_media)
//   • search_stock_media       — Pexels / Unsplash search (orientation-aware; preview only)
//   • scrape_brand_media       — Scrapling discovery → ranked product media (video>image>screenshot)
//   • collect_stock_media      — Download stock backgrounds per query (Pexels→Unsplash)
//   • review_media             — Return scraped media as thumbnails for the CLIENT AI to SEE
//   • rank_media               — Apply the CLIENT AI's own vision ranking (keep-list + scores)
//   • vision_filter_media      — (fallback) NVIDIA vision-score scraped media when the client can't see
//   • attach_media             — Bind selected clips to specific scenes (background vs frame)
//   • apply_pattern            — Persist palette, text effect, captions toggle (Stage 3)
//   • list_voices              — Kyutai pocket-tts cloned voices (your own, from voices.json) + Kokoro presets + TADA config hints
//   • synthesize_voice         — Kyutai pocket-tts cloned voice, TADA, or Kokoro (Stage 4)
//   • render_reel              — Final render with whisper alignment + animated emoji + captions (Stage 6)
//   • get_run_state            — Snapshot for the AI to plan its next move
//   • list_layouts             — Catalogue of slide archetypes the AI can pick from
//
// All long-running ops spawn the existing instagram-reel-generator.mjs CLI as a
// subprocess so the MCP server stays a thin orchestration layer.
// ─────────────────────────────────────────────────────────────────────────────

import {spawn} from 'node:child_process';
import {existsSync, readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';

import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {z} from 'zod';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOOL_ROOT = resolve(__dirname, '..');
const PROJECT_ROOT = resolve(TOOL_ROOT, '..');
const GENERATOR = join(TOOL_ROOT, 'instagram-reel-generator.mjs');
const RUNS_DIR = join(TOOL_ROOT, 'runs');
// Kyutai pocket-tts cloned voice embeddings live here, indexed by voices.json.
const VOICES_DIR = join(PROJECT_ROOT, 'audio', 'pocket-tts', 'voices');
const VOICES_INDEX = join(VOICES_DIR, 'voices.json');
const TADA_VOICE_STYLES = {
  'excited-explainer': {
    id: 'excited-explainer',
    label: 'Excited Explainer',
    description: 'Energetic, explanatory delivery with clear emphasis and confident pacing.',
  },
};

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  const text = readFileSync(path, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const [rawKey, ...rest] = trimmed.split('=');
    const key = rawKey.trim();
    const value = rest.join('=').trim().replace(/^['"]|['"]$/g, '');
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

function loadDefaultSecrets() {
  loadEnvFile(join(PROJECT_ROOT, '.env'));
  loadEnvFile(join(TOOL_ROOT, '.env'));
  loadEnvFile(join(TOOL_ROOT, '.env.local'));
}

loadDefaultSecrets();

// ─── cloned-voice resolution ─────────────────────────────────────────────────
// Read the pocket-tts voices index. Each entry: {id, name, embeddingFile}.
function readClonedVoices() {
  if (!existsSync(VOICES_INDEX)) return [];
  try {
    const arr = JSON.parse(readFileSync(VOICES_INDEX, 'utf-8'));
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

// Resolve a friendly voice reference (name, id, or embedding filename) to the
// path the generator expects (`audio/pocket-tts/voices/<file>.safetensors`,
// relative to PROJECT_ROOT — resolveVoiceFile() in the generator handles it).
// Matching is case-insensitive and tolerant of spaces/underscores so "Jane",
// "jane doe", and "jane-doe" all hit the same voice.
function resolveClonedVoice(ref) {
  if (!ref) return null;
  const voices = readClonedVoices();
  const norm = (s) => String(s || '').toLowerCase().replace(/[\s_]+/g, '-').replace(/\.safetensors$/, '').trim();
  const target = norm(ref);
  // Exact id / name / embedding match first.
  let hit = voices.find((v) => norm(v.id) === target || norm(v.name) === target || norm(v.embeddingFile) === target);
  // Then a prefix/contains match (so "jane" matches "jane-doe").
  if (!hit) hit = voices.find((v) => norm(v.id).startsWith(target) || norm(v.name).startsWith(target) || norm(v.name).includes(target) || norm(v.id).includes(target));
  if (!hit) return null;
  return {
    ...hit,
    voiceFilePath: `audio/pocket-tts/voices/${hit.embeddingFile}`,
  };
}

// ─── helpers ────────────────────────────────────────────────────────────────
const slugify = (s) => String(s || '')
  .trim().toLowerCase()
  .replace(/[^a-z0-9-]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 60) || `mcp-${randomUUID().slice(0, 8)}`;

const stageFile = (slug, stage) => join(RUNS_DIR, slug, `${stage}.json`);

function readStage(slug, stage) {
  const path = stageFile(slug, stage);
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf-8')); } catch { return null; }
}

function readCheckpoint(slug) {
  const path = join(RUNS_DIR, slug, 'checkpoint.json');
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf-8')); } catch { return null; }
}

// Resolve a public-relative media path to an absolute file on disk. Media lives
// under either toolRoot/public or projectRoot/public depending on the asset.
function resolveMediaAbsPath(file) {
  if (!file) return null;
  const candidates = [
    join(TOOL_ROOT, 'public', file),
    join(PROJECT_ROOT, 'public', file),
  ];
  return candidates.find((p) => existsSync(p)) || null;
}

// Make a small JPEG thumbnail (base64, no data: prefix) the client AI can SEE.
// Images are downscaled; videos are sampled at a mid-ish timestamp. Returns the
// base64 string, or null on failure. ffmpeg handles both image and video input.
function makeThumbnail(absPath, kind, outPath, width = 320) {
  return new Promise((resolveThumb) => {
    const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
    const args = kind === 'video'
      ? ['-v', 'error', '-ss', '1', '-i', absPath, '-frames:v', '1', '-vf', `scale=${width}:-1`, '-q:v', '5', '-y', outPath]
      : ['-v', 'error', '-i', absPath, '-frames:v', '1', '-vf', `scale=${width}:-1`, '-q:v', '5', '-y', outPath];
    const proc = spawn(ffmpeg, args);
    const timer = setTimeout(() => { try { proc.kill('SIGKILL'); } catch { /* noop */ } resolveThumb(null); }, 20000);
    proc.on('error', () => { clearTimeout(timer); resolveThumb(null); });
    proc.on('close', () => {
      clearTimeout(timer);
      try {
        if (existsSync(outPath)) { resolveThumb(readFileSync(outPath).toString('base64')); return; }
      } catch { /* fall through */ }
      resolveThumb(null);
    });
  });
}

// Spawn the generator with the given args. Streams progress JSON lines from
// stderr/stdout to a callback so the MCP host can surface live status, and
// resolves with the final JSON payload printed at the end.
async function runGenerator(args, {onProgress} = {}) {
  return new Promise((resolveRun, reject) => {
    const proc = spawn('node', [GENERATOR, ...args], {
      cwd: TOOL_ROOT,
      // REEL_VIA_MCP is the gate token: the generator refuses to run unless the
      // MCP server spawned it. This is the only place it is set.
      env: {...process.env, REEL_VIA_MCP: '1'},
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
      // Progress events stream on STDERR as one JSON object per line (--progress).
      if (onProgress) {
        for (const ln of d.toString().split('\n')) {
          const trimmed = ln.trim();
          if (!trimmed.startsWith('{')) continue;
          try {
            const ev = JSON.parse(trimmed);
            if (ev?.type === 'progress' && ev.message) onProgress(ev);
          } catch { /* not a JSON progress line */ }
        }
      }
    });
    proc.on('error', (e) => reject(e));
    proc.on('close', (code) => {
      if (code !== 0 && code !== null) {
        reject(new Error(`generator exited with code ${code}: ${stderr.slice(-2000) || stdout.slice(-2000)}`));
        return;
      }
      // The generator prints its final result to STDOUT as pretty-printed
      // (multi-line) JSON. Parse the whole stdout; if that fails, extract the
      // last balanced top-level {...} object.
      let result = null;
      const raw = stdout.trim();
      try {
        result = JSON.parse(raw);
      } catch {
        const start = raw.indexOf('{');
        const end = raw.lastIndexOf('}');
        if (start >= 0 && end > start) {
          try { result = JSON.parse(raw.slice(start, end + 1)); } catch { /* leave null */ }
        }
      }
      resolveRun({result, stdout, stderr});
    });
  });
}

// ─── MCP server ─────────────────────────────────────────────────────────────
const server = new McpServer({
  name: 'instagram-reel-tool',
  version: '1.0.0',
});

// ── 1. create_run ────────────────────────────────────────────────────────────
server.registerTool(
  'create_run',
  {
    title: 'Create a new reel run',
    description: 'Mints a fresh slug for a new reel build. All subsequent tool calls operate on this slug. Returns the slug + run directory path.',
    inputSchema: {
      slug: z.string().optional().describe('Optional human-readable slug (auto-generated if omitted)'),
    },
  },
  async ({slug}) => {
    const finalSlug = slugify(slug || `mcp-${Date.now().toString(36)}`);
    const dir = join(RUNS_DIR, finalSlug);
    mkdirSync(dir, {recursive: true});
    return {
      content: [{type: 'text', text: JSON.stringify({slug: finalSlug, runDir: dir}, null, 2)}],
    };
  },
);

// ── 2. transcribe_source ────────────────────────────────────────────────────
server.registerTool(
  'transcribe_source',
  {
    title: 'Transcribe an Instagram URL or local video',
    description: 'Stage 1 — fetches an Instagram reel via yt-dlp + transcriber MCP, OR transcribes a local video file. Returns the verbatim transcript and metadata. Required before set_strategy unless a transcript is provided directly.',
    inputSchema: {
      slug: z.string().describe('Run slug from create_run'),
      url: z.string().optional().describe('Instagram reel URL'),
      videoFile: z.string().optional().describe('Absolute path to a local video file (alternative to url)'),
      transcript: z.string().optional().describe('Skip transcription and use this verbatim transcript'),
      skipTranscribe: z.boolean().optional().describe('Skip whisper, use --transcript directly'),
    },
  },
  async ({slug, url, videoFile, transcript, skipTranscribe}) => {
    const args = ['--stage', 'source', '--slug', slugify(slug), '--progress'];
    if (url) args.push('--url', url);
    if (videoFile) args.push('--video-file', videoFile);
    if (transcript) args.push('--transcript', transcript);
    if (skipTranscribe) args.push('--skip-transcribe');
    const {result} = await runGenerator(args);
    const stage = readStage(slug, 'source') || {};
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          ok: Boolean(result),
          transcript: stage.transcript || '',
          sourceMeta: stage.sourceMeta || {},
          mode: stage.mode || 'unknown',
        }, null, 2),
      }],
    };
  },
);

// ── F1. ingest_footage ───────────────────────────────────────────────────────
server.registerTool(
  'ingest_footage',
  {
    title: 'Ingest raw talking-head footage (footage mode)',
    description: [
      'Footage mode Stage F1 — normalizes a raw video file into the reel master with',
      'cleaned audio (high-pass + presence EQ + loudnorm + dynaudnorm). Run first, then transcribe_footage.',
      'SINGLE-SPEAKER (default): cover-crops to 1080x1920 — use for a vertical or already-framed source.',
      'DUAL-SPEAKER (reframe:"dual"): KEEPS the full landscape width (scaled to 1920 tall) so you can',
      'crop to EITHER person per beat via beat.speaker. Pass speakers:[{id,cx}] with each speaker\'s',
      'normalized horizontal centre (0=left edge, 1=right edge) — e.g. [{"id":"A","cx":0.30},{"id":"B","cx":0.72}].',
    ].join(' '),
    inputSchema: {
      slug: z.string().describe('Run slug from create_run'),
      videoFile: z.string().describe('Absolute path to the raw footage file'),
      reframe: z.enum(['cover', 'dual']).optional().describe('"cover" (default) single 1080x1920 crop; "dual" keeps full width for per-beat speaker cropping.'),
      speakers: z.array(z.object({
        id: z.string().describe('Speaker id referenced by beat.speaker (e.g. "A","B")'),
        cx: z.number().min(0).max(1).describe('Normalized horizontal centre of this speaker in the frame (0-1)'),
        cy: z.number().min(0).max(1).optional().describe('Normalized vertical centre of this speaker in the frame (0-1)'),
      })).optional().describe('Required for reframe:"dual" — each speaker\'s horizontal and optional vertical centre.'),
    },
  },
  async ({slug, videoFile, reframe, speakers}) => {
    const args = ['--stage', 'ingest', '--slug', slugify(slug), '--video-file', videoFile, '--progress'];
    if (reframe) args.push('--reframe', reframe);
    if (Array.isArray(speakers) && speakers.length) args.push('--speakers', JSON.stringify(speakers));
    await runGenerator(args);
    const stage = readStage(slugify(slug), 'footage') || {};
    return {content: [{type: 'text', text: JSON.stringify({
      ok: Boolean(stage.master),
      master: stage.master || null,
      sourceMeta: stage.sourceMeta || null,
    }, null, 2)}]};
  },
);

// ── F2. transcribe_footage ───────────────────────────────────────────────────
server.registerTool(
  'transcribe_footage',
  {
    title: 'Transcribe ingested footage (word-level timestamps)',
    description: 'Footage mode Stage F2 — whisper.cpp word-level transcript of the ingested master. Returns the full text + word timestamps. You will read this transcript to write the edit plan: spot flubbed/restarted sentences to drop, pick beat boundaries, and choose caption keywords.',
    inputSchema: {
      slug: z.string().describe('Run slug'),
    },
  },
  async ({slug}) => {
    const cleanSlug = slugify(slug);
    await runGenerator(['--stage', 'transcribe-footage', '--slug', cleanSlug, '--progress']);
    const t = readStage(cleanSlug, 'footage-transcript') || {};
    return {content: [{type: 'text', text: JSON.stringify({
      ok: Boolean(t.ok),
      text: t.text || '',
      wordCount: (t.words || []).length,
      words: t.words || [],
    }, null, 2)}]};
  },
);

// ── F3. set_edit_plan ────────────────────────────────────────────────────────
const CaptionWordSchema = z.object({
  text: z.string().describe('The word or short phrase. Multi-word entries animate as one unit.'),
  scale: z.enum(['s', 'm', 'hero']).describe('Visual size. EXACTLY ONE word per caption should be "hero" (2.5-3x larger, accent-colored).'),
  accent: z.boolean().optional().describe('Render in the accent color (usually true for the hero word).'),
});
const BeatSchema = z.object({
  fromCut: z.number().int().min(0).describe('First cut index this beat covers (beats must tile the cut list contiguously).'),
  toCut: z.number().int().min(0).describe('Last cut index this beat covers (inclusive).'),
  treatment: z.enum(['talking-head', 'overlay', 'broll', 'frame-overlay', 'split', 'two-shot']).describe('talking-head = full-screen one speaker (set speaker:"A"/"B"; zoom:true for punch-in). split = archetype card on TOP half + speaker on BOTTOM half (set archetype+layoutData AND speaker). two-shot = both speakers in frame together (needs dual ingest). broll = full-screen stock cutaway (set mediaRef; audio continues). overlay = full-screen archetype card. frame-overlay = speaker full-screen + floating product screenshot (mediaRef).'),
  layout: z.enum(['split', 'pip']).optional().describe('overlay only. split (default) = speaker top half, card bottom half. pip = speaker corner bubble, card full-canvas (use for comparison/motion-graphic/wide cards).'),
  archetype: z.string().optional().describe('overlay / split only. One of the 8 footage archetypes: tweet-card, quote-card, notification-stack, before-after, phone-mockup, myth-fact, timeline, receipt.'),
  layoutData: z.any().optional().describe('Archetype payload. Shapes: tweet-card={handle,name?,text,likes?,avatarRef?}; quote-card={text,author,role?}; notification-stack={notifications:[{app,title,body?,time?}]}; before-after={beforeRef,afterRef,beforeLabel?,afterLabel?}; phone-mockup={mediaRef,scroll?}; myth-fact={myth,fact}; timeline={title?,events:[{label,sublabel?}]}; receipt={title?,items:[{label,value}],total?}. mediaRef/beforeRef/afterRef/avatarRef are public-relative paths from scraped/stock media.'),
  mediaRef: z.string().optional().describe('broll / frame-overlay: public-relative media path (from review_media / collect_stock_media).'),
  mediaKind: z.enum(['image', 'video']).optional(),
  zoom: z.boolean().optional().describe('talking-head only: slow punch-in for emphasis.'),
  speaker: z.string().optional().describe('talking-head only (dual-speaker ingest): which speaker id to crop to — must match an id from ingest_footage speakers[] (e.g. "A","B"). Alternate A/B across beats to cut between both people.'),
  caption: z.object({
    words: z.array(CaptionWordSchema).min(1).max(8),
    entrance: z.enum(['blur-reveal', 'rise', 'slide-x']).optional().describe('blur-reveal (default) = words unblur + fade in. rise = slide up + fade. slide-x = horizontal slide.'),
    anchor: z.enum(['auto', 'top', 'center', 'bottom']).optional(),
  }).optional().describe('SELECTIVE kinetic caption — one short phrase, only the words worth seeing, exactly one hero word. Omit when nothing is worth highlighting (never transcribe speech verbatim).'),
});

server.registerTool(
  'set_edit_plan',
  {
    title: 'Set the edit plan (you are the editor — cuts, beats, captions)',
    description: [
      'Footage mode Stage F3 — YOU author the Edit Decision List. Read the transcript from',
      'transcribe_footage first. Omit cuts to auto-build them (silence >0.7s and filler words',
      'removed); provide cuts explicitly to also drop flubbed/restarted sentences you spotted.',
      'Then group cuts into beats and give each a treatment + optional selective caption.',
      'Director rules: never cut away in the first 2 seconds; B-roll max ~4s; one overlay',
      'archetype per beat and vary them; end on the speaker for the CTA.',
    ].join(' '),
    inputSchema: {
      slug: z.string().describe('Run slug'),
      cuts: z.array(z.object({
        start: z.number().min(0).describe('Source-timeline seconds'),
        end: z.number().min(0),
      })).optional().describe('Kept segments of the source. Omit for auto silence/filler cutting.'),
      beats: z.array(BeatSchema).min(1).describe('Beats tiling the cut list (fromCut/toCut contiguous, covering every cut).'),
    },
  },
  async ({slug, cuts, beats}) => {
    const cleanSlug = slugify(slug);
    const runDir = join(RUNS_DIR, cleanSlug);
    mkdirSync(runDir, {recursive: true});
    const edlPath = join(runDir, 'mcp-edl.json');
    writeFileSync(edlPath, JSON.stringify({cuts: cuts || [], beats}, null, 2));
    await runGenerator(['--stage', 'edit-plan', '--slug', cleanSlug, '--edl-file', edlPath, '--progress']);
    const plan = readStage(cleanSlug, 'edit_plan') || {};
    return {content: [{type: 'text', text: JSON.stringify({
      ok: Boolean(plan.beats),
      cuts: (plan.cuts || []).length,
      beats: (plan.beats || []).length,
      totalSeconds: plan.totalSeconds || 0,
      warnings: plan.warnings || [],
      cutList: plan.cuts || [],
    }, null, 2)}]};
  },
);

// ── F4. render_footage_reel ──────────────────────────────────────────────────
server.registerTool(
  'render_footage_reel',
  {
    title: 'Render the footage-mode reel MP4',
    description: 'Footage mode Stage F4 — renders the TalkingHeadReel composition from edit_plan.json. Optional pattern stage colors apply (apply_pattern); otherwise the default warm palette is used. Optional music bed is mixed with automatic speech ducking.',
    inputSchema: {
      slug: z.string(),
      vignette: z.boolean().optional().describe('Curved dark top/bottom vignette for cinematic depth. ON by default; pass false to disable.'),
      viewfinder: z.boolean().optional().describe('Legacy: thin white viewfinder frame over talking-head beats. Off by default.'),
      highBitrate: z.boolean().optional(),
      music: z.string().optional().describe('Absolute path to a music file to bed under the speech (auto-ducked).'),
    },
  },
  async ({slug, vignette, viewfinder, highBitrate, music}) => {
    const args = ['--stage', 'render-footage', '--slug', slugify(slug), '--progress'];
    if (viewfinder) args.push('--viewfinder');
    if (vignette === false) args.push('--no-vignette');
    if (highBitrate) args.push('--high-bitrate');
    if (music) args.push('--music', music);
    await runGenerator(args);
    const render = readStage(slugify(slug), 'render');
    return {content: [{type: 'text', text: JSON.stringify({
      ok: Boolean(render?.output),
      output: render?.output || '',
      duration: render?.finalDuration || 0,
    }, null, 2)}]};
  },
);

// ── 3. set_strategy ─────────────────────────────────────────────────────────
// The KEY tool: the host AI authors the entire creative strategy and we skip
// the Groq/Cerebras LLM call. Schema mirrors what buildSimplifiedProps expects.
const SCENE_TYPES = ['hook', 'problem', 'stat', 'statement', 'proof', 'checklist', 'comparison', 'bar-graph', 'pie-chart', 'progress-graph', 'motion-graphic', 'github-card', 'cta'];

const SceneSchema = z.object({
  type: z.enum(SCENE_TYPES)
    .describe([
      'Scene archetype — YOU (the director) choose the right one per scene:',
      '• hook — opening scroll-stopper (scene 1).',
      '• problem — name the pain / status quo that hurts.',
      '• stat — one dominant number is the point (needs layoutData {value,label}).',
      '• statement — punchy editorial declaration, no data.',
      '• proof — show the actual product / a concrete how-to step (uses scraped product media).',
      '• checklist — 3-5 steps/features/requirements (layoutData {items:[{text,brand?}]}).',
      '• comparison — before/after, A vs B, old vs new (layoutData {leftTitle,rightTitle,leftItems,rightItems}).',
      '• bar-graph — compare magnitudes across 2-5 things (layoutData {bars:[{label,value,brand?}]}).',
      '• pie-chart — composition / share of a whole (layoutData {slices:[{label,value,brand?}]}).',
      '• progress-graph — trend/growth over time, 3-6 points (layoutData {points:[{label,value}]}).',
      '• motion-graphic — process/flow with connected nodes (layoutData {nodes:[{label,brand?}],flow}).',
      '• github-card — the script names a specific GitHub repo; renders a GitHub repo card (layoutData {owner,repo,description?,language?,stars?,forks?,visibility?,url?}). The scraper can fill stars/forks/language from the repo URL.',
      '• cta — closing call-to-action (scene last).',
    ].join('\n')),
  layout: z.enum(['hook', 'stat', 'statement', 'proof', 'cta', 'checklist', 'comparison', 'bar-graph', 'pie-chart', 'progress-graph', 'motion-graphic', 'github-card']).optional()
    .describe('Usually omit — the visual layout defaults to match `type`. Only set this if you want a layout that differs from the archetype label.'),
  onScreen: z.string().describe('The on-screen headline/hero text. Write a COMPLETE short sentence (6-16 words), not a fragment. This is what the viewer reads.'),
  spoken: z.string().describe("This scene's portion of the voiceover script — what the cloned/Kokoro voice says over this slide. The audio is auto-chunked from this."),
  subtext: z.string().optional().describe('Optional supporting line below the headline (best on hook + cta).'),
  brands: z.array(z.string()).optional().describe('Brand/product names mentioned in this scene (drives logo chips on the slide).'),
  search: z.string().optional().describe('Stock background query for this scene (e.g. "sunrise over mountains", "person typing laptop"). Used if you let media auto-collect.'),
  layoutData: z.any().optional().describe('Structured payload required by data archetypes. checklist={title?,items:[{text,brand?}],checked?}; comparison={leftTitle,rightTitle,leftItems:[],rightItems:[],leftBrand?,rightBrand?}; stat={value,label}; bar-graph={title?,unit?,bars:[{label,value,brand?}]}; pie-chart={title?,slices:[{label,value,brand?}]}; progress-graph={title?,unit?,points:[{label,value}]}; motion-graphic={title?,nodes:[{label,brand?}],flow:"linear"|"cycle"|"hub"}; github-card={owner,repo,description?,language?,stars?,forks?,visibility?,url?}.'),
  emoji: z.string().optional().describe('Optional decorative animated emoji name for hook/cta/proof (e.g. "rocket", "fire", "light-bulb", "money-face", "100"). Omit to let the tool auto-pick.'),
  audioDurationSeconds: z.number().optional().describe('Usually omit. Only set if you already synthesized this scene\'s audio and want to pin its duration.'),
});

server.registerTool(
  'set_strategy',
  {
    title: 'Set the reel strategy (you are the scriptwriter — no external LLM)',
    description: [
      'Stage 2 — YOU provide the entire creative strategy; no Groq/Cerebras call is made.',
      'PLAN FIRST: before calling this, decide (a) the slide COUNT — exactly 6 or 7 — and',
      '(b) the ARCHETYPE for each slide (hook → varied middle → cta). The reel ALWAYS renders',
      '6-7 slides, each on screen ~5s including transitions and element in/out effects.',
      'AUDIO-FIRST: the voiceover is synthesized as ONE continuous track later; slides auto-size',
      'so the total video length always EXCEEDS the voiceover (narration is never clipped). Write',
      'the `voiceover` as a single flowing script (~28-38s of speech ≈ 70-95 words) — do NOT pad',
      'each scene to equal length. After this returns, media is collected per the scenes\' search/',
      'brand fields unless you pass mediaCollection:"skip" (recommended when you will scrape +',
      'review + rank media yourself).',
    ].join(' '),
    inputSchema: {
      slug: z.string().describe('Run slug from create_run'),
      hook: z.string().describe('The opening hook line (≤ 80 chars works best). Also used as scene 1 on-screen if scene 1 omits onScreen.'),
      voiceover: z.string().describe('The FULL continuous voiceover script (one flowing paragraph, ~28-38s ≈ 70-95 words). This is synthesized as a single master track — write it to be spoken start-to-finish, not as disconnected per-slide lines.'),
      scenes: z.array(SceneSchema).min(6).max(7).describe('EXACTLY 6 or 7 scenes — decide the count AND each scene\'s archetype up front before calling this tool. Scene 1 must be a hook, the last must be a cta. In between, vary archetypes (problem / proof / stat / checklist / comparison / a graph). Each scene is on screen ~5s (the reel auto-sizes so total length exceeds the voiceover).'),
      brands: z.array(z.string()).optional().describe('All brand names mentioned in the script (for logo chips and watermark).'),
      angle: z.string().optional().describe('The narrative spine ("why this audience should watch this NOW"). Helps downstream stages.'),
      commentTrigger: z.string().optional().describe('CTA action word (e.g. "GUIDE") that the audience comments to receive a link.'),
      commentReward: z.string().optional().describe('What the audience receives in DM after commenting.'),
      durationSeconds: z.number().optional().describe('Optional hint for --skip-tts previews only. Real length comes from the synthesized audio.'),
      autoDuration: z.boolean().optional().describe('Recommended true — final length follows the actual voiceover audio.'),
      brandUrl: z.string().optional().describe('Primary product/brand URL for scrapling discovery.'),
      mediaCollection: z.enum(['auto', 'skip']).optional().describe('"auto" (default) collects stock + scraped media. "skip" leaves media empty so you can scrape→review→rank yourself.'),
    },
  },
  async ({slug, hook, voiceover, scenes, brands, angle, commentTrigger, commentReward, durationSeconds, autoDuration, brandUrl, mediaCollection}) => {
    const cleanSlug = slugify(slug);
    const runDir = join(RUNS_DIR, cleanSlug);
    mkdirSync(runDir, {recursive: true});
    // Build the strategy in the exact shape buildStrategy() emits.
    const strategy = {
      hook,
      voiceover,
      angle: angle || '',
      brands: Array.isArray(brands) && brands.length ? brands : [],
      commentTrigger: commentTrigger || '',
      commentReward: commentReward || '',
      scenes: scenes.map((s) => ({
        type: s.type,
        // Only pin an explicit layout when the caller set one; otherwise leave
        // it empty so the generator derives layout from `type` (honouring the
        // AI's archetype choice, including problem→statement).
        ...(s.layout ? {layout: s.layout} : {}),
        onScreen: s.onScreen,
        subtext: s.subtext || '',
        spoken: s.spoken,
        brands: Array.isArray(s.brands) ? s.brands : [],
        search: s.search || '',
        layoutData: s.layoutData || null,
        ...(s.emoji ? {emoji: s.emoji} : {}),
        audioDurationSeconds: typeof s.audioDurationSeconds === 'number' ? s.audioDurationSeconds : 0,
      })),
    };
    const stratPath = join(runDir, 'mcp-strategy.json');
    writeFileSync(stratPath, JSON.stringify(strategy, null, 2));

    // If source.json doesn't exist (caller skipped transcribe_source), fabricate
    // a minimal one so runScriptStage's requireStage('source') passes.
    if (!existsSync(stageFile(cleanSlug, 'source'))) {
      writeFileSync(stageFile(cleanSlug, 'source'), JSON.stringify({
        sourceMeta: {title: angle || hook || 'AI-authored reel', caption: ''},
        transcript: voiceover,
        mode: 'mcp',
        generatedAt: new Date().toISOString(),
      }, null, 2));
    }

    const args = ['--stage', 'script', '--slug', cleanSlug, '--progress', '--strategy-file', stratPath];
    if (Array.isArray(brands) && brands.length) args.push('--brands', brands.join(','));
    if (brandUrl) args.push('--tool-url', brandUrl);
    if (typeof durationSeconds === 'number') args.push('--duration', String(durationSeconds));
    if (autoDuration) args.push('--auto-duration');
    if (mediaCollection === 'skip') args.push('--skip-media');
    if (angle) args.push('--topic', angle);

    await runGenerator(args);
    const script = readStage(cleanSlug, 'script') || {};
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          ok: true,
          slug: cleanSlug,
          sceneCount: (script.strategy?.scenes || []).length,
          scrapedCount: script.scrapedCount || 0,
          stockCount: script.stockCount || 0,
          media: script.media || [],
          brandLogos: script.brandLogos || [],
          resolvedBrands: script.resolvedBrands || [],
        }, null, 2),
      }],
    };
  },
);

// ── 3b. extract_entities ─────────────────────────────────────────────────────
// AI auto-extracts per-scene entities from the voiceover. Each scene gets a
// list of concrete product/brand/tool names (for Google Images + Brandfetch
// logos) and a list of generic nouns to EXCLUDE from search (visual noise).
// Downstream: scrape_media reads entities.json to decide which scenes get
// GIF+logo treatment (alternate/brand) vs stock backgrounds (content/mood).
server.registerTool(
  'extract_entities',
  {
    title: 'Extract per-scene entities (auto AI)',
    description: [
      'Stage 1.5 — LLM inspects each scene\'s spoken text and returns the concrete',
      'product/brand/tool names that should be visually represented in that scene,',
      'plus a list of generic nouns to EXCLUDE from search.',
      'Empty entities = content/mood slide (use stock footage).',
      'Non-empty entities = alternate/brand slide (use Google Images + Brandfetch + Giphy).',
      'Requires the script stage (set_strategy) to have run first. Writes entities.json.',
    ].join(' '),
    inputSchema: {
      slug: z.string().describe('Run slug from create_run'),
    },
  },
  async ({slug}) => {
    const cleanSlug = slugify(slug);
    if (!existsSync(stageFile(cleanSlug, 'script'))) {
      throw new Error(`script.json missing for ${cleanSlug} — run set_strategy first.`);
    }
    const args = ['--stage', 'entities', '--slug', cleanSlug, '--progress'];
    await runGenerator(args);
    const entities = readStage(cleanSlug, 'entities') || {};
    return {content: [{type: 'text', text: JSON.stringify({
      ok: true,
      slug: cleanSlug,
      sceneCount: (entities.scenes || []).length,
      totalEntities: (entities.scenes || []).reduce((n, s) => n + (s.entities?.length || 0), 0),
      brandScenes: (entities.scenes || []).filter((s) => (s.entities?.length || 0) > 0).length,
      contentScenes: (entities.scenes || []).filter((s) => (s.entities?.length || 0) === 0).length,
      scenes: entities.scenes || [],
    }, null, 2)}]};
  },
);

// ── 4. search_stock_media ───────────────────────────────────────────────────
server.registerTool(
  'search_stock_media',
  {
    title: 'Search Pexels for stock video / image',
    description: 'Orientation-aware Pexels search. Returns a list of candidate clips with metadata (size, duration, link) the AI can pick from before calling attach_media. Requires PEXELS_API_KEY in .env.',
    inputSchema: {
      query: z.string().describe('Search query (e.g. "boardroom meeting", "neon city night")'),
      orientation: z.enum(['portrait', 'landscape', 'square']).optional().describe('Defaults to portrait for reels'),
      perPage: z.number().int().min(1).max(15).optional().describe('Number of results (default 8)'),
    },
  },
  async ({query, orientation = 'portrait', perPage = 8}) => {
    const apiKey = process.env.PEXELS_API_KEY;
    if (!apiKey) throw new Error('PEXELS_API_KEY not set in .env');
    const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&orientation=${orientation}&per_page=${perPage}`;
    const res = await fetch(url, {headers: {Authorization: apiKey}});
    if (!res.ok) throw new Error(`Pexels: HTTP ${res.status}`);
    const data = await res.json();
    const clips = (data.videos || []).map((v) => {
      const file = (v.video_files || []).sort((a, b) => (b.height || 0) - (a.height || 0)).find((f) => f.height >= 720 && f.height <= 1080) || v.video_files?.[0];
      return {
        id: v.id,
        url: v.url,
        download: file?.link || null,
        width: file?.width,
        height: file?.height,
        duration: v.duration,
        thumbnail: v.image,
      };
    });
    return {content: [{type: 'text', text: JSON.stringify({clips}, null, 2)}]};
  },
);

// ── 5. scrape_brand_media ───────────────────────────────────────────────────
server.registerTool(
  'scrape_brand_media',
  {
    title: 'Scrape brand/product media (video > image > screenshot)',
    description: 'Runs the scrapling discovery engine to pull REAL product media from seed URLs and/or product-name searches (e.g. "Claude Code", "Cursor"). It searches for the real product pages, scrapes up to 4 sites, hunts a hero video, and returns ranked items (video → image → screenshot; landscape preferred) with probed dimensions. Progress streams live (sites discovered, assets found). Pass commit:true to append the pool into the run\'s media; otherwise it just returns the candidates for you to vision-filter and attach. Requires the script stage (set_strategy) to have run first when commit:true.',
    inputSchema: {
      slug: z.string().describe('Run slug'),
      urls: z.array(z.string()).optional().describe('Seed URLs to scrape directly'),
      productQueries: z.array(z.string()).optional().describe('Product/brand names to discover via DuckDuckGo (e.g. ["Claude Code", "Notion AI"])'),
      commit: z.boolean().optional().describe('If true, append the scraped pool into script.json media[] (role: frame). Default false — returns candidates only.'),
    },
  },
  async ({slug, urls = [], productQueries = [], commit = false}) => {
    const cleanSlug = slugify(slug);
    if (!urls.length && !productQueries.length) {
      throw new Error('Provide at least one url or productQuery.');
    }
    const args = ['--media-op', 'scrape', '--slug', cleanSlug, '--progress'];
    if (urls.length) args.push('--urls', JSON.stringify(urls));
    if (productQueries.length) args.push('--queries', JSON.stringify(productQueries));
    if (commit) args.push('--commit', '--mode', 'append');
    const {result} = await runGenerator(args);
    return {content: [{type: 'text', text: JSON.stringify(result || {ok: false, note: 'no result parsed'}, null, 2)}]};
  },
);

// ── 5b. collect_stock_media ──────────────────────────────────────────────────
server.registerTool(
  'collect_stock_media',
  {
    title: 'Collect stock backgrounds (Pexels → Unsplash)',
    description: 'Downloads one stock background per query (vertical video from Pexels, falling back to an Unsplash image) into the run. Each query maps to a scene index by order, so pass queries in scene order. These are the full-bleed backgrounds behind every slide. Progress streams per query. Pass commit:true to append them into script.json media[] (role: background). Requires the script stage first when commit:true.',
    inputSchema: {
      slug: z.string().describe('Run slug'),
      queries: z.array(z.string()).min(1).describe('Search phrases in scene order, e.g. ["sunrise over mountains", "person typing laptop", ...]'),
      commit: z.boolean().optional().describe('If true, append into script.json media[] as backgrounds. Default false — returns candidates only.'),
    },
  },
  async ({slug, queries, commit = false}) => {
    const cleanSlug = slugify(slug);
    const args = ['--media-op', 'stock', '--slug', cleanSlug, '--progress', '--queries', JSON.stringify(queries)];
    if (commit) args.push('--commit', '--mode', 'append');
    const {result} = await runGenerator(args);
    return {content: [{type: 'text', text: JSON.stringify(result || {ok: false, note: 'no result parsed'}, null, 2)}]};
  },
);

// ── 5b2. scrape_media (entity-driven, dedicated) ─────────────────────────────
// Decoupled from set_strategy. Driven by entities.json (from extract_entities).
// Brand scenes (non-empty entities) get Giphy GIF + Brandfetch + Google logos.
// Content scenes (empty entities) get Pexels/Unsplash stock backgrounds.
// Pass --entities to override entities.json (manual mode).
server.registerTool(
  'scrape_media',
  {
    title: 'Scrape media for the reel (entity-driven)',
    description: [
      'Dedicated media-scraping tool. Reads entities.json from extract_entities (or accepts',
      'an --entities override) and scrapes the right kind of media per scene:',
      '  • brand scenes (non-empty entities): Giphy (animated GIF) → Brandfetch (cached) →',
      '    Google Images via StealthyFetcher (Bing fallback) for static logos.',
      '  • content scenes (empty entities): Pexels video → Unsplash image background.',
      'Decoupled from set_strategy: run it as many times as you want. Pass commit:true to',
      'append the items into script.json media[]. Requires the script stage (set_strategy)',
      'to have run first so scenes exist. Requires extract_entities to have run, OR pass',
      '--entities manually.',
    ].join(' '),
    inputSchema: {
      slug: z.string().describe('Run slug'),
      entities: z.array(z.object({
        sceneIndex: z.number().int().min(0),
        entities: z.array(z.string()).default([]),
        exclude: z.array(z.string()).optional(),
      })).optional().describe('Manual override for entities. If omitted, reads entities.json.'),
      perEntityCount: z.number().int().min(1).max(3).optional().describe('How many GIFs AND static logos to fetch per entity (default 1).'),
      commit: z.boolean().optional().describe('If true, append the items to script.json media[]. Default false.'),
    },
  },
  async ({slug, entities, perEntityCount, commit = false}) => {
    const cleanSlug = slugify(slug);
    if (!existsSync(stageFile(cleanSlug, 'script'))) {
      throw new Error(`script.json missing for ${cleanSlug} — run set_strategy first.`);
    }
    const args = ['--media-op', 'scrape-media', '--slug', cleanSlug, '--progress'];
    if (entities) args.push('--entities', JSON.stringify(entities));
    if (perEntityCount) args.push('--per-entity-count', String(perEntityCount));
    if (commit) args.push('--commit', '--mode', 'append');
    const {result} = await runGenerator(args);
    return {content: [{type: 'text', text: JSON.stringify(result || {ok: false, note: 'no result parsed'}, null, 2)}]};
  },
);

// ── 5c. vision_filter_media ──────────────────────────────────────────────────
server.registerTool(
  'vision_filter_media',
  {
    title: 'Vision-score and rank scraped media',
    description: 'Runs an NVIDIA vision model (llama-3.2-90b-vision) over scraped images to score editorial quality 1-10 for the premium Huashu aesthetic (rejects AI slop, neon, clutter, watermarks). Videos pass through with a neutral score. Returns the kept items sorted best-first with a visionScore on each. With no items arg, it scores the scraped media already in script.json. Pass commit:true to replace the scraped media in script.json with the kept+ranked set (stock backgrounds preserved). Needs NVIDIA_API_KEY; without it, all items pass through unscored.',
    inputSchema: {
      slug: z.string().describe('Run slug'),
      items: z.array(z.any()).optional().describe('Optional explicit media pool to score (objects with .file/.kind). Omit to score script.json\'s current scraped media.'),
      threshold: z.number().min(0).max(10).optional().describe('Keep items scoring ≥ threshold. Default 6.5.'),
      commit: z.boolean().optional().describe('If true, write the kept+ranked scraped set back into script.json (preserving stock backgrounds). Default false.'),
    },
  },
  async ({slug, items, threshold, commit = false}) => {
    const cleanSlug = slugify(slug);
    const args = ['--media-op', 'vision-filter', '--slug', cleanSlug, '--progress'];
    if (Array.isArray(items) && items.length) args.push('--items', JSON.stringify(items));
    if (typeof threshold === 'number') args.push('--threshold', String(threshold));
    if (commit) args.push('--commit');
    const {result} = await runGenerator(args);
    return {content: [{type: 'text', text: JSON.stringify(result || {ok: false, note: 'no result parsed'}, null, 2)}]};
  },
);

// ── 5d. review_media — let the CLIENT AI see the scraped media ────────────────
// Returns each scraped item as a small base64 thumbnail (images downscaled;
// videos → a mid-point frame) so the calling MCP host can judge them with its
// OWN vision instead of delegating to an external vision API. Pair with
// rank_media to commit the AI's judgment.
server.registerTool(
  'review_media',
  {
    title: 'Review scraped media (returns thumbnails to look at)',
    description: "Returns the run's scraped media as small inline image thumbnails (videos are sampled to a single frame) so YOU can look at them and judge editorial quality yourself. Each thumbnail is preceded by a text line with its index + file path. After reviewing, call rank_media with your chosen order / keep-list. This replaces the external NVIDIA vision filter with your own vision.",
    inputSchema: {
      slug: z.string().describe('Run slug'),
      source: z.enum(['scraped', 'all']).optional().describe('"scraped" (default) reviews scrapling/search items; "all" includes stock backgrounds too.'),
      max: z.number().int().min(1).max(20).optional().describe('Max items to return thumbnails for (default 12).'),
      thumbWidth: z.number().int().min(160).max(640).optional().describe('Thumbnail width in px (default 320). Smaller = less context used.'),
    },
  },
  async ({slug, source = 'scraped', max = 12, thumbWidth = 320}) => {
    const cleanSlug = slugify(slug);
    const script = readStage(cleanSlug, 'script');
    if (!script) throw new Error('script.json missing — run set_strategy first.');
    const media = (script.media || []).filter((m) => source === 'all' ? true : (m.source === 'scrapling' || m.source === 'search'));
    if (!media.length) {
      return {content: [{type: 'text', text: JSON.stringify({note: 'no media to review', source}, null, 2)}]};
    }
    const items = media.slice(0, max);
    const content = [{
      type: 'text',
      text: `Reviewing ${items.length} ${source} media item(s) for run ${cleanSlug}. ` +
        `Look at each thumbnail below and judge it for a premium editorial reel ` +
        `(reward: clean product UI, real screenshots, good negative space, on-brand; ` +
        `penalize: AI slop, neon clutter, watermarks, low-res, off-topic). ` +
        `Then call rank_media with your keep-list + scores.`,
    }];
    const tmpDir = join(TOOL_ROOT, 'runs', cleanSlug, '.thumbs');
    mkdirSync(tmpDir, {recursive: true});
    for (let i = 0; i < items.length; i += 1) {
      const m = items[i];
      const abs = resolveMediaAbsPath(m.file);
      const meta = `[${i}] ${m.file}  (kind=${m.kind}, orientation=${m.orientation || '?'}, ${m.width || '?'}x${m.height || '?'}, source=${m.source})`;
      content.push({type: 'text', text: meta});
      if (!abs) { content.push({type: 'text', text: '   (file missing on disk — skip)'}); continue; }
      const thumb = await makeThumbnail(abs, m.kind, join(tmpDir, `thumb-${i}.jpg`), thumbWidth);
      if (thumb) {
        content.push({type: 'image', data: thumb, mimeType: 'image/jpeg'});
      } else {
        content.push({type: 'text', text: '   (could not render thumbnail)'});
      }
    }
    return {content};
  },
);

// ── 5e. rank_media — apply the CLIENT AI's own vision ranking ─────────────────
server.registerTool(
  'rank_media',
  {
    title: 'Apply your media ranking (your vision, not an API)',
    description: "Commit YOUR judgment of the scraped media after review_media. Provide rankings: an array of {file, score (0-10), keep, role?, sceneIndex?}. Items with keep:false are dropped. Kept items are sorted by score (best first) and written into script.json as the scraped media, preserving stock backgrounds. Optionally set role ('frame'|'background') and sceneIndex per item to bind it to a scene.",
    inputSchema: {
      slug: z.string().describe('Run slug'),
      rankings: z.array(z.object({
        file: z.string().describe('The media file path exactly as shown in review_media (e.g. "instagram-reel-tool/<slug>/scraped/asset_000.png")'),
        score: z.number().min(0).max(10).describe('Your editorial quality score 0-10'),
        keep: z.boolean().describe('Whether to keep this item in the reel'),
        role: z.enum(['frame', 'background']).optional().describe('Optional: how this clip is used. frame = product card; background = full-bleed.'),
        sceneIndex: z.number().int().min(0).optional().describe('Optional: pin this clip to a specific scene index.'),
      })).min(1),
    },
  },
  async ({slug, rankings}) => {
    const cleanSlug = slugify(slug);
    const path = stageFile(cleanSlug, 'script');
    if (!existsSync(path)) throw new Error('script.json missing — run set_strategy first.');
    const script = JSON.parse(readFileSync(path, 'utf-8'));
    const allMedia = script.media || [];
    const byFile = new Map(allMedia.map((m) => [m.file, m]));

    // Apply the AI's ranking to the scraped items it judged.
    const kept = [];
    for (const r of rankings) {
      const item = byFile.get(r.file);
      if (!item) continue; // unknown file — ignore
      if (r.keep === false) continue;
      kept.push({
        ...item,
        visionScore: r.score,
        rankedBy: 'client-ai',
        ...(r.role ? {role: r.role} : {role: item.role || 'frame'}),
        ...(typeof r.sceneIndex === 'number' ? {sceneIndex: r.sceneIndex} : {}),
      });
    }
    kept.sort((a, b) => (b.visionScore || 0) - (a.visionScore || 0));

    // Preserve stock backgrounds + any scraped item the AI didn't mention.
    const rankedFiles = new Set(rankings.map((r) => r.file));
    const stock = allMedia.filter((m) => m.source === 'stock');
    const untouchedScraped = allMedia.filter((m) => (m.source === 'scrapling' || m.source === 'search') && !rankedFiles.has(m.file));

    const merged = [...stock, ...kept, ...untouchedScraped];
    script.media = merged;
    script.scrapedCount = merged.filter((m) => m.source === 'scrapling' || m.source === 'search').length;
    script.stockCount = merged.filter((m) => m.source === 'stock').length;
    writeFileSync(path, JSON.stringify(script, null, 2) + '\n');

    return {content: [{type: 'text', text: JSON.stringify({
      ok: true,
      kept: kept.length,
      dropped: rankings.filter((r) => r.keep === false).length,
      totalMedia: merged.length,
      ranking: kept.map((m) => ({file: m.file.split('/').pop(), score: m.visionScore, role: m.role, sceneIndex: m.sceneIndex})),
    }, null, 2)}]};
  },
);


server.registerTool(
  'attach_media',
  {
    title: 'Attach media clips to specific scenes',
    description: 'Bind specific clip files (already in public/) to scene indices, with role: "background" (full-bleed video behind the slide) or "frame" (in a browser-chrome card). Updates script.json directly. Use this to override or supplement the auto-collected media after set_strategy.',
    inputSchema: {
      slug: z.string().describe('Run slug'),
      attachments: z.array(z.object({
        sceneIndex: z.number().int().min(0).describe('Zero-based scene index'),
        file: z.string().describe('Relative file path under public/ (e.g. "instagram-reel-tool/<slug>/scrape/foo.png")'),
        kind: z.enum(['image', 'video']),
        role: z.enum(['background', 'frame']).describe('"background" = full-bleed; "frame" = product showcase card'),
        source: z.string().optional().describe('Optional provenance tag (pexels, scrapling, etc.)'),
        orientation: z.enum(['landscape', 'portrait', 'square']).optional(),
        alt: z.string().optional(),
      })).min(1),
      mode: z.enum(['append', 'replace']).optional().describe('"append" (default) merges with existing media; "replace" wipes the script.json media list first.'),
    },
  },
  async ({slug, attachments, mode = 'append'}) => {
    const cleanSlug = slugify(slug);
    const path = stageFile(cleanSlug, 'script');
    if (!existsSync(path)) throw new Error('script.json missing — call set_strategy first');
    const script = JSON.parse(readFileSync(path, 'utf-8'));
    const newClips = attachments.map((a) => ({
      file: a.file,
      kind: a.kind,
      role: a.role,
      source: a.source || 'mcp',
      orientation: a.orientation || 'unknown',
      sceneIndex: a.sceneIndex,
      alt: a.alt || '',
    }));
    script.media = mode === 'replace' ? newClips : [...(script.media || []), ...newClips];
    writeFileSync(path, JSON.stringify(script, null, 2));
    return {content: [{type: 'text', text: JSON.stringify({ok: true, totalMedia: script.media.length}, null, 2)}]};
  },
);

// ── 7. apply_pattern ────────────────────────────────────────────────────────
server.registerTool(
  'apply_pattern',
  {
    title: 'Apply pattern (palette + text effect)',
    description: 'Stage 3 — persist palette overrides, text effect, and captions toggle into pattern.json. Cheap stage; just metadata.',
    inputSchema: {
      slug: z.string(),
      colorOverrides: z.object({
        primary: z.string().optional(),
        secondary: z.string().optional(),
        accent: z.string().optional(),
        highlight: z.string().optional(),
      }).optional(),
      textEffect: z.enum(['word-stagger', 'line-fade', 'scale-pop', 'blur-reveal']).optional(),
      captions: z.boolean().optional(),
      skipCta: z.boolean().optional(),
    },
  },
  async ({slug, colorOverrides, textEffect, captions, skipCta}) => {
    const args = ['--stage', 'pattern', '--slug', slugify(slug), '--progress', '--template', 'huashu'];
    if (colorOverrides && Object.keys(colorOverrides).length) args.push('--color-overrides', JSON.stringify(colorOverrides));
    if (textEffect) args.push('--text-effect', textEffect);
    if (captions === false) args.push('--no-captions');
    if (skipCta) args.push('--skip-cta');
    await runGenerator(args);
    return {content: [{type: 'text', text: JSON.stringify({ok: true, pattern: readStage(slug, 'pattern')}, null, 2)}]};
  },
);

// ── 8. synthesize_voice ─────────────────────────────────────────────────────
server.registerTool(
  'synthesize_voice',
  {
    title: 'Synthesize the voiceover',
    description: 'Stage 4 — generates voiceover audio. Supports Pocket-TTS (voice cloning) and TADA (Hume MLX). Default engine is pocket-tts.',
    inputSchema: {
      slug: z.string(),
      engine: z.enum(['pocket-tts', 'tada']).optional().describe('Voice backend. "pocket-tts" = Kyutai voice cloning (default). "tada" = Hume MLX-TADA.'),
      voiceStyle: z.enum(['excited-explainer']).optional().describe('TADA style preset (only for engine:"tada").'),
      voiceFile: z.string().optional().describe('Pocket-TTS voice embedding .safetensors path (only for engine:"pocket-tts").'),
      tone: z.string().optional().describe('Pocket-TTS tone: "energetic", "calm", "dramatic" (only for engine:"pocket-tts").'),
      tadaPromptAudio: z.string().optional().describe('TADA reference audio path (only for engine:"tada").'),
      tadaPromptText: z.string().optional().describe('TADA reference transcript (only for engine:"tada").'),
      tadaModel: z.string().optional().describe('TADA model or weights path (only for engine:"tada").'),
      quantize: z.enum(['4', '8']).optional().describe('TADA quantization bits (only for engine:"tada").'),
      autoTrim: z.boolean().optional().describe('Trim silence from each clip'),
      skipTts: z.boolean().optional().describe('Skip TTS entirely (preview-only mode)'),
    },
  },
  async ({slug, engine, voiceStyle, voiceFile, tone, tadaPromptAudio, tadaPromptText, tadaModel, quantize, autoTrim, skipTts}) => {
    const effectiveEngine = engine || 'pocket-tts';
    const args = ['--stage', 'voice', '--slug', slugify(slug), '--progress', '--voice-engine', effectiveEngine];
    if (effectiveEngine === 'pocket-tts') {
      if (voiceFile) args.push('--voice-file', voiceFile);
      if (tone) args.push('--tone', tone);
    } else {
      args.push('--voice-style', voiceStyle || 'excited-explainer');
      if (tadaPromptAudio) args.push('--tada-prompt-audio', tadaPromptAudio);
      if (tadaPromptText) args.push('--tada-prompt-text', tadaPromptText);
      if (tadaModel) args.push('--tada-model', tadaModel);
      if (quantize) args.push('--tada-quantize', quantize);
    }
    if (autoTrim) args.push('--auto-trim');
    if (skipTts) args.push('--skip-tts');
    await runGenerator(args);
    const stage = readStage(slug, 'voice');
    return {content: [{type: 'text', text: JSON.stringify({
      ok: Boolean(stage),
      engine: stage?.engine || 'tada',
      voiceStyle: stage?.voiceStyle ?? voiceStyle,
      audioDuration: stage?.audioDuration ?? null,
      audioFile: stage?.audioFile ?? null,
      tadaModel: stage?.tadaModel ?? null,
      quantize: stage?.tadaQuantize ?? quantize ?? null,
    }, null, 2)}]};
  },
);

// ── 8b. list_voices ──────────────────────────────────────────────────────────
server.registerTool(
  'list_voices',
  {
    title: 'List available voices',
    description: 'Returns the active Hume MLX-TADA configuration summary. TADA is the only supported voice backend in this repository.',
    inputSchema: {},
  },
  async () => {
    const tada = {
      engine: 'tada',
      configured: Boolean(process.env.TADA_PYTHON && process.env.TADA_VOICE_STYLE),
      python: process.env.TADA_PYTHON || null,
      voiceStyle: process.env.TADA_VOICE_STYLE || null,
      model: process.env.TADA_WEIGHTS || process.env.TADA_MODEL || 'HumeAI/mlx-tada-1b',
      tokenizer: process.env.TADA_TOKENIZER || null,
      availableStyles: Object.values(TADA_VOICE_STYLES),
    };
    return {content: [{type: 'text', text: JSON.stringify({tada}, null, 2)}]};
  },
);

// ── 9. render_reel ──────────────────────────────────────────────────────────
server.registerTool(
  'render_reel',
  {
    title: 'Render the final reel MP4',
    description: 'Stage 6 — assembles props, runs whisper.cpp word-level alignment (auto), and renders the 1080x1920 MP4 via Remotion. Returns the absolute path to the rendered file. Requires source + script + pattern + voice stages to have completed.',
    inputSchema: {
      slug: z.string(),
      highBitrate: z.boolean().optional().describe('Use CRF 16 (much higher quality, larger file)'),
      loopTail: z.boolean().optional().describe('Cross-fade end to start so the reel loops cleanly'),
      skipAlign: z.boolean().optional().describe('Skip whisper.cpp word-level alignment'),
    },
  },
  async ({slug, highBitrate, loopTail, skipAlign}) => {
    const args = ['--stage', 'render', '--slug', slugify(slug), '--progress'];
    if (highBitrate) args.push('--high-bitrate');
    if (loopTail) args.push('--loop-tail');
    if (skipAlign) args.push('--skip-align');
    await runGenerator(args);
    const render = readStage(slug, 'render');
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          ok: Boolean(render?.output),
          output: render?.output || '',
          duration: render?.finalDuration || 0,
        }, null, 2),
      }],
    };
  },
);

// ── 10. get_run_state ───────────────────────────────────────────────────────
server.registerTool(
  'get_run_state',
  {
    title: 'Get the current run state',
    description: 'Returns a snapshot of all stages (which have completed, key payload data) so the AI can plan its next move. Cheaper than re-reading individual stage files.',
    inputSchema: {
      slug: z.string(),
    },
  },
  async ({slug}) => {
    const cleanSlug = slugify(slug);
    const checkpoint = readCheckpoint(cleanSlug);
    const summary = {
      slug: cleanSlug,
      checkpoint: checkpoint?.stages || {},
      source: readStage(cleanSlug, 'source')
        ? {transcript: (readStage(cleanSlug, 'source').transcript || '').slice(0, 600), mode: readStage(cleanSlug, 'source').mode}
        : null,
      script: readStage(cleanSlug, 'script')
        ? {
          sceneCount: (readStage(cleanSlug, 'script').strategy?.scenes || []).length,
          scrapedCount: readStage(cleanSlug, 'script').scrapedCount,
          stockCount: readStage(cleanSlug, 'script').stockCount,
          mediaCount: (readStage(cleanSlug, 'script').media || []).length,
          resolvedBrands: readStage(cleanSlug, 'script').resolvedBrands || [],
        }
        : null,
      pattern: readStage(cleanSlug, 'pattern'),
      voice: readStage(cleanSlug, 'voice')
        ? {audioDuration: readStage(cleanSlug, 'voice').audioDuration, audioFile: readStage(cleanSlug, 'voice').audioFile}
        : null,
      render: readStage(cleanSlug, 'render')
        ? {output: readStage(cleanSlug, 'render').output, duration: readStage(cleanSlug, 'render').finalDuration}
        : null,
      footage: readStage(cleanSlug, 'footage')
        ? {master: readStage(cleanSlug, 'footage').master?.file, durationSeconds: readStage(cleanSlug, 'footage').master?.durationSeconds}
        : null,
      footageTranscript: readStage(cleanSlug, 'footage-transcript')
        ? {wordCount: (readStage(cleanSlug, 'footage-transcript').words || []).length, text: (readStage(cleanSlug, 'footage-transcript').text || '').slice(0, 600)}
        : null,
      editPlan: readStage(cleanSlug, 'edit_plan')
        ? {cuts: (readStage(cleanSlug, 'edit_plan').cuts || []).length, beats: (readStage(cleanSlug, 'edit_plan').beats || []).length, totalSeconds: readStage(cleanSlug, 'edit_plan').totalSeconds}
        : null,
    };
    return {content: [{type: 'text', text: JSON.stringify(summary, null, 2)}]};
  },
);

// ── 11. list_layouts ────────────────────────────────────────────────────────
server.registerTool(
  'list_layouts',
  {
    title: 'List all footage archetypes + their data shapes (call before set_edit_plan)',
    description: 'Returns every treatment and all 16 archetypes with the exact layoutData each needs + a filled example, the caption schema, and the cycle rhythm. Call this first so you never guess a layoutData shape.',
    inputSchema: {},
  },
  async () => {
    const catalog = {
      callThisFirst: 'In footage mode, read this before set_edit_plan. It lists every treatment + archetype and the exact layoutData each needs.',
      treatments: {
        'talking-head': 'full-screen one speaker; set speaker:"A"/"B" (dual ingest); zoom? for punch-in',
        split: 'archetype card on TOP half + speaker on BOTTOM half (set archetype+layoutData AND speaker)',
        'two-shot': 'both speakers in frame together (needs dual ingest)',
        broll: 'full-screen stock/scraped cutaway (mediaRef+mediaKind); speaker audio continues',
        overlay: 'full-screen archetype card on a blurred-speaker bed',
        'frame-overlay': 'speaker full-screen + a floating product screenshot (mediaRef)',
      },
      archetypes: {
        stat: {shape: '{value, label, subtext?}', example: {value: '90%', label: 'faster', subtext: 'vs the old way'}},
        'bar-graph': {shape: '{title?, unit?, bars:[{label,value}] (>=2)}', example: {title: 'Speed', unit: 'x', bars: [{label: 'Old', value: 1}, {label: 'New', value: 8}]}},
        'pie-chart': {shape: '{title?, slices:[{label,value}] (>=2)}', example: {title: 'Share', slices: [{label: 'AI', value: 70}, {label: 'Manual', value: 30}]}},
        'progress-graph': {shape: '{title?, unit?, points:[{label,value}] (>=3)}', example: {title: 'Growth', points: [{label: 'Jan', value: 2}, {label: 'Feb', value: 5}, {label: 'Mar', value: 9}]}},
        checklist: {shape: '{title?, items:[{text}] (>=2)}', example: {title: 'What you get', items: [{text: 'No code'}, {text: 'One prompt'}]}},
        comparison: {shape: '{leftTitle, rightTitle, leftItems[], rightItems[]}', example: {leftTitle: 'Generative', rightTitle: 'Agentic', leftItems: ['Makes content'], rightItems: ['Does tasks']}},
        'motion-graphic': {shape: '{title?, nodes:[{label}] (>=2), flow:"linear"|"cycle"|"hub"}', example: {title: 'The stack', nodes: [{label: 'Chatbot'}, {label: 'Generative'}, {label: 'Agentic'}], flow: 'linear'}},
        'github-card': {shape: '{owner, repo, description?, language?, stars?, forks?}', example: {owner: 'acme', repo: 'agent', description: 'Open-source AI agent', language: 'TypeScript', stars: '12.4k'}},
        'myth-fact': {shape: '{myth, fact}', example: {myth: 'AI is just ChatGPT', fact: 'It is the tip of the iceberg'}},
        timeline: {shape: '{title?, events:[{label,sublabel?}] (>=2)}', example: {title: 'The AI Pyramid', events: [{label: 'Chatbots', sublabel: 'you talk, it answers'}, {label: 'Agentic AI', sublabel: 'agents do tasks'}]}},
        'quote-card': {shape: '{text, author, role?}', example: {text: 'Human + AI beats AI alone', author: 'the takeaway'}},
        receipt: {shape: '{title?, items:[{label,value}] (>=2), total?}', example: {title: 'The math', items: [{label: 'Prompts', value: '1'}, {label: 'Sales', value: '1'}], total: '1 prompt to 1 sale'}},
        'tweet-card': {shape: '{handle, name?, text, likes?, avatarRef?}', example: {handle: 'levelsio', name: 'Pieter', text: 'AI changes everything', likes: '2.1k'}},
        'notification-stack': {shape: '{notifications:[{app,title,body?,time?}] (>=1)}', example: {notifications: [{app: 'Stripe', title: 'Payment received', body: '$2,400', time: 'now'}]}},
        'before-after': {shape: '{beforeRef, afterRef, beforeLabel?, afterLabel?} (image paths)', example: {beforeRef: 'instagram-reel-tool/<slug>/broll/before.png', afterRef: 'instagram-reel-tool/<slug>/broll/after.png'}},
        'phone-mockup': {shape: '{mediaRef, scroll?} (image path)', example: {mediaRef: 'instagram-reel-tool/<slug>/broll/app.png', scroll: true}},
      },
      caption: {shape: '{words:[{text, scale:"s"|"m"|"hero", accent?}] (exactly one hero), entrance:"blur-reveal"|"rise"|"slide-x", anchor:"bottom"}', note: 'Selective: one short phrase, one hero keyword from a spoken word. Omit on cards.'},
      cycle: 'Speaker A (talking-head) -> Speaker B -> two-shot or broll -> split (card top + speaker bottom) -> repeat. Open on a problem, end on a takeaway.',
    };
    return {content: [{type: 'text', text: JSON.stringify(catalog, null, 2)}]};
  },
);

// ─── stdio transport ────────────────────────────────────────────────────────
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // No console.log — stdio is the JSON-RPC channel. stderr is fine.
  console.error('[reel-tool-mcp] connected on stdio');
}

main().catch((e) => {
  console.error('[reel-tool-mcp] fatal:', e);
  process.exit(1);
});
