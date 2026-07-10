---
name: footage-reel-mcp
description: >
  Turn raw talking-head / 2-person podcast footage into finished, post-ready
  Instagram reels (1080×1920 MP4) by driving the instagram-reel-tool MCP server.
  Any MCP-capable model can follow this end to end. You are the editor: you pick
  the segment, cut between BOTH speakers + scraped media, write kinetic captions,
  drop explainer motion-graphic cards, and render — all via MCP tools. Triggers:
  edit my footage, podcast reel, talking-head reel, turn this into reels,
  repurpose this interview, make reels from this recording.
license: internal
---

# Footage Reel Production over MCP — Complete Guide

Raw camera footage in → finished edited reel out, driven entirely through the
`instagram-reel-tool` MCP server. The server is the crew (normalize, clean
audio, transcribe, validate, render). **You are the editor**: choose the
segment, decide who's on screen each beat, write the captions, pick the cards.

If the server is registered in your host, call `mcp__<server>__<tool>`. If not,
drive it with the bundled client:

```bash
node mcp/client.mjs <tool-name> '<json-args>'
```

---

## 0. The signature edit (what a great reel looks like here)

A reel is a continuous loop of **4-beat cycles**. The default rhythm for a
2-person podcast:

```
1. Speaker 1        (talking-head, speaker:"A")     3–5s
2. Speaker 2        (talking-head, speaker:"B")     3–5s
3. **Scraped** product/brand media (stock only as fallback)  OR  both speakers together  3–4s
      (treatment: "broll"            (treatment: "two-shot")
4. SPLIT-SCREEN: archetype card on the TOP half     4–6s
   + the speaker on the BOTTOM half  (treatment: "split", with archetype + speaker)
→ repeat the cycle for the next concept
```

- **Swap every 3–4s** — never sit on one shot.
- **Beat 3** is either a full-screen B-roll cutaway (`broll`) or a `two-shot`
  showing both people together — alternate these across cycles for variety.
- **Beat 4 is the split**: the archetype card (`myth-fact`, `timeline`, `quote-card`,
  `receipt`, …) renders on the **top half** as the visual representation of the
  concept just discussed, while the speaker stays live in the **bottom half**.
  This is the "mini explainer motion graphic" that anchors each concept.
- **Open on a problem/myth** in the first ~3s. **End on a takeaway.**
- Captions ride on talking-head / broll / two-shot / split beats (one hero
  keyword each); the card's own text carries the split — keep its caption short
  or omit it.

This rhythm is the default. Everything below is how to execute it via MCP.

---

## 1. Pipeline (pure MCP)

```
create_run            → mint a slug
ingest_footage        → normalize + CLEAN AUDIO + (dual mode) keep both speakers
transcribe_footage    → whisper word-level timestamps
apply_pattern         → accent colour
set_edit_plan         → YOUR EDL: cuts[] + beats[]  (validated; captions auto-synced)
render_footage_reel   → 1080×1920 MP4 (brand fonts + vignette baked in)
get_run_state         → snapshot any time
```

Ingest the FULL source **once** in dual mode; then make as many reels as you
want, each just a different `set_edit_plan` + `render_footage_reel` over the
same master (cuts use absolute source-time seconds).

What the server now does automatically (you do NOT script these):
- **Audio cleanup** on every ingest: high-pass + 3.8 kHz presence boost +
  loudnorm + dynamic normalization → evens multi-mic podcasts.
- **Dual-speaker reframing**: `reframe:"dual"` keeps the full landscape so you
  crop to either person per beat with `beat.speaker`.
- **Brand fonts** (Advercase display + Chirp body) and the **curved dark
  top/bottom vignette** are baked into every render.

---

## 2. Step-by-step

### 2.0 Call `list_layouts` first
It returns every treatment + all 16 archetypes with their exact `layoutData` shape + a filled example. Never guess a shape — call it once at the start.

