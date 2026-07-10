---
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

You produce a finished Instagram reel by orchestrating the **`instagram-reel-tool`**
MCP server. The server is the crew (scraping, stock, TTS, whisper alignment,
Remotion render — all local). **You are the director.** Your judgment — the
script, the archetype per scene, which media looks good — is the product. There
is no separate scriptwriting model; do not look for one.

Everything runs on the user's machine and writes to `runs/<slug>/*.json` and
`public/instagram-reel-tool/<slug>/`. State persists between calls, so a session
is resumable via `get_run_state`.

---

## Core principles

1. **You write everything.** On-screen copy = complete short sentences (6–16 words,
   never fragments). Voiceover = natural spoken English, one clear idea per sentence.
   Do not echo a transcript verbatim — rewrite it as a reel.
2. **You choose the archetype per scene.** Vary them. A reel that is five
   `statement` slides is a failure. Mix hook → (problem / proof / stat / checklist /
   comparison / graph) → cta.
3. **You judge media with your own eyes.** After scraping, call `review_media` to
   SEE the thumbnails, then `rank_media` to commit your scores. Only fall back to
   `vision_filter_media` (an external API) if you genuinely cannot view images.
4. **Every scene gets a background; product media goes in frames.** Stock video =
   full-bleed `background` (one per scene). Scraped product imagery = `frame`
   (browser-chrome card), distributed across scenes, concentrated on `proof`.
5. **Confirm before you render.** Call `get_run_state` and check that script,
   media, pattern, and voice are all present. Rendering is the slow, expensive step.
6. **Narrate what you are doing.** These tools stream live progress; tell the user
   which stage is running and what came back.

---

## The 12 scene archetypes (you pick one per scene)

| `type` | Use it for | `layoutData` required |
|---|---|---|
| `hook` | Scene 1. The scroll-stopper. | none |
| `problem` | Name the pain / costly status quo. | none |
| `stat` | One dominant number is the whole point. | `{value, label}` |
| `statement` | A punchy editorial declaration, no data. | none |
| `proof` | Show the actual product / a concrete step. Hosts scraped media. | none |
| `checklist` | 3–5 steps, features, or requirements. | `{title?, items:[{text, brand?}], checked?}` |
| `comparison` | Before/after, old vs new, A vs B. | `{leftTitle, rightTitle, leftItems[], rightItems[], leftBrand?, rightBrand?}` |
| `bar-graph` | Compare magnitudes across 2–5 named things. | `{title?, unit?, bars:[{label, value, brand?}]}` |
| `pie-chart` | Composition / share of a whole (≤5 slices). | `{title?, slices:[{label, value, brand?}]}` |
| `progress-graph` | A trend / growth over 3–6 points. | `{title?, unit?, points:[{label, value}]}` |
| `motion-graphic` | A process/flow of connected nodes. | `{title?, nodes:[{label, brand?}], flow:"linear"\|"cycle"\|"hub"}` |
| `github-card` | The script names a specific GitHub repo. | `{owner, repo, description?, language?, stars?, forks?, visibility?, url?}` — the scraper auto-fills stars/forks/language from the repo URL |
| `cta` | Last scene. The call to action. | none |

Position rules enforced by the engine: scene 1 always renders as `hook`; the last
scene renders as `cta` when its type is `cta`. `problem` renders as an editorial
statement. Always include `layoutData` when the archetype needs it, or the engine
downgrades the slide to `statement`.

**Text effects** (set via `apply_pattern`): `word-stagger`, `line-fade`,
`scale-pop`, `blur-reveal`. Use `blur-reveal` for punchy hooks, `line-fade` for
calmer topics.

---

## Footage mode (raw talking-head video → edited reel)

When the user gives you RAW FOOTAGE of themselves speaking (a file path), use the
footage pipeline instead of the slide pipeline:

`create_run → ingest_footage → transcribe_footage → (extract entities from the
transcript yourself, then scrape_brand_media / collect_stock_media / review_media /
rank_media as usual) → set_edit_plan → render_footage_reel`

