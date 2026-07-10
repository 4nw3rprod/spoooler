'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  Play, PauseCircle, Microphone01, Type01, Film02, Lock01,
  Link03, Terminal, CpuChip01, Download01, ArrowRight, Stars01,
} from '@untitledui/icons';
import { Copy, Check } from 'lucide-react';
import SpotlightCard from '@/components/ui/SpotlightCard';
import LogoLoop, { LogoItem } from '@/components/ui/LogoLoop';
import ShinyText from '@/components/ui/ShinyText';
import AnimatedContent from '@/components/ui/AnimatedContent';
import BrandLogo from '@/components/ui/BrandLogo';
import { motion, useScroll, useTransform, useMotionValue, useMotionValueEvent, MotionValue } from 'motion/react';


// ── Apple "gallery-white" style reference (Downloads/DESIGN.md) ──
const FONT_DISPLAY = "'SF Pro Display', Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
const FONT_TEXT = "'SF Pro Text', Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

const INK = '#1d1d1f';
const GRAPHITE = '#707070';
const FOG = '#f5f5f7';
const SNOW = '#ffffff';
const SILVER_MIST = '#e8e8ed';
const AZURE = '#0071e3';
const COBALT = '#0066cc';

const DARK_BG = '#0b0b0c';
const DARK_SURFACE = '#121214';
const DARK_BORDER = 'rgba(255, 255, 255, 0.08)';
const DARK_TEXT = '#f4f4f5';
const DARK_MUTED = '#a1a1aa';

const GRADIENT_INDIGO = 'linear-gradient(184deg, rgb(29,29,31) 20%, rgb(168,211,251) 43%, rgb(0,18,249) 76%, rgb(37,53,224) 95%)';

const display: React.CSSProperties = { fontFamily: FONT_DISPLAY, fontSize: 'clamp(44px, 8.5vw, 96px)', lineHeight: 1.04, letterSpacing: '-0.022em', fontWeight: 700, color: INK };
const headingLg: React.CSSProperties = { fontFamily: FONT_DISPLAY, fontSize: 'clamp(34px, 5.2vw, 56px)', lineHeight: 1.07, letterSpacing: '-0.016em', fontWeight: 700, color: INK };
const heading: React.CSSProperties = { fontFamily: FONT_DISPLAY, fontSize: 'clamp(28px, 3.6vw, 40px)', lineHeight: 1.17, letterSpacing: '-0.015em', fontWeight: 700, color: INK };
const headingSm: React.CSSProperties = { fontFamily: FONT_DISPLAY, fontSize: 24, lineHeight: 1.29, letterSpacing: '-0.015em', fontWeight: 600, color: INK };
const subheading: React.CSSProperties = { fontFamily: FONT_TEXT, fontSize: 'clamp(18px, 2vw, 20px)', lineHeight: 1.4, letterSpacing: '-0.01em', fontWeight: 300, color: INK };
const body: React.CSSProperties = { fontFamily: FONT_TEXT, fontSize: 17, lineHeight: 1.47, letterSpacing: '-0.006em', fontWeight: 400, color: GRAPHITE };
const bodySm: React.CSSProperties = { fontFamily: FONT_TEXT, fontSize: 14, lineHeight: 1.43, letterSpacing: '-0.003em', fontWeight: 400, color: GRAPHITE };
const caption: React.CSSProperties = { fontFamily: FONT_TEXT, fontSize: 12, lineHeight: 1.33, letterSpacing: '-0.022em', fontWeight: 400, color: GRAPHITE };
const eyebrow: React.CSSProperties = { fontFamily: FONT_TEXT, fontSize: 'clamp(19px, 2.4vw, 24px)', lineHeight: 1.29, letterSpacing: '-0.015em', fontWeight: 600, color: INK };

const PIPELINE = ['scrape media', 'collect stock', 'synthesize voice', 'align captions', 'render'];

// AI agents / MCP hosts that can drive Spoooler. Logos served live from Brandfetch,
// with bundled Simple Icons SVGs as the offline/rate-limit fallback.
const BRANDFETCH_ID = '1idq4HNz7jtRuv8vA8G';
const bf = (domain: string) =>
  `https://cdn.brandfetch.io/domain/${domain}/w/400/h/400/theme/light/fallback/lettermark/type/icon?c=${BRANDFETCH_ID}`;

const AGENTS: LogoItem[] = [
  { src: bf('openai.com'), fallback: '/logos/openai.svg', title: 'Codex' },
  { src: bf('cursor.com'), fallback: '/logos/cursor.svg', title: 'Cursor' },
  { src: bf('github.com'), fallback: '/logos/githubcopilot.svg', title: 'Copilot' },
  { src: bf('gemini.google.com'), fallback: '/logos/googlegemini.svg', title: 'Gemini' },
  { src: bf('windsurf.com'), fallback: '/logos/windsurf.svg', title: 'Windsurf' },
  { src: bf('zed.dev'), fallback: '/logos/zedindustries.svg', title: 'Zed' },
  { src: bf('cline.bot'), fallback: '/logos/cline.svg', title: 'Cline' },
  { src: bf('replit.com'), fallback: '/logos/replit.svg', title: 'Replit' },
];

const SPECS: { label: string; value: string }[] = [
  { label: 'Inputs', value: 'Instagram URL, local video, transcript, or a one-line topic' },
  { label: 'Control', value: 'Driven over MCP by Codex, Cursor, or any MCP host — one tool at a time' },
  { label: 'Media', value: 'Scrapes product footage; fills gaps from Pexels and Unsplash; NVIDIA NIM vision filter' },
  { label: 'Voice', value: 'Built-in Kokoro voices, or clone your own with pocket-tts' },
  { label: 'Captions', value: 'Word-aligned to the rendered audio with whisper.cpp' },
  { label: 'Render', value: 'Remotion composition templates → 1080×1920 MP4 (also 1:1 and 16:9)' },
  { label: 'Privacy', value: 'Local-first. Your keys, your clips, your voices stay on your Mac' },
  { label: 'Requires', value: 'macOS 12 or later' },
];

const PIPELINE_STEPS = [
  { name: 'Init', index: 0 },
  { name: 'Strategy', index: 3 },
  { name: 'Scrape', index: 4 },
  { name: 'Stock', index: 7 },
  { name: 'Voice', index: 13 },
  { name: 'Render', index: 14 }
];

const MCP_TOOLS = [
  {
    name: 'create_run',
    category: 'Lifecycle',
    desc: 'Mints a fresh unique slug for a new Reel build. Sets up local workspace.',
    params: [
      { name: 'slug', type: 'string', required: false, desc: 'Optional unique name. If omitted, the server generates a random human-readable slug.' }
    ],
    args: '{ slug?: string }',
    returns: '{\n  "slug": "run-slug",\n  "runDir": "/absolute/path/to/instagram-reel-tool/runs/run-slug"\n}'
  },
  {
    name: 'get_run_state',
    category: 'Lifecycle',
    desc: 'Retrieves current status, completed stages, and paths of generated files. Use to confirm readiness before rendering.',
    params: [
      { name: 'slug', type: 'string', required: true, desc: 'The unique slug of the Reel run.' }
    ],
    args: '{ slug: string }',
    returns: '{\n  "stage": 4,\n  "script": { ... },\n  "rendered": false,\n  "files": ["strategy.json", "audio.wav"]\n}'
  },
  {
    name: 'transcribe_source',
    category: 'Lifecycle',
    desc: 'Downloads and transcribes a reference Instagram Reel URL or local video to feed into the strategy stage.',
    params: [
      { name: 'slug', type: 'string', required: true, desc: 'The Reel run slug.' },
      { name: 'url', type: 'string', required: false, desc: 'Instagram Reel URL to download and transcribe.' },
      { name: 'videoFile', type: 'string', required: false, desc: 'Path to a local video file to transcribe.' },
      { name: 'transcript', type: 'string', required: false, desc: 'Direct raw text transcript if already available.' },
      { name: 'skipTranscribe', type: 'boolean', required: false, desc: 'If true, downloads video but skips transcription.' }
    ],
    args: '{ slug, url?, videoFile?, transcript?, skipTranscribe? }',
    returns: '{\n  "transcript": "...",\n  "duration": 28.4\n}'
  },
  {
    name: 'set_strategy',
    category: 'Authoring',
    desc: 'The central directing tool. Configures scriptwriting, outlines scenes, and selects layout archetypes.',
    params: [
      { name: 'slug', type: 'string', required: true, desc: 'The Reel run slug.' },
      { name: 'hook', type: 'string', required: true, desc: 'Spoken and written hook to capture attention in the first second.' },
      { name: 'voiceover', type: 'string', required: true, desc: 'Full text to be spoken across the entire reel.' },
      { name: 'scenes', type: 'array', required: true, desc: 'Array of scenes. Each scene must specify type, onScreen copy, spoken copy, and stock search queries.' },
      { name: 'brandUrl', type: 'string', required: false, desc: 'Product brand URL for asset scraping.' },
      { name: 'mediaCollection', type: 'string', required: false, desc: 'Set to "skip" to manually scrape/review, or "auto" for server collection.' }
    ],
    args: '{ slug, hook, voiceover, scenes: [...], brandUrl?, mediaCollection? }',
    returns: '{\n  "success": true,\n  "slideCount": 5\n}'
  },
  {
    name: 'scrape_brand_media',
    category: 'Media',
    desc: 'Scrapes brand assets, screenshots, and logos from the product page URL and commits them to the run.',
    params: [
      { name: 'slug', type: 'string', required: true, desc: 'The Reel run slug.' },
      { name: 'productQueries', type: 'array', required: false, desc: 'Specific keywords to scrape for (e.g. ["logo", "ui"]).' },
      { name: 'brandUrl', type: 'string', required: false, desc: 'The website page to scrape.' },
      { name: 'commit', type: 'boolean', required: false, desc: 'If true, automatically commits discovered files directly.' }
    ],
    args: '{ slug, productQueries?, brandUrl?, commit?: boolean }',
    returns: '{\n  "discovered": 12,\n  "committed": true,\n  "items": [{"file": "brand-logo.png", "url": "..."}]\n}'
  },
  {
    name: 'review_media',
    category: 'Review',
    desc: 'Returns scraped product media as inline image blocks (with samples of video frames) for you to visually judge.',
    params: [
      { name: 'slug', type: 'string', required: true, desc: 'The Reel run slug.' },
      { name: 'source', type: 'string', required: false, desc: 'Filter by source (e.g., "pexels", "brand").' },
      { name: 'max', type: 'number', required: false, desc: 'Maximum items to retrieve.' }
    ],
    args: '{ slug, source?, max? }',
    returns: '{\n  "items": [\n    {"file": "scr_1.png", "thumbnail": "data:image/png;base64,...", "dimensions": "1920x1080"}\n  ]\n}'
  },
  {
    name: 'rank_media',
    category: 'Review',
    desc: 'Commit your score for each scraped asset. High scores are kept and bound to scenes; AI slop is dropped.',
    params: [
      { name: 'slug', type: 'string', required: true, desc: 'The Reel run slug.' },
      { name: 'rankings', type: 'array', required: true, desc: 'Array of rankings. Each item has a file path, score (1-10), keep boolean, and sceneIndex binding.' }
    ],
    args: '{ slug, rankings: [{ file, score, keep, role?, sceneIndex? }] }',
    returns: '{\n  "success": true,\n  "keptCount": 4\n}'
  },
  {
    name: 'collect_stock_media',
    category: 'Media',
    desc: 'Downloads contextual full-bleed backgrounds (Pexels video or Unsplash images) per scene query.',
    params: [
      { name: 'slug', type: 'string', required: true, desc: 'The Reel run slug.' },
      { name: 'queries', type: 'array', required: true, desc: 'Array of visual search queries (one per scene).' },
      { name: 'commit', type: 'boolean', required: false, desc: 'Commit downloaded items immediately.' }
    ],
    args: '{ slug, queries: string[], commit?: boolean }',
    returns: '{\n  "downloaded": 5,\n  "committed": true\n}'
  },
  {
    name: 'search_stock_media',
    category: 'Media',
    desc: 'Searches stock candidate assets on Pexels/Unsplash to preview results with links (does not download).',
    params: [
      { name: 'query', type: 'string', required: true, desc: 'Visual query terms.' },
      { name: 'orientation', type: 'string', required: false, desc: 'Filter by orientation (e.g. "vertical").' }
    ],
    args: '{ query, orientation? }',
    returns: '{\n  "candidates": [{"id": "px-1", "url": "...", "previewUrl": "..."}]\n}'
  },
  {
    name: 'vision_filter_media',
    category: 'Review',
    desc: 'Fallback only. Uses NVIDIA NIM vision models to filter low-quality/slop assets if you cannot view thumbnails.',
    params: [
      { name: 'slug', type: 'string', required: true, desc: 'The Reel run slug.' },
      { name: 'threshold', type: 'number', required: false, desc: 'Minimum score threshold (0.0 to 1.0).' }
    ],
    args: '{ slug, threshold? }',
    returns: '{\n  "scores": [{"file": "...", "score": 0.85, "kept": true}]\n}'
  },
  {
    name: 'attach_media',
    category: 'Media',
    desc: 'Manually binds specific asset files to scenes as background layers or floating frame cards.',
    params: [
      { name: 'slug', type: 'string', required: true, desc: 'The Reel run slug.' },
      { name: 'attachments', type: 'array', required: true, desc: 'List of files to bind with sceneIndex and role.' }
    ],
    args: '{ slug, attachments: [{ sceneIndex, file, role }] }',
    returns: '{\n  "success": true\n}'
  },
  {
    name: 'apply_pattern',
    category: 'Style',
    desc: 'Configures video styling including global palette color overrides, text animation effects, and subtitles.',
    params: [
      { name: 'slug', type: 'string', required: true, desc: 'The Reel run slug.' },
      { name: 'textEffect', type: 'string', required: false, desc: 'Subtitles transition type (e.g. "blur-reveal").' },
      { name: 'captions', type: 'boolean', required: false, desc: 'Whether to overlay text captions.' }
    ],
    args: '{ slug, textEffect?, captions? }',
    returns: '{\n  "success": true\n}'
  },
  {
    name: 'list_voices',
    desc: 'Lists available high-quality cloned voices (e.g., Anwar Sheikh, Irina) and Kokoro text-to-speech presets.',
    category: 'Voice',
    params: [],
    args: '{}',
    returns: '{\n  "cloned": ["Anwar", "Irina"],\n  "presets": ["af_bella", "am_adam"]\n}'
  },
  {
    name: 'synthesize_voice',
    category: 'Voice',
    desc: 'Generates word-aligned audio voiceover clips for each scene using your selected cloned voice.',
    params: [
      { name: 'slug', type: 'string', required: true, desc: 'The Reel run slug.' },
      { name: 'clonedVoice', type: 'string', required: false, desc: 'Name of the cloned voice sample to use.' },
      { name: 'tone', type: 'string', required: false, desc: 'Expression tone ("calm", "energetic").' }
    ],
    args: '{ slug, clonedVoice?, tone? }',
    returns: '{\n  "audioPath": "runs/run-slug/voiceover.wav",\n  "duration": 24.5\n}'
  },
  {
    name: 'render_reel',
    category: 'Style',
    desc: 'Runs subtitle alignment with whisper.cpp and triggers local Remotion render to MP4.',
    params: [
      { name: 'slug', type: 'string', required: true, desc: 'The Reel run slug.' },
      { name: 'highBitrate', type: 'boolean', required: false, desc: 'Render with high visual bitrates.' }
    ],
    args: '{ slug, highBitrate? }',
    returns: '{\n  "mp4Path": "public/instagram-reel-tool/run-slug/reel.mp4",\n  "duration": 24.5,\n  "renderTimeMs": 18200\n}'
  }
];

