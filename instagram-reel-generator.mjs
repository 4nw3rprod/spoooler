#!/usr/bin/env node
import {spawn, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {basename, dirname, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {probeVideo, normalizeFootage} from './footage/ingest.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');
const toolRoot = __dirname;
const transcriberRoot = process.env.IG_TRANSCRIBER_ROOT || '';
const fps = 30;
// Must match TRANSITION_FRAMES in remotion/ReelSkill.tsx — the per-boundary
// visual overlap window between scenes (TransitionSeries). Used by the
// audio-first pacing math so the post-overlap visible timeline exceeds the VO.
const TRANSITION_FRAMES = 12;

const hookFormulaGuide = [
  'Pattern Interrupt: Stop [what they are doing]. [unexpected command].',
  'Contrarian Take: [common belief] is wrong. Here is what actually works.',
  'Mistake Hook: I [made a mistake] that [cost]. Here is what I learned.',
  'If You Qualifier: If you [specific situation], this is [what you need].',
  'Proof Hook: [result]. No [common excuse]. Here is exactly how.',
  'Empathy Hook: I know [specific frustration]. [validation]. [promise].',
];

const humanizerRules = [
  'Write in a conversational, first-person spoken English tone (using "I", "we", "you").',
  'Imagine you are talking directly to the camera explaining something to a friend. e.g. "Anthropic just dropped a feature...", "Yes, it is called...", "So you can set a workflow...".',
  'Write like a sharp human operator, not a motivational poster.',
  'Use plain verbs and concrete nouns. Cut filler and vague hype.',
  'Avoid AI tells: rule-of-three padding, inflated metaphors, generic transformation language, and tutorial-like meta commentary.',
  'Prefer one clear point per sentence. Let some sentences be short.',
  'Make the CTA feel useful, not needy.',
];

// ─── Per-run creative variation ─────────────────────────────────────────────
// Every run should feel distinct even from the same source. We deterministically
// pick a hook angle + narrative spine + energy from the run seed (slug+topic), so
// the same slug is reproducible for debugging but different inputs/slugs diverge.
// This is the "every single run should be different" requirement, implemented as
// controlled variation rather than randomness that would hurt cohesion.

const HOOK_ANGLES = [
  'Pattern Interrupt — open by telling them to STOP doing the obvious thing, then pivot.',
  'Contrarian Take — name a belief most people hold, then say why it is wrong.',
  'Curiosity Gap — tease a surprising outcome without revealing the how yet.',
  'Personal Stakes — open with "I" and a concrete moment or mistake that hooks emotionally.',
  'Bold Claim — lead with the single most impressive result or number, stated flatly.',
  'Direct Address — call out the exact person who needs this ("If you ...").',
];

const NARRATIVE_SPINES = [
  'Problem → Agitate → Solution → Proof → CTA (classic PAS).',
  'Hook → Three quick steps the viewer can copy → Result → CTA (how-to walkthrough).',
  'Hook → Surprising stat → What it means → What to do → CTA (insight-led).',
  'Hook → Before state → After state → The unlock between them → CTA (transformation).',
  'Hook → Myth → Truth → Demonstration → CTA (myth-bust).',
];

const ENERGY_PRESETS = [
  'calm-authoritative — measured, confident, editorial. Let ideas breathe.',
  'punchy-urgent — fast, energetic, short sentences, momentum.',
  'warm-conversational — friendly, first-person, like telling a friend a secret.',
  'sharp-analytical — precise, operator-to-operator, no fluff.',
];

// Deterministic 32-bit hash → used to pick variation lanes from the seed.
function seedHash(value) {
  let h = 2166136261 >>> 0;
  const s = String(value || '');
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function pickVariation(seed) {
  const h = seedHash(seed);
  return {
    hookAngle: HOOK_ANGLES[h % HOOK_ANGLES.length],
    spine: NARRATIVE_SPINES[(h >>> 3) % NARRATIVE_SPINES.length],
    energy: ENERGY_PRESETS[(h >>> 6) % ENERGY_PRESETS.length],
  };
}

// ─── Layout catalog ─────────────────────────────────────────────────────────
// The visual "arsenal". The LLM picks ONE layout per scene from this catalog
// based on what the scene is trying to communicate, and emits the structured
// `layoutData` that layout needs. The composition has a dedicated renderer for
// each. Keep names stable — the composition switches on them.
const LAYOUT_CATALOG = [
  {id: 'hook', when: 'Scene 1 only — the scroll-stopping opener.', data: 'none'},
  {id: 'statement', when: 'A punchy declarative idea or transition beat with no data.', data: 'none'},
  {id: 'stat', when: 'A single dominant number/percentage is the point (e.g. "87% fail", "3x faster").', data: '{value, label}'},
  {id: 'proof', when: 'Showing the actual product / a concrete how-to step. Uses real product media.', data: 'none'},
  {id: 'checklist', when: 'A list of steps, features, requirements, or do/don\'t items (3-5 items).', data: '{title, items:[{text, brand?}], checked?:bool}'},
  {id: 'comparison', when: 'Before vs after, old way vs new way, A vs B, this tool vs that tool.', data: '{leftTitle, rightTitle, leftItems:[string], rightItems:[string], leftBrand?, rightBrand?}'},
  {id: 'bar-graph', when: 'Comparing magnitudes across 2-5 named things, growth, or ranking.', data: '{title, unit?, bars:[{label, value, brand?}]}'},
  {id: 'pie-chart', when: 'Showing composition / share of a whole / a split (2-4 slices).', data: '{title, slices:[{label, value, brand?}]}'},
  {id: 'progress-graph', when: 'A trend over time / growth curve / before→after trajectory (3-6 points).', data: '{title, unit?, points:[{label, value}]}'},
  {id: 'motion-graphic', when: 'Explaining a process/flow/system that benefits from nodes connected by arrows (2-5 nodes).', data: '{title, nodes:[{label, brand?}], flow:"linear"|"cycle"|"hub"}'},
  {id: 'github-card', when: 'The script mentions a specific GitHub repository — render the repo as a GitHub-style card.', data: '{owner, repo, description?, language?, stars?, forks?, visibility?, url?}'},
  {id: 'cta', when: 'Final scene only — the call to action.', data: 'none'},
];

const LAYOUT_IDS = LAYOUT_CATALOG.map((l) => l.id);

const VELOCITY_VOICEOVER_MIN_CHARS = 800;
const VELOCITY_VOICEOVER_MAX_CHARS = 900;


function usage() {
  console.log(`Usage:
  node instagram-reel-tool/instagram-reel-generator.mjs --url <instagram-or-video-url> [options]

Options:
  --topic <text>              Optional positioning angle for the generated reel.
  --slug <text>               Output slug. Default: hash from URL and timestamp.
  --render                    Render the MP4 after generating props.
  --video-file <abs-path>     Use an uploaded local video file instead of an IG URL.
                              Audio is extracted via ffmpeg and transcribed via the
                              IG Content Transcriber's transcribe_local_audio tool.
  --skip-transcribe           Use --transcript instead of calling the IG transcriber.
  --transcript <text>         Transcript text for testing without Instagram download.
  --skip-tts                  Create props only, using an existing/placeholder audio path.
  --skip-media                Do not fetch Pexels/Unsplash media.
  --offline                   Skip Google scripting and media APIs; useful for deterministic local tests.
  --audio-file <public path>  Existing public audio path, e.g. voiceover/demo/voiceover.wav.
  --voice-engine <id>         Voice backend. Only tada is supported in this repository.
  --voice-style <id>          Required TADA style preset.
                                excited-explainer → energetic, explanatory delivery
  --tada-prompt-audio <path>  Deprecated low-level override for the TADA reference clip.
                              Prefer --voice-style.
  --tada-prompt-text <text>   Deprecated low-level override for the TADA reference transcript.
                              Prefer --voice-style.
  --tada-model <hf-id>        Optional MLX-TADA model or local weights path, e.g.
                              HumeAI/mlx-tada-1b or /absolute/path/to/weights.
  --tada-quantize <4|8>       4-bit (≈4.2 GB, single-pass friendly) or 8-bit
                              quantization for MLX-TADA. Recommended for
                              voiceovers >120 words to avoid OOM on Apple
                              Silicon (default: full precision).
  --template <id>             (deprecated) Template selection removed. Single clean template only.
  --brands <csv>              Brand/logo names to include. Default: script brands.
  --tool-url <url>            Optional tool website to fetch a preview/social image from.
  --duration <seconds>        Target duration. Default: 42. Ignored if --auto-duration is set.
  --auto-duration             Let the LLM write to natural pacing; final duration comes from
                              the actual TTS audio length. Initial scene-timing fallback is 32s.
  --stage <name>              Run JUST one stage of the pipeline. Reads predecessor
                              JSON from runs/<slug>/ and writes its own. Stages:
                                source    — URL/video/override → transcript
                                entities  — script → per-scene entity extraction
                                           (requires script stage to have run)
                                script    — transcript → LLM script + Pexels media
                                voice     — strategy.voiceover → TTS audio
                                render    — assemble props + render mp4
                                all       — full pipeline (default; same as omitting --stage)
                              Requires --slug to identify the run.
  --high-bitrate              Render at CRF 16 instead of Remotion's default. Larger
                              file (~1.5x), noticeably crisper detail in fast motion.
  --loop-tail                 Cross-fade the final 12 frames of the rendered MP4 with
                              the first 12 frames so the reel loops seamlessly on IG.
                              Adds ~5s of ffmpeg post-processing.
  --auto-trim                 Strip leading/trailing silence from the synthesized
                              voiceover audio (>0.4s of <-30dB). Default off.
  --help                      Show this help.

Required for full generation:
  GOOGLE_API_KEY or GEMINI_API_KEY
  TADA_PYTHON                 Python interpreter with mlx-tada installed (only for --voice-engine tada)
  TADA_VOICE_STYLE            Default TADA style id for non-interactive runs
  PEXELS_API_KEY and/or UNSPLASH_ACCESS_KEY

Optional:
  LOGO_DEV_TOKEN, GEMINI_MODEL, IG_TRANSCRIBER_ROOT,
  TADA_MODEL, TADA_WEIGHTS, TADA_TOKENIZER, TADA_QUANTIZE, TADA_REFERENCE_CACHE
`);
}

const TADA_VOICE_STYLES = {
  'excited-explainer': {
    id: 'excited-explainer',
    label: 'Excited Explainer',
    description: 'Energetic, explanatory delivery with clear emphasis and confident pacing.',
    // Bring-your-own reference: TADA clones voice + prosody from a short
    // sample audio clip. A Pocket-TTS-generated sample (temp=0.9) tends to
    // beat a raw recording because TADA's speaker-consistency rejection
    // sampler otherwise rejects off-prosody candidates. Drop your own sample
    // at this path (or override via --tada-prompt-audio / TADA_PROMPT_AUDIO).
    promptAudio: 'instagram-reel-tool/.cache/tada/elevan-pocket-source/reference-voice.wav',
    // Transcript of the reference sample above (must match exactly). Override
    // via --tada-prompt-text / TADA_PROMPT_TEXT for your own sample.
    promptText: "Hey everyone, welcome back to the channel. Today we are diving into something super exciting that I have been waiting to share with you for a while now. We are going to break down five completely different levels of Claude going all the way from the simple chatbot that most people know up to the most advanced agentic AI system. This is going to blow your mind. By the end of this video, you are going to understand exactly which level is right for your specific workflow. So grab a coffee, sit back, and let's get straight into it.",
    model: process.env.TADA_WEIGHTS || process.env.TADA_MODEL || 'HumeAI/mlx-tada-1b',
  },
};

function resolveTadaVoiceStyle(styleId) {
  const selected = String(styleId || '').trim();
  if (!selected) {
    throw new Error(`TADA voice style is required. Available styles: ${Object.keys(TADA_VOICE_STYLES).join(', ')}`);
  }
  const style = TADA_VOICE_STYLES[selected];
  if (!style) {
    throw new Error(`Unknown TADA voice style "${selected}". Available styles: ${Object.keys(TADA_VOICE_STYLES).join(', ')}`);
  }
  return style;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    if (['render', 'skip-transcribe', 'skip-tts', 'skip-media', 'skip-cta', 'skip-avatar', 'skip-scrape', 'skip-align', 'offline', 'progress', 'help', 'no-captions', 'auto-duration', 'export-voice', 'high-bitrate', 'loop-tail', 'auto-trim', 'retain-transcript', 'commit'].includes(key)) {
      args[key] = true;
    } else {
      args[key] = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

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
  loadEnvFile(join(projectRoot, '.env'));
  loadEnvFile(join(toolRoot, '.env'));
  loadEnvFile(join(toolRoot, '.env.local'));
}

function emitProgress(stage, percent, message, props = undefined, extra = {}) {
  if (!globalThis.__reelProgress) return;
  process.stderr.write(JSON.stringify({type: 'progress', stage, percent, message, props, ...extra}) + '\n');
}

function ensureDir(path) {
  mkdirSync(path, {recursive: true});
}

// ─── Stage I/O ─────────────────────────────────────────────────────────────────
// Per-slug stage state lives in `runs/<slug>/<stage>.json`. Each stage reads
// its predecessor's JSON, does its work, writes its own JSON, and updates a
// top-level `checkpoint.json` that summarises which stages are fresh and when
// they ran. The UI's GET /api/runs/:slug returns the checkpoint so the React
// side can paint stale badges and pre-populate edit fields without re-running
// upstream work.
const STAGE_NAMES = ['source', 'entities', 'script', 'prerender', 'pattern', 'voice', 'avatar', 'render', 'ingest', 'transcribe-footage', 'edit-plan', 'render-footage'];

function stageDir(slug) {
  return resolve(toolRoot, 'runs', slug);
}

function stageFilePath(slug, stageName) {
  return join(stageDir(slug), `${stageName}.json`);
}

function readStageJson(slug, stageName) {
  const path = stageFilePath(slug, stageName);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`Failed to parse ${stageName}.json for slug ${slug}: ${error.message}`);
  }
}

function writeStageJson(slug, stageName, data) {
  const dir = stageDir(slug);
  ensureDir(dir);
  writeFileSync(stageFilePath(slug, stageName), JSON.stringify(data, null, 2) + '\n');
}

function readCheckpoint(slug) {
  const path = join(stageDir(slug), 'checkpoint.json');
  if (!existsSync(path)) {
    return {slug, stages: {}, createdAt: new Date().toISOString()};
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    // Corrupt checkpoint — start fresh rather than crash the run.
    return {slug, stages: {}, createdAt: new Date().toISOString()};
  }
}

// Mark a stage as completed in checkpoint.json. Downstream stages get their
// `stale` flag flipped to true so the UI knows to re-run them. Upstream stages
// are left alone (they're still valid).
function updateCheckpointStage(slug, stageName, payload = {}) {
  const ck = readCheckpoint(slug);
  ck.stages = ck.stages || {};
  const now = new Date().toISOString();
  ck.stages[stageName] = {
    completed: true,
    ranAt: now,
    stale: false,
    ...payload,
  };
  // Mark every downstream stage as stale (it depended on what we just changed).
  const idx = STAGE_NAMES.indexOf(stageName);
  if (idx >= 0) {
    for (let i = idx + 1; i < STAGE_NAMES.length; i += 1) {
      const downstream = STAGE_NAMES[i];
      if (ck.stages[downstream]?.completed) {
        ck.stages[downstream].stale = true;
      }
    }
  }
  ck.updatedAt = now;
  ensureDir(stageDir(slug));
  writeFileSync(join(stageDir(slug), 'checkpoint.json'), JSON.stringify(ck, null, 2) + '\n');
  return ck;
}

function markPreRenderTextUpdated(slug, payload = {}) {
  const ck = readCheckpoint(slug);
  ck.stages = ck.stages || {};
  const now = new Date().toISOString();
  ck.stages.script = {
    ...(ck.stages.script || {}),
    completed: true,
    stale: false,
    preRenderTextAt: now,
    ...payload,
  };
  for (const downstream of ['voice', 'avatar', 'render']) {
    if (ck.stages[downstream]?.completed) ck.stages[downstream].stale = true;
  }
  ck.updatedAt = now;
  ensureDir(stageDir(slug));
  writeFileSync(join(stageDir(slug), 'checkpoint.json'), JSON.stringify(ck, null, 2) + '\n');
  return ck;
}

// Helper for stages that need a predecessor's output. Throws a clean error if
// the predecessor hasn't run yet — much friendlier than a JSON parse error
// 200 lines deep.
function requireStage(slug, stageName) {
  const data = readStageJson(slug, stageName);
  if (!data) {
    throw new Error(`Stage "${stageName}" has not been run for slug "${slug}". Run --stage ${stageName} first.`);
  }
  return data;
}

function slugify(value, fallback = 'reel') {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || fallback;
}

function hashText(value) {
  return createHash('sha1').update(value).digest('hex').slice(0, 8);
}

function cleanJson(content) {
  return String(content || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
}

function buildLlmRequest({transcript, sourceMeta, topic, durationSeconds, autoDuration}) {
  return {
    task: 'create_instagram_reel_script',
    output_contract: {
      format: 'json',
      schema: {
        hook: 'string',
        angle: 'string',
        searchQueries: ['string'],
        brands: ['string'],
        commentTrigger: 'string',
        commentReward: 'string',
        voiceover: 'string',
        // Per-beat optional fields:
        //   brands         -> small white-square chips in the mid-strip (logo.dev)
        //   brand_visuals  -> domain(s) whose OG image microlink will fetch and mix
        //                     into this beat's b-roll rotation as the product hero.
        // Use both for the beat that's *about* the tool, just brands for passing mentions.
        scenes: [
          {
            type: 'string', // 'hook', 'problem', 'solution', or 'cta'
            onScreen: 'string', 
            subtext: 'string', 
            spoken: 'string', 
            search: 'string', 
            brands: ['string'], 
            brand_visuals: ['string'], 
            gridData: {title: 'string', items: ['string']},
            miniBullets: ['string']
          }
        ],
      },
    },
    reel_structure: [
      {scene: 'Hook', purpose: 'Name the problem in memorable language.', onScreenStyle: 'short display copy', spokenStyle: 'one natural sentence'},
      {scene: 'Problem', purpose: 'Expand the pain with concrete repeated defaults.', onScreenStyle: 'rhythmic fragments', spokenStyle: 'one or two natural sentences'},
      {scene: 'Solution 1', purpose: 'Give the first action.', onScreenStyle: 'imperative phrase', spokenStyle: 'plain instruction'},
      {scene: 'Solution 2', purpose: 'Name or position the tool.', onScreenStyle: 'tool turns X into Y', spokenStyle: 'describe what the tool does'},
      {scene: 'Solution 3', purpose: 'State the outcome.', onScreenStyle: 'clear result without hype', spokenStyle: 'explain the design or business result'},
      {scene: 'CTA', purpose: 'Ask for a comment keyword and reward.', onScreenStyle: 'keyword only or pill text', spokenStyle: 'Comment KEYWORD and I will send you reward.'},
    ],
    style_rules: {
      hook_formulas: hookFormulaGuide,
      writing_style: humanizerRules,
      on_screen_examples: [
        'The Purple Problem.',
        'Same gradients. Same fonts. Same site.',
        'Use a design prompt.',
        'Base44 turns ideas into apps.',
        'Agency-level design. No designer.',
        'PROMPT',
      ],
      avoid: [
        'generic AI hype',
        'three vague benefits',
        'copying the transcript word for word',
        'long on-screen paragraphs',
      ],
    },
    context: {
      positioningAngle: topic,
      // In auto mode, omit a hard target so the LLM doesn't pad/truncate to hit a number.
      targetDurationSeconds: autoDuration ? null : durationSeconds,
      durationMode: autoDuration ? 'auto' : 'manual',
      sourceTitle: sourceMeta.title,
      sourceCaption: sourceMeta.caption,
      sourceInsights: sourceMeta.ai_insights,
      transcript: transcript.slice(0, 12000),
    },
  };
}

function buildVelocityLlmRequest({transcript, sourceMeta, topic, durationSeconds, autoDuration}) {
  return {
    task: 'create_velocity_travels_reel_script',
    output_contract: {
      format: 'json',
      schema: {
        hook: 'string',
        angle: 'string',
        searchQueries: ['string'],
        brands: ['Velocity Travels'],
        commentTrigger: 'string',
        commentReward: 'string',
        voiceover: 'string',
        scenes: [
          {
            type: 'string', // 'hook', 'problem', 'solution', or 'cta'
            onScreen: 'string', 
            subtext: 'string', 
            spoken: 'string', 
            search: 'string', 
            brands: ['Velocity Travels'], 
            brand_visuals: [], 
            gridData: {title: 'string', items: ['string']},
            miniBullets: ['string']
          }
        ],
      },
    },
    reel_structure: [
      {scene: 'Hook', purpose: 'Create curiosity before naming the package. Make the destination feel rare, sensory, and specific.', onScreenStyle: '3-6 words', spokenStyle: 'one short cinematic sentence'},
      {scene: 'Destination Reveal', purpose: 'Reveal the place or route with a vivid sensory payoff.', onScreenStyle: 'destination-led phrase', spokenStyle: 'one natural sentence'},
      {scene: 'Stay / Comfort', purpose: 'Show the hotel or stay promise without sounding like a brochure.', onScreenStyle: 'specific inclusion', spokenStyle: 'one short sentence'},
      {scene: 'Experience 1', purpose: 'Show one must-have excursion or iconic moment.', onScreenStyle: 'curiosity-first phrase', spokenStyle: 'one short sentence'},
      {scene: 'Experience 2', purpose: 'Show food, culture, beaches, shopping, nightlife, or nature depending on package.', onScreenStyle: 'sensory phrase', spokenStyle: 'one short sentence'},
      {scene: 'Ease / Inclusions', purpose: 'Explain what the package handles: transfers, tours, meals, visas, guide, dates, or customization.', onScreenStyle: 'package inclusion phrase', spokenStyle: 'one short sentence'},
      {scene: 'Price / Scarcity', purpose: 'If price/date is provided, make it easy to notice. Otherwise show limited seats or tailor-made plan.', onScreenStyle: 'price/date/limited seats', spokenStyle: 'one short sentence'},
      {scene: 'CTA', purpose: 'Ask the viewer to WhatsApp or DM Velocity Travels for itinerary/package details.', onScreenStyle: 'WHATSAPP / DM keyword', spokenStyle: 'direct CTA with contact intent'},
    ],
    style_rules: {
      brand: 'Velocity Travels',
      required_scene_count: '6 to 8 scenes. Prefer 8 when package details are rich, 6 when details are thin.',
      pacing: `NON-NEGOTIABLE: top-level voiceover must be ${VELOCITY_VOICEOVER_MIN_CHARS}-${VELOCITY_VOICEOVER_MAX_CHARS} characters including spaces. Scene spoken lines joined together must also land in that same range. Each slide has 5.0 seconds of visible time, so use compact, natural sentences without padding.`,
      on_screen_rules: [
        'No long paragraphs. 2-7 words per scene.',
        'Start with curiosity, not a generic destination name.',
        'Use concrete package details from the input: nights, hotels, meals, tours, transfers, price, dates, departure city, family/couple/group fit.',
        'If a detail is missing, do not invent exact prices, dates, hotel names, or visa terms.',
        'Write like a sharp human travel advisor, not a brochure or AI assistant.',
        'Use simple verbs. Prefer "has", "gets", "covers", "includes", "takes you" over inflated phrasing.',
      ],
      humanizer_rules: [
        'Avoid AI tells: "showcase", "highlight", "align", "vibrant", "breathtaking", "nestled", "rich cultural", "must-visit", "seamless", "curated" unless the input uses the word.',
        'Do not use "not just... but", "more than", "unlock", "discover", "elevate", "experience the magic", or rule-of-three slogan stacks.',
        'Avoid vague claims like "unforgettable memories", "perfect getaway", "world-class", "hidden gem", or "once-in-a-lifetime" unless the package brief proves it.',
        'No tailing negations such as "no stress" or "no hassle"; write full natural sentences instead.',
        'Each spoken line should sound like something a person would say in a WhatsApp voice note: specific, short, and a little curious.',
        `The voiceover must be ${VELOCITY_VOICEOVER_MIN_CHARS}-${VELOCITY_VOICEOVER_MAX_CHARS} characters, not words. Count characters before returning JSON.`,
        'Final anti-AI pass: before returning JSON, remove any line that sounds like a generic tourism ad and replace it with a concrete package detail.',
      ],
      search_rules: [
        'Every scene.search must be a stock-video search query for the exact destination or experience.',
        'Prefer vertical cinematic travel footage terms: luxury resort, beach, old town, skyline, street food, desert safari, island hopping, mountain lake, couples travel, family vacation.',
        'Do not search for software, business workflows, dashboards, AI, or generic office scenes.',
      ],
      avoid: [
        'B2B/operator language',
        'generic AI/tool framing',
        'overexplaining the package',
        'fake urgency unless seats/dates are provided',
        'gradient/overlay references',
        'soulless neutral copy',
        'inflated significance or fake luxury language',
      ],
    },
    context: {
      packageBrief: topic,
      targetDurationSeconds: autoDuration ? null : durationSeconds,
      durationMode: autoDuration ? 'auto' : 'manual',
      sourceTitle: sourceMeta.title,
      sourceCaption: sourceMeta.caption,
      sourceInsights: sourceMeta.ai_insights,
      transcript: transcript.slice(0, 12000),
    },
  };
}

// ─── LLM provider chain with per-process model memoization ────────────────────
// The first time we hit a working model, we cache its label and try it FIRST
// on all subsequent calls within the same generator process. Failures within
// this process are also cached so we skip dead models without paying their
// 30-90s timeout cost again. This is the single biggest pain point in the
// pipeline — without memoization, a Stage 2 run that has 2 LLM calls can waste
// 6+ minutes retrying the same dead NVIDIA endpoints back-to-back.
const llmStickyState = {
  workingModels: [],         // most-recently-successful labels, LRU-ish
  failedModels: new Set(),   // labels that have failed at least once
};

async function googleJson({system, user}, fallback) {
  // Provider chain order: NVIDIA NIM → Gemini → GroqCloud → hardcoded fallback.
  // Nvidia leads, Gemini follows, and GroqCloud serves as the broad-catalog fallback.
  const allAttempts = [
    ...buildNvidiaAttempts(),
    ...buildGeminiAttempts(),
    ...buildGroqAttempts(),
  ];

  if (!allAttempts.length) {
    emitProgress('script', 31, 'WARNING: No LLM providers configured. Set GOOGLE_API_KEY and/or GROQ_API_KEY in instagram-reel-tool/.env. Falling back to hardcoded strategy.');
    return fallback;
  }

  // Reorder: known-working models first (in LRU order), then untried, with
  // known-failed models LAST as a desperate fallback. We keep failed models in
  // the chain (instead of dropping them) because some failures are transient
  // (rate limit, network blip) and might recover on a much-later attempt — but
  // they're at the back of the queue so we don't pay their cold-start cost
  // unless we genuinely have nothing else.
  const byLabel = new Map(allAttempts.map((a) => [a.label, a]));
  const orderedLabels = [
    // 1. Most-recently-working first (skip failed ones since some sticky labels
    //    may have failed AFTER succeeding once — surprises happen).
    ...llmStickyState.workingModels.filter((l) => byLabel.has(l) && !llmStickyState.failedModels.has(l)),
    // 2. Untried (or recovered) models in their original config order.
    ...allAttempts
      .map((a) => a.label)
      .filter((l) => !llmStickyState.workingModels.includes(l) && !llmStickyState.failedModels.has(l)),
    // 3. Previously-failed models last — desperate fallback only.
    ...allAttempts
      .map((a) => a.label)
      .filter((l) => llmStickyState.failedModels.has(l) && !llmStickyState.workingModels.includes(l)),
  ];

  if (llmStickyState.workingModels.length || llmStickyState.failedModels.size) {
    emitProgress('script', 31, `LLM chain priority: ${llmStickyState.workingModels.length} known-working, ${llmStickyState.failedModels.size} dead, ${orderedLabels.length - llmStickyState.workingModels.length - llmStickyState.failedModels.size} untried`);
  }

  const failures = [];
  for (const label of orderedLabels) {
    const attempt = byLabel.get(label);
    if (!attempt) continue;
    const startedAt = Date.now();
    emitProgress('script', 32, `Requesting ${label}${llmStickyState.failedModels.has(label) ? ' (previously failed; retrying)' : ''}`);
    try {
      const result = await attempt.run({system, user});
      if (result && typeof result === 'object') {
        const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
        // Mark as working: prepend to LRU, remove from failed set if it had been there.
        llmStickyState.workingModels = [label, ...llmStickyState.workingModels.filter((l) => l !== label)].slice(0, 4);
        llmStickyState.failedModels.delete(label);
        emitProgress('script', 38, `Strategy returned by ${label} (${elapsed}s) — pinning to top of chain for next call`);
        return result;
      }
      throw new Error('empty result');
    } catch (error) {
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
      const message = (error?.message || String(error)).slice(0, 240);
      failures.push(`${label}: ${message}`);
      llmStickyState.failedModels.add(label);
      // Also evict from working list if it was sticky and just died.
      llmStickyState.workingModels = llmStickyState.workingModels.filter((l) => l !== label);
      emitProgress('script', 33, `${label} failed after ${elapsed}s (${message}) — skipping for the rest of this run`);
    }
  }

  emitProgress('script', 35, `All LLM providers exhausted (${failures.length} attempts). Using hardcoded fallback strategy.`);
  return fallback;
}

// Each "attempt" wraps a single (provider, model) pair. The outer loop in googleJson
// iterates these in declared order so the provider hierarchy remains predictable:
// NVIDIA first, Gemini second, GroqCloud last.
function buildGeminiAttempts() {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) return [];
  const models = (process.env.GEMINI_MODEL || 'gemini-3.5-flash,gemini-3.1-flash-lite,gemini-3.1-flash-lite-preview,gemini-3-flash-preview,gemini-2.5-flash,gemini-2.0-flash-lite,gemini-flash-lite-latest,gemini-flash-latest')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
  return models.map((model) => ({
    label: `Gemini ${model}`,
    run: async ({system, user}) => geminiCall(apiKey, model, system, user),
  }));
}

async function geminiCall(apiKey, model, system, user) {
  const response = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    timeoutMs: 45000,
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      systemInstruction: {parts: [{text: system}]},
      contents: [{role: 'user', parts: [{text: user}]}],
      generationConfig: {
        temperature: 0.65,
        responseMimeType: 'application/json',
      },
    }),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }
  const payload = await response.json();
  const content = payload.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('') || '';
  if (!content.trim()) throw new Error('empty Gemini response');
  return JSON.parse(cleanJson(content));
}

// NVIDIA NIM — OpenAI-compatible Chat Completions hosting Nemotron, DeepSeek,
// Mistral, and Kimi. Picked four strong catalog entries for structured JSON
// instruction following. The "thinking" mode some of these models support is
// explicitly disabled — we want a single quick JSON object, not a chain-of-thought.
function buildNvidiaAttempts() {
  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) return [];
  const models = (process.env.NVIDIA_MODEL || 'nvidia/nemotron-3-super-120b-a12b,deepseek-ai/deepseek-v4-pro,mistralai/mistral-large-3-675b-instruct-2512,moonshotai/kimi-k2.6')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
  return models.map((model) => ({
    label: `NVIDIA ${model}`,
    run: async ({system, user}) => nvidiaCall(apiKey, model, system, user),
  }));
}

async function nvidiaCall(apiKey, model, system, user) {
  const response = await fetchWithTimeout('https://integrate.api.nvidia.com/v1/chat/completions', {
    // 35s is enough for a healthy model to first-token; longer than that almost
    // always means the endpoint is wedged or rate-limited. The OLD 90s timeout
    // was the single biggest pipeline pain point — three dead models in a row
    // wasted 4.5 minutes per run. With sticky model memoization in googleJson(),
    // we only pay this cost once per model per process, not per call.
    timeoutMs: 35000,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      // OpenAI-compatible JSON mode — supported by most NIM endpoints.
      response_format: {type: 'json_object'},
      temperature: 0.65,
      max_tokens: 8192,
      // Disable chain-of-thought so the response is just the JSON we want. GLM-5,
      // Qwen3-thinking, and some Nemotron variants accept this; non-supporting
      // models silently ignore the field.
      chat_template_kwargs: {enable_thinking: false},
      messages: [
        {role: 'system', content: `${system}\n\nReturn STRICT JSON only — no commentary, no markdown, no <think> blocks.`},
        {role: 'user', content: user},
      ],
    }),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }
  const payload = await response.json();
  let content = payload.choices?.[0]?.message?.content || '';
  // Some thinking-capable models leak <think>...</think> blocks even when we ask for
  // JSON-only — strip them defensively before parsing.
  content = content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  if (!content) throw new Error('empty NVIDIA response');
  return JSON.parse(cleanJson(content));
}

function buildGroqAttempts() {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return [];
  const models = (process.env.GROQ_MODEL || 'llama-3.3-70b-versatile,llama-3.1-8b-instant')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
  return models.map((model) => ({
    label: `Groq ${model}`,
    run: async ({system, user}) => groqCall(apiKey, model, system, user),
  }));
}