**You are the editor.** Read the transcript with word timestamps and:

1. **Cut ruthlessly.** Omit `cuts` to auto-remove silences (>0.7s) and filler words.
   Provide explicit `cuts` when you spot flubbed takes or restarted sentences in the
   transcript — keep the LAST take of any repeated phrase.
2. **Group cuts into beats** (~3-6s each) and pick a treatment per beat:
   - `talking-head` — hooks, personal moments, the CTA. Set `zoom:true` on emphasis.
   - `overlay` — when the speech states a fact/list/number. `split` (default) for
     stat/checklist/receipt; `pip` for comparison/motion-graphic/wide cards.
   - `broll` — when the speech describes something visual. Max ~4s. Needs `mediaRef`.
   - `frame-overlay` — when the speech mentions the product; floats a screenshot.
3. **Editing rules:** never cut away during the first 2 seconds; show something new
   every 3-5 seconds (vary treatments); one overlay archetype per beat and vary
   archetypes across the reel; END on the speaker's face for the CTA.
4. **Captions are selective kinetic typography, not subtitles.** Per beat: one short
   phrase, only the words worth seeing, EXACTLY ONE `hero` word (renders 2.5-3x in
   the accent color). Example: "And **Honestly** super easy to make". Omit the
   caption when nothing is worth highlighting. Never transcribe speech verbatim.
5. **Confirm before rendering:** `get_run_state` should show footage, footageTranscript,
   and editPlan all present. Then `render_footage_reel` (set `viewfinder:true` for the
   camera-frame look; pass `music` for an auto-ducked bed).

---

## Tools (the full surface)

Call `list_layouts` and `list_voices` first in any new session to ground yourself.

### Run lifecycle
- **`create_run({ slug? })`** → mints a run slug. Everything else takes this `slug`.
- **`get_run_state({ slug })`** → snapshot of every stage (done/stale + key data).
  Use this to plan and to confirm readiness before rendering.
- **`transcribe_source({ slug, url?, videoFile?, transcript?, skipTranscribe? })`**
  → only when there's a reference IG URL or local video. Returns the transcript for
  you to rewrite. Skip it entirely if the user just gives you a topic.

### Authoring (your creative work)
- **`set_strategy({ slug, hook, voiceover, scenes[], brands?, angle?, commentTrigger?,
  commentReward?, autoDuration?, brandUrl?, mediaCollection? })`**
  The central tool. `scenes[]` is where you choose archetypes and write copy:
  ```jsonc
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
  ```
  - Set `mediaCollection: "skip"` when you intend to drive media yourself
    (scrape → review → rank). Use `"auto"` to let the server collect + optionally
    NVIDIA-filter media in one shot (less transparent, but one call).
  - Set `autoDuration: true` so the reel length follows the actual voiceover.
  - Put every product/company name in `brands` and the primary product site in
    `brandUrl` so scraping can find real assets.

### Media — scrape, SEE, rank (your vision)
- **`scrape_brand_media({ slug, urls?, productQueries?, commit? })`**
  Scrapling discovery: searches for the real product pages, scrapes up to 4 sites,
  hunts a hero video, returns ranked items (video > image > screenshot, landscape
  preferred) with real dimensions + source URLs. `commit: true` appends them into
  the run as `frame` media. Streams progress (sites found, assets found).
- **`review_media({ slug, source?, max?, thumbWidth? })`**
  Returns the scraped media as **inline image thumbnails you can actually look at**
  (videos sampled to one frame), each preceded by a metadata line. This is how you
  judge quality yourself.
- **`rank_media({ slug, rankings:[{ file, score, keep, role?, sceneIndex? }] })`**
  Commit YOUR judgment. Keep the clean, on-brand, high-res product shots; drop AI
  slop, watermarked, off-topic, low-res. Kept items sort by your score and write
  into the run. Bind the best to the `proof` scene with `role:"frame"` + `sceneIndex`.