const MCP_CONFIG_JSON = `{
  "mcpServers": {
    "instagram-reel-tool": {
      "command": "node",
      "args": [
        "/absolute/path/to/instagram-reel-tool/mcp/server.mjs"
      ]
    }
  }
}`;

const SKILL_MD_TEXT = `---
name: instagram-reel-director
description: >
  Direct and produce a finished, post-ready Instagram reel (1080×1920 MP4) end to
  end through the instagram-reel-tool MCP server. YOU are the creative director:
  you write the on-screen text and voiceover, choose the slide archetype for each
  scene, scrape + judge product media with your own vision, pick a cloned or preset
  voice, and trigger the render. No external scriptwriting LLM is used — the
  reasoning is yours. Trigger words: make a reel, instagram reel, short-form video,
  vertical video, reel from this URL, turn this into a reel, product reel, faceless
  reel, AI reel, voiceover reel, reel with my voice.
keywords:
  - instagram reel
  - reel generator
  - vertical video
  - short form video
  - remotion render
  - voiceover reel
  - cloned voice
  - product reel
license: internal
---

# Instagram Reel Director

You produce a finished Instagram reel by orchestrating the **\`instagram-reel-tool\`**
MCP server. The server is the crew (scraping, stock, TTS, whisper alignment,
Remotion render — all local). **You are the director.** Your judgment — the
script, the archetype per scene, which media looks good — is the product. There
is no separate scriptwriting model; do not look for one.

Everything runs on the user's machine and writes to \`runs/<slug>/*.json\` and
\`public/instagram-reel-tool/<slug>/\`. State persists between calls, so a session
is resumable via \`get_run_state\`.

---

## Core principles

1. **You write everything.** On-screen copy = complete short sentences (6–16 words,
   never fragments). Voiceover = natural spoken English, one clear idea per sentence.
   Do not echo a transcript verbatim — rewrite it as a reel.
2. **You choose the archetype per scene.** Vary them. A reel that is five
   \`statement\` slides is a failure. Mix hook → (problem / proof / stat / checklist /
   comparison / graph) → cta.
3. **You judge media with your own eyes.** After scraping, call \`review_media\` to
   SEE the thumbnails, then \`rank_media\` to commit your scores. Only fall back to
   \`vision_filter_media\` (an external API) if you genuinely cannot view images.
4. **Every scene gets a background; product media goes in frames.** Stock video =
   full-bleed \`background\` (one per scene). Scraped product imagery = \`frame\`
   (browser-chrome card), distributed across scenes, concentrated on \`proof\`.
5. **Confirm before you render.** Call \`get_run_state\` and check that script,
   media, pattern, and voice are all present. Rendering is the slow, expensive step.
6. **Narrate what you are doing.** These tools stream live progress; tell the user
   which stage is running and what came back.

---

## The 12 scene archetypes (you pick one per scene)

| \`type\` | Use it for | \`layoutData\` required |
|---|---|---|
| \`hook\` | Scene 1. The scroll-stopper. | none |
| \`problem\` | Name the pain / costly status quo. | none |
| \`stat\` | One dominant number is the whole point. | \`{value, label}\` |
| \`statement\` | A punchy editorial declaration, no data. | none |
| \`proof\` | Show the actual product / a concrete step. Hosts scraped media. | none |
| \`checklist\` | 3–5 steps, features, or requirements. | \`{title?, items:[{text, brand?}], checked?}\` |
| \`comparison\` | Before/after, old vs new, A vs B. | \`{leftTitle, rightTitle, leftItems[], rightItems[], leftBrand?, rightBrand?}\` |
| \`bar-graph\` | Compare magnitudes across 2–5 named things. | \`{title?, unit?, bars:[{label, value, brand?}]}\` |
| \`pie-chart\` | Composition / share of a whole (≤5 slices). | \`{title?, slices:[{label, value, brand?}]}\` |
| \`progress-graph\` | A trend / growth over 3–6 points. | \`{title?, unit?, points:[{label, value}]}\` |
| \`motion-graphic\` | A process/flow of connected nodes. | \`{title?, nodes:[{label, brand?}], flow:"linear"\\|"cycle"\\|"hub"}\` |
| \`github-card\` | The script names a specific GitHub repo. | \`{owner, repo, description?, language?, stars?, forks?, visibility?, url?}\` — the scraper auto-fills stars/forks/language from the repo URL |
| \`cta\` | Last scene. The call to action. | none |

Position rules enforced by the engine: scene 1 always renders as \`hook\`; the last
scene renders as \`cta\` when its type is \`cta\`. \`problem\` renders as an editorial
statement. Always include \`layoutData\` when the archetype needs it, or the engine
downgrades the slide to \`statement\`.

**Text effects** (set via \`apply_pattern\`): \`word-stagger\`, \`line-fade\`,
\`scale-pop\`, \`blur-reveal\`. Use \`blur-reveal\` for punchy hooks, \`line-fade\` for
calmer topics.

---

## Footage mode (raw talking-head video → edited reel)

When the user gives you RAW FOOTAGE of themselves speaking (a file path), use the
footage pipeline instead of the slide pipeline:

\`create_run → ingest_footage → transcribe_footage → (extract entities from the
transcript yourself, then scrape_brand_media / collect_stock_media / review_media /
rank_media as usual) → set_edit_plan → render_footage_reel\`

**You are the editor.** Read the transcript with word timestamps and:

1. **Cut ruthlessly.** Omit \`cuts\` to auto-remove silences (>0.7s) and filler words.
   Provide explicit \`cuts\` when you spot flubbed takes or restarted sentences in the
   transcript — keep the LAST take of any repeated phrase.
2. **Group cuts into beats** (~3-6s each) and pick a treatment per beat:
   - \`talking-head\` — hooks, personal moments, the CTA. Set \`zoom:true\` on emphasis.
   - \`overlay\` — when the speech states a fact/list/number. \`split\` (default) for
     stat/checklist/receipt; \`pip\` for comparison/motion-graphic/wide cards.
   - \`broll\` — when the speech describes something visual. Max ~4s. Needs \`mediaRef\`.
   - \`frame-overlay\` — when the speech mentions the product; floats a screenshot.
3. **Editing rules:** never cut away during the first 2 seconds; show something new
   every 3-5 seconds (vary treatments); one overlay archetype per beat and vary
   archetypes across the reel; END on the speaker's face for the CTA.
4. **Captions are selective kinetic typography, not subtitles.** Per beat: one short
   phrase, only the words worth seeing, EXACTLY ONE \`hero\` word (renders 2.5-3x in
   the accent color). Example: "And **Honestly** super easy to make". Omit the
   caption when nothing is worth highlighting. Never transcribe speech verbatim.
5. **Confirm before rendering:** \`get_run_state\` should show footage, footageTranscript,
   and editPlan all present. Then \`render_footage_reel\` (set \`viewfinder:true\` for the
   camera-frame look; pass \`music\` for an auto-ducked bed).

---

## Tools (the full surface)

Call \`list_layouts\` and \`list_voices\` first in any new session to ground yourself.

### Run lifecycle
- **\`create_run({ slug? })\`** → mints a run slug. Everything else takes this \`slug\`.
- **\`get_run_state({ slug })\`** → snapshot of every stage (done/stale + key data).
  Use this to plan and to confirm readiness before rendering.
- **\`transcribe_source({ slug, url?, videoFile?, transcript?, skipTranscribe? })\`**
  → only when there's a reference IG URL or local video. Returns the transcript for
  you to rewrite. Skip it entirely if the user just gives you a topic.

### Authoring (your creative work)
- **\`set_strategy({ slug, hook, voiceover, scenes[], brands?, angle?, commentTrigger?,
  commentReward?, autoDuration?, brandUrl?, mediaCollection? })\`**
  The central tool. \`scenes[]\` is where you choose archetypes and write copy:
  \`\`\`jsonc
  {
    "type": "checklist",
    "onScreen": "Three steps to automate your inbox.",
    "spoken": "Here are the three steps that automate your whole inbox.",
    "subtext": "",                         // optional; best on hook + cta
    "brands": ["Notion"],                  // logo chips for this scene
    "search": "person typing laptop",      // stock background query
    "layoutData": { "items": [ { "text": "Filter", "brand": "Notion" } ] },
    "emoji": "light-bulb"                  // optional animated emoji (hook/cta/proof)
  }
  \`\`\`
  - Set \`mediaCollection: "skip"\` when you intend to drive media yourself
    (scrape → review → rank). Use \`"auto"\` to let the server collect + optionally
    NVIDIA-filter media in one shot (less transparent, but one call).
  - Set \`autoDuration: true\` so the reel length follows the actual voiceover.
  - Put every product/company name in \`brands\` and the primary product site in
    \`brandUrl\` so scraping can find real assets.

### Media — scrape, SEE, rank (your vision)
- **\`scrape_brand_media({ slug, urls?, productQueries?, commit? })\`**
  Scrapling discovery: searches for the real product pages, scrapes up to 4 sites,
  hunts a hero video, returns ranked items (video > image > screenshot, landscape
  preferred) with real dimensions + source URLs. \`commit: true\` appends them into
  the run as \`frame\` media. Streams progress (sites found, assets found).
- **\`review_media({ slug, source?, max?, thumbWidth? })\`**
  Returns the scraped media as **inline image thumbnails you can actually look at**
  (videos sampled to one frame), each preceded by a metadata line. This is how you
  judge quality yourself.
- **\`rank_media({ slug, rankings:[{ file, score, keep, role?, sceneIndex? }] })\`**
  Commit YOUR judgment. Keep the clean, on-brand, high-res product shots; drop AI
  slop, watermarked, off-topic, low-res. Kept items sort by your score and write
  into the run. Bind the best to the \`proof\` scene with \`role:"frame"\` + \`sceneIndex\`.
- **\`collect_stock_media({ slug, queries[], commit? })\`**
  Downloads one stock background per query, in scene order (Pexels video → Unsplash
  image fallback). These are the full-bleed \`background\` layers.
- **\`search_stock_media({ query, orientation?, perPage? })\`**
  Preview-only Pexels search (returns candidates with links, downloads nothing).
- **\`vision_filter_media({ slug, items?, threshold?, commit? })\`**
  FALLBACK ONLY — scores scraped media with an external NVIDIA vision model. Use
  this when you cannot view images. Prefer \`review_media\` + \`rank_media\`.
- **\`attach_media({ slug, attachments:[{ sceneIndex, file, kind, role, ... }], mode? })\`**
  Manually bind specific clip files to scenes. \`role:"background"\` (full-bleed) or
  \`role:"frame"\` (product card). Use to fine-tune after the above.

### Style, voice, render
- **\`apply_pattern({ slug, colorOverrides?, textEffect?, captions?, skipCta? })\`**
  Persist palette + text effect + captions toggle. Default look is black bg / white
  text. \`colorOverrides\` slots: \`primary\` (bg), \`secondary\` (headline), \`accent\`
  (glow + CTA button), \`highlight\` (subtext).
- **\`list_voices()\`** → cloned pocket-tts voices (e.g. **Anwar Sheikh**, **Irina**)
  + Kokoro presets.
- **\`synthesize_voice({ slug, clonedVoice?, voice?, tone?, quality?, autoTrim? })\`**
  Generates per-scene + master voiceover. Prefer \`clonedVoice:"Anwar"\` (or "Irina")
  for the user's own voice. \`tone\`: calm | balanced | energetic | expressive.
  \`quality\` 1–4 (4 = closest to the cloned sample, slower). \`voice\` is a Kokoro
  preset fallback.
- **\`render_reel({ slug, highBitrate?, loopTail?, skipAlign? })\`**
  Final 1080×1920 MP4. Runs whisper.cpp word-level caption alignment automatically.
  Returns the output path + duration. Requires source + script + pattern + voice.

---

## The standard workflow

\`\`\`
1. list_layouts                         # ground yourself in archetypes + flow
2. list_voices                          # see cloned voices (Anwar, Irina) + presets
3. create_run                           # → slug
4. (optional) transcribe_source         # only if there's a reference URL/video
5. set_strategy({ mediaCollection:"skip", scenes:[ varied archetypes ] })
6. scrape_brand_media({ productQueries:[...], brandUrl, commit:true })
7. review_media                         # LOOK at the thumbnails
8. rank_media({ rankings:[...] })       # YOUR scores; keep good, drop slop, bind to proof
9. collect_stock_media({ queries:[ one per scene ], commit:true })
10. apply_pattern({ textEffect:"blur-reveal", captions:true })
11. synthesize_voice({ clonedVoice:"Anwar", tone:"energetic", quality:4 })
12. get_run_state                       # confirm script+media+pattern+voice present
13. render_reel({ highBitrate:true })   # → MP4 path
\`\`\`

A leaner path when the user wants speed over control: \`set_strategy({
mediaCollection:"auto" })\` collects media in one call; then \`apply_pattern\` →
\`synthesize_voice\` → \`render_reel\`.

---

## A concrete example

User: *"Make a 30s reel about 3 AI agents that kill busywork — Notion AI, Zapier,
and a research agent. Use my Anwar voice."*

\`\`\`jsonc
// 3. create_run → { slug: "agents-busywork" }

// 5. set_strategy
{
  "slug": "agents-busywork",
  "hook": "Three AI agents that quietly run your busywork.",
  "voiceover": "Three AI agents that quietly run your busywork. Notion AI drafts your docs before you ask. Zapier moves data between every tool you own. And a research agent reads the web so you don't have to. Comment STACK and I'll send the setup.",
  "angle": "AI agent stack for solo operators drowning in busywork",
  "brands": ["Notion", "Zapier"],
  "brandUrl": "https://www.notion.so/product/ai",
  "commentTrigger": "STACK",
  "autoDuration": true,
  "mediaCollection": "skip",
  "scenes": [
    { "type":"hook",      "onScreen":"Three AI agents quietly run your busywork.", "spoken":"Three AI agents that quietly run your busywork.", "emoji":"rocket" },
    { "type":"proof",     "onScreen":"Notion AI drafts your docs before you ask.", "spoken":"Notion AI drafts your docs before you ask.", "brands":["Notion"], "search":"clean writing app interface" },
    { "type":"checklist", "onScreen":"Zapier connects every tool you own.", "spoken":"Zapier moves data between every tool you own.", "brands":["Zapier"], "layoutData":{"title":"What it links","items":[{"text":"Gmail"},{"text":"Slack"},{"text":"Sheets"}]} },
    { "type":"stat",      "onScreen":"Ten hours back, every week.", "spoken":"Together they buy back about ten hours every single week.", "layoutData":{"value":"10","label":"hours saved / week"} },
    { "type":"cta",       "onScreen":"Comment STACK for the setup.", "spoken":"Comment STACK and I'll send the setup." }
  ]
}

// 6. scrape_brand_media { productQueries:["Notion AI","Zapier"], brandUrl, commit:true }
// 7. review_media         → look at the returned thumbnails
// 8. rank_media { rankings:[
//      {file:"...notion-ui.png", score:9, keep:true,  role:"frame", sceneIndex:1},
//      {file:"...zapier.png",     score:8, keep:true,  role:"frame", sceneIndex:2},
//      {file:"...stock-orb.jpg",  score:3, keep:false}   // AI slop — drop
//    ]}
// 9. collect_stock_media { queries:[
//      "soft morning desk", "person writing laptop", "connected workflow", "calm office", "sunrise city"
//    ], commit:true }
// 10. apply_pattern { textEffect:"blur-reveal", captions:true }
// 11. synthesize_voice { clonedVoice:"Anwar", tone:"energetic", quality:4 }
// 12. get_run_state  → confirm
// 13. render_reel { highBitrate:true } → /…/runs/agents-busywork/agents-busywork.mp4
\`\`\`

---

## Quality bar (hold yourself to this)

- **Archetype variety**: at least 3 distinct archetypes across the reel; include one
  data layout (checklist/comparison/graph) and one \`proof\` when a product is involved.
- **Complete sentences** on screen — no 3-word fragments, no dangling words.
- **≥ 2 scraped product assets** kept after ranking when the reel is about a product.
- **A background on every scene** — never a black empty slide.
- **Captions on**, whisper-aligned (the default in \`render_reel\`).
- **The user's voice** when they have a clone — confirm via \`list_voices\`.

---

## Host-specific notes

- **Multimodal MCP hosts**: full multimodal MCP — \`review_media\` thumbnails render inline,
  so you judge media with real vision. This is the intended path.
- **Codex**: if your build doesn't display MCP image blocks, you still get each
  item's metadata (kind, orientation, dimensions, source URL) from \`review_media\`'s
  text lines — rank from that, or call \`vision_filter_media\` as the fallback. The
  pipeline never blocks.

## Failure handling

- A tool that fails is recoverable — the run dir is NOT wiped. Read the error, fix
  the inputs, and retry the single tool. Don't restart the whole pipeline.
- \`render_reel\` refuses to run if the script produced zero slides (a guardrail
  against rendering dummy defaults). If you hit it, re-check \`set_strategy\`'s scenes.
- First \`render_reel\` / \`synthesize_voice\` may take minutes (whisper.cpp compiles
  once, then caches; pocket-tts loads the model). This is normal.
- If media is thin, lower \`rank_media\` standards slightly or add \`collect_stock_media\`
  backgrounds — never ship a scene with no visual.
`;