async function groqCall(apiKey, model, system, user) {
  const response = await fetchWithTimeout('https://api.groq.com/openai/v1/chat/completions', {
    timeoutMs: 45000,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      // OpenAI-compatible JSON mode — supported on Groq's Llama 3.1+ models.
      response_format: {type: 'json_object'},
      temperature: 0.65,
      messages: [
        {role: 'system', content: `${system}\n\nReturn STRICT JSON only — no commentary, no markdown.`},
        {role: 'user', content: user},
      ],
    }),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }
  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content || '';
  if (!content.trim()) throw new Error('empty Groq response');
  return JSON.parse(cleanJson(content));
}

async function transcribeInput(url, model = 'base') {
  if (!transcriberRoot) {
    throw new Error(
      'URL/video transcription requires IG_TRANSCRIBER_ROOT to point at an MCP-compatible ' +
      'transcriber (must expose a `run_mcp_server.sh` with a `transcribe_input` tool). ' +
      'Set IG_TRANSCRIBER_ROOT in .env, or skip this step by passing --transcript/--topic directly.',
    );
  }
  emitProgress('transcribe', 12, 'Starting IG Content Transcriber MCP server');
  const {Client} = await import('@modelcontextprotocol/sdk/client/index.js');
  const {StdioClientTransport} = await import('@modelcontextprotocol/sdk/client/stdio.js');
  const transport = new StdioClientTransport({
    command: join(transcriberRoot, 'run_mcp_server.sh'),
    args: [],
    cwd: transcriberRoot,
  });
  const client = new Client({name: 'outgrow-instagram-reel-tool', version: '1.0.0'});
  await client.connect(transport);
  try {
    emitProgress('transcribe', 15, 'Calling transcribe_input through MCP (yt-dlp + Whisper, can take up to 5 min)');
    const startedAt = Date.now();
    const result = await client.callTool(
      {
        name: 'transcribe_input',
        arguments: {
          input_url: url,
          model_name: model,
          // Fresh transcription per run — was previously reusing cached Whisper output,
          // which made the same Instagram URL produce identical scripts every time.
          reuse_existing: false,
          include_transcript_text: true,
        },
      },
      undefined,
      {
        // MCP SDK defaults to 60s, which is way too short for an IG fetch +
        // Whisper transcription. yt-dlp regularly takes 30-60s on a slow IG
        // connection, then base-Whisper on a 30s clip is another 20-40s,
        // and the cold start of the Python venv adds 5-10s on top. 5 minutes
        // is a sane upper bound — still aborts on a genuinely wedged server.
        timeout: 300_000,
        // The transcriber emits progress notifications during yt-dlp + Whisper.
        // Reset the timer on each one so a 4-minute Whisper run that's actively
        // making progress doesn't trip a stale timeout.
        resetTimeoutOnProgress: true,
        // Hard ceiling regardless of progress chatter — kills truly stuck calls.
        maxTotalTimeout: 600_000,
        onprogress: (progress) => {
          const pct = typeof progress?.progress === 'number' ? Math.min(20, Math.round(15 + progress.progress * 5)) : 17;
          const msg = progress?.message || `Transcriber working (${((Date.now() - startedAt) / 1000).toFixed(0)}s elapsed)`;
          emitProgress('transcribe', pct, msg);
        },
      },
    );
    if (result.structuredContent) return result.structuredContent;
    const text = result.content?.find((item) => item.type === 'text')?.text || '';
    return JSON.parse(text);
  } finally {
    await client.close();
  }
}

// Extract a 16 kHz mono WAV from any video that ffmpeg can read. The MCP transcriber's
// transcribe_local_audio tool expects an audio file (libsndfile-readable). Returns the
// absolute path of the temp WAV — caller is responsible for cleaning it up.
function extractAudioFromVideo(videoPath, outputDir) {
  if (!existsSync(videoPath)) {
    throw new Error(`Cannot extract audio: source video missing at ${videoPath}`);
  }
  ensureDir(outputDir);
  const audioPath = join(outputDir, 'source-audio.wav');
  const result = spawnSync('ffmpeg', [
    '-y',
    '-i', videoPath,
    '-vn',                  // no video
    '-ar', '16000',         // 16 kHz — Whisper's native sample rate
    '-ac', '1',             // mono
    '-c:a', 'pcm_s16le',    // libsndfile-friendly
    audioPath,
  ], {encoding: 'utf8', maxBuffer: 1024 * 1024 * 16});
  if (result.status !== 0) {
    throw new Error(`ffmpeg failed to extract audio from video:\n${result.stderr || result.stdout || 'unknown error'}`);
  }
  // Verify ffmpeg actually wrote a non-empty file. ffmpeg occasionally returns 0
  // on inputs with no audio stream (e.g. video-only mp4) AND silently writes
  // nothing — the MCP server then rejects the missing/empty file. Catch that
  // here with the actual diagnostics so the user knows what to fix.
  if (!existsSync(audioPath)) {
    const stderrTail = (result.stderr || '').split('\n').slice(-15).join('\n');
    throw new Error(
      `ffmpeg returned 0 but did NOT produce ${audioPath}.\n` +
      `Source: ${videoPath}\n` +
      `ffmpeg tail:\n${stderrTail}\n` +
      `Most common cause: the video has no audio stream, or the source codec couldn't be decoded.`,
    );
  }
  const audioStat = statSync(audioPath);
  if (audioStat.size === 0) {
    throw new Error(
      `ffmpeg produced an empty WAV (0 bytes) at ${audioPath}. ` +
      `The source video likely has no audio stream — try a different file.`,
    );
  }
  return audioPath;
}

// Local-audio variant for uploaded videos. Extracts the audio track with ffmpeg,
// hands the WAV to the MCP server's transcribe_local_audio tool, and returns the
// same `videos[0]` shape transcribeInput produces so the rest of main() doesn't care
// where the transcript came from.
async function transcribeLocalVideo(videoPath, model = 'base') {
  emitProgress('transcribe', 8, `Extracting audio from uploaded video (${relative(projectRoot, videoPath)})`);
  // Stage the temp WAV inside the per-run dir so cleanupJobAssets handles cleanup.
  const stageDir = join(dirname(videoPath), 'transcribe-stage');
  const audioPath = extractAudioFromVideo(videoPath, stageDir);
  emitProgress('transcribe', 12, 'Starting IG Content Transcriber MCP server');
  const {Client} = await import('@modelcontextprotocol/sdk/client/index.js');
  const {StdioClientTransport} = await import('@modelcontextprotocol/sdk/client/stdio.js');
  const transport = new StdioClientTransport({
    command: join(transcriberRoot, 'run_mcp_server.sh'),
    args: [],
    cwd: transcriberRoot,
  });
  const client = new Client({name: 'outgrow-instagram-reel-tool', version: '1.0.0'});
  await client.connect(transport);
  try {
    emitProgress('transcribe', 15, 'Calling transcribe_local_audio through MCP (Whisper, can take up to 4 min for long clips)');
    const startedAt = Date.now();
    const result = await client.callTool(
      {
        name: 'transcribe_local_audio',
        arguments: {
          audio_path: audioPath,
          original_filename: basename(videoPath),
          model_name: model,
          include_transcript_text: true,
        },
      },
      undefined,
      {
        // Local audio path: no yt-dlp download to wait for, but Whisper-base
        // on a long clip can still hit 90+ seconds. 4 min ceiling is generous;
        // resetTimeoutOnProgress keeps a healthy long run alive.
        timeout: 240_000,
        resetTimeoutOnProgress: true,
        maxTotalTimeout: 480_000,
        onprogress: (progress) => {
          const msg = progress?.message || `Transcriber working (${((Date.now() - startedAt) / 1000).toFixed(0)}s elapsed)`;
          emitProgress('transcribe', 17, msg);
        },
      },
    );
    let payload;
    if (result.structuredContent) {
      payload = result.structuredContent;
    } else {
      const text = result.content?.find((item) => item.type === 'text')?.text || '';
      payload = JSON.parse(text);
    }
    // Surface the MCP server's own error when its PipelineError path fired —
    // otherwise callers see a generic "no transcript text" and have no clue.
    if (payload?.status === 'error' || payload?.error) {
      throw new Error(`transcribe_local_audio MCP returned error: ${payload.error || 'unknown'}`);
    }
    // Diagnostic — print the keys + a tiny preview so we can see the shape if it
    // changes shape in a future MCP version.
    const topKeys = Object.keys(payload || {}).join(', ');
    const firstVideo = payload?.videos?.[0];
    const transcriptLen = String(firstVideo?.transcript_text || '').length;
    emitProgress('transcribe', 18, `MCP response keys: [${topKeys}] | videos: ${payload?.videos?.length ?? 0} | transcript chars: ${transcriptLen}`);
    return payload;
  } finally {
    await client.close();
    // Best-effort cleanup of the temp WAV staged for the MCP call. The user's
    // uploaded video itself stays in the run dir until cleanupJobAssets fires.
    try {
      if (existsSync(audioPath)) rmSync(audioPath, {force: true});
      if (existsSync(stageDir)) rmSync(stageDir, {recursive: true, force: true});
    } catch { /* noop */ }
  }
}

function fallbackStrategy(transcript, topic) {
  const sentences = transcript.split(/(?<=[.!?])\s+/).filter(Boolean);
  const hook = sentences[0]?.slice(0, 120) || topic || 'Most AI workflows look the same.';
  const trigger = transcript.match(/\bcomment\s+([A-Z][A-Z0-9_-]{2,})\b/i)?.[1]?.toUpperCase() || 'PROMPT';
  const reward = trigger === 'PROMPT' ? 'the Design Master Prompt' : 'the workflow checklist';
  return {
    hook: hook.length > 12 ? hook : `The workflow bottleneck.`,
    angle: topic || 'Turn the source video into a problem-solution reel with one named tool.',
    searchQueries: ['AI app builder interface', 'software product dashboard', 'founder working laptop', 'web app design interface', 'marketing analytics'],
    brands: ['Outgrow'],
    commentTrigger: trigger,
    commentReward: reward,
    voiceover: [
      'Most AI-generated workflows look the same because everyone copies the visible tactic.',
      'The real problem is underneath: the bottleneck, the handoff, and the decision that still depends on you.',
      'Use a sharper design prompt before you start the build.',
      'Then run it inside a tool that can turn raw ideas into working apps with simple text prompts.',
      'That gives the AI clearer taste: better fonts, balanced layouts, and smoother micro-interactions without hiring a designer.',
      `Comment ${trigger} and I will send you ${reward}.`,
    ].join(' '),
    scenes: [
      {type: 'hook', onScreen: 'Workflow Looks Same', subtext: 'Most AI workflows repeat the visible tactic instead of fixing the actual bottleneck.', spoken: 'Most AI-generated workflows look the same because everyone copies the visible tactic.', search: 'AI app builder interface', miniBullets: []},
      {type: 'problem', onScreen: 'Same tactic. Same bottleneck.', subtext: 'The real issue is the handoff and decision that still depends on you.', spoken: 'The real problem is underneath: the bottleneck, the handoff, and the decision that still depends on you.', search: 'software product dashboard', miniBullets: []},
      {type: 'solution', onScreen: 'Use a design prompt.', subtext: 'Sharper input gives the model a better design direction before the build starts.', spoken: 'Use a sharper design prompt before you start the build.', search: 'web app design interface', miniBullets: []},
      {type: 'solution', onScreen: 'Ideas become apps.', subtext: 'The right builder turns raw notes into working screens with simple text prompts.', spoken: 'Then run it inside a tool that can turn raw ideas into working apps with simple text prompts.', search: 'founder working laptop', miniBullets: []},
      {type: 'solution', onScreen: 'Design without hiring.', subtext: 'Better taste shows up in fonts, spacing, layouts, and smoother micro-interactions.', spoken: 'That gives the AI clearer taste: better fonts, balanced layouts, and smoother micro-interactions without hiring a designer.', search: 'marketing analytics', miniBullets: []},
      {type: 'cta', onScreen: `Get ${trigger}`, subtext: `Comment ${trigger} and I will send the exact resource.`, spoken: `Comment ${trigger} and I will send you ${reward}.`, search: 'business notes checklist', miniBullets: []},
    ],
  };
}

// Extract positioning angle, brand names, and tool URLs from a freshly-transcribed
// reel, or directly from the positioning angle/topic if no transcript is present.
// Lets the user leave the Source / Pattern fields blank — the LLM derives
// them from the transcript or topic so each new IG URL produces its own distinct strategy
// without manual setup. User-supplied values (when non-empty) always win.
async function extractMetadataFromTranscript({transcript, sourceMeta, topic}) {
  const fallback = {topic: '', brands: [], toolUrls: []};
  if ((!transcript || transcript.length < 32) && (!topic || topic.length < 12)) return fallback;
  const system = [
    'You are a metadata extractor for short-form Instagram reels.',
    'Read the transcript or positioning angle and return STRICT JSON matching the schema.',
    'topic: a one-sentence positioning angle for the reel (max 18 words). Frame as a B2B operator/founder hook.',
    'brands: array of CANONICAL PARENT COMPANY brand names actually mentioned. The renderer looks up icons by parent company in @lobehub/icons, so always normalise sub-products to their parent:',
    '  • NotebookLM, Bard, Gemini, Veo, Imagen → "Google"',
    '  • Claude, Claude Code, Sonnet, Haiku, Opus → "Anthropic"',
    '  • ChatGPT, GPT-4, Sora, DALL·E, Codex → "OpenAI"',
    '  • Copilot → "GitHub" (when about coding) or "Microsoft" (when about M365)',
    '  • CapCut, TikTok → "ByteDance" (or use "CapCut" / "TikTok" if the icon library has them)',
    '  • Vercel v0 → "Vercel"   • Cursor → "Cursor"   • Replit → "Replit"',
    'If a brand mentioned is itself a top-level company (e.g. "Notion", "Figma", "Adobe"), keep it as is.',
    'Skip generic terms ("AI", "the tool", "this app"). 1-3 entries max. Empty array if no real brand is named.',
    'tool_urls: array of AT LEAST 5 official website URLs (with https://) for the companies, products, tools, or general topics discussed. If fewer than 5 specific tools are mentioned, fill the rest of the array with high-quality informational or topic-related websites (e.g., wikipedia pages, official documentation, or relevant news sites). You MUST return 5 or more URLs.',
    'No commentary, no prose. JSON only.',
  ].join('\n');
  
  const contentToAnalyze = transcript && transcript.length >= 32 ? transcript.slice(0, 8000) : `Topic / Positioning Angle: ${topic}`;
  const user = JSON.stringify({
    output_schema: {topic: 'string', brands: ['string'], tool_urls: ['string']},
    source: {
      title: sourceMeta?.title || '',
      caption: sourceMeta?.caption || '',
      content: contentToAnalyze,
    },
  });
  try {
    const result = await googleJson({system, user}, fallback);
    return {
      topic: typeof result?.topic === 'string' ? result.topic.trim() : '',
      brands: Array.isArray(result?.brands) ? result.brands.map((b) => String(b).trim()).filter(Boolean) : [],
      toolUrls: Array.isArray(result?.tool_urls) ? result.tool_urls.map((u) => String(u).trim()).filter(Boolean) : [],
    };
  } catch {
    return fallback;
  }
}

function fallbackVelocityStrategy(transcript, topic) {
  const brief = [topic, transcript].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  const destination =
    brief.match(/\b(Bali|Dubai|Thailand|Bangkok|Phuket|Krabi|Singapore|Malaysia|Vietnam|Kashmir|South Africa|Europe|Switzerland|Japan|Iceland|Maldives|Mauritius|Turkey|Azerbaijan|Georgia|Sri Lanka)\b/i)?.[0]
    || 'your next escape';
  const price = brief.match(/(?:₹\s*\d[\d,.]*|(?:\bINR\b|\bRs\.?)\s*\d[\d,.]*)(?:\s?\/-)?/i)?.[0] || '';
  const trigger = destination === 'your next escape' ? 'TRIP' : destination.toUpperCase().replace(/\s+/g, '');
  const priceLine = price ? `Starting ${price}` : 'Limited custom departures';
  const strategy = {
    hook: `${destination} without the guesswork.`,
    angle: topic || `Velocity Travels package for ${destination}`,
    searchQueries: [
      `${destination} cinematic travel`,
      `${destination} luxury hotel resort`,
      `${destination} famous tourist attraction`,
      `${destination} local food market`,
      `${destination} scenic landscape`,
      `${destination} airport transfer vacation`,
      `${destination} couple family travel`,
      `${destination} sunset travel`,
    ],
    brands: ['Velocity Travels'],
    commentTrigger: trigger,
    commentReward: 'the full itinerary',
    voiceover: '',
    scenes: [
      {type: 'hook', onScreen: 'Skip The Guesswork', subtext: '', spoken: `${destination} sounds simple until you start choosing hotels, routes, transfers, and the one day you cannot waste.`, search: `${destination} cinematic travel`, brands: ['Velocity Travels'], brand_visuals: [], miniBullets: []},
      {type: 'problem', onScreen: destination, subtext: '', spoken: `This plan keeps the messy part off your phone, so you land in ${destination} with the main pieces sorted.`, search: `${destination} aerial landmark travel`, brands: ['Velocity Travels'], brand_visuals: [], miniBullets: []},
      {type: 'solution', onScreen: 'Stay Sorted Early', subtext: '', spoken: 'Your stay is picked around comfort and location, not a random deal that looks nice until check-in.', search: `${destination} luxury hotel resort`, brands: ['Velocity Travels'], brand_visuals: [], miniBullets: []},
      {type: 'solution', onScreen: 'See The Right Places', subtext: '', spoken: 'The route gives time to the places people actually remember, with enough space to stop instead of rushing through them.', search: `${destination} famous tourist attraction`, brands: ['Velocity Travels'], brand_visuals: [], miniBullets: []},
      {type: 'solution', onScreen: 'Eat. Walk. Slow Down.', subtext: '', spoken: 'There is room for food, markets, photos, and the kind of evening that makes the trip feel like yours.', search: `${destination} local food market travel`, brands: ['Velocity Travels'], brand_visuals: [], miniBullets: []},
      {type: 'solution', onScreen: 'Transfers Are Covered', subtext: '', spoken: 'Airport runs, movement, and day plans are handled before you are standing outside wondering what comes next.', search: `${destination} airport transfer vacation`, brands: ['Velocity Travels'], brand_visuals: [], miniBullets: []},
      {type: 'solution', onScreen: priceLine, subtext: '', spoken: `${priceLine}. If your dates, group size, or budget are different, the team can shape the plan around that brief.`, search: `${destination} couple family travel`, brands: ['Velocity Travels'], brand_visuals: [], miniBullets: []},
      {type: 'cta', onScreen: `Ask for ${trigger}`, subtext: '', spoken: `Text Velocity Travels on WhatsApp and ask for ${trigger}. They will send the itinerary, inclusions, and available options.`, search: `${destination} sunset travel`, brands: ['Velocity Travels'], brand_visuals: [], miniBullets: []},
    ],
  };
  strategy.voiceover = strategy.scenes.map((scene) => scene.spoken).join(' ');
  return strategy;
}