- **`collect_stock_media({ slug, queries[], commit? })`**
  Downloads one stock background per query, in scene order (Pexels video → Unsplash
  image fallback). These are the full-bleed `background` layers.
- **`search_stock_media({ query, orientation?, perPage? })`**
  Preview-only Pexels search (returns candidates with links, downloads nothing).
- **`vision_filter_media({ slug, items?, threshold?, commit? })`**
  FALLBACK ONLY — scores scraped media with an external NVIDIA vision model. Use
  this when you cannot view images. Prefer `review_media` + `rank_media`.
- **`attach_media({ slug, attachments:[{ sceneIndex, file, kind, role, ... }], mode? })`**
  Manually bind specific clip files to scenes. `role:"background"` (full-bleed) or
  `role:"frame"` (product card). Use to fine-tune after the above.

### Style, voice, render
- **`apply_pattern({ slug, colorOverrides?, textEffect?, captions?, skipCta? })`**
  Persist palette + text effect + captions toggle. Default look is black bg / white
  text. `colorOverrides` slots: `primary` (bg), `secondary` (headline), `accent`
  (glow + CTA button), `highlight` (subtext).
- **`list_voices()`** → cloned pocket-tts voices (e.g. **Anwar Sheikh**, **Irina**)
  + Kokoro presets.
- **`synthesize_voice({ slug, clonedVoice?, voice?, tone?, quality?, autoTrim? })`**
  Generates per-scene + master voiceover. Prefer `clonedVoice:"Anwar"` (or "Irina")
  for the user's own voice. `tone`: calm | balanced | energetic | expressive.
  `quality` 1–4 (4 = closest to the cloned sample, slower). `voice` is a Kokoro
  preset fallback.
- **`render_reel({ slug, highBitrate?, loopTail?, skipAlign? })`**
  Final 1080×1920 MP4. Runs whisper.cpp word-level caption alignment automatically.
  Returns the output path + duration. Requires source + script + pattern + voice.

---

## The standard workflow

```
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
```

A leaner path when the user wants speed over control: `set_strategy({
mediaCollection:"auto" })` collects media in one call; then `apply_pattern` →
`synthesize_voice` → `render_reel`.

---

## A concrete example

User: *"Make a 30s reel about 3 AI agents that kill busywork — Notion AI, Zapier,
and a research agent. Use my Anwar voice."*

```jsonc
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
```

---

## Quality bar (hold yourself to this)

- **Archetype variety**: at least 3 distinct archetypes across the reel; include one
  data layout (checklist/comparison/graph) and one `proof` when a product is involved.
- **Complete sentences** on screen — no 3-word fragments, no dangling words.
- **≥ 2 scraped product assets** kept after ranking when the reel is about a product.
- **A background on every scene** — never a black empty slide.
- **Captions on**, whisper-aligned (the default in `render_reel`).
- **The user's voice** when they have a clone — confirm via `list_voices`.

---

## Host-specific notes

- **Claude / Gemini**: full multimodal MCP — `review_media` thumbnails render inline,
  so you judge media with real vision. This is the intended path.
- **Codex**: if your build doesn't display MCP image blocks, you still get each
  item's metadata (kind, orientation, dimensions, source URL) from `review_media`'s
  text lines — rank from that, or call `vision_filter_media` as the fallback. The
  pipeline never blocks.

## Failure handling

- A tool that fails is recoverable — the run dir is NOT wiped. Read the error, fix
  the inputs, and retry the single tool. Don't restart the whole pipeline.
- `render_reel` refuses to run if the script produced zero slides (a guardrail
  against rendering dummy defaults). If you hit it, re-check `set_strategy`'s scenes.
- First `render_reel` / `synthesize_voice` may take minutes (whisper.cpp compiles
  once, then caches; pocket-tts loads the model). This is normal.
- If media is thin, lower `rank_media` standards slightly or add `collect_stock_media`
  backgrounds — never ship a scene with no visual.