function BuyPill({ children, small = false }: { children: React.ReactNode; small?: boolean }) {
  return (
    <button
      onClick={() => alert('Download starting…')}
      style={{
        backgroundColor: AZURE, color: SNOW, borderRadius: 999,
        padding: small ? '7px 16px' : '12px 22px', fontFamily: FONT_TEXT,
        fontSize: small ? 14 : 17, fontWeight: 400, letterSpacing: '-0.006em',
        border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8,
        transition: 'background-color 0.1s ease',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#0077ed')}
      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = AZURE)}
    >
      {children}
    </button>
  );
}

function ReelFrame({ gradient = GRADIENT_INDIGO, image, width = 300, caption: cap = 'this is where it lands', badge = true, radius = 28 }: {
  gradient?: string; image?: string; width?: number; caption?: string; badge?: boolean; radius?: number;
}) {
  return (
    <motion.div
      whileHover="hover"
      initial="initial"
      whileTap={{ scale: 0.98 }}
      variants={{
        hover: {
          y: -12,
          boxShadow: '0 25px 50px -12px rgba(0,0,0,0.15)',
          transition: { type: "spring", stiffness: 260, damping: 20 }
        }
      }}
      style={{
        width,
        aspectRatio: '9 / 16',
        borderRadius: radius,
        background: image ? '#111' : gradient,
        position: 'relative',
        overflow: 'hidden',
        flexShrink: 0,
        cursor: 'pointer',
        boxShadow: '0 4px 6px -1px rgba(0,0,0,0.02), 0 2px 4px -1px rgba(0,0,0,0.01)',
      }}
    >
      {image && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <motion.img
            src={image}
            alt=""
            variants={{
              hover: { scale: 1.06 }
            }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
          />
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(0,0,0,0.2) 0%, rgba(0,0,0,0) 30%, rgba(0,0,0,0) 65%, rgba(0,0,0,0.55) 100%)', zIndex: 1 }} />
        </>
      )}
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2 }}>
        <motion.div
          variants={{
            hover: {
              scale: 1.15,
              backgroundColor: 'rgba(255,255,255,0.38)',
              boxShadow: '0 0 24px rgba(255,255,255,0.4)',
              transition: { type: "spring", stiffness: 300, damping: 12 }
            }
          }}
          style={{ width: 52, height: 52, borderRadius: 999, background: 'rgba(255,255,255,0.22)', backdropFilter: 'blur(20px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <Play width={20} height={20} style={{ color: SNOW }} />
        </motion.div>
      </div>
      {cap && (
        <div style={{ position: 'absolute', left: 14, right: 14, bottom: 18, textAlign: 'center', zIndex: 2 }}>
          <motion.span
            variants={{
              hover: { y: -4, scale: 1.03, transition: { type: "spring", stiffness: 300, damping: 15 } }
            }}
            style={{ display: 'inline-block', background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(8px)', borderRadius: 8, padding: '6px 12px', fontFamily: FONT_TEXT, fontSize: 14, fontWeight: 600, color: SNOW, letterSpacing: '-0.01em' }}
          >
            {cap}
          </motion.span>
        </div>
      )}
      {badge && <div style={{ position: 'absolute', top: 13, left: 14, fontFamily: FONT_TEXT, fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.85)', zIndex: 2 }}>1080 × 1920</div>}
    </motion.div>
  );
}

// Vertical stock stills used in the "Made to ship" gallery — real photos, not grey.
const REELS = [
  { image: 'https://picsum.photos/seed/spoooler-travel/480/854', caption: 'before you book' },
  { image: 'https://picsum.photos/seed/spoooler-food/480/854', caption: 'the secret menu' },
  { image: 'https://picsum.photos/seed/spoooler-music/480/854', caption: 'turn it up' },
  { image: 'https://picsum.photos/seed/spoooler-city/480/854', caption: 'this is where it lands' },
  { image: 'https://picsum.photos/seed/spoooler-fit/480/854', caption: 'watch till the end' },
  { image: 'https://picsum.photos/seed/spoooler-design/480/854', caption: 'pixel perfect' },
  { image: 'https://picsum.photos/seed/spoooler-style/480/854', caption: '3 ways to save' },
];

// Ambient decorative mock UI screen
function AmbientReelFrame({
  top, left, right, bottom, width, rotation, opacity, gradient, delay
}: {
  top?: string | number;
  left?: string | number;
  right?: string | number;
  bottom?: string | number;
  width: number;
  rotation: number;
  opacity: number;
  gradient: string;
  delay: number;
}) {
  return (
    <div
      style={{
        position: 'absolute',
        top, left, right, bottom,
        width,
        aspectRatio: '9 / 16',
        transform: `rotate(${rotation}deg)`,
        opacity,
        pointerEvents: 'none',
      }}
    >
      <div
        className="ambient-screen"
        style={{
          width: '100%',
          height: '100%',
          borderRadius: 24,
          background: gradient,
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.05), 0 1px 3px rgba(0, 0, 0, 0.02)',
          border: '3px solid rgba(29, 29, 31, 0.08)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: 12,
          animation: `float-slow 7s ease-in-out infinite`,
          animationDelay: `${delay}s`,
        }}
      >
        {/* Top Header Mock */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', opacity: 0.8 }}>
          <div style={{ width: '40%', height: 6, borderRadius: 3, background: 'rgba(255, 255, 255, 0.5)' }} />
          <div style={{ width: 10, height: 10, borderRadius: 999, background: 'rgba(255, 255, 255, 0.4)' }} />
        </div>

        {/* Center Play Button Mock */}
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1 }}>
          <div style={{ width: 32, height: 32, borderRadius: 999, background: 'rgba(255, 255, 255, 0.25)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ width: 0, height: 0, borderTop: '6px solid transparent', borderBottom: '6px solid transparent', borderLeft: '10px solid #fff', marginLeft: 2 }} />
          </div>
        </div>

        {/* Bottom Mock UI Info */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          {/* Caption & User */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '70%' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 16, height: 16, borderRadius: 999, background: 'rgba(255, 255, 255, 0.5)' }} />
              <div style={{ width: 40, height: 6, borderRadius: 3, background: 'rgba(255, 255, 255, 0.6)' }} />
            </div>
            <div style={{ width: '100%', height: 4, borderRadius: 2, background: 'rgba(255, 255, 255, 0.4)' }} />
            <div style={{ width: '60%', height: 4, borderRadius: 2, background: 'rgba(255, 255, 255, 0.4)' }} />
          </div>
          {/* Sidebar Icons Mock */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
            <div style={{ width: 14, height: 14, borderRadius: 999, background: 'rgba(255, 255, 255, 0.5)' }} />
            <div style={{ width: 14, height: 14, borderRadius: 999, background: 'rgba(255, 255, 255, 0.5)' }} />
          </div>
        </div>
      </div>
    </div>
  );
}


const LOGO_OFFSETS = [
  // 0: Codex (Left side, high near title)
  { xS: -540, ySOffset: -480, sizeS: 96, blurS: 0, opacityS: 0.95, rotS: -15, xA: -416 },
  // 1: Cursor (Left side, mid-low near subheading, blurred)
  { xS: -420, ySOffset: -380, sizeS: 72, blurS: 1.5, opacityS: 0.65, rotS: 12, xA: -312 },
  // 2: Copilot (Left side, low near CTA buttons)
  { xS: -620, ySOffset: -240, sizeS: 88, blurS: 0, opacityS: 0.9, rotS: -8, xA: -208 },
  // 3: Gemini (Left side, mid-high near subtitle)
  { xS: -480, ySOffset: -280, sizeS: 76, blurS: 2.0, opacityS: 0.5, rotS: 10, xA: -104 },
  // 4: Windsurf (Left side, outer-high near title)
  { xS: -600, ySOffset: -440, sizeS: 90, blurS: 0, opacityS: 0.9, rotS: -5, xA: 0 },
  // 5: Zed (Right side, high near title, blurred)
  { xS: 440, ySOffset: -460, sizeS: 72, blurS: 2.0, opacityS: 0.55, rotS: 20, xA: 104 },
  // 6: Cline (Right side, mid-low near subtitle)
  { xS: 580, ySOffset: -360, sizeS: 88, blurS: 0, opacityS: 0.9, rotS: -12, xA: 208 },
  // 7: Replit (Right side, low near CTA buttons, blurred)
  { xS: 480, ySOffset: -260, sizeS: 80, blurS: 1.0, opacityS: 0.7, rotS: 8, xA: 312 }
];

// Motion ScrollLogo component for 120fps dynamic translation
function ScrollLogo({
  agent,
  config,
  scrollY,
  screenshotY,
  spacerY,
}: {
  agent: LogoItem;
  config: typeof LOGO_OFFSETS[0];
  scrollY: MotionValue<number>;
  screenshotY: number;
  spacerY: number;
}) {
  const yS = screenshotY + config.ySOffset;
  const yA = spacerY;

  const [scale, setScale] = useState(1);

  useEffect(() => {
    const handleResize = () => {
      const w = window.innerWidth;
      // Linear scaling factor centered around 1440px wide viewport
      // clamped between 0.75 and 1.3 to avoid clipping while maintaining wide scatter
      const factor = Math.min(1.3, Math.max(0.75, w / 1440));
      setScale(factor);
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Compute horizontal x position dynamically
  const x = useTransform(scrollY, (latestScrollY) => {
    const progress = Math.max(0, Math.min(1, latestScrollY / 450));
    const startX = config.xS * scale;
    return startX + progress * (config.xA - startX);
  });

  // Compute vertical y position dynamically
  const y = useTransform(scrollY, (latestScrollY) => {
    const progress = Math.max(0, Math.min(1, latestScrollY / 450));
    return yS + progress * (yA - yS);
  });

  const size = useTransform(scrollY, [0, 450], [config.sizeS, 56]);
  const opacity = useTransform(scrollY, [0, 450], [config.opacityS, 0.85]);
  const rotate = useTransform(scrollY, [0, 450], [config.rotS, 0]);
  const blur = useTransform(scrollY, [0, 450], [config.blurS, 0]);

  // Derive composite styles dynamically
  const leftStr = useTransform(x, (val) => `calc(50% + ${val}px)`);
  const transformStr = useTransform(rotate, (r) => `translate(-50%, -50%) rotate(${r}deg)`);
  const filterStr = useTransform(blur, (v) => v > 0.1 ? `blur(${v}px)` : 'none');

  return (
    <motion.div
      style={{
        position: 'absolute',
        left: leftStr,
        top: y,
        width: size,
        height: size,
        transform: transformStr,
        opacity,
        filter: filterStr,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#ffffff', // SNOW
        borderRadius: 14,
        border: '1px solid #e8e8ed', // SILVER_MIST
        boxShadow: '0 4px 12px rgba(0,0,0,0.03), 0 1px 2px rgba(0,0,0,0.02)',
        willChange: 'left, top, width, height, transform, opacity, filter',
      }}
    >
      <BrandLogo
        src={agent.src}
        fallback={agent.fallback}
        alt={agent.title}
        style={{ height: '70%', width: 'auto' }}
      />
    </motion.div>
  );
}

export default function LandingPage() {


  const [aspect, setAspect] = useState('9:16');
  const [playing, setPlaying] = useState(false);
  const [audioProgress, setAudioProgress] = useState(0);
  const [activeStep, setActiveStep] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const screenshotRef = useRef<HTMLDivElement>(null);
  const spacerRef = useRef<HTMLDivElement>(null);

  const { scrollY } = useScroll();
  const [mounted, setMounted] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [positions, setPositions] = useState<{
    screenshotY: number;
    spacerY: number;
  } | null>(null);

  const [activeMcpTab, setActiveMcpTab] = useState<'cursor' | 'windsurf'>('cursor');
  const [activeTool, setActiveTool] = useState<number | null>(0);
  const [copiedMcp, setCopiedMcp] = useState(false);
  const [copiedSkill, setCopiedSkill] = useState(false);

  const handleCopyMcp = (text: string) => {
    if (typeof window !== 'undefined') {
      navigator.clipboard.writeText(text);
      setCopiedMcp(true);
      setTimeout(() => setCopiedMcp(false), 2000);
    }
  };

  const handleCopySkill = (text: string) => {
    if (typeof window !== 'undefined') {
      navigator.clipboard.writeText(text);
      setCopiedSkill(true);
      setTimeout(() => setCopiedSkill(false), 2000);
    }
  };

  useEffect(() => {
    setMounted(true);
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 1024);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    if (isMobile) return;
    const updatePositions = () => {
      const container = containerRef.current;
      const screenshot = screenshotRef.current;
      const spacer = spacerRef.current;
      if (!container || !screenshot || !spacer) return;

      const containerRect = container.getBoundingClientRect();
      const screenshotRect = screenshot.getBoundingClientRect();
      const spacerRect = spacer.getBoundingClientRect();

      setPositions({
        screenshotY: screenshotRect.top - containerRect.top + screenshotRect.height / 2,
        spacerY: spacerRect.top - containerRect.top + spacerRect.height / 2,
      });
    };

    updatePositions();
    window.addEventListener('resize', updatePositions);
    window.addEventListener('load', updatePositions);
    const timer = setTimeout(updatePositions, 500);
    return () => {
      window.removeEventListener('resize', updatePositions);
      window.removeEventListener('load', updatePositions);
      clearTimeout(timer);
    };
  }, [isMobile]);



  useEffect(() => {
    const id = setInterval(() => setActiveStep((p) => (p + 1) % PIPELINE.length), 1300);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let id: ReturnType<typeof setInterval>;
    if (playing) id = setInterval(() => setAudioProgress((p) => (p + 1) % 100), 100);
    else setAudioProgress(0);
    return () => { if (id) clearInterval(id); };
  }, [playing]);

  return (
    <div style={{ background: FOG, color: INK, fontFamily: FONT_TEXT, minHeight: '100vh' }}>

      {/* ── GLOBAL NAV (44px) ── */}
      <header style={{ position: 'sticky', top: 0, zIndex: 60, background: 'rgba(245,245,247,0.8)', backdropFilter: 'saturate(180%) blur(20px)', height: 44, borderBottom: `1px solid ${SILVER_MIST}` }}>
        <div style={{ maxWidth: 1024, margin: '0 auto', height: '100%', padding: '0 22px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Logo height={18} />
          <nav style={{ display: 'flex', gap: 28, alignItems: 'center' }}>
            <a href="#overview" style={{ ...caption, color: INK, textDecoration: 'none' }}>Overview</a>
            <a href="#features" style={{ ...caption, color: INK, textDecoration: 'none' }}>How it works</a>
            <a href="#agents" style={{ ...caption, color: INK, textDecoration: 'none' }}>Agents</a>
            <a href="#specs" style={{ ...caption, color: INK, textDecoration: 'none' }}>Specs</a>
          </nav>
        </div>
      </header>

      {/* ── PRODUCT SUB-NAV (52px) ── */}
      <div style={{ position: 'sticky', top: 44, zIndex: 55, background: SNOW, borderBottom: `1px solid ${SILVER_MIST}`, height: 52 }}>
        <div style={{ maxWidth: 1024, margin: '0 auto', height: '100%', padding: '0 22px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Logo height={24} />
          <BuyPill small><Download01 width={15} height={15} style={{ color: SNOW }} /> Download</BuyPill>
        </div>
      </div>

      <div ref={containerRef} style={{ position: 'relative', overflow: 'hidden' }}>

      {/* ── HERO ── */}
      <section id="overview" style={{ background: FOG, textAlign: 'center', padding: '80px 22px 0', position: 'relative' }}>
        

        {/* Ambient background screens */}
        <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 0 }}>
          <AmbientReelFrame top="8%" left="3%" width={150} rotation={-12} opacity={0.16} gradient="linear-gradient(135deg, #ff9a9e 0%, #fecfef 100%)" delay={0} />
          <AmbientReelFrame top="42%" left="-4%" width={190} rotation={8} opacity={0.11} gradient="linear-gradient(135deg, #a1c4fd 0%, #c2e9fb 100%)" delay={2} />
          <AmbientReelFrame top="72%" left="8%" width={130} rotation={-6} opacity={0.14} gradient="linear-gradient(135deg, #f6d365 0%, #fda085 100%)" delay={4} />
          
          <AmbientReelFrame top="6%" right="2%" width={170} rotation={14} opacity={0.14} gradient="linear-gradient(135deg, #cfd9df 0%, #e2ebf0 100%)" delay={1} />
          <AmbientReelFrame top="36%" right="8%" width={135} rotation={-10} opacity={0.18} gradient="linear-gradient(135deg, #d4fc79 0%, #96e6a1 100%)" delay={3} />
          <AmbientReelFrame top="68%" right="-5%" width={200} rotation={6} opacity={0.09} gradient="linear-gradient(135deg, #84fab0 0%, #8fd3f4 100%)" delay={5} />

          <AmbientReelFrame bottom="-4%" left="26%" width={140} rotation={-7} opacity={0.08} gradient="linear-gradient(135deg, #e0c3fc 0%, #8ec5fc 100%)" delay={1.5} />
          <AmbientReelFrame bottom="-2%" right="24%" width={150} rotation={10} opacity={0.08} gradient="linear-gradient(135deg, #fddb92 0%, #d1f2f9 100%)" delay={3.5} />
        </div>

        <div style={{ maxWidth: 980, margin: '0 auto', position: 'relative', zIndex: 10 }}>
          <h1 style={{ ...display, marginBottom: 16 }}>Hand it a topic.<br />Get a Reel.</h1>
          <p style={{ ...subheading, maxWidth: 640, margin: '0 auto 24px', color: INK }}>
            A local-first Mac app that turns a link, a video, or a topic into a finished
            1080×1920 Reel. Your agent runs the whole pipeline over MCP.
          </p>
          <div style={{ display: 'flex', gap: 28, justifyContent: 'center', alignItems: 'center', marginBottom: 40 }}>
            <BuyPill><Download01 width={17} height={17} style={{ color: SNOW }} /> Download for macOS</BuyPill>
            <a href="#features" style={{ ...body, color: COBALT, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              See how it works <ArrowRight width={15} height={15} style={{ color: COBALT }} />
            </a>
          </div>
          <div ref={screenshotRef} style={{ display: 'flex', justifyContent: 'center', marginTop: 24 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/hero-screenshot.jpg"
              alt="Spoooler App"
              style={{
                maxWidth: '100%',
                width: 900,
                height: 'auto',
                borderRadius: 16,
                boxShadow: '0 20px 40px rgba(0, 0, 0, 0.06), 0 1px 3px rgba(0, 0, 0, 0.02)',
                border: `1px solid ${SILVER_MIST}`,
              }}
            />
          </div>
        </div>
      </section>

      {/* ── AGENT LOGO STRIP (ReactBits LogoLoop) ── */}
      <section id="agents" style={{ background: SNOW, padding: '56px 0', borderTop: `1px solid ${SILVER_MIST}`, marginTop: 64, position: 'relative', zIndex: 1 }}>
        <p style={{ ...caption, textAlign: 'center', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 28 }}>Works with the agent you already use</p>
        {!mounted || isMobile ? (
          <LogoLoop logos={AGENTS} speed={50} logoHeight={56} gap={56} fadeOutColor={SNOW} label={false} isStatic={true} />
        ) : (
          <div ref={spacerRef} style={{ height: 56 }} />
        )}
      </section>

      {/* Scattered/Aligned Logos (Desktop only) */}
      {mounted && !isMobile && positions && (
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 5 }}>
          {LOGO_OFFSETS.map((config, i) => {
            const agent = AGENTS[i];
            return (
              <ScrollLogo
                key={agent.title}
                agent={agent}
                config={config}
                scrollY={scrollY}
                screenshotY={positions.screenshotY}
                spacerY={positions.spacerY}
              />
            );
          })}
        </div>
      )}
    </div>

      {/* ── BENTO: what it does (white, Unbody-style) ── */}
      <section id="features" style={{ background: FOG, padding: '120px 22px' }}>
        <div style={{ maxWidth: 1080, margin: '0 auto' }}>
          <AnimatedContent>
            <h2 style={{ ...heading, textAlign: 'center', marginBottom: 12 }}>What it actually does</h2>
            <p style={{ ...body, textAlign: 'center', maxWidth: 540, margin: '0 auto 56px' }}>
              You point it at a source and it builds the Reel. There&apos;s no timeline to scrub and nothing to drag.
            </p>
          </AnimatedContent>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>

            {/* Inputs */}
            <BentoCard icon={<Link03 width={18} height={18} style={{ color: INK }} />} eyebrowText="Inputs" title="Four ways in"
              bodyText="A link, a video file, a transcript, or a one-line topic.">
              <div style={{ background: FOG, borderRadius: 16, padding: '6px 16px' }}>
                {[
                  { label: 'Instagram URL', icon: <Link03 width={16} height={16} /> },
                  { label: 'Video file', icon: <Film02 width={16} height={16} /> },
                  { label: 'Transcript', icon: <Type01 width={16} height={16} /> },
                  { label: 'Topic', icon: <Stars01 width={16} height={16} /> },
                ].map((row, i) => (
                  <motion.div
                    key={row.label}
                    variants={{
                      hover: { x: 4, transition: { type: "spring", stiffness: 300, damping: 15 } }
                    }}
                    style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 0', borderBottom: i < 3 ? `1px solid ${SILVER_MIST}` : 'none' }}
                  >
                    <motion.span
                      variants={{
                        hover: { scale: 1.15, color: AZURE }
                      }}
                      style={{ display: 'flex', alignItems: 'center', color: INK }}
                    >
                      {row.icon}
                    </motion.span>
                    <motion.span
                      variants={{
                        hover: { color: INK }
                      }}
                      style={{ ...bodySm, color: GRAPHITE, fontWeight: 500 }}
                    >
                      {row.label}
                    </motion.span>
                    <motion.span
                      variants={{
                        hover: { x: 4, color: AZURE }
                      }}
                      style={{ marginLeft: 'auto', ...caption, fontFamily: MONO, color: GRAPHITE }}
                    >
                      → reel
                    </motion.span>
                  </motion.div>
                ))}
              </div>
            </BentoCard>

            {/* Control — hub & spoke */}
            <BentoCard icon={<Terminal width={18} height={18} style={{ color: INK }} />} eyebrowText="Control" title="Driven by your agent"
              bodyText="Codex, Cursor, or any MCP host — over MCP, one tool at a time.">
              <div style={{ background: FOG, borderRadius: 16, padding: '18px 14px 14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0 4px' }}>
                  {AGENTS.slice(0, 4).map((a, idx) => (
                    <motion.div
                      key={a.title}
                      variants={{
                        hover: { y: -4, scale: 1.1, transition: { type: "spring", stiffness: 300, damping: 10, delay: idx * 0.05 } }
                      }}
                      style={{ width: 34, height: 34, borderRadius: 9, background: SNOW, border: `1px solid ${SILVER_MIST}`, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 2px rgba(0,0,0,0.02)' }}
                    >
                      <BrandLogo src={a.src} fallback={a.fallback} alt={a.title} style={{ width: 18, height: 18 }} />
                    </motion.div>
                  ))}
                </div>
                <svg width="100%" height="56" viewBox="0 0 300 56" preserveAspectRatio="none" style={{ display: 'block', overflow: 'visible' }}>
                  {[26, 108, 192, 274].map((x, i) => (
                    <motion.path
                      key={i}
                      d={`M${x} 2 C ${x} 34, 150 22, 150 52`}
                      stroke="rgba(0,0,0,0.16)"
                      strokeWidth="1.4"
                      strokeDasharray="4 4"
                      fill="none"
                      variants={{
                        hover: {
                          stroke: AZURE,
                          strokeWidth: 2.0,
                          strokeDashoffset: -20,
                          transition: { repeat: Infinity, ease: "linear", duration: 1.5 }
                        }
                      }}
                    />
                  ))}
                </svg>
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  <motion.div
                    variants={{
                      hover: { scale: 1.1, backgroundColor: AZURE, transition: { type: "spring", stiffness: 200, damping: 12 } }
                    }}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderRadius: 999, background: INK, color: SNOW }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/spoooler-white.png" alt="spoooler" style={{ height: 11, width: 'auto' }} />
                    <span style={{ fontFamily: MONO, fontSize: 11, color: 'rgba(255,255,255,0.7)' }}>MCP</span>
                  </motion.div>
                </div>
              </div>
            </BentoCard>

            {/* Voice */}
            <BentoCard icon={<Microphone01 width={18} height={18} style={{ color: INK }} />} eyebrowText="Voice" title="Voiceover in your voice"
              bodyText="Built-in Kokoro voices, or clone yours with pocket-tts.">
              <div style={{ background: FOG, borderRadius: 16, padding: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                  <motion.button
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    onClick={() => setPlaying(!playing)}
                    style={{ width: 36, height: 36, borderRadius: 999, border: `1px solid ${SILVER_MIST}`, background: SNOW, color: INK, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 1px 2px rgba(0,0,0,0.02)' }}
                  >
                    {playing ? <PauseCircle width={18} height={18} style={{ color: INK }} /> : <Play width={15} height={15} style={{ color: INK }} />}
                  </motion.button>
                  <div style={{ flex: 1, height: 24, display: 'flex', alignItems: 'center', gap: 3 }}>
                    {Array.from({ length: 22 }).map((_, i) => {
                      const sinVal = Math.abs(Math.sin(i * 0.4)) * 75 + 15;
                      return (
                        <motion.span
                          key={i}
                          custom={i}
                          variants={{
                            initial: { height: playing ? `${Math.abs(Math.sin((i + audioProgress) * 0.7)) * 80 + 20}%` : '14%', backgroundColor: playing ? INK : SILVER_MIST },
                            hover: {
                              height: [`14%`, `${sinVal}%`, `14%`],
                              backgroundColor: INK,
                              transition: {
                                repeat: Infinity,
                                duration: 1.2,
                                delay: i * 0.035,
                                ease: "easeInOut",
                                type: "tween"
                              }
                            }
                          }}
                          animate={playing ? "hover" : "initial"}
                          style={{ flex: 1, borderRadius: 2, background: SILVER_MIST, height: '14%' }}
                        />
                      );
                    })}
                  </div>
                </div>
                <motion.span
                  variants={{
                    hover: { borderColor: INK, color: INK, transition: { duration: 0.2 } }
                  }}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 999, background: SNOW, border: `1px solid ${SILVER_MIST}`, color: GRAPHITE }}
                >
                  <Microphone01 width={13} height={13} />
                  <span style={{ ...caption, fontWeight: 500 }}>voice: you</span>
                </motion.span>
              </div>
            </BentoCard>

            {/* Captions */}
            <BentoCard icon={<Type01 width={18} height={18} style={{ color: INK }} />} eyebrowText="Captions" title="Timed to the word"
              bodyText="whisper.cpp lines each caption up to the exact moment it’s spoken.">
              <div style={{ background: FOG, borderRadius: 16, padding: 16 }}>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 28, marginBottom: 12 }}>
                  {Array.from({ length: 36 }).map((_, i) => (
                    <motion.span
                      key={i}
                      variants={{
                        hover: {
                          height: [`${Math.abs(Math.sin(i * 0.6)) * 100}%`, `${Math.abs(Math.sin(i * 0.6)) * 40 + 40}%`, `${Math.abs(Math.sin(i * 0.6)) * 100}%`],
                          backgroundColor: i % 6 === 2 ? AZURE : INK,
                          transition: { repeat: Infinity, duration: 1.5, delay: i * 0.02, type: "tween", ease: "easeInOut" }
                        }
                      }}
                      style={{ flex: 1, borderRadius: 1, background: i % 6 === 2 ? INK : SILVER_MIST, height: `${Math.abs(Math.sin(i * 0.6)) * 100}%` }}
                    />
                  ))}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {['this', 'is', 'where', 'it', 'lands'].map((w, i) => (
                    <motion.span
                      key={w}
                      variants={{
                        hover: {
                          scale: [1, 1.05, 1],
                          backgroundColor: i === 2 ? [INK, AZURE, INK] : [SNOW, INK, SNOW],
                          color: i === 2 ? [SNOW, SNOW, SNOW] : [GRAPHITE, SNOW, GRAPHITE],
                          borderColor: i === 2 ? [SILVER_MIST, AZURE, SILVER_MIST] : [SILVER_MIST, INK, SILVER_MIST],
                          transition: {
                            repeat: Infinity,
                            repeatDelay: 1.0,
                            duration: 0.6,
                            delay: i * 0.15,
                            type: "tween",
                            ease: "easeInOut"
                          }
                        }
                      }}
                      style={{ fontFamily: MONO, fontSize: 13, padding: '4px 9px', borderRadius: 7, background: i === 2 ? INK : SNOW, color: i === 2 ? SNOW : GRAPHITE, border: `1px solid ${SILVER_MIST}` }}
                    >
                      {w}
                    </motion.span>
                  ))}
                </div>
              </div>
            </BentoCard>

            {/* Render */}
            <BentoCard icon={<Film02 width={18} height={18} style={{ color: INK }} />} eyebrowText="Render" title="Rendered in Remotion"
              bodyText="Real templates output a post-ready MP4. 9:16, 1:1, or 16:9.">
              <div style={{ background: FOG, borderRadius: 16, padding: 16, display: 'flex', alignItems: 'center', gap: 16 }}>
                <motion.div
                  variants={{
                    hover: { scale: 1.08, rotate: -2, y: -2, transition: { type: "spring", stiffness: 300, damping: 15 } }
                  }}
                  style={{ width: 62, height: 110, borderRadius: 12, overflow: 'hidden', background: '#111', position: 'relative', flexShrink: 0, boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={REELS[3].image} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                </motion.div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {['9:16', '1:1', '16:9'].map((id) => {
                    const on = aspect === id;
                    return (
                      <motion.button
                        key={id}
                        whileHover={{ scale: 1.04, x: 2 }}
                        whileTap={{ scale: 0.96 }}
                        onClick={() => setAspect(id)}
                        style={{ padding: '7px 14px', borderRadius: 999, border: on ? `1px solid ${INK}` : `1px solid ${SILVER_MIST}`, background: on ? INK : SNOW, color: on ? SNOW : GRAPHITE, fontFamily: MONO, fontSize: 12, cursor: 'pointer', textAlign: 'left', transition: 'border-color 0.1s ease, background-color 0.1s ease' }}
                      >
                        {id}
                      </motion.button>
                    );
                  })}
                </div>
              </div>
            </BentoCard>

            {/* Privacy — provider toggle list */}
            <BentoCard icon={<Lock01 width={18} height={18} style={{ color: INK }} />} eyebrowText="Privacy" title="Stays on your Mac"
              bodyText="Your keys, clips, and voices never leave the machine.">
              <div style={{ background: FOG, borderRadius: 16, padding: '4px 14px' }}>
                {['Pexels', 'Unsplash', 'Gemini', 'Kokoro', 'whisper.cpp'].map((name, i, arr) => (
                  <div key={name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 0', borderBottom: i < arr.length - 1 ? `1px solid ${SILVER_MIST}` : 'none' }}>
                    <span style={{ ...bodySm, color: INK, fontWeight: 500 }}>{name}</span>
                    <motion.div
                      variants={{
                        hover: {
                          backgroundColor: [INK, "#e8e8ed", INK],
                          transition: { repeat: Infinity, repeatDelay: 2.0, duration: 0.6, delay: i * 0.12, type: "tween", ease: "easeInOut" }
                        }
                      }}
                      style={{ width: 34, height: 20, borderRadius: 999, background: INK, position: 'relative', flexShrink: 0 }}
                    >
                      <motion.span
                        variants={{
                          hover: {
                            x: [0, -14, 0],
                            transition: { repeat: Infinity, repeatDelay: 2.0, duration: 0.6, delay: i * 0.12, type: "tween", ease: "easeInOut" }
                          }
                        }}
                        style={{ position: 'absolute', top: 2, right: 2, width: 16, height: 16, borderRadius: 999, background: SNOW }}
                      />
                    </motion.div>
                  </div>
                ))}
              </div>
            </BentoCard>

          </div>
        </div>
      </section>

      {/* ── MADE TO SHIP — white reel gallery with side fades ── */}
      <section style={{ background: SNOW, padding: '120px 0', textAlign: 'center', overflow: 'hidden' }}>
        <div style={{ padding: '0 22px', marginBottom: 56 }}>
          <h2 style={{ ...headingLg, marginBottom: 16 }}>
            <ShinyText text="Made to ship." baseColor={INK} shineColor="#c7c7cc" speed={5} />
          </h2>
          <p style={{ ...subheading, color: GRAPHITE, maxWidth: 520, margin: '0 auto' }}>
            From a single line to a post-ready Reel, on your machine, in one run.
          </p>
        </div>
        <div style={{ position: 'relative' }}>
          <div style={{ display: 'flex', gap: 20, justifyContent: 'center', alignItems: 'center' }}>
            {REELS.map((r, i) => (
              <ReelFrame key={i} image={r.image} caption={r.caption} width={i === 3 ? 264 : 208} badge={false} />
            ))}
          </div>
          <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: '20%', background: `linear-gradient(90deg, ${SNOW} 10%, transparent)`, pointerEvents: 'none' }} />
          <div style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width: '20%', background: `linear-gradient(270deg, ${SNOW} 10%, transparent)`, pointerEvents: 'none' }} />
        </div>
      </section>

      {/* ── UNDER THE HOOD (Revamped Specs, MCP tools, and SKILL.md) ── */}
            {/* ── UNDER THE HOOD (Revamped Specs, MCP tools, and SKILL.md) ── */}
                  {mounted && (
        <>
          {/* ── TECHNICAL SPECIFICATIONS (Gallery White) ── */}
      <section id="specs" style={{ background: FOG, padding: '120px 22px', borderTop: `1px solid ${SILVER_MIST}` }}>
        <div style={{ maxWidth: 840, margin: '0 auto' }}>
          <AnimatedContent>
            <div style={{ textAlign: 'center', marginBottom: 56 }}>
              <span style={{ ...caption, textTransform: 'uppercase', letterSpacing: '0.08em', color: GRAPHITE, fontWeight: 600 }}>Technical Specifications</span>
              <h2 style={{ ...heading, marginTop: 8, marginBottom: 16 }}>Engine Specs</h2>
            </div>
            
            <div style={{ background: SNOW, borderRadius: 24, border: `1px solid ${SILVER_MIST}`, overflow: 'hidden', boxShadow: '0 4px 20px rgba(0,0,0,0.02)' }}>
              {SPECS.map((spec, i, arr) => (
                <div 
                  key={spec.label} 
                  style={{ 
                    display: 'flex', 
                    flexDirection: isMobile ? 'column' : 'row',
                    gap: isMobile ? 4 : 32,
                    padding: '20px 24px', 
                    borderBottom: i < arr.length - 1 ? `1px solid ${SILVER_MIST}` : 'none',
                    alignItems: isMobile ? 'flex-start' : 'center',
                    background: i % 2 === 0 ? 'rgba(245, 245, 247, 0.3)' : SNOW
                  }}
                >
                  <span style={{ ...bodySm, fontWeight: 600, color: INK, width: isMobile ? 'auto' : 140, flexShrink: 0 }}>
                    {spec.label}
                  </span>
                  <span style={{ ...bodySm, color: GRAPHITE, flex: 1 }}>
                    {spec.value}
                  </span>
                </div>
              ))}
            </div>
          </AnimatedContent>
        </div>
      </section>

      {/* ── DEVELOPER INTEGRATION & MCP (Dark Mode, Operator UI - DESIGN.md) ── */}
            {/* ── DEVELOPER INTEGRATION & MCP (Dark Mode, Operator UI - DESIGN.md) ── */}
      <section id="developer" style={{ background: DARK_BG, color: DARK_TEXT, padding: '120px 22px', borderTop: `1px solid ${DARK_BORDER}` }}>
        <div style={{ maxWidth: 1120, margin: '0 auto' }}>
          <AnimatedContent>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', marginBottom: 56 }}>
              <div style={{ width: 48, height: 48, borderRadius: 12, background: 'rgba(255,255,255,0.06)', border: `1px solid ${DARK_BORDER}`, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
                <Terminal width={24} height={24} style={{ color: AZURE }} />
              </div>
              <h2 style={{ ...headingLg, color: DARK_TEXT, marginBottom: 12 }}>Developer Suite</h2>
              <p style={{ ...subheading, color: DARK_MUTED, maxWidth: 540 }}>
                Direct the video compilation engine locally. Connect your coding assistant via MCP and copy the system prompt.
              </p>
            </div>

            {/* Row 1: Configurations */}
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 32, alignItems: 'start', marginBottom: 32 }}>
              
              {/* mcp.json Card */}
              <div style={{ background: DARK_SURFACE, borderRadius: 24, border: `1px solid ${DARK_BORDER}`, padding: 24 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                  <span style={{ width: 28, height: 28, borderRadius: 7, background: 'rgba(255,255,255,0.04)', border: `1px solid ${DARK_BORDER}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Terminal width={16} height={16} style={{ color: AZURE }} /></span>
                  <h3 style={{ ...headingSm, fontSize: 18, color: DARK_TEXT, margin: 0 }}>Configure mcp.json</h3>
                </div>

                <p style={{ ...bodySm, color: DARK_MUTED, marginBottom: 20 }}>
                  Select your coding assistant to see the integration steps and configuration block:
                </p>

                {/* Tabs */}
                <div style={{ display: 'flex', gap: 8, background: 'rgba(0,0,0,0.2)', padding: 4, borderRadius: 10, border: `1px solid ${DARK_BORDER}`, marginBottom: 16 }}>
                  {(['cursor', 'windsurf'] as const).map((tab) => {
                    const active = activeMcpTab === tab;
                    return (
                      <button
                        key={tab}
                        onClick={() => setActiveMcpTab(tab)}
                        style={{
                          flex: 1,
                          padding: '6px 12px',
                          borderRadius: 8,
                          border: 'none',
                          background: active ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
                          color: active ? DARK_TEXT : DARK_MUTED,
                          fontSize: 13,
                          fontWeight: active ? 600 : 500,
                          cursor: 'pointer',
                          transition: 'all 0.1s ease',
                          textTransform: 'capitalize'
                        }}
                      >
                        {tab}
                      </button>
                    );
                  })}
                </div>

                {/* Tab-specific instructions */}
                <div style={{ background: 'rgba(0,0,0,0.15)', border: `1px solid ${DARK_BORDER}`, borderRadius: 12, padding: '12px 16px', marginBottom: 16 }}>
                  {activeMcpTab === 'cursor' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <span style={{ ...bodySm, fontWeight: 600, color: DARK_TEXT }}>Cursor UI Setup:</span>
                      <ul style={{ margin: 0, paddingLeft: 18, ...bodySm, color: DARK_MUTED, display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <li>Go to <strong>Settings &gt; Features &gt; MCP</strong></li>
                        <li>Click <strong>+ Add New MCP Server</strong></li>
                        <li>Name: <code style={{ fontFamily: MONO, color: AZURE }}>instagram-reel-tool</code></li>
                        <li>Type: <code style={{ fontFamily: MONO }}>command</code></li>
                        <li>Command: <code style={{ fontFamily: MONO, fontSize: 11, background: '#1c1c1f', border: `1px solid ${DARK_BORDER}`, padding: '2px 4px', borderRadius: 4, color: DARK_TEXT }}>node &quot;/absolute/path/to/instagram-reel-tool/mcp/server.mjs&quot;</code></li>
                      </ul>
                    </div>
                  )}
                  {activeMcpTab === 'windsurf' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <span style={{ ...bodySm, fontWeight: 600, color: DARK_TEXT }}>Windsurf Configuration:</span>
                      <p style={{ margin: 0, ...bodySm, color: DARK_MUTED }}>
                        Copy the JSON configuration below and insert it into your global windsurf config file at the path shown below.
                      </p>
                    </div>
                  )}
                </div>

                {/* File Path info */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(0,0,0,0.15)', border: `1px solid ${DARK_BORDER}`, borderRadius: 8, padding: '8px 12px', marginBottom: 12 }}>
                  <span style={{ fontSize: 11, fontFamily: MONO, color: DARK_MUTED }}>
                    {activeMcpTab === 'cursor' && 'Config Location: Cursor settings UI (MCP tab) or settings.json'}
                    {activeMcpTab === 'windsurf' && 'Config Location: ~/.codeium/windsurf/mcp_config.json'}
                  </span>
                </div>

                {/* Code Block Container */}
                <div style={{ position: 'relative', background: '#000000', borderRadius: 12, border: `1px solid ${DARK_BORDER}`, overflow: 'hidden' }}>
                  {/* Window header controls */}
                  <div style={{ display: 'flex', gap: 6, padding: '10px 14px', borderBottom: `1px solid ${DARK_BORDER}`, background: '#121214' }}>
                    <span style={{ width: 8, height: 8, borderRadius: 99, background: '#ef4444' }} />
                    <span style={{ width: 8, height: 8, borderRadius: 99, background: '#eab308' }} />
                    <span style={{ width: 8, height: 8, borderRadius: 99, background: '#22c55e' }} />
                  </div>
                  
                  <pre style={{ margin: 0, padding: 14, overflowX: 'auto', maxHeight: 200, fontSize: 12, fontFamily: MONO, color: '#f4f4f5', lineHeight: 1.5 }}>
                    <code>{MCP_CONFIG_JSON}</code>
                  </pre>

                  {/* Copy Button */}
                  <button
                    onClick={() => handleCopyMcp(MCP_CONFIG_JSON)}
                    style={{
                      position: 'absolute',
                      top: 36,
                      right: 12,
                      width: 32,
                      height: 32,
                      borderRadius: 6,
                      border: `1px solid ${DARK_BORDER}`,
                      background: '#121214',
                      color: DARK_MUTED,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      transition: 'all 0.1s ease',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = '#fff')}
                    onMouseLeave={(e) => (e.currentTarget.style.color = DARK_MUTED)}
                  >
                    {copiedMcp ? <Check size={14} style={{ color: '#22c55e' }} /> : <Copy size={14} />}
                  </button>
                </div>
              </div>

              {/* SKILL.md Card */}
              <div style={{ background: DARK_SURFACE, borderRadius: 24, border: `1px solid ${DARK_BORDER}`, padding: 24 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                  <span style={{ width: 28, height: 28, borderRadius: 7, background: 'rgba(255,255,255,0.04)', border: `1px solid ${DARK_BORDER}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Download01 width={16} height={16} style={{ color: AZURE }} /></span>
                  <h3 style={{ ...headingSm, fontSize: 18, color: DARK_TEXT, margin: 0 }}>Dedicated SKILL.md Prompt</h3>
                </div>

                <p style={{ ...bodySm, color: DARK_MUTED, marginBottom: 20 }}>
                  Copy this system skill prompt into your workspace as <span style={{ fontFamily: MONO, fontSize: 13, background: '#1c1c1f', padding: '2px 6px', borderRadius: 4, color: DARK_TEXT }}>SKILL.md</span>. This turns your AI coding assistant into a viral video editor + producer.
                </p>

                <div style={{ position: 'relative', background: '#000000', border: `1px solid ${DARK_BORDER}`, borderRadius: 12, overflow: 'hidden' }}>
                  {/* Window Header */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 14px', borderBottom: `1px solid ${DARK_BORDER}`, background: '#121214' }}>
                    <span style={{ fontSize: 11, fontFamily: MONO, color: DARK_MUTED }}>SKILL.md</span>
                    <span style={{ fontSize: 10, background: 'rgba(255,255,255,0.04)', color: DARK_MUTED, padding: '2px 6px', borderRadius: 4, fontFamily: MONO }}>Markdown</span>
                  </div>

                  <pre style={{ margin: 0, padding: 14, overflowX: 'auto', maxHeight: 280, fontSize: 12, fontFamily: MONO, color: '#f4f4f5', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                    <code>{SKILL_MD_TEXT}</code>
                  </pre>

                  {/* Copy Button */}
                  <button
                    onClick={() => handleCopySkill(SKILL_MD_TEXT)}
                    style={{
                      position: 'absolute',
                      top: 36,
                      right: 12,
                      width: 32,
                      height: 32,
                      borderRadius: 6,
                      border: `1px solid ${DARK_BORDER}`,
                      background: '#121214',
                      color: DARK_MUTED,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      transition: 'all 0.1s ease',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = '#fff')}
                    onMouseLeave={(e) => (e.currentTarget.style.color = DARK_MUTED)}
                  >
                    {copiedSkill ? <Check size={14} style={{ color: '#22c55e' }} /> : <Copy size={14} />}
                  </button>
                </div>
              </div>

            </div>

            {/* Row 2: Full-Width MCP Reference Console */}
            <div style={{ background: DARK_SURFACE, borderRadius: 24, border: `1px solid ${DARK_BORDER}`, padding: isMobile ? 20 : 32, boxShadow: '0 10px 40px rgba(0,0,0,0.15)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                <span style={{ width: 28, height: 28, borderRadius: 7, background: 'rgba(255,255,255,0.04)', border: `1px solid ${DARK_BORDER}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><CpuChip01 width={16} height={16} style={{ color: AZURE }} /></span>
                <h3 style={{ ...headingSm, fontSize: 20, color: DARK_TEXT, margin: 0 }}>MCP Function Reference Console</h3>
              </div>

              <p style={{ ...bodySm, color: DARK_MUTED, marginBottom: 28, maxWidth: '80ch' }}>
                Explore the local model context protocol functions that your AI assistant calls. Select a pipeline step or click on a function in the explorer to view detailed parameter schemas and returns.
              </p>

              {/* Pipeline Stepper (Horizontal timeline) */}
              <div style={{ background: 'rgba(0,0,0,0.15)', borderRadius: 16, padding: '16px 20px', marginBottom: 32, border: `1px solid ${DARK_BORDER}` }}>
                <div style={{ ...caption, fontWeight: 600, color: DARK_MUTED, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12, textAlign: 'center' }}>
                  Reel Production Pipeline
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'relative', overflowX: 'auto', padding: '10px 0' }}>
                  {/* Connection line */}
                  <div style={{ position: 'absolute', left: '8%', right: '8%', top: '25px', height: 2, background: DARK_BORDER, zIndex: 0 }} />
                  
                  {/* Active Connection line */}
                  {activeTool !== null && (
                    <div 
                      style={{ 
                        position: 'absolute', 
                        left: '8%', 
                        width: `${Math.min(100, Math.max(0, (PIPELINE_STEPS.findIndex(s => s.index === activeTool) / (PIPELINE_STEPS.length - 1)) * 84))}%`, 
                        top: '25px', 
                        height: 2, 
                        background: AZURE, 
                        zIndex: 0,
                        transition: 'width 0.3s ease'
                      }} 
                    />
                  )}

                  {PIPELINE_STEPS.map((step, sIdx) => {
                    const isSelected = activeTool === step.index;
                    const isPassed = activeTool !== null && PIPELINE_STEPS.findIndex(s => s.index === activeTool) >= sIdx;
                    
                    return (
                      <div 
                        key={step.name} 
                        onClick={() => setActiveTool(step.index)}
                        style={{ 
                          display: 'flex', 
                          flexDirection: 'column', 
                          alignItems: 'center', 
                          gap: 6, 
                          flex: 1, 
                          cursor: 'pointer', 
                          zIndex: 1,
                          minWidth: 60
                        }}
                      >
                        <motion.div
                          whileHover={{ scale: 1.1 }}
                          whileTap={{ scale: 0.95 }}
                          style={{
                            width: 32,
                            height: 32,
                            borderRadius: 999,
                            background: isSelected ? AZURE : (isPassed ? 'rgba(0, 113, 227, 0.1)' : '#1c1c1f'),
                            border: isSelected ? `2px solid ${AZURE}` : `2px solid ${isPassed ? AZURE : DARK_BORDER}`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: isSelected ? SNOW : (isPassed ? AZURE : DARK_MUTED),
                            fontSize: 11,
                            fontWeight: 700,
                            transition: 'all 0.2s ease',
                            boxShadow: isSelected ? '0 0 12px rgba(0, 113, 227, 0.3)' : 'none'
                          }}
                        >
                          {sIdx + 1}
                        </motion.div>
                        <span style={{ 
                          fontFamily: FONT_TEXT, 
                          fontSize: 10, 
                          fontWeight: isSelected ? 600 : 500, 
                          color: isSelected ? AZURE : (isPassed ? DARK_TEXT : DARK_MUTED),
                          textAlign: 'center',
                          whiteSpace: 'nowrap'
                        }}>
                          {step.name}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Side-by-Side Split Console */}
              <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 24, minHeight: 480, alignItems: 'stretch' }}>
                
                {/* Left side: Tool List menu (Sidebar) */}
                <div style={{ width: isMobile ? '100%' : '30%', borderRight: isMobile ? 'none' : `1px solid ${DARK_BORDER}`, paddingRight: isMobile ? 0 : 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div style={{ ...caption, textTransform: 'uppercase', color: DARK_MUTED, fontWeight: 600, letterSpacing: '0.05em' }}>Functions List</div>
                  
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, overflowY: 'auto', maxHeight: 450, paddingRight: 4 }}>
                    {MCP_TOOLS.map((tool, idx) => {
                      const isSelected = activeTool === idx;
                      const isPipelineStep = PIPELINE_STEPS.some(s => s.index === idx);
                      return (
                        <div
                          key={tool.name}
                          onClick={() => setActiveTool(idx)}
                          style={{
                            padding: '10px 14px',
                            borderRadius: 10,
                            background: isSelected ? 'rgba(0, 113, 227, 0.08)' : 'transparent',
                            border: isSelected ? `1px solid ${AZURE}` : '1px solid transparent',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            transition: 'all 0.15s ease'
                          }}
                          onMouseEnter={(e) => {
                            if (!isSelected) e.currentTarget.style.background = 'rgba(255,255,255,0.02)';
                          }}
                          onMouseLeave={(e) => {
                            if (!isSelected) e.currentTarget.style.background = 'transparent';
                          }}
                        >
                          <span style={{ fontFamily: MONO, fontSize: 13, fontWeight: isSelected ? 600 : 500, color: isSelected ? AZURE : DARK_TEXT }}>
                            {tool.name}
                          </span>
                          {isPipelineStep && (
                            <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 4, background: 'rgba(0, 113, 227, 0.12)', color: AZURE, fontWeight: 600 }}>
                              Core
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Right side: Tool Details Console */}
                <div style={{ width: isMobile ? '100%' : '70%', background: '#050507', border: `1px solid ${DARK_BORDER}`, borderRadius: 16, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                  {activeTool !== null ? (
                    (() => {
                      const tool = MCP_TOOLS[activeTool];
                      const isPipelineStep = PIPELINE_STEPS.some(s => s.index === activeTool);
                      return (
                        <>
                          {/* Console Header */}
                          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, borderBottom: `1px solid ${DARK_BORDER}`, padding: '14px 20px', background: 'rgba(255,255,255,0.01)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ fontFamily: MONO, fontSize: 16, fontWeight: 700, color: AZURE }}>{tool.name}</span>
                              {tool.category && (
                                <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 999, background: 'rgba(255,255,255,0.06)', border: `1px solid ${DARK_BORDER}`, color: DARK_MUTED, fontWeight: 600 }}>
                                  {tool.category}
                                </span>
                              )}
                              {isPipelineStep && (
                                <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 999, background: 'rgba(0, 113, 227, 0.15)', color: AZURE, fontWeight: 600 }}>
                                  Pipeline Tool
                                </span>
                              )}
                            </div>
                            <span style={{ fontSize: 11, color: DARK_MUTED, fontFamily: MONO }}>mcp/server.mjs</span>
                          </div>

                          {/* Console Body */}
                          <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 20, flex: 1, overflowY: 'auto', maxHeight: 420 }}>
                            
                            {/* Description */}
                            <div>
                              <span style={{ ...caption, fontWeight: 600, color: DARK_MUTED, display: 'block', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Description</span>
                              <p style={{ ...bodySm, color: DARK_TEXT, margin: 0, lineHeight: 1.5 }}>{tool.desc}</p>
                            </div>

                            {/* Parameters Table */}
                            <div>
                              <span style={{ ...caption, fontWeight: 600, color: DARK_MUTED, display: 'block', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Parameters Schema</span>
                              {tool.params && tool.params.length > 0 ? (
                                <div style={{ border: `1px solid ${DARK_BORDER}`, borderRadius: 10, overflow: 'hidden' }}>
                                  <div style={{ display: 'flex', background: 'rgba(255,255,255,0.02)', borderBottom: `1px solid ${DARK_BORDER}`, padding: '8px 12px', ...caption, fontWeight: 600, color: DARK_MUTED }}>
                                    <div style={{ width: '25%' }}>Parameter</div>
                                    <div style={{ width: '20%' }}>Type</div>
                                    <div style={{ width: '15%' }}>Required</div>
                                    <div style={{ width: '40%' }}>Description</div>
                                  </div>
                                  {tool.params.map((param) => (
                                    <div key={param.name} style={{ display: 'flex', borderBottom: `1px solid ${DARK_BORDER}`, padding: '10px 12px', ...bodySm, color: DARK_TEXT, alignItems: 'center' }}>
                                      <div style={{ width: '25%', fontFamily: MONO, fontWeight: 600, color: AZURE }}>{param.name}</div>
                                      <div style={{ width: '20%', fontFamily: MONO, fontSize: 12 }}>
                                        <span style={{ 
                                          padding: '2px 6px', 
                                          borderRadius: 4, 
                                          background: param.type === 'string' ? 'rgba(56, 189, 248, 0.1)' : (param.type === 'boolean' ? 'rgba(192, 132, 252, 0.1)' : 'rgba(251, 146, 60, 0.1)'), 
                                          color: param.type === 'string' ? '#38bdf8' : (param.type === 'boolean' ? '#c084fc' : '#fb923c') 
                                        }}>
                                          {param.type}
                                        </span>
                                      </div>
                                      <div style={{ width: '15%', ...caption }}>
                                        {param.required ? (
                                          <span style={{ color: '#f43f5e', fontWeight: 600 }}>Yes</span>
                                        ) : (
                                          <span style={{ color: DARK_MUTED }}>No</span>
                                        )}
                                      </div>
                                      <div style={{ width: '40%', fontSize: 13, color: DARK_MUTED, lineHeight: 1.4 }}>{param.desc}</div>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <div style={{ border: `1px solid ${DARK_BORDER}`, borderRadius: 10, padding: '14px 16px', background: 'rgba(0,0,0,0.1)', color: DARK_MUTED, ...bodySm }}>
                                  No arguments required for this function.
                                </div>
                              )}
                            </div>

                            {/* Arguments and Returns Monospace Blocks */}
                            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 16 }}>
                              <div>
                                <span style={{ ...caption, fontWeight: 600, color: DARK_MUTED, display: 'block', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Argument Format</span>
                                <pre style={{ margin: 0, padding: 12, background: '#000000', border: `1px solid ${DARK_BORDER}`, borderRadius: 10, overflowX: 'auto', fontSize: 11, fontFamily: MONO, color: '#f43f5e', lineHeight: 1.4 }}>
                                  <code>{tool.args}</code>
                                </pre>
                              </div>
                              <div>
                                <span style={{ ...caption, fontWeight: 600, color: DARK_MUTED, display: 'block', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Returns</span>
                                <pre style={{ margin: 0, padding: 12, background: '#000000', border: `1px solid ${DARK_BORDER}`, borderRadius: 10, overflowX: 'auto', fontSize: 11, fontFamily: MONO, color: '#34d399', lineHeight: 1.4 }}>
                                  <code>{tool.returns}</code>
                                </pre>
                              </div>
                            </div>

                          </div>
                        </>
                      );
                    })()
                  ) : (
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 40, color: DARK_MUTED }}>
                      <CpuChip01 width={32} height={32} />
                      <span style={{ ...bodySm }}>Select a function from the list to inspect it.</span>
                    </div>
                  )}
                </div>

              </div>
            </div>
          </AnimatedContent>
        </div>
      </section>
        </>
      )}

      {/* ── CLOSING CTA ── */}
      <section style={{ background: SNOW, padding: '120px 22px', textAlign: 'center' }}>
        <AnimatedContent>
          <h2 style={{ ...heading, marginBottom: 16 }}>Make your next Reel without opening an editor.</h2>
          <p style={{ ...body, maxWidth: 440, margin: '0 auto 36px' }}>
            Download the Mac app, connect your agent, and point it at your first source.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
            <BuyPill><Download01 width={17} height={17} style={{ color: SNOW }} /> Download for macOS</BuyPill>
            <span style={{ ...caption }}>macOS 12 or later. Bring your own API keys.</span>
          </div>
        </AnimatedContent>
      </section>

      {/* ── FOOTER ── */}
      <footer style={{ background: FOG, borderTop: `1px solid ${SILVER_MIST}`, padding: '32px 22px' }}>
        <div style={{ maxWidth: 1024, margin: '0 auto', display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ ...caption }}>
            Copyright © 2026 Spoooler. Built locally, rendered with Remotion.{' '}
            <a href="https://brandfetch.com" target="_blank" rel="noopener noreferrer" style={{ color: GRAPHITE, textDecoration: 'none' }}>Logos by Brandfetch</a>.
          </span>
          <div style={{ display: 'flex', gap: 24 }}>
            <a href="#" style={{ ...caption, color: COBALT, textDecoration: 'none' }}>Source</a>
            <a href="#" style={{ ...caption, color: COBALT, textDecoration: 'none' }}>MCP tools</a>
            <a href="#" style={{ ...caption, color: COBALT, textDecoration: 'none' }}>Docs</a>
            <a href="#" style={{ ...caption, color: COBALT, textDecoration: 'none' }}>Privacy</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

// ── helpers ──

// Spoooler wordmark (official). Black on light surfaces, white on dark.
function Logo({ height = 24, dark = false }: { height?: number; dark?: boolean }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={dark ? '/spoooler-white.png' : '/spoooler-black.png'}
      alt="Spoooler"
      style={{ height, width: 'auto', display: 'block' }}
    />
  );
}

// Unbody-style bento card (white): icon chip + title + muted desc + visual at bottom.
// Built on ReactBits SpotlightCard for the subtle cursor-follow highlight.
function BentoCard({ icon, eyebrowText, title, bodyText, children }: {
  icon: React.ReactNode; eyebrowText: string; title: string; bodyText: string; children: React.ReactNode;
}) {
  return (
    <motion.div
      whileHover="hover"
      initial="initial"
      whileTap={{ scale: 0.98 }}
      variants={{
        hover: {
          y: -6,
          transition: { type: "spring", stiffness: 300, damping: 20 }
        }
      }}
      style={{ display: 'flex', flexDirection: 'column', height: '100%' }}
    >
      <SpotlightCard
        spotlightColor="rgba(29,29,31,0.05)"
        style={{
          background: SNOW, borderRadius: 24, border: `1px solid ${SILVER_MIST}`,
          boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 12px 32px rgba(0,0,0,0.03)',
          padding: 24, minHeight: 312,
          display: 'flex', flexDirection: 'column', height: '100%',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <span style={{ width: 32, height: 32, borderRadius: 9, background: FOG, border: `1px solid ${SILVER_MIST}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{icon}</span>
          <span style={{ ...caption, color: GRAPHITE, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{eyebrowText}</span>
        </div>
        <h3 style={{ ...headingSm, fontSize: 21, color: INK, marginBottom: 6 }}>{title}</h3>
        <p style={{ ...bodySm, marginBottom: 20, maxWidth: '34ch' }}>{bodyText}</p>
        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'center' }}>{children}</div>
      </SpotlightCard>
    </motion.div>
  );
}