function normalizeVoiceoverText(value) {
  return String(value || '')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// Fix the most common Whisper mishears of AI/dev tool names so the LLM (and the
// final script) never says "Clawed" for "Claude" etc. Conservative, word-boundary
// matched, case-insensitive. Applied to the raw transcript right after STT.
const TRANSCRIPT_FIXUPS = [
  [/\bclawed\s+code\b/gi, 'Claude Code'],
  [/\bclawed\b/gi, 'Claude'],
  [/\bcloud\s+code\b/gi, 'Claude Code'],
  [/\b(?:n\s*8\s*n|8\s*n|and\s*8\s*n|in\s*8\s*n)\b/gi, 'n8n'],
  [/\bco\s*pilot\b/gi, 'Copilot'],
  [/\bchat\s*gpt\b/gi, 'ChatGPT'],
  [/\bopen\s*ai\b/gi, 'OpenAI'],
  [/\bgemini\b/gi, 'Gemini'],
  [/\bversell?\b/gi, 'Vercel'],
  [/\bsuper\s*base\b/gi, 'Supabase'],
  [/\bcursor\s*ai\b/gi, 'Cursor'],
  [/\bperplexity\b/gi, 'Perplexity'],
  [/\bmid\s*journey\b/gi, 'Midjourney'],
];

function fixTranscriptMishears(text) {
  let out = String(text || '');
  for (const [re, rep] of TRANSCRIPT_FIXUPS) out = out.replace(re, rep);
  return out;
}

// Fast structured Groq call that cleans a raw speech-to-text transcript: fixes
// brand/product mishears (Clawed→Claude, 8N→n8n), obvious spelling errors, and
// punctuation — WITHOUT rewriting the content. Uses a cheap/fast model
// (GROQ_FIXUP_MODEL). Falls back to the regex fixups on any failure so the
// pipeline never blocks on this. Returns {text, brands} where brands is the
// model's best guess at the real product/company names mentioned.
async function cleanupTranscriptLLM(rawText) {
  const text = String(rawText || '').trim();
  if (text.length < 16) return {text: fixTranscriptMishears(text), brands: []};
  const key = process.env.GROQ_FIXUP_KEY || process.env.GROQ_API_KEY;
  const model = (process.env.GROQ_FIXUP_MODEL || 'llama-3.1-8b-instant').split(',')[0].trim();
  if (!key) return {text: fixTranscriptMishears(text), brands: []};

  const system = [
    'You clean raw auto-generated speech-to-text transcripts for a video tool.',
    'Return ONLY JSON: {"text": string, "brands": string[]}.',
    'RULES (follow exactly):',
    '• Output "text" must be the SAME sentences in the SAME order with the SAME words — you are a proofreader, NOT an editor. Do NOT restructure, do NOT add phrases like "follow these steps", do NOT merge or split sentences, do NOT summarize.',
    '• ONLY change: (a) mis-transcribed product/company names, (b) clear spelling errors, (c) missing punctuation/capitalization.',
    '• Brand name fixes are mandatory: "Clawed"→"Claude", "Clawed Code"/"Cloud Code"→"Claude Code", "8N"/"and 8N"/"an 8N"/"eight N"→"n8n", "co-pilot"→"Copilot", "Versel"→"Vercel", "super base"→"Supabase", "chat GPT"→"ChatGPT", "mid journey"→"Midjourney".',
    '• "brands": the CORRECTED canonical product/company names actually mentioned (e.g. ["Claude Code","Cursor","n8n","GitHub"]). Empty array if none.',
    'If you are unsure whether to change a word, keep it as-is. Word count of "text" must be within 10% of the input.',
  ].join('\n');

  try {
    const response = await fetchWithTimeout('https://api.groq.com/openai/v1/chat/completions', {
      timeoutMs: 20000,
      method: 'POST',
      headers: {'Content-Type': 'application/json', Authorization: `Bearer ${key}`},
      body: JSON.stringify({
        model,
        response_format: {type: 'json_object'},
        temperature: 0,
        messages: [
          {role: 'system', content: system},
          {role: 'user', content: text},
        ],
      }),
    });
    if (!response.ok) throw new Error(`Groq fixup HTTP ${response.status}`);
    const payload = await response.json();
    const content = payload.choices?.[0]?.message?.content || '';
    const parsed = JSON.parse(cleanJson(content));
    const cleaned = typeof parsed?.text === 'string' && parsed.text.trim().length >= text.length * 0.6
      ? parsed.text.trim()
      : null;
    const brands = Array.isArray(parsed?.brands) ? parsed.brands.map((b) => String(b).trim()).filter(Boolean).slice(0, 6) : [];
    // Belt-and-suspenders: run the regex fixups over the LLM output too.
    return {text: fixTranscriptMishears(cleaned || text), brands};
  } catch (error) {
    emitProgress('source', 24, `Transcript cleanup LLM unavailable (${error.message}); using local fixups`);
    return {text: fixTranscriptMishears(text), brands: []};
  }
}

function isVelocityVoiceoverLength(text) {
  const length = normalizeVoiceoverText(text).length;
  return length >= VELOCITY_VOICEOVER_MIN_CHARS && length <= VELOCITY_VOICEOVER_MAX_CHARS;
}

function trimVelocityVoiceover(text) {
  const cleaned = normalizeVoiceoverText(text);
  if (cleaned.length <= VELOCITY_VOICEOVER_MAX_CHARS) return cleaned;
  const sentences = cleaned.match(/[^.!?]+[.!?]+/g) || [];
  let trimmed = '';
  for (const sentence of sentences) {
    const next = normalizeVoiceoverText(`${trimmed} ${sentence}`);
    if (next.length > VELOCITY_VOICEOVER_MAX_CHARS) break;
    trimmed = next;
  }
  return trimmed.length >= VELOCITY_VOICEOVER_MIN_CHARS ? trimmed : cleaned.slice(0, VELOCITY_VOICEOVER_MAX_CHARS).replace(/\s+\S*$/, '').replace(/[,\s]+$/g, '.');
}

function normalizeVelocityStrategy(strategy, fallback) {
  const normalized = strategy && typeof strategy === 'object' ? {...strategy} : {...fallback};
  const scenes = Array.isArray(normalized.scenes) && normalized.scenes.length ? normalized.scenes : fallback.scenes;
  normalized.scenes = scenes.map((scene) => ({
    ...scene,
    spoken: normalizeVoiceoverText(scene?.spoken),
    brands: Array.isArray(scene?.brands) && scene.brands.length ? scene.brands : ['Velocity Travels'],
  }));

  const voiceover = normalizeVoiceoverText(normalized.voiceover);
  const scenesVoiceover = normalizeVoiceoverText(normalized.scenes.map((scene) => scene.spoken).join(' '));
  const candidates = [voiceover, scenesVoiceover, fallback.voiceover].filter(Boolean).map(trimVelocityVoiceover);
  const valid = candidates.find(isVelocityVoiceoverLength);
  if (!valid) {
    const lengths = candidates.map((text) => text.length).join(', ');
    throw new Error(`Velocity voiceover must be ${VELOCITY_VOICEOVER_MIN_CHARS}-${VELOCITY_VOICEOVER_MAX_CHARS} characters. Provider returned invalid lengths: ${lengths || 'none'}.`);
  }
  normalized.voiceover = valid;
  return normalized;
}

async function buildStrategy({transcript, sourceMeta, topic, durationSeconds, autoDuration, template, retainTranscript, seed}) {
  if (template === 'velocity') {
    const fallback = fallbackVelocityStrategy(transcript, topic);
    const llmRequest = buildVelocityLlmRequest({transcript, sourceMeta, topic, durationSeconds, autoDuration});
    const durationDirective = `NON-NEGOTIABLE: top-level voiceover must be ${VELOCITY_VOICEOVER_MIN_CHARS}-${VELOCITY_VOICEOVER_MAX_CHARS} characters including spaces. This is a character count, not a word count. Count it before returning JSON.`;
    const strategy = await googleJson(
      {
        system: [
          'You create high-converting Instagram Reel scripts for Velocity Travels, a travel agency.',
          'Return only JSON matching the user-provided output_contract.schema.',
          'The goal is desire, but the writing must not sound like generic tourism advertising or AI-generated copy.',
          'scenes must contain between 4 and 12 objects depending on the content length. First scene type hook. Last scene type cta. Middle scenes use problem for destination reveal and solution for package/experience beats.',
          'Every scene should be useful on its own as a fast slide. Do not make any slide depend on a long paragraph.',
          'Spoken text must be highly conversational, first-person spoken dialogue like: "I just found this... So you can skip the lines... And the best part is..."',
          'If a scene has a long spoken text (>15 words), provide an array of 2-5 `miniBullets` (short punchy phrases, 2-4 words each) that summarize the audio. If the spoken text is short, `miniBullets` should be empty.',
          'Start with curiosity, then reveal the destination, then explain what the package includes: stay, tours, transfers, meals, free time, price/dates if provided.',
          'Use only details present in the transcript/package brief. If price, dates, hotel category, nights, visas, or inclusions are missing, keep the line general.',
          'Top-level brands must be ["Velocity Travels"]. Per-scene brands must include "Velocity Travels".',
          'For every scene.search, write a stock-footage query for the exact destination/experience. No software, dashboards, office, AI, or business footage.',
          'Humanizer rules are mandatory: avoid showcase/highlight/align/vibrant/breathtaking/nestled/rich cultural/must-visit/seamless/curated unless quoted from the brief.',
          'Do not write "not just... but", "more than", "unlock", "discover", "elevate", "experience the magic", fake urgency, or three-item slogan stacks.',
          'Use concrete package facts and plain verbs. Spoken lines should sound like a real travel advisor, not a press release.',
          'Before returning JSON, do an internal anti-AI pass and rewrite any line that feels generic, inflated, vague, or brochure-like.',
          durationDirective,
          'No generic motivational copy. No brochure padding. No invented guarantees.',
          ...(retainTranscript ? [
            'CRITICAL INSTRUCTION: The user has requested to RETAIN THE EXACT TRANSCRIPT verbatim.',
            'DO NOT rewrite, summarize, or alter the provided transcript in any way.',
            'The `voiceover` field MUST be exactly identical to the input transcript.',
            'Split the exact transcript into the `scenes` array `spoken` fields without dropping or changing any words.'
          ] : [
            'Do not imitate the source transcript word-for-word. Extract the underlying idea and make a new reel.'
          ])
        ].join('\n'),
        user: JSON.stringify(llmRequest, null, 2),
      },
      fallback,
    );
    return normalizeVelocityStrategy(strategy, fallback);
  }
  const fallback = normalizePreRenderText(fallbackStrategy(transcript, topic));

  // Per-run creative variation — picked deterministically from the seed so the
  // same slug reproduces but different runs diverge in angle/structure/energy.
  const variation = pickVariation(seed || `${topic}:${(transcript || '').slice(0, 64)}`);
  emitProgress('script', 23, `Creative lane — hook: ${variation.hookAngle.split(' — ')[0]} | spine: ${variation.spine.split(' (')[0]} | energy: ${variation.energy.split(' — ')[0]}`);

  const durationDirective = autoDuration
    ? 'Voiceover length: write to natural pacing for an Instagram Reel — between 18 and 75 seconds depending on the source transcript\'s information density. Do not pad. Do not truncate the message just to hit a target.'
    : `Target voiceover duration: ${durationSeconds} seconds. Keep voiceover around ${Math.round(durationSeconds * 2.35)} words.`;

  const baseSystem = [
    'You create Remotion Instagram Reel scripts for the Huashu Design skill pattern.',
    'Parse the story into slide archetypes: hook, stat, statement, solution, and cta. First scene must stop the scroll. Last scene must be a clear action.',
    'Design constraints are non-negotiable: one accent color, no generic AI-purple default, no filler, no brochure copy, no "not just... but", no "unlock/elevate/discover".',
    'Every on-screen line must be readable in 0.5 seconds: hook <= 5 words, stat = number + one-line context, statement = 1-2 short declaratives, solution label <= 6 words, CTA starts with an action verb.',
    'Motion intent: hook is fastest, middle slides hold long enough to read, CTA is the brightest and clearest moment.',
    // Per-run creative direction — this is what makes each run feel different.
    `CREATIVE DIRECTION FOR THIS RUN (follow it, do not default to your usual structure):`,
    `• Hook angle: ${variation.hookAngle}`,
    `• Narrative spine: ${variation.spine}`,
    `• Energy / voice: ${variation.energy}`,
    `Apply this human writing style: ${humanizerRules.join(' ')}`,
  ];
  
  if (retainTranscript) {
    baseSystem.push(
      'CRITICAL INSTRUCTION: The user has requested to RETAIN THE EXACT TRANSCRIPT verbatim.',
      'DO NOT rewrite, summarize, or alter the provided transcript in any way.',
      'The `voiceover` field MUST be exactly identical to the input transcript.',
      'Split the exact transcript into the `scenes` array `spoken` fields without dropping or changing any words.'
    );
  } else {
    baseSystem.push('Do not imitate the source transcript word-for-word. Extract the underlying idea and make a new reel.');
  }

  // --- CHUNK 1: Voiceover & Pacing ---
  emitProgress('script', 24, 'Chunk 1/4: Drafting elaborate voiceover and scene pacing...');
  const chunk1Request = {
    task: 'create_instagram_reel_script_part1_voiceover',
    output_contract: { format: 'json', schema: { hook: 'string', voiceover: 'string', scenes: [ { type: 'string', spoken: 'string' } ] } },
    context: { topic, sourceTitle: sourceMeta.title, transcript: transcript.slice(0, 12000) }
  };
  const chunk1 = await googleJson({
    system: [
      ...baseSystem,
      'Return ONLY JSON matching the user-provided output_contract.schema.',
      'scenes must contain between 4 and 8 objects. The first scene must be type hook. The last scene must be type cta. Middle scenes should be stat, problem, or solution so the renderer can map them to Huashu archetypes.',
      'The transcript is auto-generated speech-to-text and may MISHEAR product names. Silently correct obvious mishears to the real brand (e.g. "Clawed"→"Claude", "Cloud Code"→"Claude Code", "8N"/"and 8N"→"n8n", "co-pilot"→"Copilot"). Never let a misheard brand name appear in the output.',
      'Spoken text must be highly conversational, first-person spoken dialogue like: "Anthropic just dropped a feature... So you can set a workflow... And the best part, your files never leave your computer."',
      durationDirective,
      `Use these hook formula patterns: ${hookFormulaGuide.join(' | ')}`,
    ].join('\n'),
    user: JSON.stringify(chunk1Request, null, 2),
  }, fallback);

  // --- CHUNK 2: Visuals ---
  emitProgress('script', 26, 'Chunk 2/4: Generating hook text, sub text, and element texts...');
  const chunk2Request = {
    task: 'create_instagram_reel_script_part2_visuals',
    output_contract: { format: 'json', schema: { scenes: [ { index: 'number', onScreen: 'string', subtext: 'string', miniBullets: ['string'] } ] } },
    // Pass scenes with explicit index + spoken so the model maps one onScreen per
    // scene and cannot collapse them. It MUST return exactly this many scenes.
    scene_count: (chunk1.scenes || []).length,
    scenes: (chunk1.scenes || []).map((s, i) => ({ index: i, type: s.type, spoken: s.spoken })),
  };
  const chunk2 = await googleJson({
    system: [
      ...baseSystem,
      'Return ONLY JSON matching the user-provided output_contract.schema.',
      'You are given the drafted scenes (each with its index and spoken line). Return EXACTLY one object per input scene, in the same order, each carrying its `index`. Never merge, drop, or reorder scenes.',
      'Your job is to write the ON-SCREEN DISPLAY TEXT for each scene.',
      'CRITICAL: onScreen is a COMPLETE, natural SENTENCE that captures the scene\'s point — NOT a 3-4 word fragment. Aim for 6-16 words, a full readable thought, ending in proper punctuation. It can closely track the spoken line but should be clean written English.',
      'Good onScreen examples: "Claude Code can build an entire n8n system from one prompt." / "Your files never leave your computer — everything runs locally." Bad (too short / fragment): "build n8n", "Files stay local", "First go to".',
      'For scene 1 / hook: onScreen is a punchy complete sentence (6-12 words) that stops the scroll.',
      'For every scene: onScreen MUST be grammatically complete and never end on a dangling word ("the", "to", "and", "which").',
      'subtext: only needed for the hook and the final CTA (a short supporting line). For all other scenes return an empty string for subtext — the complete onScreen sentence stands alone.',
      'Do not return internal labels (hook, problem, solution, stat, cta) inside onScreen or subtext.',
      'If a scene has long spoken text (>15 words), provide 2-5 `miniBullets` (2-4 words each) that summarize the audio. Else miniBullets = [].',
      'Before returning JSON, re-read every onScreen: if any reads like a chopped sentence, rewrite it as a clean headline.',
    ].join('\n'),
    user: JSON.stringify(chunk2Request, null, 2),
  }, fallback);

  // --- CHUNK 3: Search Queries ---
  emitProgress('script', 28, 'Chunk 3/4: Writing search queries for scrapling...');
  const chunk3Request = {
    task: 'create_instagram_reel_script_part3_search',
    output_contract: { format: 'json', schema: { searchQueries: ['string'], scenes: [ { search: 'string' } ] } },
    input_script_so_far: { hook: chunk1.hook, scenes: chunk1.scenes?.map((s, i) => ({ ...s, ...(chunk2.scenes?.[i] || {}) })) }
  };
  const chunk3 = await googleJson({
    system: [
      ...baseSystem,
      'Return ONLY JSON matching the user-provided output_contract.schema.',
      'You are provided with the drafted script. Your job is to write highly optimized stock footage search queries for Pexels/Unsplash for each scene.',
      'searchQueries is an array of 2-3 global search terms for the overall vibe.',
      'scene.search is a specific search query for that exact scene. Do not use abstract words. Use concrete nouns (e.g., "typing on keyboard", "coffee shop", "server rack").'
    ].join('\n'),
    user: JSON.stringify(chunk3Request, null, 2),
  }, fallback);

  // --- CHUNK 4: Branding & Details ---
  emitProgress('script', 30, 'Chunk 4/4: Processing branding and rest of the stuff...');
  const chunk4Request = {
    task: 'create_instagram_reel_script_part4_branding',
    output_contract: { format: 'json', schema: { angle: 'string', brands: ['string'], commentTrigger: 'string', commentReward: 'string', scenes: [ { brands: ['string'], brand_visuals: ['string'], gridData: {title: 'string', items: ['string']} } ] } },
    input_script_so_far: chunk3Request.input_script_so_far
  };
  const chunk4 = await googleJson({
    system: [
      ...baseSystem,
      'Return ONLY JSON matching the user-provided output_contract.schema.',
      'You are provided with the drafted script. Your job is to add the branding and final details.',
      'For each beat, set `brands` to a short array of CANONICAL PARENT COMPANY brand names mentioned (1–3 entries).',
      'CRITICAL: Always map sub-products to their parent company so the icon library can match: NotebookLM/Bard/Gemini/Veo/Imagen → "Google" · Claude/Sonnet/Haiku/Opus/Claude Code → "Anthropic" · ChatGPT/GPT-4/Sora/DALL·E/Codex → "OpenAI"',
      'For the beat that is ABOUT the tool, also set `brand_visuals` to that tool\'s domain (e.g. "base44.com", "claude.com/code"). Other beats can leave it empty. MUST be bare domains.',
      'Top-level `brands` should list the union of all per-beat brands so chips can render on every scene.',
    ].join('\n'),
    user: JSON.stringify(chunk4Request, null, 2),
  }, fallback);

  // --- CHUNK 5: Layout direction (the visual "arsenal" selector) ---
  // The model assigns each scene ONE layout from the catalog and emits the
  // structured data that layout needs. This is what makes each video use the
  // RIGHT visual structure (checklist / comparison / chart / motion-graphic /…)
  // instead of the same text card every time.
  emitProgress('script', 31, 'Chunk 5/5: Directing per-scene visual layouts (charts, checklists, comparisons)...');
  const chunk5Request = {
    task: 'assign_scene_layouts',
    layout_catalog: LAYOUT_CATALOG,
    scene_count: (chunk1.scenes || []).length,
    scenes: (chunk1.scenes || []).map((s, i) => ({
      index: i,
      type: s.type,
      spoken: s.spoken,
      onScreen: chunk2.scenes?.[i]?.onScreen || '',
      brands: chunk4.scenes?.[i]?.brands || [],
    })),
    output_contract: {
      format: 'json',
      schema: {scenes: [{index: 'number', layout: 'one of the catalog ids', layoutData: 'object matching that layout\'s data spec, or {} for none'}]},
    },
  };
  const chunk5 = await googleJson({
    system: [
      ...baseSystem,
      'You are the ART DIRECTOR choosing the visual STRUCTURE for each scene of an Instagram reel.',
      'Return ONLY JSON matching output_contract.schema, EXACTLY one object per input scene, each carrying its `index`.',
      `Available layouts (pick the BEST fit for what each scene communicates):\n${LAYOUT_CATALOG.map((l) => `• ${l.id} — ${l.when} data: ${l.data}`).join('\n')}`,
      'HARD RULES:',
      '• Scene 0 MUST be layout "hook". The LAST scene MUST be layout "cta".',
      '• "statement" is the LAST RESORT, not the default. Before choosing statement, check: does this scene list things (→checklist), contrast two things (→comparison), name multiple tools/options (→comparison or bar-graph), cite a number (→stat or bar-graph), describe a process/flow with steps (→motion-graphic), or show share/composition (→pie-chart)? If ANY fit, use that richer layout instead.',
      '• Across the WHOLE reel you MUST use at least 2 DIFFERENT data-driven layouts (checklist / comparison / bar-graph / pie-chart / progress-graph / motion-graphic). A reel that is all "statement" or all "stat" is a FAILURE.',
      '• When a scene introduces 2+ named tools/products/options, strongly prefer comparison (if 2 with contrast) or checklist/bar-graph (if a list). Put each tool\'s canonical brand in the relevant `brand` field so its real logo renders (Claude/Claude Code→"Anthropic", Codex/ChatGPT→"OpenAI", Copilot→"Github", Gemini/NotebookLM→"Google").',
      '• motion-graphic is for a process/flow with 2-5 connected steps or components.',
      '• Never invent statistics. Use bar-graph/pie-chart/progress-graph ONLY when the script implies real comparable values; otherwise pick a non-numeric layout. Keep all labels ≤ 4 words.',
      'WORKED EXAMPLE — script names "Claude Code, OpenAI Codex, GitHub Copilot" then "match the tool to the task":',
      '  → scene listing the 3 tools = checklist OR bar-graph with brand logos; scene contrasting two = comparison; the "match" scene = motion-graphic or checklist. NOT three "statement" slides.',
      'Think about the WHOLE reel\'s rhythm: a great reel mixes layouts (e.g. hook → comparison → bar-graph → checklist → motion-graphic → cta) to keep a viewer hooked.',
    ].join('\n'),
    user: JSON.stringify(chunk5Request, null, 2),
  }, {scenes: []});

  // Merge the four chunks into the final strategy object. Each enrichment chunk
  // (2/3/4) is keyed by its returned `index` when present so a model that reorders
  // or returns a map still aligns to the right scene; otherwise positional.
  const byIndex = (arr) => {
    const map = new Map();
    (arr || []).forEach((item, i) => {
      const idx = Number.isInteger(item?.index) ? item.index : i;
      map.set(idx, item);
    });
    return map;
  };
  const c2 = byIndex(chunk2.scenes);
  const c3 = byIndex(chunk3.scenes);
  const c4 = byIndex(chunk4.scenes);
  const c5 = byIndex(chunk5.scenes);
  const strategy = normalizePreRenderText({
    ...fallback,
    ...chunk1,
    ...chunk2,
    ...chunk3,
    ...chunk4,
    scenes: chunk1.scenes?.map((s, i) => {
      const merged = {
        ...s,
        ...(c2.get(i) || {}),
        ...(c3.get(i) || {}),
        ...(c4.get(i) || {}),
      };
      // Layout direction from chunk5, validated against the catalog.
      const lay = c5.get(i) || {};
      merged.layout = LAYOUT_IDS.includes(lay.layout) ? lay.layout : '';
      merged.layoutData = (lay.layoutData && typeof lay.layoutData === 'object') ? lay.layoutData : {};
      delete merged.index; // internal alignment key, not part of the scene shape
      return merged;
    }) || fallback.scenes,
  });

  diversifyLayouts(strategy);
  return strategy;
}

// Safety net: if the LLM played it safe and made the whole middle "statement"
// (or all one layout), nudge a couple of scenes into richer layouts based on a
// quick content scan. This guarantees layout VARIETY without inventing data —
// it only upgrades when the scene's own text supports the structure.
function diversifyLayouts(strategy) {
  const scenes = strategy.scenes || [];
  const middle = scenes.slice(1, Math.max(1, scenes.length - 1)); // exclude hook & cta
  if (middle.length < 2) return;

  const dataLayouts = new Set(['checklist', 'comparison', 'bar-graph', 'pie-chart', 'progress-graph', 'motion-graphic']);
  const usedData = middle.filter((s) => dataLayouts.has(s.layout)).length;
  if (usedData >= 2) return; // LLM already varied — leave it alone.

  // Brand mentions across the reel — used to attach logos to upgraded layouts.
  const brandPool = [...new Set((strategy.brands || []).filter(Boolean))];
  const wordCount = (t) => String(t || '').trim().split(/\s+/).filter(Boolean).length;

  // Heuristic detectors over a scene's text.
  const detect = (s) => {
    const text = `${s.onScreen || ''} ${s.spoken || ''} ${s.subtext || ''}`.toLowerCase();
    const sceneBrands = (Array.isArray(s.brands) ? s.brands : []).filter(Boolean);
    if (/\bvs\b|versus|instead of|before|after|old way|new way|used to|compared/.test(text)) return 'comparison';
    if (/\b(first|second|third|steps?|then|next|finally|checklist|need to|make sure)\b/.test(text)) return 'checklist';
    if (sceneBrands.length >= 2 || (text.match(/\b(claude|gpt|gemini|copilot|codex|cursor|vercel|figma|notion)\b/g) || []).length >= 2) return 'comparison';
    if (/\b(flow|pipeline|process|loop|cycle|step by step|how it works|under the hood)\b/.test(text)) return 'motion-graphic';
    return '';
  };

  let upgraded = 0;
  for (const s of middle) {
    if (upgraded >= 2) break;
    if (dataLayouts.has(s.layout)) continue;
    const target = detect(s);
    if (!target || (target === 'comparison' && upgraded >= 1)) continue;
    const items = (s.miniBullets && s.miniBullets.length ? s.miniBullets : []).map((t) => tidyText(t)).filter(Boolean);
    if (target === 'checklist') {
      const list = items.length >= 2 ? items : tidyText(s.spoken).split(/[,.;]/).map((t) => t.trim()).filter((t) => wordCount(t) >= 1 && wordCount(t) <= 5).slice(0, 4);
      if (list.length >= 2) {
        s.layout = 'checklist';
        s.layoutData = {title: s.onScreen, items: list.slice(0, 5).map((t, idx) => ({text: t, brand: brandPool[idx]})), checked: true};
        upgraded += 1;
      }
    } else if (target === 'comparison') {
      // Only safe to build when the scene clearly contrasts; keep it light.
      const parts = tidyText(s.spoken).split(/\bbut\b|\binstead\b|\bvs\b|→|\bnow\b/i).map((t) => t.trim()).filter(Boolean);
      if (parts.length >= 2) {
        s.layout = 'comparison';
        s.layoutData = {
          leftTitle: 'Before', rightTitle: 'After',
          leftItems: [parts[0].split(/\s+/).slice(0, 6).join(' ')],
          rightItems: [parts[1].split(/\s+/).slice(0, 6).join(' ')],
          rightBrand: brandPool[0],
        };
        upgraded += 1;
      }
    } else if (target === 'motion-graphic') {
      const nodes = (items.length >= 2 ? items : tidyText(s.spoken).split(/\bthen\b|→|,/).map((t) => t.trim()).filter(Boolean)).slice(0, 4);
      if (nodes.length >= 2) {
        s.layout = 'motion-graphic';
        s.layoutData = {title: s.onScreen, flow: 'linear', nodes: nodes.map((t, idx) => ({label: t.split(/\s+/).slice(0, 3).join(' '), brand: brandPool[idx]}))};
        upgraded += 1;
      }
    }
  }
}

// Pexels CDN, Unsplash, microlink — and most asset hosts behind Cloudflare — 403
// the default Node fetch User-Agent. Always present a real Chrome UA so downloads
// don't get bot-blocked. Caller-supplied headers still win on collision.
const DEFAULT_DOWNLOAD_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept': '*/*',
  'Accept-Language': 'en-US,en;q=0.9',
};

// Wrap fetch with a hard timeout. Without this, a slow microlink screenshot or a
// stalled CDN connection can hang the entire pipeline at the media step indefinitely.
async function fetchWithTimeout(url, {timeoutMs = 25000, ...init} = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {...init, signal: controller.signal});
  } finally {
    clearTimeout(timer);
  }
}

async function download(url, destination, headers = {}) {
  // 60s timeout for raw asset downloads (Pexels videos can be 10–30 MB).
  const response = await fetchWithTimeout(url, {timeoutMs: 60000, headers: {...DEFAULT_DOWNLOAD_HEADERS, ...headers}});
  if (!response.ok) throw new Error(`Download failed ${response.status}: ${url}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  writeFileSync(destination, buffer);
}

async function maybeDownload(url, destination, headers = {}) {
  try {
    await download(url, destination, headers);
    return true;
  } catch {
    return false;
  }
}

// Cheap deterministic hash so same (slug, sceneIndex, query) gives same pick — but
// different slugs give different picks. Avoids "same input → identical b-roll" while
// keeping renders reproducible if you re-run with the same slug for debugging.
function pickIndex(seed, modulo) {
  if (modulo <= 0) return 0;
  const h = createHash('md5').update(String(seed)).digest();
  return h.readUInt32BE(0) % modulo;
}

async function fetchPexelsVideo(query, destinationDir, name, {seed} = {}) {
  if (!process.env.PEXELS_API_KEY) return null;
  // Vary the page so back-to-back runs over the same query don't overlap their pool.
  // Pexels limits per_page to 80; we ask for 15 across pages 1..3 deterministically.
  const page = (pickIndex(`page:${seed}`, 3) + 1);
  const url = new URL('https://api.pexels.com/videos/search');
  url.searchParams.set('query', query);
  url.searchParams.set('orientation', 'portrait');
  url.searchParams.set('per_page', '15');
  url.searchParams.set('page', String(page));
  const response = await fetchWithTimeout(url, {timeoutMs: 20000, headers: {Authorization: process.env.PEXELS_API_KEY}});
  if (!response.ok) return null;
  const payload = await response.json();
  const videos = (payload.videos || []).filter((v) => v?.video_files?.length);
  if (!videos.length) return null;
  const video = videos[pickIndex(`pexels:${seed}`, videos.length)];
  // Pick the smallest portrait file that's still ≥720p tall — final composition is
  // 1080×1920 so anything beyond ~1080p is wasted bytes. Pexels often serves 4K
  // versions that are 50-200 MB; using them stresses Remotion's compositor proxy
  // (frame-extract requests time out / ECONNRESET under concurrency >1) and inflates
  // the per-run bundle copy time. Aim for 720-1080p, fall back to whatever exists.
  const portraitFiles = video.video_files
    .filter((item) => item.width && item.height && item.height >= item.width);
  const targetHeight = 1080;
  const file = portraitFiles
    .filter((item) => (item.height || 0) >= 720 && (item.height || 0) <= targetHeight)
    .sort((a, b) => (b.height || 0) - (a.height || 0))[0]
    // Fallback chains: anything ≤1080p, then anything ≥720p, then anything at all.
    || portraitFiles.filter((item) => (item.height || 0) <= targetHeight).sort((a, b) => (b.height || 0) - (a.height || 0))[0]
    || portraitFiles.sort((a, b) => (a.height || 0) - (b.height || 0))[0]
    || video.video_files[0];
  if (!file?.link) return null;
  const destination = join(destinationDir, `${name}.mp4`);
  await download(file.link, destination);
  return {file: relative(join(projectRoot, 'public'), destination), kind: 'video'};
}

// Microlink — anonymous tier (~50 req/day, no key required). Resolves a domain to its
// Open Graph image (preferred) or screenshot (fallback) and downloads it locally so
// Remotion can include it in a beat's jump-cut rotation. The image lives in
// public/instagram-reel-tool/<slug>/brand_assets/ so it's covered by the same per-run
// cleanup as the rest of the assets.
//
// Returns {file, kind:'image'} on success, null on miss/failure — caller treats it as
// best-effort and falls back to Pexels-only b-roll if microlink can't resolve.
const microlinkSeen = new Map(); // job-scoped dedupe: same domain only resolves once per job
// Strip the LLM's "helpful" markdown wrapping. Models occasionally emit
// brand_visuals as `[cotera.ai](http://cotera.ai)` — the URL form of a markdown
// link — instead of a bare domain. We unwrap to the URL part, then to the
// hostname, before any downstream code touches it. Without this, microlink
// gets fed the bracket-and-paren string verbatim and writes out files named
// `[cotera.ai](http://cotera.ai)_og.png`, which break Remotion's staticFile().
function cleanDomain(input) {
  let raw = String(input || '').trim();
  // Markdown link form: `[label](url)` — keep the URL.
  const md = raw.match(/^\[[^\]]*\]\((https?:\/\/[^)]+|[^)]+)\)$/i);
  if (md) raw = md[1];
  // Strip protocol + trailing slash + any leading `www.` we'd duplicate later.
  raw = raw.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  // If anything other than [a-z0-9.-] survived, take just the host portion
  // (everything before the first `/` or whitespace) as a last-line defence.
  const hostMatch = raw.match(/^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+)/i);
  return hostMatch ? hostMatch[1].toLowerCase() : '';
}

function microlinkSlug(input) {
  // Defence in depth — if cleanDomain rejects the input, slugify whatever's
  // left through the [^a-z0-9._-] filter so we never leak brackets, parens,
  // colons, or slashes into the filename. Worst case: a "brand" placeholder.
  const cleaned = cleanDomain(input) || '';
  const fallback = String(input || '').toLowerCase();
  return (cleaned || fallback)
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'brand';
}
async function fetchMicrolinkBrandVisual(rawDomain, slug) {
  // Re-clean inside the fetcher itself so any caller that bypasses the loop's
  // .map(cleanDomain) (future code, programmatic invocations) still gets the
  // same safety guarantees. If cleaning yields an empty host (the input was
  // not a recognisable domain), bail rather than hit microlink with garbage.
  const cleanedDomain = cleanDomain(rawDomain);
  if (!cleanedDomain) return null;
  const dedupeKey = `${slug}:${cleanedDomain}`;
  if (microlinkSeen.has(dedupeKey)) return microlinkSeen.get(dedupeKey);
  const target = cleanedDomain;
  // Microlink expects a fully-qualified URL.
  const url = /^https?:\/\//i.test(target) ? target : `https://${target}`;
  const apiUrl = new URL('https://api.microlink.io/');
  apiUrl.searchParams.set('url', url);
  apiUrl.searchParams.set('screenshot', 'true');
  apiUrl.searchParams.set('meta', 'true');
  apiUrl.searchParams.set('viewport.width', '1080');
  apiUrl.searchParams.set('viewport.height', '1920');
  let payload;
  try {
    // Microlink takes a screenshot — gives it 30s. Fail-fast beyond that so a slow
    // / dead domain doesn't hang the entire media step.
    const response = await fetchWithTimeout(apiUrl, {timeoutMs: 30000, headers: {'User-Agent': 'Outgrow Reel Generator/1.0'}});
    if (!response.ok) {
      microlinkSeen.set(dedupeKey, null);
      return null;
    }
    payload = await response.json();
  } catch {
    microlinkSeen.set(dedupeKey, null);
    return null;
  }
  if (payload?.status !== 'success') {
    microlinkSeen.set(dedupeKey, null);
    return null;
  }
  // Prefer OG image; fall back to portrait screenshot.
  const imageUrl = payload?.data?.image?.url || payload?.data?.screenshot?.url;
  if (!imageUrl) {
    microlinkSeen.set(dedupeKey, null);
    return null;
  }
  const dir = join(projectRoot, 'public', 'instagram-reel-tool', slug, 'brand_assets');
  ensureDir(dir);
  const destination = join(dir, `${microlinkSlug(target)}_og.png`);
  const ok = await maybeDownload(imageUrl, destination, {'User-Agent': 'Outgrow Reel Generator/1.0'});
  if (!ok) {
    microlinkSeen.set(dedupeKey, null);
    return null;
  }
  const result = {file: relative(join(projectRoot, 'public'), destination), kind: 'image'};
  microlinkSeen.set(dedupeKey, result);
  return result;
}

async function fetchUnsplashImage(query, destinationDir, name, {seed} = {}) {
  if (!process.env.UNSPLASH_ACCESS_KEY) return null;
  const page = (pickIndex(`unsplash-page:${seed}`, 3) + 1);
  const url = new URL('https://api.unsplash.com/search/photos');
  url.searchParams.set('query', query);
  url.searchParams.set('orientation', 'portrait');
  url.searchParams.set('per_page', '15');
  url.searchParams.set('page', String(page));
  const response = await fetchWithTimeout(url, {timeoutMs: 20000, headers: {Authorization: `Client-ID ${process.env.UNSPLASH_ACCESS_KEY}`}});
  if (!response.ok) return null;
  const payload = await response.json();
  const results = payload.results || [];
  if (!results.length) return null;
  const photo = results[pickIndex(`unsplash:${seed}`, results.length)];
  const imageUrl = photo?.urls?.regular || photo?.urls?.full;
  if (!imageUrl) return null;
  const destination = join(destinationDir, `${name}.jpg`);
  await download(imageUrl, destination);
  return {file: relative(join(projectRoot, 'public'), destination), kind: 'image'};
}

function absolutizeUrl(url, base) {
  try {
    return new URL(url, base).toString();
  } catch {
    return null;
  }
}

async function fetchToolWebsiteImage(toolUrl, slug) {
  if (!toolUrl) return null;
  emitProgress('media', 43, 'Fetching tool website preview image');
  const response = await fetchWithTimeout(toolUrl, {timeoutMs: 15000, headers: {'User-Agent': 'Outgrow Reel Generator/1.0'}});
  if (!response.ok) return null;
  const html = await response.text();
  const image = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1]
    || html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i)?.[1]
    || html.match(/<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]+href=["']([^"']+)["']/i)?.[1];
  const imageUrl = image ? absolutizeUrl(image, toolUrl) : null;
  if (!imageUrl) return null;
  const dir = join(projectRoot, 'public', 'instagram-reel-tool', slug, 'media');
  ensureDir(dir);
  const destination = join(dir, 'tool-website-preview.jpg');
  const saved = await maybeDownload(imageUrl, destination);
  return saved ? {file: relative(join(projectRoot, 'public'), destination), kind: 'image', sceneIndex: 3} : null;
}

// Brand-logo system uses Brandfetch Search API to find the domain, 
// then downloads the logo via the Brandfetch Logo API (CDN).
// Brands without a match fallback to empty file (handled by Remotion as monogram).
async function collectBrandLogos(strategy, slug, requestedBrands) {
  const names = (requestedBrands?.length ? requestedBrands : strategy.brands || [])
    .map((name) => String(name).trim())
    .filter(Boolean)
    .slice(0, 5);

  const logos = [];
  const dir = join(projectRoot, 'public', 'instagram-reel-tool', slug, 'brand');
  ensureDir(dir);

  for (const name of names) {
    try {
      emitProgress('logos', 54, `Searching Brandfetch for ${name}...`);
      const searchRes = await fetch(`https://api.brandfetch.io/v2/search/${encodeURIComponent(name)}`);
      
      if (!searchRes.ok) {
        logos.push({name, source: 'brandfetch', file: ''});
        continue;
      }
      
      const searchData = await searchRes.json();
      if (!searchData || searchData.length === 0) {
        logos.push({name, source: 'brandfetch', file: ''});
        continue;
      }
      
      const domain = searchData[0].domain;
      emitProgress('logos', 55, `Fetching Brandfetch CDN logo for ${domain}...`);
      
      const logoUrl = `https://cdn.brandfetch.io/${domain}?c=1idq4HNz7jtRuv8vA8G`;
      const safeName = name.replace(/[^a-z0-9]/gi, '-').toLowerCase();
      
      // The CDN usually serves SVG or PNG, we save it as a generic extension or detect if possible.
      // We'll save it as .png since maybeDownload doesn't strictly care about the extension.
      // But if it's an SVG, having a .png extension might be weird. Let's just use .img as extension 
      // or rely on Remotion's Img tag which handles any format.
      const destination = join(dir, `${safeName}-logo.png`);
      const saved = await maybeDownload(logoUrl, destination);
      logos.push({name, source: 'brandfetch', file: saved ? relative(join(projectRoot, 'public'), destination) : ''});
      
    } catch (err) {
      console.error(`Brandfetch error for ${name}:`, err);
      logos.push({name, source: 'brandfetch', file: ''});
    }
  }
  
  emitProgress('logos', 56, `Brand chips collected: ${logos.length} (${logos.map((b) => b.name).join(', ') || 'none'})`);
  return logos;
}

// Resolve the Python interpreter that has scrapling installed: honor
// SCRAPLING_PYTHON if set and present, otherwise fall back to system python3
// (which will emit "scrapling unavailable" and a quiet stock-only run if the
// system env doesn't have scrapling, exactly as designed).
function resolveScraplingPython() {
  if (process.env.SCRAPLING_PYTHON && existsSync(process.env.SCRAPLING_PYTHON)) {
    return process.env.SCRAPLING_PYTHON;
  }
  return 'python3';
}

async function nvidiaVisionCall(apiKey, model, system, prompt, base64Image) {
  const response = await fetchWithTimeout('https://integrate.api.nvidia.com/v1/chat/completions', {
    timeoutMs: 45000,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 1024,
      messages: [
        {role: 'system', content: system},
        {
          role: 'user', 
          content: [
            {type: 'text', text: prompt},
            {
              type: 'image_url',
              image_url: {url: `data:image/jpeg;base64,${base64Image}`}
            }
          ]
        },
      ],
    }),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }
  const payload = await response.json();
  return payload.choices?.[0]?.message?.content || '';
}

// Score scraped IMAGE assets 1-10 against the Huashu editorial rubric using an
// NVIDIA vision model, then keep only those ≥ threshold, ranked best-first.
// Implements the skill's "5-10-2-8" principle: gather many, keep only the
// genuinely good ones, rather than shipping everything. Videos pass through
// unscored (vision models can't see motion from a single frame reliably).
// Returns items with a `visionScore` field attached, sorted descending.
async function filterScrapedMediaWithVision(items, slug, {threshold = 6.5} = {}) {
  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) return items;
  const model = 'meta/llama-3.2-90b-vision-instruct';
  const system = `You are an elite Art Director curating media for a premium, editorial, minimalist Instagram reel (Huashu Design: warm, calm, high-fidelity, lots of negative space).
Rate the image 1-10 on editorial quality for this aesthetic.
HIGH scores (8-10): real product screenshots/UI, clean editorial photography, warm tones, good negative space, premium feel, a clear single subject.
MID scores (5-7): usable but busy, slightly generic, or off-palette.
LOW scores (1-4): AI slop (glowing orbs, neon cyberpunk, fake humans, floating UI), cluttered/chaotic, low-res, heavy purple/blue tech-bro gradients, text-heavy junk, watermarked stock.
Reply with ONLY a single number 1-10. No words.`;
  const prompt = 'Rate this image 1-10 for the premium editorial Huashu aesthetic. Number only.';

  emitProgress('scrape', 45, `Vision-scoring ${items.length} scraped items (NVIDIA ${model}, keep ≥${threshold})...`);

  const scored = [];
  for (const item of items) {
    if (item.kind !== 'image') {
      // Videos pass through with a neutral score so they rank alongside images.
      scored.push({...item, visionScore: 7});
      continue;
    }
    try {
      const absPath = join(projectRoot, 'public', item.file);
      if (!existsSync(absPath)) continue;
      const base64 = readFileSync(absPath).toString('base64');
      const raw = await nvidiaVisionCall(apiKey, model, system, prompt, base64);
      const score = parseFloat(String(raw).match(/(\d+(?:\.\d+)?)/)?.[1] || '0');
      if (score >= threshold) {
        scored.push({...item, visionScore: score});
      } else {
        emitProgress('scrape', 45.5, `Rejected (score ${score || '?'}/10): ${item.file.split('/').pop()}`);
      }
    } catch (err) {
      emitProgress('scrape', 45.5, `Vision scoring failed for ${item.file.split('/').pop()}: ${err.message} — keeping by default`);
      scored.push({...item, visionScore: 6}); // keep on API failure, but rank low
    }
  }
  // Best-first so downstream assignment grabs the strongest assets for hero slots.
  scored.sort((a, b) => (b.visionScore || 0) - (a.visionScore || 0));
  emitProgress('scrape', 46, `Vision scoring complete: kept ${scored.length}/${items.length} (avg ${(scored.reduce((s, i) => s + (i.visionScore || 0), 0) / (scored.length || 1)).toFixed(1)}/10).`);
  return scored;
}

// Spawn the search-driven scripts/scrape-media.py. It takes the tool URLs as
// SEED URLs plus product/brand search PHRASES, then internally: searches for the
// real product pages, scrapes several, and returns ranked media (video → image →
// screenshot; landscape preferred) with real probed dimensions. One spawn, not a
// per-URL loop — the Python side handles multi-site discovery.
async function collectScrapedMedia(toolUrls, slug, searchQueries = [], {productQueries = []} = {}) {
  const py = resolveScraplingPython();
  const script = join(toolRoot, 'scripts', 'scrape-media.py');
  if (!existsSync(script)) {
    emitProgress('scrape', 38, 'scrape-media.py missing — skipping product-page scraping');
    return [];
  }
  const publicDir = join(projectRoot, 'public', 'instagram-reel-tool', slug);
  ensureDir(publicDir);

  const seedUrls = (toolUrls || []).filter(Boolean).slice(0, 6);
  // Search phrases: the product/brand names (best signal for finding the real
  // product page) plus the scene search queries as a topical fallback.
  const queries = [...new Set([...(productQueries || []), ...(searchQueries || [])].filter(Boolean))].slice(0, 4);
  if (seedUrls.length === 0 && queries.length === 0) {
    emitProgress('scrape', 38, 'No tool URLs or product queries — skipping scraping');
    return [];
  }

  emitProgress('scrape', 38, `Discovering product media — seeds: [${seedUrls.join(', ') || 'none'}], search: [${queries.join(', ') || 'none'}]`);

  const args = [
    script,
    '--out', publicDir,
    '--max-images', '8',
    '--max-videos', '6',
    '--max-sites', '4',
  ];
  if (seedUrls.length) args.push('--seed-urls', JSON.stringify(seedUrls));
  if (queries.length) args.push('--queries', JSON.stringify(queries));

  const scraped = await new Promise((resolveP) => {
    const proc = spawn(py, args, {env: process.env});
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    // 120s ceiling — search + up to 4 sites with at most one JS render (video hunt).
    const timer = setTimeout(() => { try { proc.kill('SIGTERM'); } catch { /* noop */ } }, 120_000);
    proc.on('close', (code) => {
      clearTimeout(timer);
      let parsed = null;
      try { parsed = JSON.parse(stdout.trim()); } catch { /* parse fail */ }
      if (!parsed || !Array.isArray(parsed.items)) {
        const tail = (stderr || stdout).trim().slice(-300);
        emitProgress('scrape', 42, `Scraper returned no usable manifest (exit ${code}).${tail ? ' — ' + tail : ''}`);
        resolveP([]);
        return;
      }
      if (Array.isArray(parsed.sites_scraped) && parsed.sites_scraped.length) {
        emitProgress('scrape', 41, `Scraped ${parsed.sites_scraped.length} product page(s): ${parsed.sites_scraped.map((u) => cleanDomain(u) || u).join(', ')}`);
      }
      if (parsed.errors?.length) {
        emitProgress('scrape', 41.5, `Scraper notes: ${parsed.errors.slice(0, 2).join(' | ')}`);
      }
      const remapped = parsed.items.map((it) => ({
        kind: it.kind === 'video' ? 'video' : 'image',
        assetType: it.assetType || (it.kind === 'video' ? 'video' : 'image'),
        file: `instagram-reel-tool/${slug}/${it.file}`,
        source: 'scrapling',
        sourceUrl: it.source_url,
        sourceSite: it.source_site || '',
        alt: it.alt || '',
        width: it.width || null,
        height: it.height || null,
        orientation: it.orientation || 'unknown',
        aspect: it.aspect || null,
      }));
      const vids = remapped.filter((m) => m.kind === 'video').length;
      const landscapes = remapped.filter((m) => m.orientation === 'landscape').length;
      emitProgress('scrape', 42, `Scraping complete: ${remapped.length} assets (${vids} video, ${landscapes} landscape/rectangular).`);
      resolveP(remapped);
    });
  });

  // Optional topical mood supplements via search-media.py (Pinterest/Bing).
  let searchMedia = [];
  if (searchQueries && searchQueries.length > 0) {
    const searchScript = join(toolRoot, 'scripts', 'search-media.py');
    if (existsSync(searchScript)) {
      emitProgress('scrape', 43, `Searching the web for ${searchQueries.length} topical mood queries`);
      searchMedia = await new Promise((resolveP) => {
        const proc = spawn(py, [searchScript, '--queries', JSON.stringify(searchQueries.slice(0, 3)), '--out', publicDir], {env: process.env});
        let stdout = '';
        const timer = setTimeout(() => { try { proc.kill('SIGTERM'); } catch { /* noop */ } }, 90_000);
        proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
        proc.on('close', () => {
          clearTimeout(timer);
          let parsed = null;
          try { parsed = JSON.parse(stdout.trim()); } catch { /* parse fail */ }
          if (!parsed || !Array.isArray(parsed.items)) { resolveP([]); return; }
          resolveP(parsed.items.map((it) => ({
            kind: it.kind === 'video' ? 'video' : 'image',
            assetType: it.kind === 'video' ? 'video' : 'image',
            file: `instagram-reel-tool/${slug}/${it.file}`,
            source: 'search',
            sourceUrl: it.source_url,
            alt: it.alt || '',
            orientation: 'unknown',
          })));
        });
      });
    }
  }

  const allMedia = [...scraped, ...searchMedia];
  if (allMedia.length === 0) {
    emitProgress('scrape', 42, 'Scraping yielded 0 items. Falling back to stock-only.');
  }
  return allMedia;
}