### 2.1 Probe + pick the segment
Look at the source, transcribe it, and choose the strongest 30–90s arc that
**opens on a problem/tension and lands a takeaway**. (Natural topic chunks are
often 20–35s — a 4-min source yields ~3–4 distinct reels; more means reusing
clips. Don't promise more distinct reels than the speech supports.)

### 2.2 Find the two speakers' positions
For dual mode you need each speaker's **normalized horizontal centre** `cx`
(0 = left edge, 1 = right edge). Grab one frame and eyeball it:
- left-seated person ≈ `cx 0.28–0.34`, right-seated ≈ `cx 0.68–0.74` for a
  typical two-shot. Adjust to centre each face.

### 2.3 create_run + ingest (dual) + transcribe
```bash
node mcp/client.mjs create_run '{"slug":"my-reel"}'
node mcp/client.mjs ingest_footage '{"slug":"my-reel","videoFile":"/abs/source.mov",
  "reframe":"dual","speakers":[{"id":"A","cx":0.30},{"id":"B","cx":0.72}]}'
node mcp/client.mjs transcribe_footage '{"slug":"my-reel"}'
```
Read `runs/<slug>/footage-transcript.json` for word-level timings (the timeline
you cut against). For a single-speaker / already-vertical source, omit
`reframe`/`speakers` (defaults to a 1080×1920 cover crop).

### 2.4 Source media — scraped FIRST, stock as fallback
For beats that need media (broll / frame-overlay / before-after / phone-mockup),
prefer REAL scraped product & brand media over stock:
1. `extract_entities` (or name them yourself) → per-beat product/brand/tool names.
2. `scrape_media` (or `scrape_brand_media`) with `commit:true` → Giphy → Brandfetch
   logo → Google Images screenshots/product shots into the run's media pool.
3. `review_media` → look at thumbnails → `rank_media` → keep the best; these
   become the `mediaRef`s your beats reference.
4. `collect_stock_media` (Pexels/Unsplash) ONLY for atmospheric beats with no
   concrete entity.
Priority per media beat: scraped product/brand asset → scraped screenshot → stock.

### 2.5 Accent colour
```bash
node mcp/client.mjs apply_pattern '{"slug":"my-reel","colorOverrides":{"accent":"#4FB0FF"}}'
```

### 2.6 Author the EDL and set it
```bash
node mcp/client.mjs set_edit_plan '<edl-json with slug>'   # expect warnings: []
```

### 2.7 Render
```bash
node mcp/client.mjs render_footage_reel '{"slug":"my-reel","highBitrate":true}'
```
Output: `runs/<slug>/<slug>.mp4`. Optional: `{"music":"/abs/bed.mp3"}`
(auto-ducked under speech), `{"vignette":false}` to disable the vignette.

---

## 3. EDL reference

```jsonc
{
  "slug": "my-reel",
  "cuts": [ {"start": 12.4, "end": 16.0}, ... ],  // SOURCE-time seconds, ascending, non-overlapping
  "beats": [ { ...one beat per cut, tiling fromCut..toCut contiguously... } ]
}
```
Omit `cuts` to auto-build them (drops silences > 0.7s + filler words). Provide
them explicitly to also drop flubs and off-topic lines, and to control the
swap rhythm precisely.

### Beat fields
| field | meaning |
|---|---|
| `fromCut`,`toCut` | cut index range this beat covers (beats tile cuts contiguously) |
| `treatment` | `talking-head` \| `broll` \| `overlay` \| `frame-overlay` |
| `speaker` | talking-head only: `"A"`/`"B"` — which person to crop to (dual ingest) |
| `zoom` | talking-head only: slow punch-in |
| `mediaRef`,`mediaKind` | broll/frame-overlay: public-relative stock path + `image`/`video` |
| `archetype`,`layoutData` | overlay only: which card + its data |
| `caption` | optional kinetic caption (see below) — use on talking-head/broll, NOT on cards |

### Treatments
- **talking-head** — full-screen one speaker; set `speaker:"A"/"B"` (dual ingest).
- **split** — archetype card on the **TOP half** + speaker on the **BOTTOM half**
  (set `archetype` + `layoutData` AND `speaker`). The signature cycle-ender.
- **two-shot** — both speakers in frame together (centred band; needs dual ingest).
  Use as the beat-3 alternative to B-roll.
- **broll** — full-screen stock cutaway; speaker audio continues underneath.
- **overlay** — full-screen clean explainer **card** (speaker hidden, audio continues). No webcam bubble.
- **frame-overlay** — speaker full-screen + a floating product screenshot.

### All 16 overlay archetypes + layoutData shapes

Call `list_layouts` at the start of every session — it returns every archetype
with its exact `layoutData` shape and a filled example. Never guess a shape.

| archetype | `layoutData` shape | when to use |
|---|---|---|
| `stat` | `{value, label, subtext?}` | one dominant number |
| `bar-graph` | `{title?, unit?, bars:[{label,value}]}` (≥2) | compare magnitudes |
| `pie-chart` | `{title?, slices:[{label,value}]}` (≥2) | share of a whole |
| `progress-graph` | `{title?, unit?, points:[{label,value}]}` (≥3) | trend over time |
| `checklist` | `{title?, items:[{text}]}` (≥2) | steps/features |
| `comparison` | `{leftTitle, rightTitle, leftItems[], rightItems[]}` | A vs B |
| `motion-graphic` | `{title?, nodes:[{label}], flow:"linear"\|"cycle"\|"hub"}` (≥2 nodes) | a process/flow |
| `github-card` | `{owner, repo, description?, language?, stars?, forks?}` | a named repo |
| `myth-fact` | `{myth, fact}` | correct a misconception |
| `timeline` | `{title?, events:[{label, sublabel?}]}` (≥2) | a ladder/journey/pyramid (the takeaway) |
| `quote-card` | `{text, author, role?}` | a pull-quote |
| `receipt` | `{title?, items:[{label,value}], total?}` (≥2) | itemized breakdown |
| `tweet-card` | `{handle, name?, text, likes?, avatarRef?}` | social proof |
| `notification-stack` | `{notifications:[{app,title,body?,time?}]}` (≥1) | push-banner pops |
| `before-after` | `{beforeRef, afterRef, beforeLabel?, afterLabel?}` | wipe reveal (image paths) |
| `phone-mockup` | `{mediaRef, scroll?}` | app UI in a phone frame (image path) |

### Captions (selective kinetic typography)
```jsonc
"caption": { "entrance": "blur-reveal"|"rise"|"slide-x", "anchor": "bottom",  // entrance: blur-reveal (default) | rise | slide-x
  "words": [ {"text":"most people think AI is just","scale":"m"},
             {"text":"ChatGPT","scale":"hero","accent":true} ] }
```
- Exactly ONE `hero` word, drawn from the **actual spoken words in that cut's
  range** so it syncs to speech (otherwise it falls back to even-stagger).
- Hero = Advercase bold in the accent colour; supporting = Chirp. No serifs.
- Omit when nothing is worth highlighting. Never transcribe verbatim.

---

## 4. Authoring the swap-cycle rhythm (worked pattern)

For a concept discussed from source-time `T0`→`T1`, build one cycle as four
beats, ~3–4s each:

```jsonc
// cut list for one cycle (pick clean phrase boundaries from the transcript)
{"start": 12.0, "end": 15.5},   // cut 0  → Speaker 1 (A)
{"start": 15.5, "end": 19.0},   // cut 1  → Speaker 2 (B)
{"start": 19.0, "end": 22.5},   // cut 2  → media OR two-shot
{"start": 22.5, "end": 27.5},   // cut 3  → SPLIT: card top + speaker bottom

// beats
{"fromCut":0,"toCut":0,"treatment":"talking-head","speaker":"A",
  "caption":{"entrance":"rise","anchor":"bottom","words":[
    {"text":"the problem is","scale":"m"},{"text":"X","scale":"hero","accent":true}]}},
{"fromCut":1,"toCut":1,"treatment":"talking-head","speaker":"B",
  "caption":{"entrance":"slide-x","anchor":"bottom","words":[
    {"text":"and that means","scale":"m"},{"text":"Y","scale":"hero","accent":true}]}},
{"fromCut":2,"toCut":2,"treatment":"two-shot",
  "caption":{"entrance":"rise","anchor":"bottom","words":[
    {"text":"here's the","scale":"m"},{"text":"shift","scale":"hero","accent":true}]}},
  // ... or treatment:"broll" with mediaRef for a stock cutaway instead
{"fromCut":3,"toCut":3,"treatment":"split","speaker":"A","archetype":"timeline",
  "layoutData":{"title":"The concept","events":[
    {"label":"Step one","sublabel":"detail"},
    {"label":"Step two","sublabel":"detail"},
    {"label":"Step three","sublabel":"detail"}]}}
```
Repeat for each concept. Vary beat 3 (B-roll ↔ two-shot) and the card archetype
across cycles. First beat poses the problem; the final cycle's card is the takeaway.

**Who's on screen vs who's talking:** ideally `speaker:"A"` beats are when A is
actually talking. Cutting to the *listener* (reaction) for a beat is a legitimate
podcast technique, but never leave a clearly silent face up for long — if unsure,
use a `broll` or `overlay` beat instead. Sample a frame at a cut's midpoint to
check who's speaking.

---

## 5. Editorial rules (hold to these)
1. Open on a **problem / myth / tension** in the first ~3s.
2. **Swap every 3–4s** (A / B / B-roll); never sit on one shot.
3. **One archetype card per swap cycle** to name the concept; vary the card type.
4. **End on the takeaway** (a card or a punchy talking-head line), not mid-thought.
5. Captions: one hero keyword per beat, synced to a spoken word; none on cards.
6. **Cover, don't expose** — uncertain who's talking or muffled audio → B-roll/card.
7. Confirm before render: `get_run_state` shows footage + transcript + editPlan.
8. After render, spot-check 4–6 frames (speaker crops, fonts, vignette, sync).

---

## 6. Tool reference (footage mode)
| tool | key args | returns |
|---|---|---|
| `create_run` | `slug?` | slug, runDir |
| `ingest_footage` | `slug`, `videoFile`, `reframe?("cover"\|"dual")`, `speakers?[{id,cx}]` | master {width,height,mode} |
| `transcribe_footage` | `slug` | text, wordCount, words[{text,start,end}] |
| `apply_pattern` | `slug`, `colorOverrides{accent,...}` | ok |
| `set_edit_plan` | `slug`, `cuts?[]`, `beats[]` | cuts, beats, totalSeconds, warnings |
| `render_footage_reel` | `slug`, `highBitrate?`, `music?`, `vignette?` | output path, duration |
| `get_run_state` | `slug` | footage / transcript / editPlan / render summary |

---

## 7. Full worked example (a real reel)

2-person AI podcast, 4-min 4K landscape. One dual ingest, then this reel:

```bash
node mcp/client.mjs create_run '{"slug":"ai-pyramid"}'
node mcp/client.mjs ingest_footage '{"slug":"ai-pyramid","videoFile":"/abs/podcast.mov","reframe":"dual","speakers":[{"id":"A","cx":0.30},{"id":"B","cx":0.72}]}'
node mcp/client.mjs transcribe_footage '{"slug":"ai-pyramid"}'
node mcp/client.mjs apply_pattern '{"slug":"ai-pyramid","colorOverrides":{"accent":"#4FB0FF"}}'
node mcp/client.mjs set_edit_plan '{...EDL with A/B/broll swap cycles + myth-fact opener + timeline takeaway...}'
node mcp/client.mjs render_footage_reel '{"slug":"ai-pyramid","highBitrate":true}'
```
Arc: **PROBLEM** ("most people think AI is just ChatGPT", speaker A) → cut to B
reacting → B-roll → **myth-fact card** ("AI is just ChatGPT" / "tip of the
iceberg") → A explains evolution → B → AI-brain B-roll → **timeline card "The AI
Pyramid"** (chatbot → generative → agentic) → B-roll → close.

---

## 8. Checklist (paste into a todo list)
- [ ] Call list_layouts to see all 16 archetypes + exact layoutData shapes before authoring the EDL
- [ ] Probe + transcribe; pick the problem→takeaway arc
- [ ] Eyeball each speaker's `cx`
- [ ] create_run → ingest_footage (reframe:dual, speakers) → transcribe_footage
- [ ] Source media SCRAPED-FIRST: extract/name entities → scrape_media (commit) →
      review_media → rank_media; collect_stock_media only as atmospheric fallback
- [ ] apply_pattern accent
- [ ] Author EDL as A→B→media swap cycles, one archetype card per cycle, hero words synced
- [ ] set_edit_plan (warnings: []) → get_run_state
- [ ] render_footage_reel → spot-check frames