// Interleave a flat pool of scraped items into the per-scene stock-media list.
// `ratio` ∈ [0, 1]: fraction of slots that should be filled with scraped media
// instead of stock. Hook scene (sceneIndex 0) gets first dibs on scraped items
// since that's the user's most "on-brand" slot.
//
// Algorithm:
//   • Walk stock items in their existing order (already sceneIndex-tagged).
//   • For each, count how many we've taken for that scene so far. Use a
//     deterministic interleave (every Kth slot is scraped, where K = 1/ratio)
//     so the mix is even and predictable rather than clumpy.
//   • If we run out of scraped items, the remaining stock items pass through.
//   • After the walk, append any leftover scraped items round-robin so they
//     don't get lost — the scene's jump-cut planner can use the extras.
function mixMediaPools(stockMedia, scrapedItems, sceneCount, ratio) {
  const r = Math.max(0, Math.min(1, Number(ratio) || 0));
  if (r <= 0 || scrapedItems.length === 0) return stockMedia;
  if (r >= 1) {
    // 100% scraped: drop stock entirely. We want at least 2 items per scene
    // (so the jump-cut planner has variety) — when the scraped pool is smaller
    // than 2*sceneCount, items cycle so every scene still has multiple clips
    // to rotate through. With 4 scraped items + 6 scenes, each scene gets
    // 2 items by cycling through the pool.
    if (scrapedItems.length === 0) return [];
    const result = [];
    const S = Math.max(1, sceneCount);
    const basePerScene = Math.floor(scrapedItems.length / S);
    let remainder = scrapedItems.length % S;
    let cursor = 0;
    
    for (let s = 0; s < S; s += 1) {
      // Some scenes get one extra clip if they don't divide evenly
      const take = basePerScene + (remainder > 0 ? 1 : 0);
      remainder -= 1;
      
      // If we literally have fewer clips than scenes, we might have take=0 for some scenes.
      // But we always want at least 1 clip per scene if possible, though if we only scraped 3 items 
      // and have 6 scenes, 3 scenes will get 1, and 3 scenes will get 0. 
      // Remotion requires at least 1 clip to render the MediaFrame, so we'll wrap around ONLY if 
      // there are zero clips assigned to this scene.
      const finalTake = Math.max(take, 1);
      
      for (let k = 0; k < finalTake; k += 1) {
        // Fallback modulo wrap only for scenes that would otherwise be empty
        const itemIdx = cursor < scrapedItems.length ? cursor : (cursor % scrapedItems.length);
        result.push({...scrapedItems[itemIdx], sceneIndex: s});
        cursor += 1;
      }
    }
    return result;
  }

  const result = [];
  const sceneTakeCounts = new Map();
  let scrapedCursor = 0;

  // Hook scene priority: if the first stock item belongs to scene 0, swap in
  // the highest-scored scraped item there first so the very first jump-cut is
  // an on-brand visual. The Python script already returns videos before images
  // sorted by score, so scrapedItems[0] is the best candidate.
  for (const stock of stockMedia) {
    const idx = typeof stock.sceneIndex === 'number' ? stock.sceneIndex : 0;
    const prevTaken = sceneTakeCounts.get(idx) || 0;
    sceneTakeCounts.set(idx, prevTaken + 1);
    const wantScraped = Math.floor((prevTaken + 1) * r) > Math.floor(prevTaken * r);
    if (wantScraped && scrapedCursor < scrapedItems.length) {
      result.push({...scrapedItems[scrapedCursor], sceneIndex: idx});
      scrapedCursor += 1;
    } else {
      result.push(stock);
    }
  }
  // Append leftover scraped → spread across scenes so all scenes benefit.
  let appendCursor = 0;
  while (scrapedCursor < scrapedItems.length) {
    const idx = sceneCount > 0 ? (appendCursor % sceneCount) : 0;
    result.push({...scrapedItems[scrapedCursor], sceneIndex: idx});
    scrapedCursor += 1;
    appendCursor += 1;
  }
  return result;
}

// ─── Smart media engine ─────────────────────────────────────────────────────
// Decides, PER SCENE, whether the scene wants PRODUCT media (real screenshots /
// og:image / scraped brand imagery — "show the actual thing") or MOOD media
// (stock b-roll — "set the feeling / illustrate a concept"). This replaces the
// old global scrapeMix toggle with an intent-driven decision so each scene gets
// the RIGHT kind of visual, and so the same source produces a thoughtful,
// non-random media plan.
//
// Heuristics (in priority order):
//   • Scene names a concrete UI/product action OR has brand_visuals     → PRODUCT
//   • Scene is the tool-reveal / solution step that shows "how"          → PRODUCT
//   • Hook, problem, emotional/abstract statement, CTA                    → MOOD
// The decision is also nudged by available supply (no tool URL → MOOD).
const PRODUCT_SIGNAL = /\b(click|tap|open|type|paste|copy|run|command|terminal|dashboard|screen|interface|app|tool|button|menu|setting|prompt|deploy|install|sign ?up|login|scan|qr|workflow|feature|update|download|upload)\b/i;
const MOOD_SIGNAL = /\b(imagine|feel|most people|everyone|nobody|stop|tired|struggle|dream|future|world|life|why|story|remember|notice)\b/i;

function classifySceneMediaIntent(scene, index, sceneCount, {hasToolUrl}) {
  const isHook = index === 0 || scene.type === 'hook';
  const isCta = index === sceneCount - 1 || scene.type === 'cta';
  const text = `${scene.onScreen || ''} ${scene.spoken || ''} ${scene.subtext || ''}`;
  const hasBrandVisual = Array.isArray(scene.brand_visuals) && scene.brand_visuals.filter(Boolean).length > 0;

  // Strong product signals always win when we can actually scrape product imagery.
  if (hasToolUrl && (hasBrandVisual || (scene.type === 'solution' && PRODUCT_SIGNAL.test(text)))) {
    return 'product';
  }
  // Hook & CTA are emotional bookends — almost always mood/atmosphere.
  if (isHook || isCta) return 'mood';
  // A solution step that describes a concrete action wants product, else mood.
  if (hasToolUrl && PRODUCT_SIGNAL.test(text) && !MOOD_SIGNAL.test(text)) return 'product';
  return 'mood';
}

// Build a per-scene media plan describing intent + the search query to use.
function planSceneMedia(strategy, {hasToolUrl}) {
  const scenes = strategy.scenes || [];
  return scenes.map((scene, i) => ({
    sceneIndex: i,
    intent: classifySceneMediaIntent(scene, i, scenes.length, {hasToolUrl}),
    query: scene.search || strategy.searchQueries?.[i % (strategy.searchQueries?.length || 1)] || strategy.angle || 'editorial minimal background',
    type: scene.type,
  }));
}

// Orchestrate media collection with the NEW model:
//   • EVERY scene gets a STOCK background video (full-bleed, role:'background').
//   • SCRAPED product media is distributed round-robin across ALL scenes as
//     framed overlays (role:'frame') — shown inside on-screen device/browser
//     frames. This guarantees the real product appears throughout the reel.
// Returns a flat, sceneIndex-tagged media array. Each clip carries `role`.
async function collectSmartMedia(strategy, slug, {plan, scrapedPool = [], seedSalt = ''}) {
  const dir = join(projectRoot, 'public', 'instagram-reel-tool', slug, 'media');
  ensureDir(dir);
  const media = [];
  const sceneCount = plan.length || 1;

  // ── 1. STOCK BACKGROUND for every scene (always a moving backdrop). ──
  for (const item of plan) {
    const i = item.sceneIndex;
    const seed = `${slug}:${seedSalt}:${i}:${item.query}`;
    const clip = await fetchPexelsVideo(item.query, dir, `scene${i + 1}`, {seed}).catch(() => null);
    if (clip) {
      media.push({...clip, sceneIndex: i, source: 'stock', role: 'background'});
    } else {
      const image = await fetchUnsplashImage(item.query, dir, `scene${i + 1}-bg`, {seed}).catch(() => null);
      if (image) media.push({...image, sceneIndex: i, source: 'stock', role: 'background'});
    }
  }

  // ── 2. SCRAPED PRODUCT media distributed across ALL scenes as frames. ──
  // Pool is vision-sorted (best first). Spread round-robin so every scene gets
  // product imagery on screen; cycle if there are more scenes than assets.
  const pool = scrapedPool.filter((m) => m && m.file);
  let frameCount = 0;
  if (pool.length > 0) {
    const order = plan.map((p) => p.sceneIndex);
    // Rotate so the hook (scene 0) isn't always first to receive a frame.
    const midFirst = order.length > 1 ? [...order.slice(1), order[0]] : order;
    let pi = 0;
    const passes = Math.max(1, Math.ceil(pool.length / sceneCount));
    for (let pass = 0; pass < passes && pi < pool.length; pass += 1) {
      for (const sceneIndex of midFirst) {
        if (pi >= pool.length) break;
        media.push({...pool[pi], sceneIndex, role: 'frame'});
        pi += 1;
        frameCount += 1;
      }
    }
  }

  const bgCount = media.filter((m) => m.role === 'background').length;
  emitProgress('media', 50, `Media: ${bgCount} stock backgrounds + ${frameCount} scraped product frame(s) across ${sceneCount} scenes`);
  return media;
}

async function collectMedia(strategy, slug, options = {}) {
  emitProgress('media', 45, 'Fetching vertical media from Pexels');
  const dir = join(projectRoot, 'public', 'instagram-reel-tool', slug, 'media');
  ensureDir(dir);
  const scenes = strategy.scenes || [];
  const media = [];

  for (let i = 0; i < scenes.length; i += 1) {
    const query = scenes[i].search || strategy.searchQueries?.[i % strategy.searchQueries.length] || strategy.angle || 'business workflow';
    const safe = `scene${i + 1}`;
    const seed = `${slug}:${options.seedSalt || ''}:${i}:${query}`;
    
    // Fetch Pexels video
    const clip = await fetchPexelsVideo(query, dir, safe, {seed}).catch(() => null);
    if (clip) media.push({...clip, sceneIndex: i, source: 'stock'});

    // Fetch Unsplash image for variety
    const image = await fetchUnsplashImage(query, dir, `${safe}-image`, {seed}).catch(() => null);
    if (image) media.push({...image, sceneIndex: i, source: 'stock'});
  }

  emitProgress('media', 50, `Fetched ${media.length} media items from Pexels/Unsplash`);
  return media;
}


// Resolve a user-supplied voice path. Accepts:
//   • Absolute path:                /Users/me/voices/zain.safetensors  → used as-is
//   • Relative to projectRoot:      audio/pocket-tts/voices/zain.safetensors
//   • Relative to toolRoot:         voices/zain.safetensors
//   • Bare filename in default dir: zain.safetensors  → projectRoot/audio/pocket-tts/voices/
// Returns the first absolute path that actually exists on disk, or throws a clean
// error listing every location we checked so the user can fix the path quickly
// (instead of seeing pocket-tts's 60-line Python traceback for "no such file").
function resolveVoiceFile(voiceFile) {
  if (!voiceFile) throw new Error('voiceFile is empty');
  const candidates = [];
  if (voiceFile.startsWith('/')) {
    candidates.push(voiceFile);
  } else {
    candidates.push(resolve(projectRoot, voiceFile));
    candidates.push(resolve(toolRoot, voiceFile));
    // Bare filename → default voices directory.
    if (!voiceFile.includes('/')) {
      candidates.push(resolve(projectRoot, 'audio', 'pocket-tts', 'voices', voiceFile));
    }
  }
  for (const path of candidates) {
    if (existsSync(path)) return path;
  }
  throw new Error(
    `Voice file not found. Checked:\n  ${candidates.join('\n  ')}\n` +
    `Place .safetensors files under ${resolve(projectRoot, 'audio/pocket-tts/voices')} or pass an absolute path.`,
  );
}

// Emotion/energy presets → pocket-tts temperature values.
// Higher temperature = more expressive/varied delivery; lower = calm/flat.
const TONE_TEMPERATURE = {
  calm:       0.4,
  balanced:   0.7,
  energetic:  0.9,
  expressive: 1.1,
};

function toneToTemperature(tone) {
  return TONE_TEMPERATURE[String(tone || '').toLowerCase()] ?? TONE_TEMPERATURE.balanced;
}

// pocket-tts voice cloning backend. Activated when voiceFile is provided (via --voice-file
// or POCKET_TTS_VOICE env var). Generates speech sentence-by-sentence, then concats.
function runPocketTtsOnce({text, output, voiceFile, temperature, decodeSteps}) {
  // CRITICAL: ensure the parent dir exists IMMEDIATELY before pocket-tts opens
  // the output file. We saw a real failure where mkdirSync(partsDir) ran fine
  // at the top of synthesizePocketTTS but by the time pocket-tts (a separate
  // Python subprocess that loads a 4GB model first, taking ~10s) tried to
  // open() the path, the dir was gone — likely wiped by a concurrent sweep on
  // the public mirror dir. mkdirSync recursive is idempotent and cheap, so
  // calling it on every spawn is bulletproof and adds <1ms.
  mkdirSync(dirname(output), {recursive: true});
  const result = spawnSync('pocket-tts', [
    'generate',
    '--text', text,
    '--voice', voiceFile,
    '--output-path', output,
    '--temperature', String(temperature ?? TONE_TEMPERATURE.balanced),
    '--lsd-decode-steps', String(decodeSteps ?? 1),
  ], {
    cwd: projectRoot,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 32,
  });
  if (result.status !== 0) {
    throw new Error(`pocket-tts failed:\n${result.stderr || result.stdout}`);
  }
  // Verify the file was actually written. Some pocket-tts edge cases (e.g.,
  // empty text, model abort) return exit 0 without producing the WAV — better
  // to fail loudly here than to spawn ffmpeg on a missing input later.
  if (!existsSync(output)) {
    throw new Error(`pocket-tts returned 0 but did not write ${output}`);
  }
}

async function synthesizePocketTTS({text, slug, voiceFile, tone, quality, outputName = 'voiceover.wav', partsPrefix = ''}) {
  // Resolve the voice path to an absolute, existing file BEFORE invoking pocket-tts.
  // This converts "audio/pocket-tts/voices/zain.safetensors" → an abs path under
  // projectRoot, eliminating the cwd ambiguity that produced the FileNotFoundError.
  const resolvedVoice = resolveVoiceFile(voiceFile);
  const temperature = toneToTemperature(tone);
  const decodeSteps = Math.max(1, Math.min(4, Number(quality) || 4));
  const toneLabel = tone || 'balanced';
  emitProgress('tts', 65, `Generating voiceover with pocket-tts (tone: ${toneLabel}, quality: ${decodeSteps}-step)`);
  const publicDir = join(projectRoot, 'public', 'instagram-reel-tool', slug, 'voiceover');
  ensureDir(publicDir);
  const output = join(publicDir, outputName);

  const sentences = splitSentences(text);
  if (!sentences.length) sentences.push(text.trim());

  if (sentences.length === 1) {
    runPocketTtsOnce({text: sentences[0], output, voiceFile: resolvedVoice, temperature, decodeSteps});
    return relative(join(projectRoot, 'public'), output);
  }

  emitProgress('tts', 67, `Synthesizing ${sentences.length} sentences with pocket-tts (${toneLabel})`);
  const partsDir = join(publicDir, 'parts');
  mkdirSync(partsDir, {recursive: true});
  const wavs = [];
  for (let i = 0; i < sentences.length; i += 1) {
    const idx = String(i + 1).padStart(3, '0');
    const partWav = join(partsDir, `${partsPrefix}sentence-${idx}.wav`);
    emitProgress('tts', 67 + Math.round((i / sentences.length) * 10), `sentence ${i + 1}/${sentences.length}`);
    runPocketTtsOnce({text: sentences[i], output: partWav, voiceFile: resolvedVoice, temperature, decodeSteps});
    wavs.push(partWav);
  }
  concatSentencesWithSilence(wavs, output, 0.5);
  return relative(join(projectRoot, 'public'), output);
}

// kokoro-say CLI is the default TTS path. The OpenAI-compatible HTTP server is an
// optional fast-path activated only when KOKORO_API_URL is set AND reachable; any
// failure (connection refused, timeout, non-2xx) is logged and we fall back to the CLI
// so the pipeline doesn't crash when the local Kokoro server is offline.
function runKokoroCliOnce({scriptPath, output, voice}) {
  // Same defensive mkdir as the pocket-tts path — guarantees the parent dir
  // exists right before the subprocess opens the output file.
  mkdirSync(dirname(output), {recursive: true});
  mkdirSync(dirname(scriptPath), {recursive: true});
  const result = spawnSync('kokoro-say', [
    '--file',
    scriptPath,
    '--out',
    output,
    '--voice',
    voice,
    '--speed',
    String(process.env.KOKORO_SPEED || 1.04),
  ], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 8,
  });
  if (result.status !== 0) {
    throw new Error(`kokoro-say failed:\n${result.stderr || result.stdout}`);
  }
  if (!existsSync(output)) {
    throw new Error(`kokoro-say returned 0 but did not write ${output}`);
  }
}

// Sentence splitter — keeps end punctuation, breaks on . ! ? followed by whitespace and
// a capital letter or digit (so abbreviations like "U.S." don't trigger false splits).
function splitSentences(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'])/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Concat per-sentence WAVs with a 0.5s silence between each into `output`. Uses the
// ffmpeg concat *filter* (not demuxer) so source WAVs don't need identical specs.
function concatSentencesWithSilence(sentenceWavs, output, gapSeconds = 0.5) {
  if (sentenceWavs.length === 1 && gapSeconds === 0) {
    cpSync(sentenceWavs[0], output);
    return;
  }
  // Build: [0:a]apad=pad_dur=0.5[s0]; [1:a]apad=pad_dur=0.5[s1]; ... [sN-1=last][:a]concat...
  // Using `apad` to append silence at the end of each clip is simpler than interleaving a
  // silence input — it's one filter per clip with a deterministic gap.
  const inputs = sentenceWavs.flatMap((path) => ['-i', path]);
  const lastIdx = sentenceWavs.length - 1;
  // Each clip except the last gets pad_dur=gap appended; the final clip stays as-is.
  const padFilters = sentenceWavs.map((_, i) =>
    i === lastIdx
      ? `[${i}:a]anull[s${i}]`
      : `[${i}:a]apad=pad_dur=${gapSeconds}[s${i}]`,
  ).join(';');
  const concatInputs = sentenceWavs.map((_, i) => `[s${i}]`).join('');
  const filterComplex = `${padFilters};${concatInputs}concat=n=${sentenceWavs.length}:v=0:a=1[out]`;
  const result = spawnSync('ffmpeg', [
    '-y',
    ...inputs,
    '-filter_complex', filterComplex,
    '-map', '[out]',
    '-c:a', 'pcm_s16le',
    output,
  ], {encoding: 'utf8', maxBuffer: 1024 * 1024 * 16});
  if (result.status !== 0) {
    throw new Error(`ffmpeg concat with silence failed:\n${result.stderr || result.stdout}`);
  }
}

// Synthesize a single sentence using whichever backend is configured. Prefers the HTTP
// server when KOKORO_API_URL is set and reachable; otherwise (or on any HTTP failure)
// falls back to the kokoro-say CLI. Returns void; writes to `output`.
async function synthSentence({text, output, voice, partScriptPath}) {
  if (process.env.KOKORO_API_URL) {
    try {
      const response = await fetch(process.env.KOKORO_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(process.env.KOKORO_API_KEY ? {Authorization: `Bearer ${process.env.KOKORO_API_KEY}`} : {}),
        },
        body: JSON.stringify({
          model: process.env.KOKORO_MODEL || 'kokoro',
          voice,
          input: text,
          response_format: 'wav',
          speed: Number(process.env.KOKORO_SPEED || 1.04),
        }),
      });
      if (!response.ok) throw new Error(`Kokoro HTTP ${response.status} ${await response.text()}`);
      writeFileSync(output, Buffer.from(await response.arrayBuffer()));
      return;
    } catch (error) {
      emitProgress('tts', 66, `Kokoro HTTP unreachable (${error.message}); using kokoro-say CLI`);
      // fall through
    }
  }
  writeFileSync(partScriptPath, text + '\n');
  runKokoroCliOnce({scriptPath: partScriptPath, output, voice});
}

async function synthesizeKokoro({text, slug, voice, outputName = 'voiceover.wav', partsPrefix = ''}) {
  emitProgress('tts', 65, 'Generating voiceover with Kokoro TTS');
  const publicDir = join(projectRoot, 'public', 'instagram-reel-tool', slug, 'voiceover');
  ensureDir(publicDir);
  const output = join(publicDir, outputName);
  const scriptPath = join(publicDir, `${partsPrefix}script.txt`);
  writeFileSync(scriptPath, text.trim() + '\n');

  // Pipeline rule: synthesize per sentence, then concat with a 0.5s gap between each.
  // Single-sentence input still goes through the per-sentence path (no concat needed).
  const sentences = splitSentences(text);
  if (!sentences.length) sentences.push(text.trim());

  if (sentences.length === 1) {
    await synthSentence({text: sentences[0], output, voice, partScriptPath: scriptPath});
    return relative(join(projectRoot, 'public'), output);
  }

  emitProgress('tts', 67, `Synthesizing ${sentences.length} sentences with 0.5s gaps`);
  const partsDir = join(publicDir, 'parts');
  mkdirSync(partsDir, {recursive: true});
  const wavs = [];
  for (let i = 0; i < sentences.length; i += 1) {
    const idx = String(i + 1).padStart(3, '0');
    const partScript = join(partsDir, `${partsPrefix}sentence-${idx}.txt`);
    const partWav = join(partsDir, `${partsPrefix}sentence-${idx}.wav`);
    await synthSentence({text: sentences[i], output: partWav, voice, partScriptPath: partScript});
    wavs.push(partWav);
  }
  concatSentencesWithSilence(wavs, output, 0.5);
  return relative(join(projectRoot, 'public'), output);
}

function resolveTadaPromptAudio(promptAudio) {
  if (!promptAudio) throw new Error('TADA prompt audio is empty');
  const candidates = [];
  if (promptAudio.startsWith('/')) {
    candidates.push(promptAudio);
  } else {
    candidates.push(resolve(projectRoot, promptAudio));
    candidates.push(resolve(toolRoot, promptAudio));
  }
  for (const path of candidates) {
    if (existsSync(path)) return path;
  }
  throw new Error(`TADA prompt audio not found. Checked:\n  ${candidates.join('\n  ')}`);
}

async function synthesizeTada({text, slug, promptAudio, promptText, model, outputName = 'voiceover.wav', quantize}) {
  const tadaPython = process.env.TADA_PYTHON || 'python3';
  const resolvedPromptAudio = resolveTadaPromptAudio(promptAudio);
  const trimmedPromptText = String(promptText || '').trim();
  const publicDir = join(projectRoot, 'public', 'instagram-reel-tool', slug, 'voiceover');
  ensureDir(publicDir);
  const output = join(publicDir, outputName);
  const promptCache = process.env.TADA_REFERENCE_CACHE || join(toolRoot, '.cache', 'tada', `${basename(resolvedPromptAudio)}.npz`);
  const scriptPath = join(toolRoot, 'scripts', 'tada-tts.py');
  const selectedModel = model || process.env.TADA_WEIGHTS || process.env.TADA_MODEL || 'HumeAI/mlx-tada-1b';
  // 8-bit quantization chosen for richer detail (4-bit loses high-frequency
  // harmonics) — 3B in 8-bit fits comfortably in Apple Silicon unified memory.
  const selectedQuantize = quantize || process.env.TADA_QUANTIZE || '8';

  emitProgress('tts', 65, `Generating voiceover with Hume MLX-TADA (${selectedModel})`);

  const result = spawnSync(tadaPython, [
    scriptPath,
    '--text', text,
    '--output', output,
    '--reference-audio', resolvedPromptAudio,
    ...(trimmedPromptText ? ['--reference-text', trimmedPromptText] : []),
    '--model', selectedModel,
    '--reference-cache', promptCache,
    ...(process.env.TADA_WEIGHTS ? ['--weights', process.env.TADA_WEIGHTS] : []),
    ...(process.env.TADA_TOKENIZER ? ['--tokenizer', process.env.TADA_TOKENIZER] : []),
    ...(selectedQuantize ? ['--quantize', String(selectedQuantize)] : []),
    // New TADA inference options (README-aligned: cosine cfg, logsnr time).
    // num-extra-steps: 20 for per-scene (short text), 50 for continuous (long text).
    '--num-extra-steps', String(process.env.TADA_NUM_EXTRA_STEPS || (text.split(/\s+/).length < 30 ? 20 : 50)),
    '--num-transition-steps', String(process.env.TADA_NUM_TRANSITION_STEPS || 5),
    '--cfg-schedule', process.env.TADA_CFG_SCHEDULE || 'cosine',
    '--time-schedule', process.env.TADA_TIME_SCHEDULE || 'logsnr',
    '--flow-steps', String(process.env.TADA_FLOW_STEPS || 10),
    '--text-repetition-penalty', String(process.env.TADA_TEXT_REP_PENALTY || (text.split(/\s+/).length < 30 ? 1.2 : 1.1)),
    ...(process.env.TADA_ACOUSTIC_CFG ? ['--acoustic-cfg', String(process.env.TADA_ACOUSTIC_CFG)] : []),
    ...(process.env.TADA_NOISE_TEMP ? ['--noise-temp', String(process.env.TADA_NOISE_TEMP)] : []),
    ...(process.env.TADA_TEXT_TEMP ? ['--text-temp', String(process.env.TADA_TEXT_TEMP)] : []),
  ], {
    cwd: projectRoot,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 64,
  });
  if (result.status !== 0) {
    throw new Error(`TADA failed:\n${result.stderr || result.stdout}`);
  }
  let payload = null;
  try {
    const stdout = String(result.stdout || '').trim();
    const jsonLine = stdout.split(/\r?\n/).reverse().find((line) => line.trim().startsWith('{'));
    payload = JSON.parse(jsonLine || '{}');
  } catch {
    throw new Error(`TADA returned non-JSON output:\n${result.stdout || result.stderr}`);
  }
  if (!payload?.ok) {
    throw new Error(`TADA error: ${payload?.error || result.stderr || result.stdout}`);
  }
  if (!existsSync(output)) {
    throw new Error(`TADA returned ok but did not write ${output}`);
  }
  return {
    audioFile: relative(join(projectRoot, 'public'), output),
    promptAudio: resolvedPromptAudio,
    promptText: trimmedPromptText || null,
    model: payload.model || selectedModel,
  };
}

function probeAudioDuration(publicAudioFile) {
  const absolute = join(projectRoot, 'public', publicAudioFile);
  if (!existsSync(absolute)) return null;
  const result = spawnSync('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    absolute,
  ], {encoding: 'utf8'});
  const value = Number(result.stdout.trim());
  return Number.isFinite(value) && value > 0 ? value : null;
}

function makeCaptions(text, durationSeconds) {
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (!words.length) return [];
  const chunks = [];
  for (let i = 0; i < words.length; i += 7) {
    chunks.push(words.slice(i, i + 7).join(' '));
  }
  const secondsPerChunk = durationSeconds / chunks.length;
  return chunks.map((chunk, index) => ({
    text: chunk,
    start: Number((index * secondsPerChunk).toFixed(2)),
    end: Number(((index + 1) * secondsPerChunk).toFixed(2)),
  }));
}

// ─── Display-text shaping ──────────────────────────────────────────────────
// Philosophy (Huashu): on-screen text is purpose-written kinetic display copy,
// NOT a sliced spoken sentence. These helpers TRUST good LLM-authored copy and
// only intervene when it's too long or is an obvious sentence fragment — and
// even then they extract the strongest standalone clause rather than blindly
// chopping mid-phrase (the old bug that produced "First, go to this website
// which" / "Hero Find prompts for SAS, Portfolio").

// Words that signal a phrase is a dangling fragment when it leads or trails.
const FRAGMENT_LEAD = new Set(['and', 'but', 'so', 'or', 'because', 'which', 'that', 'then', 'while', 'when', 'if', 'as', 'of', 'to', 'for', 'with', 'from', 'into', 'this', 'these', 'those']);
const FRAGMENT_TRAIL = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'to', 'of', 'in', 'on', 'for', 'with', 'which', 'that', 'this', 'your', 'my', 'our', 'their', 'is', 'are', 'was', 'were', 'just', 'so', 'as', 'at', 'by', 'from', 'into', 'will', 'can']);

function tidyText(value, fallback = '') {
  return String(value ?? '').trim() ? String(value).replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/^["']+|["']+$/g, '').replace(/\s+/g, ' ').trim()
    : String(fallback || '').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/^["']+|["']+$/g, '').replace(/\s+/g, ' ').trim();
}

// True if the phrase reads like a chopped-off sentence fragment.
function looksLikeFragment(text) {
  const words = tidyText(text).toLowerCase().split(' ').filter(Boolean);
  if (words.length === 0) return true;
  return FRAGMENT_LEAD.has(words[0]) || FRAGMENT_TRAIL.has(words[words.length - 1]);
}

// Extract the strongest leading clause from a long line, breaking on real
// clause boundaries (punctuation / conjunctions) so we never strand a fragment.
function strongestClause(text, maxWords) {
  const cleaned = tidyText(text);
  const words = cleaned.split(' ').filter(Boolean);
  if (words.length <= maxWords && !looksLikeFragment(cleaned)) return cleaned;
  // Try splitting on punctuation or conjunction boundaries; keep the first clause
  // that fits and doesn't read like a fragment.
  const parts = cleaned.split(/\s*[,;:—–]\s*|\s+(?:and|but|so|because|which|that|then|while|when)\s+/i).map((p) => p.trim()).filter(Boolean);
  for (const part of parts) {
    const w = part.split(' ').filter(Boolean);
    if (w.length >= 2 && w.length <= maxWords && !looksLikeFragment(part)) return part;
  }
  // Last resort: take leading words, then trim trailing fragment words.
  let slice = words.slice(0, maxWords);
  while (slice.length > 2 && FRAGMENT_TRAIL.has(slice[slice.length - 1].toLowerCase())) slice.pop();
  return slice.join(' ');
}

// On-screen kinetic display copy: short, punchy, no trailing terminal period.
// On-screen DISPLAY COPY — a COMPLETE, readable sentence (not a 3-4 word
// fragment). The LLM struggles to write good ultra-short copy, so we now show
// the full spoken line (lightly tidied), capped only to avoid runaway length.
// Keeps terminal punctuation so it reads as a real sentence.
function toDisplayCopy(text, {maxWords = 16, fallback = ''} = {}) {
  const cleaned = tidyText(text, fallback);
  if (!cleaned) return '';
  // Take the first full sentence; if it's very long, take up to maxWords but end
  // on a clause boundary so it never strands a dangling word.
  const firstSentence = cleaned.split(/(?<=[.!?])\s+/)[0] || cleaned;
  const words = firstSentence.split(' ').filter(Boolean);
  if (words.length <= maxWords) return firstSentence.trim();
  // Too long: trim to maxWords, then back off to the last clean clause boundary.
  let slice = words.slice(0, maxWords);
  while (slice.length > 6 && FRAGMENT_TRAIL.has(slice[slice.length - 1].toLowerCase().replace(/[^a-z]/g, ''))) slice.pop();
  return slice.join(' ').replace(/[,;:]+$/g, '') + '…';
}

// Supporting subtext: exactly one natural sentence, capped, and never a
// duplicate of the on-screen line.
function toSubtext(text, {maxWords = 16, avoid = ''} = {}) {
  const cleaned = tidyText(text);
  if (!cleaned) return '';
  const firstSentence = cleaned.split(/(?<=[.!?])\s+/)[0] || cleaned;
  const words = firstSentence.replace(/[.!?]+$/g, '').split(' ').filter(Boolean).slice(0, maxWords);
  let out = words.join(' ').trim();
  if (!out) return '';
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
  if (avoid && norm(out).startsWith(norm(avoid)) && norm(out).length - norm(avoid).length < 8) return '';
  return /[.!?]$/.test(firstSentence.trim()) ? `${out}.` : out;
}

// Normalize the pre-render text fields across all scenes. On-screen text is now
// a COMPLETE SENTENCE (the scene's spoken line), so the viewer always reads a
// full, coherent thought. Subtext is reserved for hook/cta accents only to avoid
// double text. Guarantees every scene has non-empty, complete onScreen text.
function normalizePreRenderText(strategy) {
  const scenes = Array.isArray(strategy?.scenes) ? strategy.scenes : [];
  strategy.scenes = scenes.map((scene, index) => {
    const isHook = index === 0 || scene.type === 'hook';
    const isCta = index === scenes.length - 1 || scene.type === 'cta';
    const spoken = tidyText(scene.spoken || '');
    // Complete-sentence budget: a touch tighter for the hook (punchy opener),
    // generous for the rest so full thoughts survive.
    const maxWords = isHook ? 12 : 18;

    // Primary source is the SPOKEN line — that's a complete sentence by design.
    // Authored onScreen is only used when it's itself a full sentence (has a verb-ish
    // length and ends cleanly); otherwise we prefer the spoken line.
    const authored = tidyText(scene.onScreen);
    const authoredIsSentence = authored && authored.split(' ').filter(Boolean).length >= 5 && !looksLikeFragment(authored);
    const source = authoredIsSentence ? authored : (spoken || authored || strategy.hook || strategy.angle || '');
    let onScreen = toDisplayCopy(source, {maxWords, fallback: spoken});
    if (!onScreen) onScreen = toDisplayCopy(spoken || scene.subtext || 'Watch this', {maxWords});

    // Subtext: only keep a distinct supporting line on hook/cta (where it reads as
    // an accent). For middle scenes the complete onScreen sentence stands alone —
    // no second text block competing for the center safe-zone.
    const subtext = (isHook || isCta)
      ? toSubtext(scene.subtext || '', {avoid: onScreen, maxWords: 14})
      : '';

    // Strip any stray empty-string keys some providers emit (seen: `"": ""`).
    const clean = {};
    for (const [k, v] of Object.entries(scene)) {
      if (k.trim()) clean[k] = v;
    }
    return {...clean, onScreen, subtext};
  });
  if (strategy.scenes[0]?.onScreen) strategy.hook = strategy.scenes[0].onScreen;
  return strategy;
}

function frames(seconds) {
  return Math.max(24, Math.round(seconds * fps));
}

function sceneDuration(scene, durationSeconds) {
  const weights = {hook: 0.15, problem: 0.18, solution: 0.18, cta: 0.13};
  return frames(durationSeconds * (weights[scene.type] || 0.16));
}

// Extract a leading numeric/percent token for stat detection (e.g. "87%", "3x", "$2M").
function leadingMetric(text) {
  const m = String(text || '').match(/(\$|₹|€|£)?\d[\d,.]*\s?(%|x|x faster|×|k|m|b|bn|mins?|hours?|days?|weeks?|months?|years?|fps|gb|mb)?/i);
  if (!m) return '';
  return m[0].trim();
}

// Pick the single word to accent in a headline: a metric if present, else the
// strongest content word (skipping stop-words and weak connectors), else the
// first word. Prefers nouns/verbs over prepositions and auxiliaries.
function pickAccentWord(text) {
  const cleaned = tidyText(text);
  const metric = leadingMetric(cleaned);
  if (metric) return metric.replace(/[.,;:]+$/g, '');
  const stop = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'to', 'of', 'in', 'on', 'for', 'with', 'is', 'are', 'was', 'were', 'be',
    'this', 'that', 'these', 'those', 'you', 'your', 'my', 'our', 'their', 'how', 'just', 'now', 'why', 'what',
    'without', 'within', 'into', 'onto', 'from', 'as', 'at', 'by', 'it', 'its', 'they', 'them', 'we', 'i',
    'become', 'becomes', 'get', 'gets', 'make', 'makes', 'use', 'uses', 'do', 'does', 'can', 'will', 'about',
  ]);
  const words = cleaned.split(' ').map((w) => w.replace(/[^\w%$₹+\-]/g, '')).filter(Boolean);
  const content = words.filter((w) => w.length >= 4 && !stop.has(w.toLowerCase()));
  const pool = content.length ? content : words.filter((w) => !stop.has(w.toLowerCase()));
  const finalPool = pool.length ? pool : words;
  // Prefer the longest content word (usually the most concrete noun).
  return finalPool.slice().sort((a, b) => b.length - a.length)[0] || words[0] || '';
}

// Break a display line into 1-2 balanced lines for the statement layout, only
// at a natural word boundary — never mid-clause.
function balanceLines(text, maxPerLine = 4) {
  const words = tidyText(text).split(' ').filter(Boolean);
  if (words.length <= maxPerLine) return [words.join(' ')];
  const midpoint = Math.ceil(words.length / 2);
  return [words.slice(0, midpoint).join(' '), words.slice(midpoint).join(' ')].filter(Boolean);
}

// Kicker label for a given FINAL layout. Gives each slide a "magazine section"
// eyebrow without inventing content.
function kickerForLayout(layout, stepIndex) {
  switch (layout) {
    case 'hook': return '';
    case 'cta': return '';
    case 'stat': return 'BY THE NUMBERS';
    case 'proof': return `STEP ${String(stepIndex || 1).padStart(2, '0')}`;
    case 'checklist': return 'THE CHECKLIST';
    case 'comparison': return 'SIDE BY SIDE';
    case 'bar-graph': return 'THE BREAKDOWN';
    case 'pie-chart': return 'THE SPLIT';
    case 'progress-graph': return 'THE TRAJECTORY';
    case 'motion-graphic': return 'HOW IT FLOWS';
    case 'github-card': return 'ON GITHUB';
    default: return 'THE IDEA';
  }
}

// Coerce a number out of an LLM value ("87%", "3x", "1.2M") → finite number.
function toNumber(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const s = String(v ?? '').replace(/,/g, '');
  const m = s.match(/-?\d+(?:\.\d+)?/);
  if (!m) return 0;
  let n = parseFloat(m[0]);
  if (/k\b/i.test(s)) n *= 1e3;
  else if (/m\b/i.test(s)) n *= 1e6;
  else if (/b\b|bn\b/i.test(s)) n *= 1e9;
  return Number.isFinite(n) ? n : 0;
}

// Sanitize the LLM's layoutData per layout so the renderer always gets clean,
// bounded structures (no missing arrays, capped item counts, numeric values).
function sanitizeLayoutData(layout, raw, fallbackBrands = []) {
  const d = (raw && typeof raw === 'object') ? raw : {};
  const str = (v, max = 48) => tidyText(String(v ?? '')).slice(0, max);
  const brand = (v) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  switch (layout) {
    case 'checklist': {
      const items = (Array.isArray(d.items) ? d.items : []).slice(0, 5).map((it) => {
        if (typeof it === 'string') return {text: str(it, 42), brand: undefined};
        return {text: str(it?.text ?? it?.label, 42), brand: brand(it?.brand)};
      }).filter((it) => it.text);
      return {title: str(d.title, 40), items, checked: d.checked !== false};
    }
    case 'comparison': {
      const col = (arr) => (Array.isArray(arr) ? arr : []).slice(0, 4).map((x) => str(typeof x === 'string' ? x : x?.text, 36)).filter(Boolean);
      return {
        leftTitle: str(d.leftTitle || 'Before', 22),
        rightTitle: str(d.rightTitle || 'After', 22),
        leftItems: col(d.leftItems),
        rightItems: col(d.rightItems),
        leftBrand: brand(d.leftBrand),
        rightBrand: brand(d.rightBrand) || fallbackBrands[0],
      };
    }
    case 'bar-graph': {
      const bars = (Array.isArray(d.bars) ? d.bars : []).slice(0, 5).map((b) => ({
        label: str(b?.label, 22), value: toNumber(b?.value), brand: brand(b?.brand),
      })).filter((b) => b.label);
      return {title: str(d.title, 40), unit: str(d.unit, 10), bars};
    }
    case 'pie-chart': {
      const slices = (Array.isArray(d.slices) ? d.slices : []).slice(0, 4).map((s) => ({
        label: str(s?.label, 22), value: Math.max(0, toNumber(s?.value)), brand: brand(s?.brand),
      })).filter((s) => s.label && s.value > 0);
      return {title: str(d.title, 40), slices};
    }
    case 'progress-graph': {
      const points = (Array.isArray(d.points) ? d.points : []).slice(0, 6).map((p) => ({
        label: str(p?.label, 16), value: toNumber(p?.value),
      })).filter((p) => p.label);
      return {title: str(d.title, 40), unit: str(d.unit, 10), points};
    }
    case 'motion-graphic': {
      const nodes = (Array.isArray(d.nodes) ? d.nodes : []).slice(0, 5).map((n) => ({
        label: str(typeof n === 'string' ? n : n?.label, 20), brand: brand(typeof n === 'object' ? n?.brand : undefined),
      })).filter((n) => n.label);
      const flow = ['linear', 'cycle', 'hub'].includes(d.flow) ? d.flow : 'linear';
      return {title: str(d.title, 40), nodes, flow};
    }
    case 'github-card': {
      // Accept either explicit owner/repo or parse them from a github URL.
      let owner = str(d.owner, 39);
      let repo = str(d.repo, 100);
      const url = typeof d.url === 'string' ? d.url.trim() : '';
      if ((!owner || !repo) && url) {
        const m = url.match(/github\.com\/([^/\s]+)\/([^/\s?#]+)/i);
        if (m) { owner = owner || m[1]; repo = repo || m[2].replace(/\.git$/, ''); }
      }
      const stat = (v) => {
        if (v == null) return '';
        const s = String(v).trim();
        return /^[\d.,]+\s*[kKmM]?$/.test(s) ? s : str(s, 10);
      };
      return {
        owner, repo,
        description: tidyText(String(d.description ?? '')).slice(0, 160),
        language: str(d.language, 24),
        languageColor: typeof d.languageColor === 'string' && /^#?[0-9a-f]{6}$/i.test(d.languageColor.trim()) ? (d.languageColor.trim().startsWith('#') ? d.languageColor.trim() : '#' + d.languageColor.trim()) : undefined,
        stars: stat(d.stars),
        forks: stat(d.forks),
        visibility: ['Public', 'Private'].includes(d.visibility) ? d.visibility : 'Public',
        url,
      };
    }
    default:
      return {};
  }
}

// Layouts that require structured data to be worth rendering. If the LLM picked
// one of these but the data is too thin, we downgrade to a safe text layout.
function layoutHasEnoughData(layout, data) {
  switch (layout) {
    case 'checklist': return (data.items || []).length >= 2;
    case 'comparison': return (data.leftItems || []).length >= 1 && (data.rightItems || []).length >= 1;
    case 'bar-graph': return (data.bars || []).length >= 2;
    case 'pie-chart': return (data.slices || []).length >= 2;
    case 'progress-graph': return (data.points || []).length >= 3;
    case 'motion-graphic': return (data.nodes || []).length >= 2;
    case 'github-card': return Boolean(data.owner && data.repo);
    default: return true;
  }
}

// Build props for the Huashu skill-driven ReelSkill composition. Trusts the
// already-normalized scene.onScreen / scene.subtext (set by normalizePreRenderText)
// and only derives presentation metadata (accent word, kicker, slide archetype).
// The curated animated-emoji set we ship in public/emoji (see scripts/fetch-emoji.sh
// and remotion/emoji.tsx). Keyword map → emoji, plus pools for hook/cta fallbacks.
const EMOJI_SET = new Set([
  'fire', 'star-struck', 'rocket', 'party-popper', 'light-bulb', 'thumbs-up',
  '100', 'sparkles', 'eyes', 'mind-blown', 'clap', 'folded-hands',
  'money-face', 'glowing-star', 'check-mark', 'sunglasses-face',
]);
const EMOJI_KEYWORDS = [
  [/\b(money|revenue|profit|price|cost|cheap|free|dollar|cash|save|budget)\b/i, 'money-face'],
  [/\b(idea|tip|learn|secret|hack|trick|insight|smart)\b/i, 'light-bulb'],
  [/\b(launch|ship|fast|speed|grow|scale|boost|skyrocket)\b/i, 'rocket'],
  [/\b(win|celebrate|congrat|success|achiev|milestone)\b/i, 'party-popper'],
  [/\b(amazing|incredible|wow|insane|mind|shock|unbeliev|crazy)\b/i, 'mind-blown'],
  [/\b(best|top|perfect|fully|complete|nailed)\b/i, '100'],
  [/\b(watch|look|see|reveal|notice|spot)\b/i, 'eyes'],
  [/\b(magic|shine|special|premium|stunning)\b/i, 'sparkles'],
  [/\b(thank|please|grateful|hope|wish)\b/i, 'folded-hands'],
  [/\b(approve|yes|agree|recommend|great)\b/i, 'thumbs-up'],
  [/\b(done|check|verif|confirm|finish)\b/i, 'check-mark'],
  [/\b(cool|easy|chill|relax|smooth)\b/i, 'sunglasses-face'],
];
const EMOJI_HOOK_POOL = ['fire', 'eyes', 'mind-blown', 'star-struck', 'rocket'];
const EMOJI_CTA_POOL = ['thumbs-up', 'folded-hands', 'party-popper', 'glowing-star', 'sparkles'];

// Pick a contextually-relevant animated emoji for a slide. Keyword match wins;
// otherwise a deterministic pick from the type-appropriate pool (seeded).
function pickEmoji(text, seed, type) {
  for (const [re, name] of EMOJI_KEYWORDS) {
    if (re.test(text) && EMOJI_SET.has(name)) return name;
  }
  const pool = type === 'cta' ? EMOJI_CTA_POOL : EMOJI_HOOK_POOL;
  return pool[seedHash(seed) % pool.length];
}

// Enforce the mandatory 6-7 slide count. The reel always renders 6 or 7 slides.
//   • > 7 scenes → keep scene 0 (hook), the last (cta), and the best middle ones,
//     preserving order, capped at 7.
//   • < 6 scenes → insert filler 'statement' slides (split from the longest middle
//     scene's spoken text, or a neutral beat) just before the CTA so we reach 6.
// Keeps the hook first and the CTA last whenever those exist.
const MIN_SLIDES = 6;
const MAX_SLIDES = 7;
function normalizeSceneCount(scenes, strategy) {
  const list = Array.isArray(scenes) ? scenes.filter(Boolean) : [];
  if (list.length === 0) {
    // No scenes at all — fabricate a minimal 6-slide skeleton from the voiceover.
    const vo = String(strategy?.voiceover || strategy?.hook || 'Here is what you need to know.').trim();
    const chunks = splitIntoChunks(vo, MIN_SLIDES);
    return chunks.map((text, i) => ({
      type: i === 0 ? 'hook' : i === MIN_SLIDES - 1 ? 'cta' : 'statement',
      onScreen: text,
      spoken: text,
      subtext: '',
    }));
  }
  if (list.length > MAX_SLIDES) {
    const first = list[0];
    const last = list[list.length - 1];
    const isCtaLast = last && (last.type === 'cta' || last.layout === 'cta');
    const middle = list.slice(1, isCtaLast ? -1 : undefined);
    // Keep the first (MAX_SLIDES - reserved) middle scenes, preserving order.
    const reserved = 1 + (isCtaLast ? 1 : 0);
    const keepMiddle = middle.slice(0, MAX_SLIDES - reserved);
    return isCtaLast ? [first, ...keepMiddle, last] : [first, ...keepMiddle];
  }
  if (list.length < MIN_SLIDES) {
    const out = [...list];
    const isCtaLast = out.length && (out[out.length - 1].type === 'cta' || out[out.length - 1].layout === 'cta');
    const insertAt = isCtaLast ? out.length - 1 : out.length;
    // Build filler statement slides from the longest spoken line so they carry
    // real narration rather than empty beats.
    const donor = [...out].sort((a, b) => String(b.spoken || '').length - String(a.spoken || '').length)[0];
    const donorText = String(donor?.spoken || donor?.onScreen || strategy?.angle || 'Here is the key idea.').trim();
    let fillerIdx = 0;
    while (out.length < MIN_SLIDES) {
      const pieces = splitIntoChunks(donorText, 2);
      const text = pieces[fillerIdx % pieces.length] || donorText;
      out.splice(insertAt + fillerIdx, 0, {
        type: 'statement',
        onScreen: text,
        spoken: '',           // filler carries no NEW audio — the master VO already covers it
        subtext: '',
        _filler: true,
      });
      fillerIdx += 1;
    }
    return out;
  }
  return list;
}

// Split text into roughly `n` even chunks on sentence/word boundaries.
function splitIntoChunks(text, n) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return Array.from({length: n}, () => 'Key point');
  const sentences = clean.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (sentences.length >= n) {
    // Group sentences into n buckets.
    const per = Math.ceil(sentences.length / n);
    const out = [];
    for (let i = 0; i < sentences.length; i += per) out.push(sentences.slice(i, i + per).join(' '));
    return out.slice(0, n);
  }
  // Fewer sentences than buckets — split by words.
  const words = clean.split(' ');
  const per = Math.ceil(words.length / n);
  const out = [];
  for (let i = 0; i < words.length; i += per) out.push(words.slice(i, i + per).join(' '));
  while (out.length < n) out.push(out[out.length - 1] || clean);
  return out.slice(0, n);
}

// Enrich github-card scenes with live repo metadata (stars/forks/language/desc).
// Unauthenticated GitHub API — fine for a handful of calls per run. Best-effort:
// any failure leaves whatever the AI provided. Detects the repo from explicit
// data.owner/repo, a github URL in data.url, or a github.com link in the text.
async function enrichGithubCards(strategy) {
  const scenes = (strategy?.scenes || []).filter((s) => s && (s.type === 'github-card' || s.layout === 'github-card'));
  if (!scenes.length) return;
  const ghRe = /github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/i;
  for (const scene of scenes) {
    const d = (scene.layoutData && typeof scene.layoutData === 'object') ? scene.layoutData : {};
    let owner = d.owner;
    let repo = d.repo;
    if (!owner || !repo) {
      const hay = `${d.url || ''} ${scene.onScreen || ''} ${scene.spoken || ''} ${scene.subtext || ''}`;
      const m = hay.match(ghRe);
      if (m) { owner = owner || m[1]; repo = repo || m[2].replace(/\.git$/, ''); }
    }
    if (!owner || !repo) {
      emitProgress('script', 40, 'github-card scene present but no owner/repo could be resolved — leaving as-is');
      continue;
    }
    repo = repo.replace(/\.git$/, '');
    try {
      emitProgress('script', 40, `Fetching GitHub repo metadata: ${owner}/${repo}`);
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
        headers: {
          'Accept': 'application/vnd.github+json',
          'User-Agent': 'instagram-reel-tool',
          ...(process.env.GITHUB_TOKEN ? {Authorization: `Bearer ${process.env.GITHUB_TOKEN}`} : {}),
        },
      });
      if (!res.ok) {
        emitProgress('script', 40, `GitHub API ${res.status} for ${owner}/${repo} — using provided/empty card data`);
        scene.layoutData = {...d, owner, repo};
        continue;
      }
      const j = await res.json();
      const fmt = (n) => {
        const v = Number(n) || 0;
        if (v >= 1e6) return `${(v / 1e6).toFixed(1)}m`;
        if (v >= 1e3) return `${(v / 1e3).toFixed(1)}k`;
        return String(v);
      };
      scene.layoutData = {
        owner,
        repo,
        description: d.description || j.description || '',
        language: d.language || j.language || '',
        stars: d.stars != null ? d.stars : fmt(j.stargazers_count),
        forks: d.forks != null ? d.forks : fmt(j.forks_count),
        visibility: d.visibility || (j.private ? 'Private' : 'Public'),
        url: d.url || j.html_url || `https://github.com/${owner}/${repo}`,
      };
      emitProgress('script', 41, `GitHub card filled: ${owner}/${repo} — ${fmt(j.stargazers_count)} stars, ${fmt(j.forks_count)} forks, ${j.language || 'n/a'}`);
    } catch (err) {
      emitProgress('script', 40, `GitHub enrichment failed for ${owner}/${repo}: ${err.message} — using provided data`);
      scene.layoutData = {...d, owner, repo};
    }
  }
}

function buildSimplifiedProps({strategy, media, audioFile, durationSeconds, brandLogos, colorOverrides, textEffect, skipCta = false}) {
  const allScenes = strategy.scenes || [];
  // Optionally DROP the final CTA scene (the user finds it monotonous). Only drop
  // a scene that is actually a CTA, and never go below 2 scenes.
  const afterCta = (() => {
    if (!skipCta || allScenes.length <= 2) return allScenes;
    const last = allScenes[allScenes.length - 1];
    const isCta = last && (last.type === 'cta' || last.layout === 'cta');
    return isCta ? allScenes.slice(0, -1) : allScenes;
  })();

  // ── MANDATORY 6-7 SLIDE COUNT ───────────────────────────────────────────────
  // The reel ALWAYS renders 6 or 7 slides regardless of what the strategy passed
  // (the MCP is told to plan 6-7, but this is the hard safety net). If fewer were
  // provided we synthesize filler statement slides drawn from the voiceover; if
  // more, we keep the hook, the CTA, and the strongest middle scenes.
  const scenes = normalizeSceneCount(afterCta, strategy);
  const mediaFor = (index) => media.filter((item) => item.sceneIndex === index);

  // ── AUDIO-FIRST PACING ─────────────────────────────────────────────────────
  // One continuous master track plays from frame 0. Slides are sized so their
  // TOTAL on-screen time always EXCEEDS the audio — narration is never cut.
  //
  // Rules:
  //   • Each slide is on screen at least MIN_SLIDE_SECONDS (5s incl. transition
  //     overlap + in/out element effects), so nothing feels rushed.
  //   • Total video = max(Σ minimums, audio + TAIL_SECONDS), distributed evenly
  //     across the slides so pacing is uniform.
  const MIN_SLIDE_SECONDS = 5;       // hard floor per slide (incl. transitions/effects)
  const TAIL_SECONDS = 1.2;          // breathing room after the last spoken word
  const TRANSITION_OVERLAP_S = TRANSITION_FRAMES / fps; // scenes overlap during a transition

  const audioSeconds = Number(durationSeconds) > 0 ? Number(durationSeconds) : 0;

  const sceneCount = scenes.length || 1;
  const overlapTotal = Math.max(0, sceneCount - 1) * TRANSITION_OVERLAP_S;
  const targetVisible = Math.max(
    sceneCount * MIN_SLIDE_SECONDS,
    (audioSeconds + TAIL_SECONDS),
  );
  const targetSlideSum = targetVisible + overlapTotal;
  const perSlideSeconds = Math.max(MIN_SLIDE_SECONDS, targetSlideSum / sceneCount);
  const perSlideFrames = Math.round(perSlideSeconds * fps);
  const getFrames = () => perSlideFrames;

  // Tag solution scenes with a 1-based step index for the proof kicker.
  let stepCounter = 0;

  const allBrands = Array.isArray(strategy.brands) ? strategy.brands.filter(Boolean) : [];
  const brandMark = (allBrands[0] || brandLogos?.[0]?.name || '').toUpperCase();

  const slides = scenes.map((scene, index) => {
    const isFirst = index === 0;
    const isLast = index === scenes.length - 1;
    const onScreen = tidyText(scene.onScreen || (isFirst ? strategy.hook : scene.spoken) || '');
    const subtext = tidyText(scene.subtext || '');
    const durationInFrames = getFrames(scene);
    const sceneBrands = (Array.isArray(scene.brands) ? scene.brands.filter(Boolean) : []);

    // ── Resolve the LAYOUT. Priority: explicit scene.layout → the AI's chosen
    // scene.type (when it's itself a renderable layout id, e.g. checklist /
    // comparison / stat / bar-graph) → inference from content. Position
    // constraints: scene 0 is the hook; the last scene becomes the CTA ONLY
    // when it's genuinely a CTA (when skipCta dropped the real CTA, the new
    // last scene keeps its content layout). 'problem' has no dedicated layout,
    // so it renders as a 'statement'.
    let layout = LAYOUT_IDS.includes(scene.layout) ? scene.layout : '';
    if (!layout && LAYOUT_IDS.includes(scene.type)) layout = scene.type;
    if (!layout && scene.type === 'problem') layout = 'statement';
    const sceneIsCta = scene.type === 'cta' || scene.layout === 'cta';
    if (isFirst) layout = 'hook';
    else if (sceneIsCta) layout = 'cta';
    else if (!layout) {
      const metric = leadingMetric(onScreen) || leadingMetric(scene.spoken);
      if (metric) layout = 'stat';
      else if (scene.type === 'solution') layout = 'proof';
      else layout = 'statement';
    }

    // Sanitize structured data; downgrade data layouts that came back too thin.
    let layoutData = sanitizeLayoutData(layout, scene.layoutData, sceneBrands.length ? sceneBrands : allBrands);
    if (!layoutHasEnoughData(layout, layoutData)) {
      layout = scene.type === 'solution' ? 'proof' : 'statement';
      layoutData = {};
    }
    if (layout === 'proof') stepCounter += 1;

    const common = {
      kicker: kickerForLayout(layout, stepCounter),
      brands: sceneBrands.length ? sceneBrands : allBrands.slice(0, 2),
      mediaClips: mediaFor(index),
      audioFile: null,
      durationInFrames,
      accentWord: pickAccentWord(onScreen),
    };

    switch (layout) {
      case 'hook':
        return {type: 'hook', headline: onScreen, subtext, bgVariant: 'orb', ...common};

      case 'cta': {
        const trigger = tidyText(strategy.commentTrigger || '');
        let ctaHeadline = onScreen;
        if (!ctaHeadline || /^get\s+\w+$/i.test(ctaHeadline) || ctaHeadline.toUpperCase() === trigger.toUpperCase()) {
          ctaHeadline = trigger ? 'Want the full breakdown?' : 'Try it yourself';
        }
        return {
          type: 'cta',
          headline: ctaHeadline,
          subtext: subtext || tidyText(strategy.commentReward || ''),
          buttonLabel: trigger ? (trigger.length <= 18 ? `Comment "${trigger}"` : trigger) : 'Save this',
          buttonStyle: 'pill',
          brandMark,
          ...common,
        };
      }

      case 'stat': {
        const metric = leadingMetric(onScreen) || leadingMetric(scene.spoken) || tidyText(scene.layoutData?.value) || '';
        const label = tidyText(scene.layoutData?.label) || tidyText(onScreen.replace(metric, '').replace(/^[^a-zA-Z0-9]+/, '')) || subtext;
        return {type: 'stat', value: metric || onScreen, label: label || subtext, subtext, showRings: true, ...common};
      }

      case 'proof':
        return {type: 'proof', headline: onScreen, subtext, ...common};

      case 'checklist':
        return {type: 'checklist', headline: onScreen, subtext, data: layoutData, ...common};

      case 'comparison':
        return {type: 'comparison', headline: onScreen, subtext, data: layoutData, ...common};

      case 'bar-graph':
        return {type: 'bar-graph', headline: onScreen, subtext, data: layoutData, ...common};

      case 'pie-chart':
        return {type: 'pie-chart', headline: onScreen, subtext, data: layoutData, ...common};

      case 'progress-graph':
        return {type: 'progress-graph', headline: onScreen, subtext, data: layoutData, ...common};

      case 'motion-graphic':
        return {type: 'motion-graphic', headline: onScreen, subtext, data: layoutData, ...common};

      case 'github-card':
        return {type: 'github-card', headline: onScreen, subtext, data: layoutData, ...common};

      default:
        return {type: 'statement', lines: balanceLines(onScreen), subtext, emphasisLine: 1, ...common};
    }
  });

  // ── Transition plan (J-cuts / L-cuts + varied wipes) ───────────────────────
  // For each scene boundary we pick: a visual transition style + an audio-cut
  // style. J-cut = next scene's audio leads its visual (audio comes early);
  // L-cut = this scene's audio lingers past its visual (audio trails out). We
  // express this as per-slide audioLeadFrames (how early THIS slide's audio
  // starts, bleeding into the previous scene). Deterministic from the seed.
  const TRANSITION_STYLES = ['fade', 'slide-left', 'slide-up', 'wipe', 'clock-wipe'];
  const seedBase = seedHash(strategy.hook || strategy.angle || 'reel');
  slides.forEach((slide, i) => {
    const h = seedHash(`${seedBase}:${i}`);
    // Visual transition INTO this slide (slide 0 has none).
    slide.transitionIn = i === 0 ? 'none' : TRANSITION_STYLES[h % TRANSITION_STYLES.length];
    // Audio cut style for the boundary entering this slide.
    // ~45% J-cut (audio leads), ~35% L-cut (prev audio trails), else hard.
    const r = (h >>> 4) % 100;
    if (i === 0) {
      slide.cut = 'hard';
      slide.audioLeadFrames = 0;
    } else if (r < 45) {
      slide.cut = 'J'; // this slide's audio starts early, under the previous visual
      slide.audioLeadFrames = 8 + ((h >>> 8) % 7); // 8-14 frames (~0.27-0.47s)
    } else if (r < 80) {
      slide.cut = 'L'; // previous slide's audio lingers (handled by prev slide tail)
      slide.audioLeadFrames = 0;
    } else {
      slide.cut = 'hard';
      slide.audioLeadFrames = 0;
    }
  });

  // ── Decorative animated emoji (hook / CTA) ─────────────────────────────────
  // Honour an emoji the client AI explicitly set on the scene; otherwise
  // keyword-match + seed-pick for hook/CTA slides only.
  slides.forEach((slide, i) => {
    const provided = scenes[i] && typeof scenes[i].emoji === 'string' ? scenes[i].emoji.trim() : '';
    if (provided) {
      slide.emoji = provided;
    } else if (slide.type === 'hook' || slide.type === 'cta') {
      const text = `${slide.headline || ''} ${slide.subtext || ''}`;
      slide.emoji = pickEmoji(text, `${seedBase}:emoji:${i}`, slide.type);
    }
  });

  return {
    slides,
    brandLogos: brandLogos || [],
    voiceoverAudioFile: audioFile,
    accentColor: colorOverrides?.accent || '#C04A1A',
    colorOverrides: colorOverrides || null,
    textEffect: ['word-stagger', 'line-fade', 'scale-pop', 'blur-reveal'].includes(textEffect) ? textEffect : 'word-stagger',
    // Pacing transparency: the reel's length is the sum of per-scene VO clips when
    // audio exists (audioDriven=true), so more narration → more/longer slides.
    audioDriven: audioSeconds > 0,
    sceneCount: slides.length,
    totalDurationInFrames: slides.reduce((sum, slide) => sum + slide.durationInFrames, 0),
  };
}

function copyPublicAsset(sourceRelative, publicDir) {
  if (!sourceRelative) return false;
  // Search toolRoot/public first (the Next.js tool's own assets — brand logos,
  // audio, voiceover), then fall back to projectRoot/public (parent Remotion
  // workspace). This fixes a bug where brand logos that live in
  // instagram-reel-tool/public/brand/ were not found because copyPublicAsset
  // only searched OutGrow - Remotion/public/.
  const candidates = [
    join(toolRoot, 'public', sourceRelative),
    join(projectRoot, 'public', sourceRelative),
  ];
  const source = candidates.find(existsSync);
  if (!source) return false;
  const destination = join(publicDir, sourceRelative);
  ensureDir(dirname(destination));
  cpSync(source, destination, {recursive: true});
  return true;
}

// Remove media/logo references whose underlying file is missing in public/ so
// that Remotion never tries to staticFile() a broken path. This is the main
// failsafe against renders crashing on a missing asset.
function sanitizeProps(props) {
  // Check toolRoot/public first (brand logos, audio), then projectRoot/public
  // (stock videos downloaded by collectMedia into the parent workspace's public/).
  const exists = (relative) => {
    if (!relative) return false;
    return existsSync(join(toolRoot, 'public', relative)) || existsSync(join(projectRoot, 'public', relative));
  };
  const filterClips = (clips = []) => clips.filter((clip) => clip && exists(clip.file));
  if (Array.isArray(props.slides)) {
    const sanitizedSlides = props.slides.map((slide) => ({
      ...slide,
      mediaClips: filterClips(slide.mediaClips),
      audioFile: exists(slide.audioFile) ? slide.audioFile : null,
    }));
    const sanitizedLogos = (props.brandLogos || []).filter((logo) => logo && (!logo.file || exists(logo.file)));
    const audioOk = exists(props.voiceoverAudioFile);
    return {
      ...props,
      slides: sanitizedSlides,
      brandLogos: sanitizedLogos,
      voiceoverAudioFile: audioOk ? props.voiceoverAudioFile : '',
      totalDurationInFrames: sanitizedSlides.reduce((sum, slide) => sum + (slide.durationInFrames || 96), 0),
    };
  }
  const sanitizedHook = {...props.hook, mediaClips: filterClips(props.hook?.mediaClips), audioFile: exists(props.hook?.audioFile) ? props.hook.audioFile : null};
  const sanitizedProblem = {
    ...props.problem,
    beats: (props.problem?.beats || []).map((beat) => ({...beat, mediaClips: filterClips(beat.mediaClips), audioFile: exists(beat.audioFile) ? beat.audioFile : null})),
  };
  const sanitizedSolution = {
    ...props.solution,
    beats: (props.solution?.beats || []).map((beat) => ({...beat, mediaClips: filterClips(beat.mediaClips), audioFile: exists(beat.audioFile) ? beat.audioFile : null})),
  };
  const sanitizedCta = props.cta ? {
    ...props.cta,
    mediaClips: filterClips(props.cta?.mediaClips),
    audioFile: exists(props.cta?.audioFile) ? props.cta.audioFile : null,
  } : undefined;
  // Brand logos: keep logos that either have a file that exists, or have no file
  // (name-only logos rendered via chip/monogram — these never need a file).
  const sanitizedLogos = (props.brandLogos || []).filter((logo) => logo && (!logo.file || exists(logo.file)));
  const audioOk = exists(props.voiceoverAudioFile);
  const talkingHead = props.talkingHead && exists(props.talkingHead.file)
    ? props.talkingHead
    : {...(props.talkingHead || {}), enabled: false, file: ''};
  return {
    ...props,
    hook: sanitizedHook,
    problem: sanitizedProblem,
    solution: sanitizedSolution,
    cta: sanitizedCta || props.cta,
    brandLogos: sanitizedLogos,
    voiceoverAudioFile: audioOk ? props.voiceoverAudioFile : '',
    talkingHead,
  };
}

// Copy the entire public/fonts/ directory (if present) into the per-run sandbox so
// staticFile('fonts/X.otf') resolves during render. Without this the font HEAD-probe
// loader gets 404s for every variant. Fonts are bytes — small enough that copying
// the whole dir per run is cheaper than enumerating which OTF/TTFs are referenced.
function copyFontsAsset(publicDir) {
  const source = join(projectRoot, 'public', 'fonts');
  if (!existsSync(source)) return;
  const destination = join(publicDir, 'fonts');
  ensureDir(destination);
  cpSync(source, destination, {recursive: true});
}

function prepareRenderPublicDir(slug, props) {
  const publicDir = join(toolRoot, 'runs', slug, 'public');
  ensureDir(publicDir);
  // OutgrowReel uses .png variants per the locked spec; ToolReel uses .svg. Ship both
  // so either composition has its required brand assets in the sandbox.
  copyPublicAsset('brand/outgrow_white.svg', publicDir);
  copyPublicAsset('brand/outgrow_black.svg', publicDir);
  copyPublicAsset('brand/outgrow_white.png', publicDir);
  copyPublicAsset('brand/outgrow_black.png', publicDir);
  copyPublicAsset('brand/velocity-logo.png', publicDir);
  copyPublicAsset('brand/velocity-logo-white.png', publicDir);
  copyPublicAsset('brand/wtfes-logo.png', publicDir);
  copyPublicAsset(props.voiceoverAudioFile, publicDir);
  copyPublicAsset(props.talkingHead?.file, publicDir);
  copyFontsAsset(publicDir);
  // Footage mode (TalkingHeadReel): the base video carries the speech audio and
  // each beat may reference B-roll / overlay media. Copy them into the sandbox so
  // staticFile() resolves during render.
  copyPublicAsset(props.sourceVideo, publicDir);
  for (const beat of props.beats || []) {
    copyPublicAsset(beat.mediaRef, publicDir);
    const ld = beat.layoutData || {};
    for (const key of ['mediaRef', 'beforeRef', 'afterRef', 'avatarRef']) {
      if (typeof ld[key] === 'string') copyPublicAsset(ld[key], publicDir);
    }
  }
  for (const slide of props.slides || []) {
    copyPublicAsset(slide.audioFile, publicDir);
    for (const clip of slide.mediaClips || []) copyPublicAsset(clip.file, publicDir);
  }
  // Brand logos: Velocity injects file-based logos — copy them explicitly.
  // Other templates use chip/monogram logos (no file), so this is a no-op for them.
  for (const logo of props.brandLogos || []) {
    if (logo?.file) copyPublicAsset(logo.file, publicDir);
  }
  copyPublicAsset(props.hook?.audioFile, publicDir);
  for (const clip of props.hook?.mediaClips || []) copyPublicAsset(clip.file, publicDir);
  for (const beat of props.problem?.beats || []) {
    copyPublicAsset(beat.audioFile, publicDir);
    for (const clip of beat.mediaClips || []) copyPublicAsset(clip.file, publicDir);
  }
  for (const beat of props.solution?.beats || []) {
    copyPublicAsset(beat.audioFile, publicDir);
    for (const clip of beat.mediaClips || []) copyPublicAsset(clip.file, publicDir);
  }
  // CTA media clips (Velocity uses these for the video background on the final scene)
  copyPublicAsset(props.cta?.audioFile, publicDir);
  for (const clip of props.cta?.mediaClips || []) copyPublicAsset(clip.file, publicDir);

  // Animated-emoji assets (Google Noto via @remotion/animated-emoji). Each slide
  // may reference one decorative emoji; copy its webm+mp4 at 1x/2x so the
  // composition's staticFile('emoji/<name>-<scale>x.<ext>') resolves in the
  // render sandbox. Assets live in toolRoot/public/emoji (scripts/fetch-emoji.sh).
  const emojiNames = new Set(
    (props.slides || []).map((s) => s && s.emoji).filter(Boolean),
  );
  for (const name of emojiNames) {
    for (const scale of ['1', '2']) {
      for (const ext of ['webm', 'mp4']) {
        copyPublicAsset(`emoji/${name}-${scale}x.${ext}`, publicDir);
      }
    }
  }
  return publicDir;
}


// Async spawn so we can stream Remotion's stdout, parse "Bundling X%" / "Rendered
// X/Y" / "Encoded X%" lines, and emit fine-grained progress events. Without this
// the bar jumps 86 → 90 → 100 with multi-minute pauses in between, making the
// render look stuck even though it's grinding through ~1024 frames.
function spawnRender({output, propsPath, publicDir, concurrency, scale, compositionId = 'ReelSkill', percentBand = [80, 99], crf}) {
  const args = [
    'remotion',
    'render',
    'instagram-reel-tool/remotion/index.ts',
    compositionId,
    output,
    '--props',
    propsPath,
    '--public-dir',
    publicDir,
    '--concurrency',
    String(concurrency),
    '--timeout',
    '180000',
  ];
  if (scale) args.push('--scale', String(scale));
  // High-bitrate render: override Remotion's default CRF (typically 18) with
  // a tighter target so the rendered MP4 keeps more detail in fast motion.
  // CRF is logarithmic — 16 ≈ 30% larger file vs 18, ≈ 1.5x vs 22.
  if (crf) args.push('--crf', String(crf));
  return new Promise((resolveFn) => {
    const child = spawn('npx', args, {cwd: projectRoot});
    const [bandLo, bandHi] = percentBand;
    const bandSize = bandHi - bandLo;
    const mapPct = (frac) => Math.max(bandLo, Math.min(bandHi, Math.round(bandLo + frac * bandSize)));
    let lastEmitted = 0;

    const handleLine = (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      // 1. Bundling X% — first ~10% of the band
      const bundleMatch = trimmed.match(/Bundling (\d+)%/i);
      if (bundleMatch) {
        const pct = Number(bundleMatch[1]);
        const overall = mapPct((pct / 100) * 0.10);
        if (overall !== lastEmitted) {
          lastEmitted = overall;
          emitProgress('render', overall, `Bundling ${pct}%`);
        }
        return;
      }
      // 2. Rendered N/M — middle ~80% of the band, mapped by frame ratio
      const renderedMatch = trimmed.match(/Rendered (\d+)\/(\d+)(?:, time remaining: ([^\n]+))?/);
      if (renderedMatch) {
        const done = Number(renderedMatch[1]);
        const total = Number(renderedMatch[2]);
        const remaining = renderedMatch[3];
        if (total > 0) {
          // 0.10..0.90 of the band so encoding has room at the end.
          const overall = mapPct(0.10 + (done / total) * 0.80);
          if (overall !== lastEmitted) {
            lastEmitted = overall;
            emitProgress('render', overall, `Rendered ${done}/${total} frames${remaining ? ` (${remaining})` : ''}`, undefined, {currentFrame: done});
          }
        }
        return;
      }
      // 3. Encoded X% — final 10% of the band
      const encodedMatch = trimmed.match(/Encoded (\d+)%/i);
      if (encodedMatch) {
        const pct = Number(encodedMatch[1]);
        const overall = mapPct(0.90 + (pct / 100) * 0.10);
        if (overall !== lastEmitted) {
          lastEmitted = overall;
          emitProgress('render', overall, `Encoding ${pct}%`);
        }
        return;
      }
      // 4. Anything else gets relayed as a log line so render errors stay visible.
      // Skip the noisy DM Sans warning so it doesn't spam the Job Log.
      if (/Made \d+ network requests to load fonts/.test(trimmed)) return;
      process.stderr.write(JSON.stringify({type: 'log', message: trimmed.slice(0, 400)}) + '\n');
    };

    let outBuf = '';
    let errBuf = '';
    child.stdout.on('data', (chunk) => {
      outBuf += chunk.toString();
      let nl;
      while ((nl = outBuf.indexOf('\n')) >= 0) {
        handleLine(outBuf.slice(0, nl));
        outBuf = outBuf.slice(nl + 1);
      }
    });
    child.stderr.on('data', (chunk) => {
      errBuf += chunk.toString();
      let nl;
      while ((nl = errBuf.indexOf('\n')) >= 0) {
        handleLine(errBuf.slice(0, nl));
        errBuf = errBuf.slice(nl + 1);
      }
    });
    child.on('error', (err) => {
      emitProgress('render', null, `Render spawn error: ${err.message}`);
      resolveFn({status: 1});
    });
    child.on('close', (code) => {
      // Drain any partial trailing line before finishing.
      if (outBuf.trim()) handleLine(outBuf);
      if (errBuf.trim()) handleLine(errBuf);
      resolveFn({status: code});
    });
  });
}

// Map the generic ToolReelProps the generator already builds onto the OutgrowReel
// composition's schema. Same hook/problem/solution/cta/captions shape; difference
// is per-beat `brands: string[]` (Outgrow renders chips itself via logo.dev rather
// than using ToolReel's pre-fetched brandLogos[]).
function mapPropsToOutgrowReel(props) {
  // Per-beat brands take precedence; fall back to the union of brandLogos[].name.
  const fallbackBrandNames = (props.brandLogos || []).map((logo) => logo?.name).filter(Boolean);
  const brandsFor = (beat) => (Array.isArray(beat?.brands) && beat.brands.length ? beat.brands : fallbackBrandNames);
  const stripBeat = (beat) => ({
    spoken: beat?.spoken || '',
    onScreen: beat?.onScreen || '',
    mediaClips: (beat?.mediaClips || []).map((clip) => ({file: clip.file, kind: clip.kind})),
    durationInFrames: beat?.durationInFrames || 180,
    brands: brandsFor(beat),
    miniBullets: Array.isArray(beat?.miniBullets) ? beat.miniBullets : [],
  });
  return {
    logoVariant: props.logoVariant || 'white',
    logoDevToken: props.logoDevToken || process.env.LOGO_DEV_PUBLIC_KEY || '',
    hook: {
      eyebrow: props.hook?.eyebrow || 'OUTGROW REEL',
      tagline: props.hook?.tagline || props.hook?.spoken || '',
      onScreen: props.hook?.onScreen || '',
      footer: props.hook?.footer || 'OUTGROW INTELLIGENCE STUDIOS',
      mediaClips: (props.hook?.mediaClips || []).map((clip) => ({file: clip.file, kind: clip.kind})),
      durationInFrames: props.hook?.durationInFrames || 180,
      brands: brandsFor(props.hook),
    },
    problem: {
      title: props.problem?.title || 'WHAT PEOPLE MISS',
      beats: (props.problem?.beats || []).map(stripBeat),
      durationInFrames: props.problem?.durationInFrames || 360,
    },
    solution: {
      title: props.solution?.title || 'WHAT TO DO INSTEAD',
      beats: (props.solution?.beats || []).map(stripBeat),
      durationInFrames: props.solution?.durationInFrames || 360,
    },
    cta: {
      tagline: props.cta?.tagline || '',
      commentTrigger: props.cta?.commentTrigger || 'PROMPT',
      commentReward: props.cta?.commentReward || 'the workflow checklist',
      footer: props.cta?.footer || 'OUTGROW INTELLIGENCE STUDIOS',
      durationInFrames: props.cta?.durationInFrames || 180,
    },
    voiceoverAudioFile: props.voiceoverAudioFile || '',
    ...(props.talkingHead ? {talkingHead: props.talkingHead} : {}),
    captions: props.captions || [],
    totalDurationInFrames: props.totalDurationInFrames || 1080,
  };
}

// Loop-tail post-process: cross-fade the last 12 frames with the first 12 so
// the rendered MP4 plays seamlessly when Instagram loops it. Returns the new
// path (or the original if ffmpeg is missing / fails — graceful degrade).
function applyLoopTail(inputPath) {
  try {
    if (!existsSync(inputPath)) return inputPath;
    // 12 frames = 0.4s at 30fps. Long enough to be smooth, short enough to feel
    // like the reel "wraps" rather than visibly cross-fading.
    const TAIL_SECONDS = 0.4;
    const tmpPath = inputPath.replace(/\.mp4$/i, '.looped.mp4');
    // Probe duration so we know where to cut. ffprobe isn't always on PATH
    // alongside ffmpeg, so fall back to ffmpeg -f null -i with stderr parse.
    const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', inputPath], {encoding: 'utf8'});
    if (probe.status !== 0 || !probe.stdout) return inputPath;
    const totalSeconds = parseFloat(probe.stdout.trim());
    if (!Number.isFinite(totalSeconds) || totalSeconds < 2) return inputPath;
    const cutAt = totalSeconds - TAIL_SECONDS;
    const result = spawnSync('ffmpeg', [
      '-y', '-loglevel', 'error',
      '-i', inputPath,
      '-filter_complex',
      `[0:v]split=3[v_main][v_head][v_tail];` +
      `[v_main]trim=duration=${cutAt.toFixed(3)},setpts=PTS-STARTPTS[main];` +
      `[v_head]trim=duration=${TAIL_SECONDS},setpts=PTS-STARTPTS[head];` +
      `[v_tail]trim=start=${cutAt.toFixed(3)}:duration=${TAIL_SECONDS},setpts=PTS-STARTPTS[tail];` +
      `[tail][head]xfade=duration=${TAIL_SECONDS}:offset=0:transition=fade[crossed];` +
      `[main][crossed]concat=n=2:v=1:a=0[v]`,
      '-map', '[v]',
      '-map', '0:a?',  // pass audio through if present
      '-c:a', 'copy',
      '-pix_fmt', 'yuv420p',
      tmpPath,
    ], {timeout: 120_000});
    if (result.status !== 0 || !existsSync(tmpPath)) {
      emitProgress('render', 99, 'Loop tail post-process failed; keeping original render');
      return inputPath;
    }
    // Replace original with looped version.
    rmSync(inputPath);
    cpSync(tmpPath, inputPath);
    rmSync(tmpPath);
    emitProgress('render', 99, 'Loop tail applied — last 12 frames cross-faded with first 12');
    return inputPath;
  } catch (error) {
    emitProgress('render', 99, `Loop tail skipped: ${error.message || error}`);
    return inputPath;
  }
}

// Auto-trim TTS silence: strip leading/trailing silence (>0.4s of <-30dB) from
// the synthesized voiceover so the reel doesn't open or close on dead air.
// Operates on the public-resolved path (under public/voiceover/...). Returns
// new audio file path or original on any failure.
function applyAutoTrim(audioFile) {
  try {
    if (!audioFile) return audioFile;
    const absInput = audioFile.startsWith('/') ? audioFile : join(projectRoot, 'public', audioFile);
    if (!existsSync(absInput)) return audioFile;
    const tmpPath = absInput.replace(/(\.[a-z0-9]+)$/i, '.trimmed$1');
    const result = spawnSync('ffmpeg', [
      '-y', '-loglevel', 'error',
      '-i', absInput,
      // Strip 0.4s of <-30dB silence at both ends — same threshold pocket-tts
      // typically pads with on its end-of-utterance breath sample.
      '-af', 'silenceremove=start_periods=1:start_duration=0.4:start_threshold=-30dB:stop_periods=1:stop_duration=0.4:stop_threshold=-30dB',
      tmpPath,
    ], {timeout: 30_000});
    if (result.status !== 0 || !existsSync(tmpPath)) {
      return audioFile;
    }
    rmSync(absInput);
    cpSync(tmpPath, absInput);
    rmSync(tmpPath);
    emitProgress('voice', 76, 'Auto-trimmed leading/trailing silence');
    return audioFile;
  } catch {
    return audioFile;
  }
}

async function renderReel(slug, propsPath, props, template, opts = {}) {
  emitProgress('render', 86, 'Rendering Remotion MP4');
  const outputDir = join(toolRoot, 'runs', slug);
  ensureDir(outputDir);
  const output = join(outputDir, `${slug}.mp4`);
  const publicDir = prepareRenderPublicDir(slug, props);

  const compositionId = opts.compositionId || 'ReelSkill';
  const useOutgrow = false;
  let activePropsPath = propsPath;
  let activeProps = props;
  if (useOutgrow) {
    const outgrowProps = mapPropsToOutgrowReel(props);
    activePropsPath = join(outputDir, `${slug}.outgrow.json`);
    writeFileSync(activePropsPath, JSON.stringify(outgrowProps, null, 2) + '\n');
    activeProps = outgrowProps;
  }

  // Three-pass render with progressive degradation:
  //   1. Fast pass:  concurrency 2, full media, full quality.
  //   2. Slow pass:  concurrency 1, full media — keeps every Pexels/microlink clip in
  //                  the final reel but eliminates the OffthreadVideo proxy race that
  //                  produces "write ECONNRESET" / "Failed to fetch sceneN.mp4 …
  //                  disk space low" errors when two frames extract from the same
  //                  large video simultaneously.
  //   3. Safe pass:  concurrency 1, no media — typography-only fallback so the user
  //                  always gets *some* watchable MP4 even if the first two die.

  // High-bitrate pass-through: opts.crf is set by main() / runRenderStage when
  // --high-bitrate is on. CRF 16 ≈ 1.3x file size of the default 18, with
  // visibly tighter detail in motion. All three passes use the same setting.
  const crf = opts.crf;

  // Pass 1: fast.
  let result = await spawnRender({output, propsPath: activePropsPath, publicDir, concurrency: 2, compositionId, percentBand: [80, 92], crf});
  if (result.status === 0) return finalisePostRender(output, opts);

  // Pass 2: same media, but serialised. Most ECONNRESET / proxy errors disappear
  // when only one frame is in flight at a time.
  emitProgress('render', 92, 'First render failed — retrying with full media at concurrency 1');
  result = await spawnRender({output, propsPath: activePropsPath, publicDir, concurrency: 1, compositionId, percentBand: [92, 97], crf});
  if (result.status === 0) return finalisePostRender(output, opts);

  // Pass 3: typography-only failsafe. Strip mediaClips, keep voiceoverAudioFile (the
  // WAV is local in the per-run sandbox and works fine — blanking it would make the
  // composition's <Audio src={staticFile('')}> resolve to `/public/` and 404).
  emitProgress('render', 97, 'Slow-pass render failed — falling back to typography-only safe mode');
  const stripBeat = (beat) => ({...beat, mediaClips: []});
  // The safe pass strips media so the composition always produces *some* MP4.
  // Default behaviour is ReelSkill-shaped (hook/problem/solution beats); footage
  // mode supplies its own transform via opts.safePropsTransform.
  const buildSafeProps = opts.safePropsTransform || ((p) => ({
    ...p,
    ...(useOutgrow ? {} : {brandLogos: []}),
    hook: {...p.hook, mediaClips: []},
    problem: {...p.problem, beats: (p.problem?.beats || []).map(stripBeat)},
    solution: {...p.solution, beats: (p.solution?.beats || []).map(stripBeat)},
  }));
  const safeProps = buildSafeProps(activeProps);
  const safePropsPath = join(outputDir, `${slug}.safe.json`);
  writeFileSync(safePropsPath, JSON.stringify(safeProps, null, 2) + '\n');
  result = await spawnRender({output, propsPath: safePropsPath, publicDir, concurrency: 1, scale: 0.75, compositionId, percentBand: [97, 99], crf});
  if (result.status === 0) return finalisePostRender(output, opts);

  emitProgress('render', 99, 'Render failed after safe-mode retry — keeping props for inspection');
  return null;
}

// Final post-processing wrapper: applies loop-tail when requested. Runs after
// the render pass that succeeded; never throws (graceful degrade if ffmpeg
// can't do the cross-fade for any reason).
function finalisePostRender(output, opts = {}) {
  if (opts.loopTail) return applyLoopTail(output);
  return output;
}

// ─── Stage functions ──────────────────────────────────────────────────────────
// Each stage reads its predecessor's JSON, does its slice, and writes its own.
// They share helper logic with main()'s monolithic flow but are independently
// runnable so the UI can re-do voice without re-running source/script.

// Stage 1 — SOURCE: URL / uploaded video / transcript override → transcript text.
// Output: runs/<slug>/source.json {sourceMeta, transcript, mode}
async function runSourceStage(args, slug) {
  emitProgress('source', 5, `Stage source: preparing run ${slug}`);
  const userRequestedSkip = Boolean(args['skip-transcribe']);
  const overrideText = String(args.transcript || '').trim();
  const overrideUsable = overrideText.length >= 32;
  const willSkip = userRequestedSkip && overrideUsable;
  let sourceMeta = {title: args.topic || 'Input video', caption: '', ai_insights: {}};
  let transcript = overrideText;
  let mode = 'override';

  if (!willSkip && args['video-file']) {
    const videoFile = String(args['video-file']);
    if (!existsSync(videoFile)) throw new Error(`Uploaded video file not found at ${videoFile}`);
    emitProgress('source', 10, `Transcribing uploaded video (${relative(projectRoot, videoFile)})`);
    const batch = await transcribeLocalVideo(videoFile, process.env.WHISPER_MODEL || 'base');
    const video = batch.videos?.[0];
    if (!video) throw new Error(`Local-audio transcriber returned no video result.`);
    sourceMeta = {...video, title: video.title || basename(videoFile)};
    emitProgress('source', 24, 'Cleaning transcript (spelling + brand-name fixes)');
    {
      const cleaned = await cleanupTranscriptLLM(String(video.transcript_text || '').trim());
      transcript = cleaned.text;
      if (cleaned.brands.length) sourceMeta = {...sourceMeta, detectedBrands: cleaned.brands};
    }
    mode = 'video-file';
  } else if (!willSkip && args.url) {
    emitProgress('source', 10, `Transcribing ${args.url}`);
    const batch = await transcribeInput(args.url, process.env.WHISPER_MODEL || 'base');
    const video = batch.videos?.[0];
    if (!video?.transcript_text) throw new Error('Transcriber returned no transcript text.');
    sourceMeta = video;
    emitProgress('source', 24, 'Cleaning transcript (spelling + brand-name fixes)');
    {
      const cleaned = await cleanupTranscriptLLM(video.transcript_text);
      transcript = cleaned.text;
      if (cleaned.brands.length) sourceMeta = {...sourceMeta, detectedBrands: cleaned.brands};
    }
    mode = 'url';
  } else if (willSkip) {
    mode = 'override';
    emitProgress('source', 22, `Using transcript override (${transcript.length} chars)`);
  } else {
    mode = 'empty';
    emitProgress('source', 22, 'No URL or video provided — strategy will run on positioning angle only');
  }

  const payload = {sourceMeta, transcript, mode, generatedAt: new Date().toISOString()};
  writeStageJson(slug, 'source', payload);
  updateCheckpointStage(slug, 'source', {mode, transcriptChars: transcript.length});
  emitProgress('source', 28, `Stage source complete (${transcript.length} chars)`);
  return payload;
}

// Stage F1 — INGEST (footage mode): raw video file → normalized 1080x1920 master.
// Output: runs/<slug>/footage.json + public/instagram-reel-tool/<slug>/footage/master.{mp4,wav}
async function runIngestStage(args, slug) {
  const input = args['video-file'];
  if (!input || !existsSync(input)) throw new Error(`--video-file missing or not found: ${input}`);
  const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
  const ffprobe = process.env.FFPROBE_PATH || 'ffprobe';

  // Dual-speaker mode: --reframe dual keeps the FULL width (scaled to 1920 tall)
  // so the composition can crop to either speaker per beat. --speakers is a JSON
  // array [{id, cx}] of normalized horizontal centres (0-1) for each speaker.
  const mode = args.reframe === 'dual' ? 'wide' : 'cover';
  let speakers = [];
  if (args.speakers) {
    try { speakers = JSON.parse(args.speakers); } catch { throw new Error(`--speakers must be JSON [{id,cx}]: ${args.speakers}`); }
  }

  emitProgress('ingest', 10, `Probing ${input}`);
  const meta = probeVideo(ffprobe, input);
  emitProgress('ingest', 20, `Source: ${meta.width}x${meta.height} @ ${meta.fps.toFixed(1)}fps, ${meta.durationSeconds.toFixed(1)}s — normalizing (${mode})`);

  const outDir = join(toolRoot, 'public', 'instagram-reel-tool', slug, 'footage');
  const {master} = normalizeFootage(ffmpeg, input, outDir, {mode});
  const masterMeta = probeVideo(ffprobe, master);

  const payload = {
    inputPath: input,
    sourceMeta: meta,
    master: {
      file: `instagram-reel-tool/${slug}/footage/master.mp4`,
      wav: `instagram-reel-tool/${slug}/footage/master.wav`,
      durationSeconds: masterMeta.durationSeconds,
      width: masterMeta.width, height: masterMeta.height, fps: 30,
      mode,
    },
    speakers,
    generatedAt: new Date().toISOString(),
  };
  writeStageJson(slug, 'footage', payload);
  updateCheckpointStage(slug, 'ingest', {master: payload.master.file, durationSeconds: masterMeta.durationSeconds});
  emitProgress('ingest', 99, 'Stage ingest complete');
  return payload;
}

// Stage F2 — TRANSCRIBE-FOOTAGE: whisper word-level transcript of the master audio.
// Output: runs/<slug>/footage-transcript.json {ok, text, words, captions}
async function runTranscribeFootageStage(args, slug) {
  const footage = requireStage(slug, 'footage');
  const wavAbs = join(toolRoot, 'public', footage.master.wav);
  if (!existsSync(wavAbs)) throw new Error(`master.wav missing — re-run --stage ingest (${wavAbs})`);

  const cacheDir = join(toolRoot, '.cache', 'whisper-footage', slug);
  ensureDir(cacheDir);
  const alignScript = join(toolRoot, 'scripts', 'whisper-align.mjs');
  if (!existsSync(alignScript)) throw new Error('whisper-align.mjs missing at ' + alignScript);
  const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';

  emitProgress('transcribe-footage', 20, 'Transcribing footage with whisper.cpp (word-level)');
  const alignment = await new Promise((resolveAlign) => {
    const proc = spawn('node', [alignScript, wavAbs, cacheDir, ffmpeg], {env: process.env});
    let stdout = ''; let stderr = '';
    const timer = setTimeout(() => { try { proc.kill('SIGTERM'); } catch { /* noop */ } }, 300_000);
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
      const line = d.toString().trim().split('\n').pop();
      if (line && line.startsWith('[align')) emitProgress('transcribe-footage', 40, line.replace(/^\[align[^\]]*\]\s*/, 'Whisper: '));
    });
    proc.on('error', (e) => { clearTimeout(timer); resolveAlign({ok: false, reason: e.message}); });
    proc.on('close', () => {
      clearTimeout(timer);
      try { resolveAlign(JSON.parse(stdout.trim() || '{}')); }
      catch { resolveAlign({ok: false, reason: `unparseable whisper output: ${stderr.slice(-200)}`}); }
    });
  });

  if (!alignment?.ok || !Array.isArray(alignment.words) || !alignment.words.length) {
    throw new Error(`Footage transcription failed: ${alignment?.reason || 'no words returned'} — cannot build an edit plan without a transcript.`);
  }
  const payload = {
    ok: true,
    text: alignment.words.map((w) => w.text).join(' '),
    words: alignment.words,
    captions: alignment.captions || [],
    generatedAt: new Date().toISOString(),
  };
  writeStageJson(slug, 'footage-transcript', payload);
  updateCheckpointStage(slug, 'transcribe-footage', {wordCount: alignment.words.length});
  emitProgress('transcribe-footage', 99, `Stage transcribe-footage complete (${alignment.words.length} words)`);
  return {wordCount: alignment.words.length, text: payload.text};
}

// Stage F3 — EDIT-PLAN: validate + persist the director's EDL.
// Input: --edl-file <path to JSON written by the MCP server>.
// If the EDL has no cuts, an auto cut-list is built from the transcript.
// Output: runs/<slug>/edit_plan.json (validated, caption timings resolved)
async function runEditPlanStage(args, slug) {
  const footage = requireStage(slug, 'footage');
  const transcript = requireStage(slug, 'footage-transcript');
  const edlPath = args['edl-file'];
  if (!edlPath || !existsSync(edlPath)) throw new Error(`--edl-file missing or not found: ${edlPath}`);
  let raw;
  try {
    raw = JSON.parse(readFileSync(edlPath, 'utf-8'));
  } catch (err) {
    throw new Error(`Failed to parse --edl-file ${edlPath}: ${err.message}`);
  }

  const {buildCutList} = await import('./footage/cuts.mjs');
  const {validateEditPlan, resolveCaptionTimings} = await import('./footage/edl.mjs');

  const sourceDuration = footage.master.durationSeconds;
  if (!Array.isArray(raw.cuts) || !raw.cuts.length) {
    emitProgress('edit-plan', 20, 'No cuts provided — building auto cut-list from transcript (silence + filler removal)');
    raw.cuts = buildCutList(transcript.words, {totalDuration: sourceDuration});
    // Caller-provided beats can't know the auto-generated cut count. Normalize them so
    // the final beat absorbs any trailing auto-cuts (common "cut my silences, captions
    // over the whole take" single-beat case), and clamp all indices into range.
    if (Array.isArray(raw.beats) && raw.beats.length) {
      const lastCut = raw.cuts.length - 1;
      const clamp = (n) => Math.max(0, Math.min(lastCut, Number(n) || 0));
      for (const beat of raw.beats) {
        beat.fromCut = clamp(beat.fromCut);
        beat.toCut = clamp(beat.toCut);
      }
      const lastBeat = raw.beats[raw.beats.length - 1];
      lastBeat.toCut = Math.max(lastBeat.toCut, lastCut);
      emitProgress('edit-plan', 25, `Auto-cut produced ${raw.cuts.length} cuts — extended final beat to cover them`);
    }
  }

  const validated = validateEditPlan(raw, {sourceDuration});
  if (!validated.ok) {
    throw new Error(`Edit plan invalid:\n  - ${validated.errors.join('\n  - ')}`);
  }
  for (const w of validated.warnings) emitProgress('edit-plan', 40, `Warning: ${w}`);

  const resolved = resolveCaptionTimings(validated.plan, transcript.words);
  const totalSeconds = resolved.beats.length
    ? resolved.beats[resolved.beats.length - 1].outputEndSec
    : 0;

  // Frame length must come from the per-cut frame sum (the same rounding the
  // composition uses to place each cut), not the seconds sum — otherwise the
  // timeline can fall a few frames short and truncate the last cut.
  const totalFrames = resolved.cuts.reduce((s, c) => s + Math.round((c.end - c.start) * 30), 0);

  const payload = {
    ...resolved,
    source: footage.master,
    totalSeconds,
    totalFrames,
    warnings: validated.warnings,
    generatedAt: new Date().toISOString(),
  };
  writeStageJson(slug, 'edit_plan', payload);
  updateCheckpointStage(slug, 'edit-plan', {cuts: resolved.cuts.length, beats: resolved.beats.length, totalSeconds});
  emitProgress('edit-plan', 99, `Stage edit-plan complete: ${resolved.cuts.length} cuts → ${resolved.beats.length} beats, ${totalSeconds.toFixed(1)}s`);
  return {cuts: resolved.cuts.length, beats: resolved.beats.length, totalSeconds, warnings: validated.warnings};
}

// Tolerant stage reader (pattern is optional in footage mode).
function readStageJsonSafe(slug, name) {
  try { return requireStage(slug, name); } catch { return null; }
}

// Stage F4 — RENDER-FOOTAGE: edit_plan + pattern → TalkingHeadReel MP4.
async function runRenderFootageStage(args, slug) {
  const footage = requireStage(slug, 'footage');
  const plan = requireStage(slug, 'edit_plan');
  const pattern = readStageJsonSafe(slug, 'pattern') || {}; // pattern optional in footage mode

  const colors = pattern.colorOverrides || {};
  const props = {
    sourceVideo: footage.master.file,
    cuts: plan.cuts,
    beats: plan.beats,
    accentColor: colors.accent || colors.primary || '#C04A1A',
    inkColor: colors.secondary || '#2A2A28',
    paperColor: colors.highlight || '#F7F2E9',
    viewfinder: Boolean(args.viewfinder ?? pattern.viewfinder),
    // Cinematic curved top/bottom vignette is ON by default; pass --no-vignette to disable.
    vignette: args['no-vignette'] ? false : (pattern.vignette ?? true),
    // Dual-speaker reframing: wide master dims + speaker centres let the
    // composition crop to either speaker per beat (beat.speaker).
    masterWidth: footage.master.width || 1080,
    masterHeight: footage.master.height || 1920,
    speakers: footage.speakers || [],
    totalDurationInFrames: plan.totalFrames,
  };
  if (!Array.isArray(props.beats) || !props.beats.length) {
    throw new Error('Render aborted: edit_plan has no beats. Run --stage edit-plan first.');
  }

  const propsDir = join(toolRoot, 'runs', slug);
  ensureDir(propsDir);
  const propsPath = join(propsDir, `${slug}.footage-props.json`);
  writeFileSync(propsPath, JSON.stringify(props, null, 2) + '\n');

  emitProgress('render-footage', 84, `Rendering TalkingHeadReel (${plan.beats.length} beats, ${plan.totalSeconds.toFixed(1)}s)`);
  const rendered = await renderReel(slug, propsPath, props, 'huashu', {
    crf: args['high-bitrate'] ? 16 : undefined,
    compositionId: 'TalkingHeadReel',
    safePropsTransform: (p) => ({...p, beats: p.beats.map((b) => ({...b, mediaRef: undefined, treatment: b.treatment === 'broll' ? 'talking-head' : b.treatment}))}),
  });
  if (!rendered) throw new Error('Footage render failed after retries — props kept for inspection at ' + propsPath);

  // Optional music bed with speech ducking (ffmpeg sidechain compression).
  let output = rendered;
  if (args.music && existsSync(args.music)) {
    emitProgress('render-footage', 96, 'Mixing music bed with speech ducking');
    const ducked = rendered.replace(/\.mp4$/, '.music.mp4');
    const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
    const res = spawnSync(ffmpeg, [
      '-y', '-i', rendered, '-stream_loop', '-1', '-i', args.music,
      '-filter_complex',
      '[1:a]volume=0.9[m];[m][0:a]sidechaincompress=threshold=0.04:ratio=12:attack=40:release=600[duck];[0:a][duck]amix=inputs=2:duration=first:normalize=0[out]',
      '-map', '0:v', '-map', '[out]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', ducked,
    ], {stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8'});
    if (res.status === 0 && existsSync(ducked)) output = ducked;
    else emitProgress('render-footage', 97, 'Music mix failed — delivering voice-only render');
  }

  const payload = {output, propsPath, finalDuration: plan.totalSeconds, generatedAt: new Date().toISOString()};
  writeStageJson(slug, 'render', payload);
  updateCheckpointStage(slug, 'render-footage', {output, finalDuration: plan.totalSeconds});
  emitProgress('render-footage', 99, 'Stage render-footage complete');
  return payload;
}

// Stage 1.5 — ENTITIES: extract per-scene entities for media scraping.
// Output: runs/<slug>/entities.json {scenes:[{sceneIndex, entities, exclude}]}
async function runEntitiesStage(args, slug) {
  const script = requireStage(slug, 'script');
  const scenes = (script.strategy?.scenes || []).map((s) => ({
    sceneIndex: s.type === 'hook' ? 0 : -1, // overwritten below
    type: s.type,
    spoken: s.spoken || '',
    onScreen: s.onScreen || '',
  }));
  scenes.forEach((s, i) => { s.sceneIndex = i; });
  const knownBrands = (script.strategy?.brands || []).filter(Boolean);
  const fullVoiceover = String(script.strategy?.voiceover || '').trim();

  const system = `You are an entity extractor for a short-form video reel. For each scene, return the SPECIFIC product/tool/company names that should be visually represented in that scene (logos, product UI screenshots, demo animations, etc).

Return STRICT JSON in this exact shape:
{
  "scenes": [
    {"sceneIndex": 0, "entities": ["Claude Code", "Anthropic"], "exclude": ["shortcuts"]},
    {"sceneIndex": 1, "entities": [], "exclude": ["context"]}
  ]
}

Rules:
- entities: list of concrete product/brand/tool names (e.g. "Claude Code", "Anthropic", "Stripe Dashboard"). Cap at 4 per scene. Prefer official brand names from the knownBrands list when present.
- exclude: list of generic nouns the user should NOT search for (e.g. "context", "token", "API", "shortcut", "settings"). These are visual noise words.
- Empty entities list means: this scene is a content/mood slide, use stock footage (Pexels/Unsplash), no logos needed.
- Non-empty entities list means: this scene is an alternate/brand slide, use Google Images / Brandfetch for logos + Giphy for demos.
- Dedupe within and across scenes; lowercase-normalize.
- Use the per-scene "spoken" text to decide which entities to surface — don't just copy the knownBrands list.`;

  const user = `Scenes (from the voiceover):
${scenes.map((s) => `[Scene ${s.sceneIndex} | type=${s.type} | onScreen=${JSON.stringify(s.onScreen)}]\nSpoken: ${JSON.stringify(s.spoken)}`).join('\n\n')}

Full voiceover for context:
${fullVoiceover}

Known brands (from strategy.brands): ${JSON.stringify(knownBrands)}

Return JSON only.`;

  emitProgress('entities', 30, `Extracting per-scene entities via LLM (${scenes.length} scenes, ${knownBrands.length} known brands)`);

  let result;
  try {
    result = await googleJson({system, user}, {scenes: scenes.map((s) => ({sceneIndex: s.sceneIndex, entities: [], exclude: []}))});
  } catch (err) {
    emitProgress('entities', 31, `Entity extraction failed: ${err.message}. Using empty entities.`);
    result = {scenes: scenes.map((s) => ({sceneIndex: s.sceneIndex, entities: [], exclude: []}))};
  }

  // Normalize: dedupe, lowercase, cap 4 per scene, drop empties.
  const normScene = (i, raw) => {
    const fallback = {sceneIndex: i, entities: [], exclude: []};
    if (!raw || typeof raw !== 'object') return fallback;
    const ents = Array.isArray(raw.entities) ? raw.entities : [];
    const excl = Array.isArray(raw.exclude) ? raw.exclude : [];
    const cleanEnts = [...new Set(
      ents
        .map((e) => String(e || '').trim())
        .filter(Boolean)
        .map((e) => e.replace(/\s+/g, ' '))
        .slice(0, 4),
    )];
    const cleanExcl = [...new Set(
      excl
        .map((e) => String(e || '').trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 8),
    )];
    return {sceneIndex: i, entities: cleanEnts, exclude: cleanExcl};
  };

  const byIdx = new Map((result.scenes || []).map((s) => [Number(s.sceneIndex), s]));
  const normalized = scenes.map((s) => normScene(s.sceneIndex, byIdx.get(s.sceneIndex)));

  const payload = {
    scenes: normalized,
    knownBrands,
    provider: 'gemini',
    generatedAt: new Date().toISOString(),
  };
  writeStageJson(slug, 'entities', payload);
  updateCheckpointStage(slug, 'entities', {sceneCount: normalized.length, totalEntities: normalized.reduce((n, s) => n + s.entities.length, 0)});
  const totalEnts = normalized.reduce((n, s) => n + s.entities.length, 0);
  emitProgress('entities', 35, `Entities extracted: ${totalEnts} across ${normalized.length} scenes (${normalized.filter((s) => s.entities.length).length} brand scenes, ${normalized.filter((s) => !s.entities.length).length} content scenes).`);
  return payload;
}

// Stage 2 — SCRIPT: transcript → LLM strategy + media collection (stock + scraped).
// Output: runs/<slug>/script.json {strategy, media, brandLogos, resolved*}
async function runScriptStage(args, slug) {
  const source = requireStage(slug, 'source');
  const {transcript, sourceMeta} = source;
  const autoDuration = Boolean(args['auto-duration']);
  const targetSeconds = Number(args.duration || (autoDuration ? 32 : 42));
  const durationSeconds = Number.isFinite(targetSeconds) ? targetSeconds : (autoDuration ? 32 : 42);

  // Auto-extract positioning / brands / tool URL if user left them blank.
  let resolvedTopic = (args.topic || '').trim();
  let resolvedBrands = String(args.brands || '').split(',').map((b) => b.trim()).filter(Boolean);
  let resolvedToolUrls = (args['tool-url'] || '').split(',').map((u) => u.trim()).filter(Boolean);
  const hasTranscript = transcript.trim().length >= 32;
  const hasTopic = resolvedTopic.length >= 12;
  const needsExtraction = (!resolvedTopic || !resolvedBrands.length || !resolvedToolUrls.length)
    && (hasTranscript || hasTopic) && !args.offline;
  if (needsExtraction) {
    emitProgress('extract', 30, 'Extracting positioning angle, brands, and tool URLs');
    const extracted = await extractMetadataFromTranscript({transcript, sourceMeta, topic: resolvedTopic});
    if (!resolvedTopic && extracted.topic) resolvedTopic = extracted.topic;
    if (!resolvedBrands.length && extracted.brands.length) resolvedBrands = extracted.brands;
    if (!resolvedToolUrls.length && extracted.toolUrls.length) resolvedToolUrls = extracted.toolUrls;
  }

  emitProgress('script', 36, args.offline ? 'Creating fallback script locally' : 'Generating hook + voiceover with LLM');
  // ── AI-provided strategy fast path (MCP) ─────────────────────────────────
  // When the caller provides --strategy-file <path> (typically the MCP server
  // routing the host AI's tool call), we skip the LLM entirely and use the
  // caller's strategy JSON. The rest of the stage (extraction, media collection,
  // brand logos) still runs normally so the AI only has to provide the
  // creative content, not orchestrate everything.
  let strategy;
  const strategyFilePath = args['strategy-file'];
  if (strategyFilePath && existsSync(strategyFilePath)) {
    try {
      const raw = JSON.parse(readFileSync(strategyFilePath, 'utf-8'));
      strategy = normalizePreRenderText(raw);
      emitProgress('script', 38, `Using AI-provided strategy from ${strategyFilePath} (skipping LLM)`);
    } catch (e) {
      emitProgress('script', 38, `Strategy file unreadable (${e.message}) — falling back to LLM`);
      strategy = args.offline
        ? normalizePreRenderText(fallbackStrategy(transcript, resolvedTopic))
        : await buildStrategy({transcript, sourceMeta, topic: resolvedTopic, durationSeconds, autoDuration, retainTranscript: args['retain-transcript'], seed: slug});
    }
  } else {
    strategy = args.offline
      ? normalizePreRenderText(fallbackStrategy(transcript, resolvedTopic))
      : await buildStrategy({transcript, sourceMeta, topic: resolvedTopic, durationSeconds, autoDuration, retainTranscript: args['retain-transcript'], seed: slug});
  }

  // ─── GitHub card enrichment ─────────────────────────────────────────────────
  // For any scene the AI marked as a github-card, fill missing stars/forks/
  // language/description from the live GitHub API (best-effort, unauthenticated).
  if (!args.offline) {
    await enrichGithubCards(strategy);
  }

  // ─── Smart media engine ───────────────────────────────────────────────────
  // Per-scene decision: product (scraped brand/UI imagery) vs mood (stock b-roll).
  // No more global scrapeMix toggle — each scene gets the RIGHT kind of visual.
  const sceneCount = (strategy.scenes || []).length || 1;
  const hasToolUrl = resolvedToolUrls.length > 0;
  // seedSalt: lets re-draws of the SAME slug pull fresh media while staying
  // deterministic within one run. Bumps with each script regeneration.
  const prevScript = readStageJson(slug, 'script');
  const seedSalt = String((prevScript?.mediaGeneration || 0) + 1);

  // 1. Scrape the tool/brand pool (product imagery) + topical search imagery.
  //    Product queries = brand names + topic, so the scraper can SEARCH for the
  //    real product page (e.g. "Claude Code") even when only a parent URL is known.
  const searchQueries = (strategy.scenes || []).map((s) => s.search || '').filter(Boolean);
  const productQueries = [...new Set([...(resolvedBrands || []), resolvedTopic].filter(Boolean))].slice(0, 3);
  const hasDiscovery = hasToolUrl || productQueries.length > 0;
  let scrapedPool = args['skip-media'] || !hasDiscovery
    ? []
    : await collectScrapedMedia(resolvedToolUrls, slug, searchQueries, {productQueries});

  // 2. Vision-score the scraped pool, keep only editorial-quality assets, ranked.
  //    HARD RULE: we must end up with at least 2 scraped product assets. If the
  //    strict vision filter leaves fewer than 2, relax the threshold and refill
  //    from the unfiltered pool (best-scored first) rather than ship a reel with
  //    no product imagery.
  if (scrapedPool.length > 0 && !args['skip-media']) {
    const rawPool = scrapedPool;
    let filtered = await filterScrapedMediaWithVision(rawPool, slug);
    if (filtered.length < 2) {
      // Relaxed pass: keep the top items regardless of strict threshold.
      const relaxed = await filterScrapedMediaWithVision(rawPool, slug, {threshold: 0});
      const byFile = new Map(filtered.map((m) => [m.file, m]));
      for (const m of relaxed) if (!byFile.has(m.file)) byFile.set(m.file, m);
      filtered = [...byFile.values()].slice(0, Math.max(2, filtered.length));
      emitProgress('scrape', 47, `Enforced 2+ product assets: kept ${filtered.length} after relaxed pass`);
    }
    scrapedPool = filtered;
  }
  if (scrapedPool.length < 2 && !args['skip-media'] && hasDiscovery) {
    emitProgress('scrape', 47, `WARNING: only ${scrapedPool.length} scraped product asset(s) found — product pages may be media-light. Reel will still render with stock backgrounds.`);
  }

  // 3. Build the per-scene intent plan and collect media accordingly. Product
  //    intent is gated on whether we ACTUALLY got product media (pool non-empty),
  //    not just whether a URL was supplied — so scenes never plan for media we lack.
  const plan = planSceneMedia(strategy, {hasToolUrl: scrapedPool.length > 0});
  const mixedMedia = args['skip-media']
    ? []
    : await collectSmartMedia(strategy, slug, {plan, scrapedPool, seedSalt});

  const productCount = mixedMedia.filter((m) => m.source === 'scrapling' || m.source === 'search').length;
  const stockCount = mixedMedia.filter((m) => m.source === 'stock').length;

  const brandLogos = await collectBrandLogos(strategy, slug, resolvedBrands);
  const payload = {
    strategy,
    media: mixedMedia,
    mediaPlan: plan,
    brandLogos,
    resolvedTopic,
    resolvedBrands,
    resolvedToolUrl: resolvedToolUrls[0] || '', 
    resolvedToolUrls, 
    mediaGeneration: Number(seedSalt),
    scrapedCount: productCount,
    stockCount,
    durationSeconds,
    autoDuration,
    generatedAt: new Date().toISOString(),
  };
  writeStageJson(slug, 'script', payload);
  updateCheckpointStage(slug, 'script', {
    sceneCount,
    stockCount: payload.stockCount,
    scrapedCount: payload.scrapedCount,
  });
  emitProgress('script', 60, `Stage script complete: ${mixedMedia.length} clips (${productCount} product, ${stockCount} mood) across ${sceneCount} scenes.`);
  return payload;
}

async function runPreRenderTextStage(args, slug) {
  const script = requireStage(slug, 'script');
  const source = readStageJson(slug, 'source') || {};
  if (!script.strategy?.scenes) throw new Error('script.json has no strategy.scenes — run --stage script first.');
  emitProgress('prerender', 62, 'Repopulating pre-render text with AI');

  const strategy = JSON.parse(JSON.stringify(script.strategy));
  const founderAngle = String(args.topic || script.resolvedTopic || strategy.angle || source.sourceMeta?.title || '').trim();
  const fallback = {
    scenes: (strategy.scenes || []).map((scene) => ({
      onScreen: scene.onScreen || '',
      subtext: scene.subtext || '',
    })),
  };
  const request = {
    task: 'repopulate_prerender_text_fields',
    founder_angle: founderAngle,
    output_contract: {
      format: 'json',
      schema: {
        scenes: [
          {
            onScreen: 'string',
            subtext: 'string',
          },
        ],
      },
    },
    source_context: {
      title: source.sourceMeta?.title || '',
      transcript: String(source.transcript || '').slice(0, 6000),
    },
    script: {
      hook: strategy.hook || '',
      angle: strategy.angle || '',
      voiceover: strategy.voiceover || '',
      scenes: (strategy.scenes || []).map((scene, index) => ({
        index,
        type: scene.type || 'scene',
        spoken: scene.spoken || '',
        currentOnScreen: scene.onScreen || '',
        currentSubtext: scene.subtext || '',
      })),
    },
  };

  const result = await googleJson({
    system: [
      'You are repopulating pre-render slide text for a Huashu-style Instagram Reel editor.',
      'Use the founder angle, full voiceover script, and per-slide spoken lines as context.',
      'Return ONLY JSON matching the schema. The number of returned scenes must match the input scene count.',
      'Every field is mandatory. Never leave onScreen or subtext blank.',
      'Slide 1 / hook: onScreen must be exactly 3-4 words, curiosity-first, and not a sentence.',
      'Every other slide: onScreen should be compact display copy, usually 3-6 words. Keep important numbers visible.',
      'Every slide: subtext must be exactly one natural sentence, 8-18 words, adding context to the on-screen text.',
      'Do not use internal labels like hook, problem, stat, visual-proof, solution, or cta in the viewer-facing text.',
      'Do not rewrite the voiceover. Only onScreen and subtext are being replaced.',
    ].join('\n'),
    user: JSON.stringify(request, null, 2),
  }, fallback);

  const replacements = Array.isArray(result?.scenes) ? result.scenes : [];
  strategy.scenes = (strategy.scenes || []).map((scene, index) => ({
    ...scene,
    onScreen: String(replacements[index]?.onScreen || scene.onScreen || '').trim(),
    subtext: String(replacements[index]?.subtext || scene.subtext || '').trim(),
  }));
  normalizePreRenderText(strategy);

  script.strategy = strategy;
  script.preRenderTextAt = new Date().toISOString();
  script.preRenderTextContext = {founderAngle};
  writeStageJson(slug, 'script', script);
  markPreRenderTextUpdated(slug, {sceneCount: strategy.scenes.length});
  emitProgress('prerender', 68, `Pre-render text repopulated for ${strategy.scenes.length} slide(s)`);
  return {
    sceneCount: strategy.scenes.length,
    founderAngle,
    scenes: strategy.scenes.map((scene) => ({
      onScreen: scene.onScreen,
      subtext: scene.subtext,
    })),
    generatedAt: script.preRenderTextAt,
  };
}

// Stage 3 — PATTERN: just persists the user's template + palette + caption choice.
// No external work; this is the cheapest stage. Decoupling it from script means
// the user can change templates without re-running the LLM or media fetch.
async function runPatternStage(args, slug) {
  // We don't strictly require a script.json yet — pattern can be set first.
  const template = 'huashu';
  let colorOverrides = null;
  if (args['color-overrides']) {
    try {
      const parsed = JSON.parse(String(args['color-overrides']));
      if (parsed && typeof parsed === 'object') {
        const cleaned = {};
        for (const key of ['primary', 'secondary', 'accent', 'highlight']) {
          if (typeof parsed[key] === 'string' && parsed[key].trim()) cleaned[key] = parsed[key].trim();
        }
        if (Object.keys(cleaned).length) colorOverrides = cleaned;
      }
    } catch { /* malformed JSON → null fallback */ }
  }
  const textEffect = ['word-stagger', 'line-fade', 'scale-pop', 'blur-reveal'].includes(args['text-effect'])
    ? args['text-effect']
    : 'word-stagger';
  const captionsEnabled = !args['no-captions'];
  const payload = {
    template,
    colorOverrides,
    textEffect,
    captionsEnabled,
    skipCta: Boolean(args['skip-cta']),
    generatedAt: new Date().toISOString(),
  };
  writeStageJson(slug, 'pattern', payload);
  updateCheckpointStage(slug, 'pattern', {template, textEffect});
  emitProgress('pattern', 65, `Stage pattern complete: ${template}${colorOverrides ? ' + custom colors' : ''} + ${textEffect}`);
  return payload;
}

// Stage 4 — VOICE: strategy.voiceover → ONE continuous master TTS track.
//
// We synthesize the WHOLE voiceover as a single continuous audio file (sentence
// Single continuous track: one TTS call for the full voiceover text. Slides are
// sized to exceed the audio duration so narration is never cut.
async function runVoiceStage(args, slug) {
  const script = requireStage(slug, 'script');
  if (!script.strategy?.voiceover && !script.strategy?.scenes) {
    throw new Error('script.json has no strategy.voiceover — re-run --stage script.');
  }
  const selectedVoiceEngine = String(args['voice-engine'] || 'tada').toLowerCase();
  const effectiveVoiceEngine = selectedVoiceEngine || 'tada';

  const publicDir = join(projectRoot, 'public', 'instagram-reel-tool', slug, 'voiceover');
  ensureDir(publicDir);

  // The single source of truth for narration is strategy.voiceover. Fall back to
  // joining the per-scene spoken lines only if the top-level field is empty.
  const scenes = script.strategy.scenes || [];
  const fullText = String(
    script.strategy.voiceover ||
    scenes.map((s) => s.spoken || '').filter(Boolean).join(' '),
  ).trim();
  if (!fullText && !args['skip-tts']) {
    throw new Error('No voiceover text to synthesize (strategy.voiceover and scene.spoken are all empty).');
  }

  let masterAudioFile;
  if (args['skip-tts']) {
    masterAudioFile = args['audio-file'] || 'voiceover/preview/s1.mp3';
  } else if (effectiveVoiceEngine === 'pocket-tts') {
    // ── Pocket-TTS voice cloning ──────────────────────────────────────────────
    const voiceFile = args['voice-file'] || process.env.POCKET_TTS_VOICE;
    if (!voiceFile) {
      throw new Error(
        'Pocket-TTS voice cloning requires a voice file: pass --voice-file, or set ' +
        'POCKET_TTS_VOICE, pointing at a .safetensors embedding under audio/pocket-tts/voices/.',
      );
    }
    const tone = args['tone'] || null;
    const quality = args['quality'] || null;
    const engineLabel = `Pocket-TTS (${basename(voiceFile)})`;
    emitProgress('voice', 70, `Synthesizing ONE continuous voiceover track with ${engineLabel}`);
    masterAudioFile = await synthesizePocketTTS({
      text: fullText,
      slug,
      voiceFile,
      tone,
      quality,
      outputName: 'voiceover.wav',
    });
  } else {
    // ── TADA (default) ────────────────────────────────────────────────────────
    const voiceStyle = resolveTadaVoiceStyle(args['voice-style'] || process.env.TADA_VOICE_STYLE);
    const tadaPromptAudio = args['tada-prompt-audio'] || voiceStyle.promptAudio;
    const tadaPromptText = args['tada-prompt-text'] || voiceStyle.promptText;
    const tadaModel = args['tada-model'] || process.env.TADA_WEIGHTS || process.env.TADA_MODEL || voiceStyle.model;
    const tadaQuantize = args['tada-quantize'] || process.env.TADA_QUANTIZE || null;
    const engineLabel = `Hume MLX-TADA (${tadaModel})`;
    emitProgress('voice', 70, `Synthesizing ONE continuous voiceover track with ${engineLabel}`);
    const tada = await synthesizeTada({
      text: fullText,
      slug,
      promptAudio: tadaPromptAudio,
      promptText: tadaPromptText,
      model: tadaModel,
      outputName: 'voiceover.wav',
      quantize: tadaQuantize,
    });
    masterAudioFile = tada.audioFile;
  }

  if (args['auto-trim'] && !args['skip-tts']) {
    masterAudioFile = applyAutoTrim(masterAudioFile);
  }

  const masterAudioDuration = args['skip-tts'] ? null : probeAudioDuration(masterAudioFile);
  emitProgress('voice', 76, args['skip-tts']
    ? 'Voice skipped (preview mode) — slides will use default pacing'
    : `Master voiceover ready: ${(masterAudioDuration || 0).toFixed(1)}s (continuous)`);

  const payload = {
    audioFile: masterAudioFile,
    audioDuration: masterAudioDuration,
    scenes: [],
    voiceStyle: effectiveVoiceEngine === 'pocket-tts' ? null : (resolveTadaVoiceStyle(args['voice-style'] || process.env.TADA_VOICE_STYLE).id),
    voiceFile: effectiveVoiceEngine === 'pocket-tts' ? (args['voice-file'] || process.env.POCKET_TTS_VOICE || null) : null,
    tadaPromptAudio: effectiveVoiceEngine === 'pocket-tts' ? null : (args['tada-prompt-audio'] || resolveTadaVoiceStyle(args['voice-style'] || process.env.TADA_VOICE_STYLE).promptAudio),
    tadaPromptText: effectiveVoiceEngine === 'pocket-tts' ? null : String(args['tada-prompt-text'] || resolveTadaVoiceStyle(args['voice-style'] || process.env.TADA_VOICE_STYLE).promptText || '').trim() || null,
    tadaModel: effectiveVoiceEngine === 'pocket-tts' ? null : (args['tada-model'] || process.env.TADA_WEIGHTS || process.env.TADA_MODEL || resolveTadaVoiceStyle(args['voice-style'] || process.env.TADA_VOICE_STYLE).model),
    tone: effectiveVoiceEngine === 'pocket-tts' ? (args['tone'] || null) : null,
    quality: effectiveVoiceEngine === 'pocket-tts' ? (args['quality'] || null) : null,
    voice: null,
    engine: effectiveVoiceEngine,
    generatedAt: new Date().toISOString(),
  };
  writeStageJson(slug, 'voice', payload);
  updateCheckpointStage(slug, 'voice', {audioDuration: masterAudioDuration, engine: payload.engine});
  emitProgress('voice', 78, `Stage voice complete: 1 continuous track (${(masterAudioDuration || 0).toFixed(1)}s).`);
  return payload;
}

// Stage 5 — AVATAR: optional portrait/audio to talking-head video.
// Output: runs/<slug>/avatar.json {enabled, file, kind, source, skippedReason?}
async function runAvatarStage(args, slug) {
  const voice = requireStage(slug, 'voice');
  emitProgress('avatar', 78, 'Preparing optional AI avatar stage');

  const outputDir = join(projectRoot, 'public', 'instagram-reel-tool', slug, 'avatar');
  ensureDir(outputDir);
  const disabledPayload = (reason) => ({
    enabled: false,
    file: '',
    kind: 'video',
    fit: 'cover',
    source: 'skipped',
    skippedReason: reason,
    generatedAt: new Date().toISOString(),
  });

  if (args['skip-avatar']) {
    const payload = disabledPayload('Skipped by user');
    writeStageJson(slug, 'avatar', payload);
    updateCheckpointStage(slug, 'avatar', {enabled: false, skipped: true});
    emitProgress('avatar', 84, 'AI avatar skipped');
    return payload;
  }

  const avatarVideo = String(args['avatar-video'] || '').trim();
  if (avatarVideo) {
    if (!existsSync(avatarVideo)) throw new Error(`Avatar video not found: ${avatarVideo}`);
    const ext = (avatarVideo.match(/\.[a-z0-9]+$/i)?.[0] || '.mp4').toLowerCase();
    const destination = join(outputDir, `talking-head${ext}`);
    cpSync(avatarVideo, destination);
    const payload = {
      enabled: true,
      file: relative(join(projectRoot, 'public'), destination),
      kind: 'video',
      fit: 'cover',
      source: 'uploaded-video',
      generatedAt: new Date().toISOString(),
    };
    writeStageJson(slug, 'avatar', payload);
    updateCheckpointStage(slug, 'avatar', {enabled: true, source: 'uploaded-video'});
    emitProgress('avatar', 86, 'AI avatar stage complete: using uploaded talking-head video');
    return payload;
  }

  const avatarImage = String(args['avatar-image'] || '').trim();
  const workerUrl = String(
    args['avatar-worker-url'] ||
    process.env.AVATAR_WORKER_URL ||
    process.env.INFINITETALK_WORKER_URL ||
    ''
  ).trim();
  if (!avatarImage || !workerUrl) {
    const payload = disabledPayload(!avatarImage ? 'No portrait image supplied' : 'No avatar worker URL configured');
    writeStageJson(slug, 'avatar', payload);
    updateCheckpointStage(slug, 'avatar', {enabled: false, skipped: true});
    emitProgress('avatar', 84, `AI avatar skipped: ${payload.skippedReason}`);
    return payload;
  }

  if (!existsSync(avatarImage)) throw new Error(`Avatar image not found: ${avatarImage}`);
  const audioPath = voice.audioFile?.startsWith('/')
    ? voice.audioFile
    : join(projectRoot, 'public', voice.audioFile || '');
  if (!existsSync(audioPath)) throw new Error(`Voiceover audio for avatar not found: ${voice.audioFile || '(empty)'}`);

  const outputPath = join(outputDir, 'talking-head.mp4');
  emitProgress('avatar', 80, 'Calling InfiniteTalk worker');
  const response = await fetchWithTimeout(workerUrl.replace(/\/$/, '') + '/jobs', {
    timeoutMs: Number(process.env.AVATAR_WORKER_TIMEOUT_MS || process.env.INFINITETALK_TIMEOUT_MS || 1000 * 60 * 60),
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      runId: slug,
      mode: 'image-to-video',
      portraitImage: avatarImage,
      audioFile: audioPath,
      outputPath,
      resolution: args['avatar-size'] || 'infinitetalk-480',
    }),
  });
  if (!response.ok) throw new Error(`InfiniteTalk worker failed ${response.status}: ${await response.text().catch(() => '')}`);
  
  let result = {};
  if (response.headers.get('content-type')?.includes('x-ndjson')) {
    // We are running Node 18+ which has Web Streams API for fetch response body
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const {done, value} = await reader.read();
      if (value) {
        buffer += decoder.decode(value, {stream: true});
        const lines = buffer.split('\n');
        buffer = lines.pop(); // Keep the last incomplete line
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line);
            if (parsed.type === 'progress') {
              emitProgress('avatar', 82, parsed.message.substring(0, 100));
            } else if (parsed.type === 'error') {
              throw new Error(`Worker Error: ${parsed.message}`);
            } else if (parsed.type === 'result') {
              result = parsed;
            }
          } catch (e) {
            if (e.message.includes('Worker Error')) throw e;
          }
        }
      }
      if (done) break;
    }
  } else {
    result = await response.json().catch(() => ({}));
  }

  const produced = result.videoFile || result.outputPath || outputPath;
  if (produced && existsSync(produced) && produced !== outputPath) cpSync(produced, outputPath);
  if (!existsSync(outputPath)) throw new Error('InfiniteTalk worker completed but no talking-head video was written.');

  const payload = {
    enabled: true,
    file: relative(join(projectRoot, 'public'), outputPath),
    kind: 'video',
    fit: 'cover',
    source: 'infinitetalk',
    workerUrl,
    generatedAt: new Date().toISOString(),
  };
  writeStageJson(slug, 'avatar', payload);
  updateCheckpointStage(slug, 'avatar', {enabled: true, source: 'infinitetalk'});
  emitProgress('avatar', 86, 'AI avatar stage complete');
  return payload;
}

// Stage 6 — RENDER: assemble props from all predecessors + render mp4.
// Run whisper.cpp word-level alignment on the generated VO audio in an isolated
// child process (so a native crash during whisper build can't kill the parent).
// Returns {ok, words, captions} or {ok:false, reason}. Best-effort — the caller
// treats any failure as "skip alignment, render with estimated timing".
async function alignVoiceoverWords(slug, audioFileRel) {
  const audioPath = join(projectRoot, 'public', audioFileRel);
  if (!existsSync(audioPath)) return {ok: false, reason: 'VO audio not found on disk'};
  const cacheDir = join(toolRoot, '.cache', 'whisper-align', slug);
  ensureDir(cacheDir);
  const alignScript = join(toolRoot, 'scripts', 'whisper-align.mjs');
  if (!existsSync(alignScript)) return {ok: false, reason: 'whisper-align.mjs missing'};
  const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';

  emitProgress('render', 82, 'Aligning voiceover to on-screen text with whisper.cpp');
  return await new Promise((resolveAlign) => {
    const proc = spawn('node', [alignScript, audioPath, cacheDir, ffmpeg], {env: process.env});
    let stdout = '';
    let stderr = '';
    // whisper build + transcription on a short clip is usually < 60s after the
    // first cached install, but the very first run compiles whisper.cpp — allow
    // a generous ceiling and fail soft on timeout.
    const timer = setTimeout(() => { try { proc.kill('SIGTERM'); } catch { /* noop */ } }, 240_000);
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
      // Surface alignment progress lines to the UI feed.
      const line = d.toString().trim().split('\n').pop();
      if (line && line.startsWith('[align')) emitProgress('render', 82, line.replace(/^\[align[^\]]*\]\s*/, 'Align: '));
    });
    proc.on('error', (e) => { clearTimeout(timer); resolveAlign({ok: false, reason: e.message}); });
    proc.on('close', () => {
      clearTimeout(timer);
      try {
        const parsed = JSON.parse(stdout.trim() || '{}');
        resolveAlign(parsed && typeof parsed === 'object' ? parsed : {ok: false, reason: 'empty alignment output'});
      } catch {
        resolveAlign({ok: false, reason: `unparseable alignment output${stderr ? `: ${stderr.slice(-200)}` : ''}`});
      }
    });
  });
}

async function runRenderStage(args, slug) {
  const source = requireStage(slug, 'source');
  const script = requireStage(slug, 'script');
  const pattern = requireStage(slug, 'pattern');
  const voice = requireStage(slug, 'voice');

  // Audio-first: the voice stage produces ONE continuous master track
  // (voice.audioFile). Slides are sized to exceed voice.audioDuration.
  const finalDuration = voice.audioDuration || script.durationSeconds || 42;

  const hasSavedMedia = Array.isArray(script.media) && script.media.length > 0;
  emitProgress('render', 80, hasSavedMedia ? 'Using saved media order from script stage...' : 'Collecting stock media...');
  let media = script.media || [];
  if (!hasSavedMedia && !args['skip-media']) {
    try {
      media = await collectMedia(script.strategy, slug, {});
    } catch (err) {
      console.error('Warning: collectMedia failed:', err);
    }
  }

  emitProgress('render', 82, 'Composing Remotion props from checkpoint state');
  const rawProps = buildSimplifiedProps({
    strategy: script.strategy,
    media,
    audioFile: voice.audioFile,
    durationSeconds: finalDuration,
    brandLogos: script.brandLogos || [],
    colorOverrides: pattern.colorOverrides || null,
    textEffect: pattern.textEffect || 'word-stagger',
    skipCta: Boolean(args['skip-cta'] ?? pattern.skipCta),
  });
  const props = sanitizeProps(rawProps);
  // ── GUARDRAIL: never render with empty/missing slides ──────────────────────
  // If props has no usable slides array, Remotion silently falls back to the
  // composition's defaultProps (the dummy "Your phone is the remote" reel at
  // 426 frames). That produces a video whose visuals don't match the script and
  // whose duration is wrong. Fail loudly instead so the bug surfaces in the UI.
  if (!Array.isArray(props.slides) || props.slides.length === 0) {
    const sceneCount = (script.strategy?.scenes || []).length;
    throw new Error(
      `Render aborted: props has no slides (built from ${sceneCount} strategy scene(s)). ` +
      `This usually means buildSimplifiedProps dropped the slides array. Re-run --stage script, ` +
      `or check that script.json has strategy.scenes. Refusing to render dummy defaults.`,
    );
  }
  emitProgress('render', 82, 'Composing Remotion props from checkpoint state', props);

  // ── Word-level alignment (whisper.cpp) ──────────────────────────────────────
  // Sync captions + scene text to the ACTUAL spoken words. Best-effort: any
  // failure leaves props untouched and the render proceeds with estimated timing.
  if (!args['skip-align'] && !args['skip-tts'] && voice.audioFile) {
    try {
      const alignment = await alignVoiceoverWords(slug, voice.audioFile);
      if (alignment?.ok && Array.isArray(alignment.captions) && alignment.captions.length) {
        props.captions = alignment.captions;
        props.alignedWords = alignment.words || [];
        emitProgress('render', 83, `Whisper aligned ${alignment.words?.length || 0} words → ${alignment.captions.length} caption lines`);
      } else if (alignment && !alignment.ok) {
        emitProgress('render', 83, `Whisper alignment skipped: ${alignment.reason || 'unknown'} (render continues with estimated timing)`);
      }
    } catch (err) {
      emitProgress('render', 83, `Whisper alignment error: ${err?.message || err} (render continues)`);
    }
  }

  const propsDir = join(toolRoot, 'runs', slug);
  ensureDir(propsDir);
  const propsPath = join(propsDir, `${slug}.json`);
  writeFileSync(propsPath, JSON.stringify(props, null, 2) + '\n');
  const strategyPath = join(propsDir, `${slug}.strategy.json`);
  writeFileSync(strategyPath, JSON.stringify({
    sourceMeta: source.sourceMeta,
    strategy: script.strategy,
    media,
    voice: {audioFile: voice.audioFile, audioDuration: voice.audioDuration},
  }, null, 2) + '\n');

  const renderOpts = {
    crf: args['high-bitrate'] ? 16 : undefined,
    loopTail: Boolean(args['loop-tail']),
  };
  const rendered = await renderReel(slug, propsPath, props, 'huashu', renderOpts);
  const payload = {
    output: rendered,
    propsPath,
    strategyPath,
    finalDuration,
    renderOpts,
    generatedAt: new Date().toISOString(),
  };
  writeStageJson(slug, 'render', payload);
  updateCheckpointStage(slug, 'render', {output: rendered, finalDuration});
  emitProgress('render', 99, 'Stage render complete');
  return payload;
}

// ─────────────────────────────────────────────────────────────────────────────
// MEDIA-OP — granular media operations for MCP clients. Each op is a thin,
// transparent wrapper over the existing media engine functions. They print the
// items they produced and (where relevant) persist them into script.json's
// `media[]` so the render stage picks them up. Progress streams over stderr as
// usual (the MCP server relays it to the host AI).
// ─────────────────────────────────────────────────────────────────────────────
function parseJsonArrayArg(value) {
  if (!value) return [];
  try {
    const arr = JSON.parse(value);
    return Array.isArray(arr) ? arr.filter((x) => x != null) : [];
  } catch {
    // Allow comma-separated fallback.
    return String(value).split(',').map((s) => s.trim()).filter(Boolean);
  }
}

// Merge new media into script.json's media[] (append or replace), de-duping by file.
function persistMediaIntoScript(slug, newItems, mode = 'append') {
  const path = stageFilePath(slug, 'script');
  if (!existsSync(path)) {
    throw new Error(`script.json missing for ${slug} — run --stage script (or MCP set_strategy) first.`);
  }
  const script = JSON.parse(readFileSync(path, 'utf8'));
  const existing = Array.isArray(script.media) ? script.media : [];
  let merged;
  if (mode === 'replace') {
    merged = [...newItems];
  } else {
    const byFile = new Map(existing.map((m) => [m.file, m]));
    for (const it of newItems) byFile.set(it.file, it);
    merged = [...byFile.values()];
  }
  script.media = merged;
  script.scrapedCount = merged.filter((m) => m.source === 'scrapling' || m.source === 'search').length;
  script.stockCount = merged.filter((m) => m.source === 'stock').length;
  writeStageJson(slug, 'script', script);
  return merged;
}

async function runMediaOp(op, args, slug) {
  const script = readStageJson(slug, 'script');
  switch (op) {
    case 'scrape': {
      const urls = parseJsonArrayArg(args.urls || args['seed-urls']);
      const queries = parseJsonArrayArg(args.queries || args['product-queries']);
      if (!urls.length && !queries.length) {
        throw new Error('media-op scrape needs --urls and/or --queries (JSON arrays).');
      }
      const pool = await collectScrapedMedia(urls, slug, [], {productQueries: queries});
      const persisted = args.commit ? persistMediaIntoScript(slug, pool.map((m) => ({...m, role: m.role || 'frame'})), args.mode || 'append') : null;
      return {
        op: 'scrape', slug,
        found: pool.length,
        videos: pool.filter((m) => m.kind === 'video').length,
        images: pool.filter((m) => m.kind === 'image').length,
        landscape: pool.filter((m) => m.orientation === 'landscape').length,
        items: pool,
        committed: args.commit ? {total: persisted.length} : false,
      };
    }
    case 'stock': {
      const queries = parseJsonArrayArg(args.queries);
      if (!queries.length) throw new Error('media-op stock needs --queries (JSON array of search phrases).');
      const dir = join(projectRoot, 'public', 'instagram-reel-tool', slug, 'media');
      ensureDir(dir);
      const items = [];
      for (let i = 0; i < queries.length; i += 1) {
        const q = queries[i];
        const seed = `${slug}:mediaop:${i}:${q}`;
        emitProgress('media', 45, `Stock: fetching "${q}" (${i + 1}/${queries.length})`);
        const clip = await fetchPexelsVideo(q, dir, `op-scene${i + 1}`, {seed}).catch(() => null);
        if (clip) {
          items.push({...clip, sceneIndex: i, source: 'stock', role: 'background', query: q});
        } else {
          const image = await fetchUnsplashImage(q, dir, `op-scene${i + 1}-bg`, {seed}).catch(() => null);
          if (image) items.push({...image, sceneIndex: i, source: 'stock', role: 'background', query: q});
          else emitProgress('media', 45.5, `No stock result for "${q}"`);
        }
      }
      const persisted = args.commit ? persistMediaIntoScript(slug, items, args.mode || 'append') : null;
      return {
        op: 'stock', slug,
        requested: queries.length,
        found: items.length,
        items,
        committed: args.commit ? {total: persisted.length} : false,
      };
    }
    case 'vision-filter': {
      // Filter either a passed-in --items pool, or the current script.json media.
      const passed = parseJsonArrayArg(args.items);
      const pool = passed.length ? passed : (script?.media || []).filter((m) => m.source === 'scrapling' || m.source === 'search');
      if (!pool.length) {
        return {op: 'vision-filter', slug, scored: 0, kept: 0, items: [], note: 'no scraped media to score'};
      }
      const threshold = Number(args.threshold) > 0 ? Number(args.threshold) : 6.5;
      const scored = await filterScrapedMediaWithVision(pool, slug, {threshold});
      let persisted = null;
      if (args.commit) {
        // Replace only the scraped items in script.json with the kept+scored set,
        // preserving stock backgrounds.
        const stock = (script?.media || []).filter((m) => m.source === 'stock');
        persisted = persistMediaIntoScript(slug, [...stock, ...scored.map((m) => ({...m, role: m.role || 'frame'}))], 'replace');
      }
      return {
        op: 'vision-filter', slug,
        scored: pool.length,
        kept: scored.length,
        threshold,
        avgScore: Number((scored.reduce((s, i) => s + (i.visionScore || 0), 0) / (scored.length || 1)).toFixed(2)),
        items: scored,
        committed: args.commit ? {total: persisted.length} : false,
      };
    }
    case 'commit': {
      const items = parseJsonArrayArg(args.items);
      if (!items.length) throw new Error('media-op commit needs --items (JSON array of media objects).');
      const persisted = persistMediaIntoScript(slug, items, args.mode || 'replace');
      return {op: 'commit', slug, total: persisted.length, items: persisted};
    }
    case 'scrape-media': {
      // Dedicated media scrape (Stage 1.5 output driven). Reads entities.json
      // (or accepts --entities JSON) and:
      //   • brand scenes (non-empty entities): spawn scrape-entities.py per scene
      //     (Giphy GIF first, Brandfetch + Google + Bing static fallback)
      //   • content scenes (empty entities): scrapling + Pexels/Unsplash background
      // Writes results to script.json with role: frame for brand, role: background
      // for content. Decoupled from set_strategy so the AI can iterate media
      // independently of scripting.
      const entitiesArg = args.entities || (() => {
        const entPath = stageFilePath(slug, 'entities');
        if (existsSync(entPath)) {
          return JSON.stringify((JSON.parse(readFileSync(entPath, 'utf8'))).scenes || []);
        }
        return null;
      })();
      if (!entitiesArg) {
        throw new Error('media-op scrape-media needs --entities JSON or entities.json to exist (run extract_entities first).');
      }
      const entities = parseJsonArrayArg(entitiesArg);
      const scenes = script?.strategy?.scenes || [];
      const publicDir = join(projectRoot, 'public', 'instagram-reel-tool', slug);
      ensureDir(publicDir);

      const items = [];
      const queries_meta = [];

      // Phase 1: brand scenes (GIF + logos via scrape-entities.py)
      const brandEntries = entities
        .filter((e) => Array.isArray(e.entities) && e.entities.length > 0)
        .flatMap((e) => (e.entities || []).map((ent) => ({sceneIndex: Number(e.sceneIndex), entity: ent, preferGif: true})));
      if (brandEntries.length) {
        const entitiesJson = JSON.stringify(brandEntries);
        const pyScript = join(toolRoot, 'scripts', 'scrape-entities.py');
        if (existsSync(pyScript)) {
          emitProgress('media', 40, `scrape-entities: ${brandEntries.length} brand entries across ${new Set(brandEntries.map((b) => b.sceneIndex)).size} scenes`);
          const proc = spawnSync(resolveScraplingPython(), [
            pyScript,
            '--entities', entitiesJson,
            '--out', publicDir,
            '--per-entity-count', '1',
          ], {encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 180_000});
          if (proc.status === 0) {
            try {
              const parsed = JSON.parse(proc.stdout.trim() || '{"items": []}');
              for (const it of parsed.items || []) {
                items.push({
                  ...it,
                  file: `instagram-reel-tool/${slug}/${it.file}`,
                  role: 'frame',
                  source: it.source,
                });
              }
              queries_meta.push(...(parsed.queries || []));
            } catch (e) {
              emitProgress('media', 41, `scrape-entities parse failed: ${e.message}`);
            }
          } else {
            emitProgress('media', 41, `scrape-entities exited ${proc.status}: ${(proc.stderr || '').slice(0, 200)}`);
          }
        }
      }

      // Phase 2: content scenes (stock backgrounds from Pexels/Unsplash)
      const contentScenes = entities
        .map((e) => Number(e.sceneIndex))
        .filter((idx) => {
          const ent = entities.find((e2) => Number(e2.sceneIndex) === idx);
          return ent && (!ent.entities || ent.entities.length === 0);
        });
      for (const sceneIdx of contentScenes) {
        const scene = scenes[sceneIdx] || {};
        const q = (scene.search || '').trim() || (scene.onScreen || '').toLowerCase().replace(/[^\w\s]/g, ' ').trim() || `scene ${sceneIdx}`;
        const dir = join(publicDir, 'media');
        ensureDir(dir);
        const seed = `${slug}:scrape-media:bg:${sceneIdx}:${q}`;
        emitProgress('media', 45, `Content scene ${sceneIdx}: fetching stock "${q}"`);
        const clip = await fetchPexelsVideo(q, dir, `bg-scene${sceneIdx + 1}`, {seed}).catch(() => null);
        if (clip) {
          items.push({...clip, sceneIndex: sceneIdx, source: 'stock', role: 'background', query: q});
        } else {
          const image = await fetchUnsplashImage(q, dir, `bg-scene${sceneIdx + 1}`, {seed}).catch(() => null);
          if (image) items.push({...image, sceneIndex: sceneIdx, source: 'stock', role: 'background', query: q});
        }
      }

      const persisted = args.commit ? persistMediaIntoScript(slug, items, args.mode || 'append') : null;
      return {
        op: 'scrape-media', slug,
        total: items.length,
        brandAssets: items.filter((m) => m.role === 'frame').length,
        backgroundAssets: items.filter((m) => m.role === 'background').length,
        bySource: items.reduce((acc, m) => { acc[m.source] = (acc[m.source] || 0) + 1; return acc; }, {}),
        items,
        queries: queries_meta,
        committed: args.commit ? {total: persisted.length} : false,
      };
    }
    default:
      throw new Error(`Unknown --media-op "${op}". Valid: scrape, stock, vision-filter, commit, scrape-media.`);
  }
}

async function main() {
  // Gate: this engine is MCP-only. The MCP server (mcp/server.mjs) sets
  // REEL_VIA_MCP=1 when it spawns us. Any other invocation is refused so that
  // every reel build flows through MCP. No token, no run — applies to --help too.
  if (process.env.REEL_VIA_MCP !== '1') {
    process.stderr.write(
      'instagram-reel-generator is MCP-only. Drive it through the MCP server:\n' +
      "  node mcp/client.mjs <tool> '<json-args>'   (e.g. list_layouts '{}')\n" +
      'Direct CLI invocation is disabled.\n'
    );
    process.exit(1);
  }
  loadDefaultSecrets();
  const args = parseArgs(process.argv.slice(2));
  globalThis.__reelProgress = Boolean(args.progress);
  if (args.help) {
    usage();
    return;
  }

  // ─── Media-op dispatch (granular MCP access) ────────────────────────────────
  // --media-op <op> runs a SINGLE media operation and prints structured JSON, so
  // an MCP client (an AI) can drive scraping / stock / vision-filter / assignment
  // step-by-step with full transparency instead of the opaque monolithic stage.
  //   scrape        — scrapling discovery (seed URLs + product queries) → pool
  //   stock         — Pexels/Unsplash per-query backgrounds → pool
  //   scrape-media  — entity-driven (uses entities.json): brand scenes get
  //                   Giphy+Brandfetch+Google, content scenes get stock bg.
  //                   Decoupled from set_strategy; standalone tool.
  //   vision-filter — NVIDIA vision-score a pool, keep ≥ threshold, ranked
  //   commit        — write a chosen media[] array into script.json (no fetch)
  // All ops are stateless w.r.t. each other: they print the items they produced;
  // the AI decides what to keep and calls `commit` (or the MCP attach_media tool).
  if (args['media-op']) {
    if (!args.slug) throw new Error('--media-op requires --slug.');
    const slug = slugify(args.slug);
    const result = await runMediaOp(args['media-op'], args, slug);
    emitProgress('done', 100, `media-op ${args['media-op']} complete`);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  // ─── Stage dispatch ─────────────────────────────────────────────────────────
  // --stage <name> runs JUST that stage (reading predecessors from disk).
  // Default (no --stage) runs the whole pipeline like always — preserves
  // backward compatibility with existing callers and the all-in-one CLI usage.
  const stage = args.stage;
  if (stage && stage !== 'all') {
    if (!STAGE_NAMES.includes(stage)) {
      throw new Error(`Unknown --stage "${stage}". Valid stages: ${STAGE_NAMES.join(', ')}, all.`);
    }
    if (!args.slug) {
      throw new Error(`--stage ${stage} requires --slug to identify the run.`);
    }
    const slug = slugify(args.slug);
    let result;
    switch (stage) {
      case 'source': result = await runSourceStage(args, slug); break;
      case 'entities': result = await runEntitiesStage(args, slug); break;
      case 'script': result = await runScriptStage(args, slug); break;
      case 'prerender': result = await runPreRenderTextStage(args, slug); break;
      case 'pattern': result = await runPatternStage(args, slug); break;
      case 'voice': result = await runVoiceStage(args, slug); break;
      case 'avatar': result = await runAvatarStage(args, slug); break;
      case 'render': result = await runRenderStage(args, slug); break;
      case 'ingest': result = await runIngestStage(args, slug); break;
      case 'transcribe-footage': result = await runTranscribeFootageStage(args, slug); break;
      case 'edit-plan': result = await runEditPlanStage(args, slug); break;
      case 'render-footage': result = await runRenderFootageStage(args, slug); break;
      default: throw new Error(`Unhandled stage: ${stage}`);
    }
    emitProgress('done', 100, `Stage ${stage} complete`);
    console.log(JSON.stringify({slug, stage, result}, null, 2));
    return;
  }

  // Source gate: at least one of URL / uploaded video / transcript override is needed.
  // Without this fix, video-upload jobs exited to the usage banner because the gate
  // didn't know about --video-file.
  if (!args.url && !args.transcript && !args['video-file']) {
    usage();
    process.exitCode = 1;
    return;
  }

  const slug = slugify(args.slug || `ig-reel-${hashText(args.url || args.transcript)}-${Date.now().toString().slice(-5)}`);
  // Auto mode: skip the user-provided duration entirely, use a fallback for scene timing
  // until ffprobe gives us the real audio length to override `finalDuration` below.
  const autoDuration = Boolean(args['auto-duration']);
  const targetSeconds = Number(args.duration || (autoDuration ? 32 : 42));
  const durationSeconds = Number.isFinite(targetSeconds) ? targetSeconds : (autoDuration ? 32 : 42);
  const template = 'huashu';
  // requestedBrands is computed AFTER the auto-extraction step below so it picks up
  // any brand names the LLM derived from the transcript when the user left the field
  // blank. Declared here so the rest of the function can see it.
  let requestedBrands = String(args.brands || '')
    .split(',')
    .map((brand) => brand.trim())
    .filter(Boolean);
  emitProgress('started', 3, `Preparing reel job ${slug}`);

  // Visible diagnostics so the UI Job Log shows exactly what the generator received.
  // These caught the silent-skip bug: skip-transcribe being toggled with no override
  // transcript meant the strategy ran on an empty string (only `topic` informed it),
  // so two runs over different URLs produced near-identical scripts that looked cached.
  const overrideLen = (args.transcript || '').length;
  const hasGoogleKey = Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
  emitProgress('input', 4, `URL: ${args.url ? args.url : '(empty)'} | skip-transcribe: ${args['skip-transcribe'] ? 'on' : 'off'} | transcript override: ${overrideLen} chars | Google API key: ${hasGoogleKey ? 'present' : 'MISSING (script will be hardcoded fallback)'}`);
  if (!hasGoogleKey) {
    emitProgress('input', 5, 'No Google API key found. Paste a Gemini key in the Source tab or set GOOGLE_API_KEY in instagram-reel-tool/.env — otherwise every run uses the same fallback script regardless of which URL you give it.');
  }

  let sourceMeta = {title: args.topic || 'Input video', caption: '', ai_insights: {}};
  let transcript = args.transcript || '';

  // The skip-transcribe flag is only honoured when a transcript override is actually
  // present. Otherwise we'd silently skip transcription and run the strategy on an
  // empty string — produces a generic script that drifts toward the same fallback
  // text run after run, regardless of which URL the user pasted.
  const userRequestedSkip = Boolean(args['skip-transcribe']);
  const overrideUsable = transcript.trim().length >= 32;
  const willSkip = userRequestedSkip && overrideUsable;
  if (userRequestedSkip && !overrideUsable && args.url) {
    emitProgress('input', 5, 'skip-transcribe was set but no transcript override provided — running transcription anyway so the script reflects the actual URL');
  }

  // Source priority: uploaded video file > IG URL > transcript override > nothing.
  // The uploaded video path goes through transcribe_local_audio (Whisper on the
  // extracted audio track) instead of yt-dlp, so it works for any video format
  // ffmpeg can read regardless of where it came from.
  if (!willSkip && args['video-file']) {
    const videoFile = String(args['video-file']);
    if (!existsSync(videoFile)) throw new Error(`Uploaded video file not found at ${videoFile}`);
    emitProgress('transcribe', 6, `Transcribing uploaded video (${relative(projectRoot, videoFile)})`);
    const batch = await transcribeLocalVideo(videoFile, process.env.WHISPER_MODEL || 'base');
    const video = batch.videos?.[0];
    if (!video) {
      throw new Error(`Local-audio transcriber returned no video result. Top-level keys: [${Object.keys(batch || {}).join(', ')}]`);
    }
    const rawTranscript = fixTranscriptMishears(String(video.transcript_text || '').trim());
    if (!rawTranscript) {
      // Silent / too-short / non-speech audio. Don't crash — fall through to
      // topic-only generation, but make it loud so the user knows the script
      // is not derived from their video.
      emitProgress('transcribe', 22, 'WARNING: transcriber returned an empty transcript — your video may be silent, music-only, or non-speech. Strategy will run on the positioning angle only.');
      sourceMeta = {...video, title: video.title || basename(videoFile)};
      transcript = '';
    } else {
      sourceMeta = video;
      transcript = rawTranscript;
      const preview = transcript.replace(/\s+/g, ' ').slice(0, 140);
      emitProgress('transcribe', 22, `Transcript ready (${transcript.length} chars). Opening: "${preview}${transcript.length > 140 ? '…' : ''}"`);
    }
  } else if (!willSkip && args.url) {
    emitProgress('transcribe', 10, `Transcribing ${args.url} with the IG Content Transcriber`);
    const batch = await transcribeInput(args.url, process.env.WHISPER_MODEL || 'base');
    const video = batch.videos?.[0];
    if (!video?.transcript_text) throw new Error('Transcriber returned no transcript text.');
    sourceMeta = video;
    transcript = fixTranscriptMishears(video.transcript_text);
    const preview = transcript.replace(/\s+/g, ' ').slice(0, 140);
    emitProgress('transcribe', 22, `Transcript ready (${transcript.length} chars). Opening: "${preview}${transcript.length > 140 ? '…' : ''}"`);
  } else if (willSkip) {
    emitProgress('transcribe', 22, `Using transcript override (${transcript.length} chars) — transcription skipped`);
  } else {
    emitProgress('transcribe', 22, 'No URL or video provided — strategy will run on positioning angle only');
  }

  // Auto-extract positioning angle / brands / tool URL from the transcript so the
  // user can leave the form fields blank. User-supplied values still win — extraction
  // only fills the gaps. Runs in offline mode too if a transcript override is present
  // (extractor itself short-circuits without an API key).
  let resolvedTopic = (args.topic || '').trim();
  let resolvedBrands = String(args.brands || '').split(',').map((b) => b.trim()).filter(Boolean);
  let resolvedToolUrls = (args['tool-url'] || '').split(',').map((u) => u.trim()).filter(Boolean);
  const userProvidedTopic = resolvedTopic.length > 0;
  const userProvidedBrands = resolvedBrands.length > 0;
  const userProvidedToolUrls = resolvedToolUrls.length > 0;
  const hasTranscript = transcript.trim().length >= 32;
  const hasTopic = resolvedTopic.length >= 12;
  const needsExtraction = (!userProvidedTopic || !userProvidedBrands || !userProvidedToolUrls) && (hasTranscript || hasTopic) && !args.offline;
  if (needsExtraction) {
    emitProgress('extract', 26, 'Extracting positioning angle, brands, and tool URLs');
    const extracted = await extractMetadataFromTranscript({transcript, sourceMeta, topic: resolvedTopic});
    if (!userProvidedTopic && extracted.topic) resolvedTopic = extracted.topic;
    if (!userProvidedBrands && extracted.brands.length) resolvedBrands = extracted.brands;
    if (!userProvidedToolUrls && extracted.toolUrls.length) resolvedToolUrls = extracted.toolUrls;
    emitProgress('extract', 28, `Auto-filled — topic: "${(resolvedTopic || '(none)').slice(0, 80)}" | brands: [${resolvedBrands.join(', ') || '(none)'}] | tool URLs: [${resolvedToolUrls.join(', ') || '(none)'}]`);
  }
  // Override the original args fields so downstream logic sees the resolved values.
  args.topic = resolvedTopic;
  args.brands = resolvedBrands.join(', ');
  args['tool-url'] = resolvedToolUrls.join(', ');
  // Rebuild the brands list now that auto-extraction may have populated it.
  requestedBrands = resolvedBrands;

  emitProgress('script', 30, args.offline ? 'Creating fallback script locally' : 'Generating hook, spoken text, and scenes with Google');
  const strategy = args.offline
    ? normalizePreRenderText(fallbackStrategy(transcript, args.topic || ''))
    : await buildStrategy({
      transcript,
      sourceMeta,
      topic: args.topic || '',
      durationSeconds,
      autoDuration,
      template,
      retainTranscript: args['retain-transcript'],
      seed: slug
      });

      const media = (args.offline || args['skip-media']) ? [] : await (async () => {
        const hasToolUrl = resolvedToolUrls.length > 0;
        const searchQueries = (strategy.scenes || []).map((s) => s.search || '').filter(Boolean);
        const productQueries = [...new Set([...(resolvedBrands || []), resolvedTopic].filter(Boolean))].slice(0, 3);
        let scrapedPool = (hasToolUrl || productQueries.length)
          ? await collectScrapedMedia(resolvedToolUrls, slug, searchQueries, {productQueries})
          : [];
        if (scrapedPool.length > 0) scrapedPool = await filterScrapedMediaWithVision(scrapedPool, slug);
        const plan = planSceneMedia(strategy, {hasToolUrl: scrapedPool.length > 0});
        return collectSmartMedia(strategy, slug, {plan, scrapedPool, seedSalt: '1'});
      })();
      const toolImage = await fetchToolWebsiteImage(args['tool-url'], slug).catch(() => null);

  if (toolImage) media.push(toolImage);
  // Visibility on what actually came back from Pexels / Unsplash / microlink — silent
  // failures (Cloudflare 403, dead microlink domain, no PEXELS_API_KEY) used to leave
  // mediaClips empty without telling anyone, producing a black video frame on render.
  const videoCount = media.filter((m) => m.kind === 'video').length;
  const imageCount = media.filter((m) => m.kind === 'image').length;
  emitProgress('media', 50, `Media fetched: ${videoCount} video clip(s), ${imageCount} image(s)${toolImage ? ' (incl. tool website OG)' : ''}`);
  if (videoCount + imageCount === 0) {
    emitProgress('media', 51, 'WARNING: no media files were downloaded — the rendered video frame will be empty. Check PEXELS_API_KEY / UNSPLASH_ACCESS_KEY in .env.');
  }
  // Brand chips render via @lobehub/icons at composition time — keyed by name only,
  // no on-disk SVG files, no external fetch. collectBrandLogos is now a passthrough
  // that returns {name, source: 'lobehub', file: ''} for each requested brand.
  const brandLogos = await collectBrandLogos(strategy, slug, requestedBrands);
  emitProgress('logos', 56, `Brand chips: ${brandLogos.length} (${brandLogos.map((b) => b.name).join(', ') || 'none'}) — rendered at composition time via @lobehub/icons`);
  const voiceStyle = resolveTadaVoiceStyle(args['voice-style'] || process.env.TADA_VOICE_STYLE);
  const tadaPromptAudio = args['tada-prompt-audio'] || voiceStyle.promptAudio;
  const tadaPromptText = args['tada-prompt-text'] || voiceStyle.promptText;
  const tadaModel = args['tada-model'] || process.env.TADA_WEIGHTS || process.env.TADA_MODEL || voiceStyle.model;
  const tadaQuantize = args['tada-quantize'] || process.env.TADA_QUANTIZE || null;
  let audioFile = args['skip-tts']
    ? (args['audio-file'] || 'voiceover/preview/s1.mp3')
    : await synthesizeTada({
        text: strategy.voiceover,
        slug,
        promptAudio: tadaPromptAudio,
        promptText: tadaPromptText,
        model: tadaModel,
        quantize: tadaQuantize,
      });
  if (args['auto-trim'] && !args['skip-tts']) {
    audioFile = applyAutoTrim(audioFile);
  }
  const audioDuration = args['skip-tts'] ? null : probeAudioDuration(audioFile);
  const finalDuration = audioDuration || durationSeconds;
  const captionsEnabled = !args['no-captions'];
  // Parse per-run colour overrides. Failure to parse silently falls back to
  // template defaults — never crash a render on a malformed UI payload.
  let colorOverrides = null;
  if (args['color-overrides']) {
    try {
      const parsed = JSON.parse(String(args['color-overrides']));
      if (parsed && typeof parsed === 'object') {
        const cleaned = {};
        for (const key of ['primary', 'secondary', 'accent', 'highlight']) {
          if (typeof parsed[key] === 'string' && parsed[key].trim()) cleaned[key] = parsed[key].trim();
        }
        if (Object.keys(cleaned).length) {
          colorOverrides = cleaned;
          emitProgress('input', 6, `Color overrides: ${Object.entries(cleaned).map(([k, v]) => `${k}=${v}`).join(', ')}`);
        }
      }
    } catch {
      emitProgress('input', 6, 'Color overrides arg was malformed JSON — ignored, using template defaults');
    }
  }
  const textEffect = ['word-stagger', 'line-fade', 'scale-pop', 'blur-reveal'].includes(args['text-effect']) ? args['text-effect'] : 'word-stagger';
  const rawProps = buildSimplifiedProps({strategy, media, audioFile, durationSeconds: finalDuration, brandLogos, colorOverrides, textEffect, skipCta: Boolean(args['skip-cta'])});
  const props = sanitizeProps(rawProps);

  emitProgress('props', 78, 'Writing Remotion props and strategy files');
  const propsDir = join(toolRoot, 'runs', slug);
  ensureDir(propsDir);
  const propsPath = join(propsDir, `${slug}.json`);
  writeFileSync(propsPath, JSON.stringify(props, null, 2) + '\n');

  const strategyPath = join(propsDir, `${slug}.strategy.json`);
  writeFileSync(strategyPath, JSON.stringify({
    llmRequest: buildLlmRequest({transcript, sourceMeta, topic: args.topic || '', durationSeconds: finalDuration, autoDuration}),
    sourceMeta,
    strategy,
    media,
  }, null, 2) + '\n');

  let rendered = null;
  if (args.render) {
    const renderOpts = {
      crf: args['high-bitrate'] ? 16 : undefined,
      loopTail: Boolean(args['loop-tail']),
      captionStyle: args['caption-style'] || undefined,
    };
    rendered = await renderReel(slug, propsPath, props, 'huashu', renderOpts);
  }

  emitProgress('done', 100, 'Reel generation complete');
  console.log(JSON.stringify({
    slug,
    props: propsPath,
    strategy: strategyPath,
    audio: join(projectRoot, 'public', audioFile),
    output: rendered,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
