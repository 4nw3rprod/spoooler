# Instagram Reel Tool — MCP Server

Drive the reel pipeline directly from Codex or any MCP host. The
host AI authors the creative strategy (hook, voiceover, scenes, layouts) — no
Groq / Cerebras LLM call. Local tools (Pexels, Scrapling, Kokoro TTS,
whisper.cpp, Remotion) handle the rest.

## Tools

| Tool                  | Purpose                                                            |
| --------------------- | ------------------------------------------------------------------ |
| `create_run`          | Mint a fresh slug for a new reel build                              |
| `transcribe_source`   | Stage 1 — IG URL or local video → transcript                        |
| `set_strategy`        | Stage 2 fast path — caller-authored hook + scenes (skips LLM)       |
| `search_stock_media`  | Pexels search preview (returns candidates, no download)             |
| `scrape_brand_media`  | Scrapling discovery → ranked product media (video>image>screenshot) |
| `collect_stock_media` | Download stock backgrounds per query (Pexels→Unsplash)              |
| `vision_filter_media` | NVIDIA vision-score + rank scraped media (rejects AI slop)          |
| `attach_media`        | Bind specific clips to specific scenes (background vs frame)        |
| `apply_pattern`       | Stage 3 — palette + text effect + caption toggle                    |
| `list_voices`         | Kyutai pocket-tts cloned voices (Anwar, Irina, …) + Kokoro presets   |
| `synthesize_voice`    | Stage 4 — cloned voice by name, or Kokoro preset                    |
| `render_reel`         | Stage 6 — whisper alignment + Remotion render → MP4                 |
| `get_run_state`       | Snapshot of all stages so the AI can plan its next move             |
| `list_layouts`        | Catalog of slide archetypes + data layouts + the `layoutData` shape |

## Granular media control (transparent, AI-driven)

Instead of the opaque all-in-one media collection inside `set_strategy`
(`mediaCollection: "auto"`), drive each step yourself and inspect the results
before committing to a render. Every tool streams live progress (sites
discovered, assets found, per-image vision scores) and returns the produced
items as structured JSON.

```
1. set_strategy({ ..., mediaCollection: "skip" })   → author the script, no media yet
2. scrape_brand_media({ slug, productQueries: ["Notion AI"], commit: true })
       → discovers real product pages, returns ranked items (video>image>screenshot)
3. vision_filter_media({ slug, threshold: 6.5, commit: true })
       → scores the scraped pool 1-10, keeps the editorial-quality ones, ranked
4. collect_stock_media({ slug, queries: ["calm desk morning", "city skyline", ...], commit: true })
       → one background per scene (in scene order)
5. attach_media({ slug, attachments: [...] })        → fine-tune scene↔clip bindings
6. get_run_state({ slug })                            → confirm media counts before render
7. render_reel({ slug })
```

- `commit: true` writes the result into `script.json` `media[]`; omit it to just
  inspect candidates and decide.
- `scrape_brand_media` and `collect_stock_media` tag items with `role: frame` and
  `role: background` respectively.
- `vision_filter_media` with `commit: true` replaces only the scraped items
  (stock backgrounds are preserved) with the kept + ranked set.
- Needs `NVIDIA_API_KEY` for vision scoring; without it, items pass through
  unscored (no failure).

## Cloned voices (Kyutai pocket-tts)

Your own recorded/uploaded voices live in `audio/pocket-tts/voices/` and are
indexed in `voices.json`. Currently available: **Anwar Sheikh**, **Irina**,
Manak Pur, Zain, Anika.

Call `list_voices` to see them, then pass a friendly name to `synthesize_voice`:

```
list_voices
→ clonedVoices: [{name: "Anwar Sheikh", id: "anwar-sheikh", available: true}, {name: "Irina", ...}]

synthesize_voice({ slug, clonedVoice: "Anwar", tone: "energetic", quality: 4 })
synthesize_voice({ slug, clonedVoice: "Irina",  tone: "balanced",  quality: 4 })
```

Name matching is case-insensitive and tolerant of spaces/underscores — "Anwar",
"anwar sheikh", and "anwar-sheikh" all resolve to the same voice. `clonedVoice`
takes priority over `voice` (Kokoro) and `voiceFile`. Higher `quality` (1-4)
sounds closer to the original sample but renders slower.

## Typical AI workflow

```
1. list_layouts                  → understand the layout vocabulary
2. create_run                    → mint a slug
3. (optional) transcribe_source  → if there's a reference IG URL or video
4. set_strategy                  → author hook + voiceover + scenes
5. (optional) scrape_brand_media → pull real product imagery
6. (optional) search_stock_media → find atmospheric backgrounds
7. (optional) attach_media       → bind clips to scenes manually
8. apply_pattern                 → palette + text effect
9. list_voices → synthesize_voice({clonedVoice: "Anwar"})  → generate VO in your voice
10. render_reel                  → final MP4
```

`set_strategy` will auto-collect media (stock + scraped) unless you pass
`mediaCollection: "skip"`. Most flows can skip steps 5-7.

## Install for a generic MCP host

Most MCP hosts use a JSON `mcpServers` config. Add an entry like this to your
host's settings file:

```json
{
  "mcpServers": {
    "instagram-reel-tool": {
      "command": "node",
      "args": [
        "/ABSOLUTE/PATH/TO/instagram-reel-tool/mcp/server.mjs"
      ]
    }
  }
}
```

Restart the host. The tools appear under the `instagram-reel-tool` namespace.

## Install for Codex CLI

Add to `~/.codex/config.toml`:

```toml
[mcp.instagram-reel-tool]
command = "node"
args = [
  "/ABSOLUTE/PATH/TO/instagram-reel-tool/mcp/server.mjs"
]
```

## Install for Kiro

Add to `~/.kiro/settings/mcp.json` (user-level) or `.kiro/settings/mcp.json`
(workspace-level):

```json
{
  "mcpServers": {
    "instagram-reel-tool": {
      "command": "node",
      "args": [
        "/ABSOLUTE/PATH/TO/instagram-reel-tool/mcp/server.mjs"
      ],
      "disabled": false,
      "autoApprove": [
        "list_layouts",
        "get_run_state",
        "search_stock_media"
      ]
    }
  }
}
```

## Smoke tests

```bash
# Verifies the server registers all tools and list_layouts works.
node mcp/test-client.mjs

# Verifies the AI-authored strategy fast path (set_strategy skips Groq).
node mcp/test-strategy.mjs
```

## Environment

The server reads `.env` from the tool root for API keys (PEXELS_API_KEY,
UNSPLASH_ACCESS_KEY). Scrapling uses `python3` on `PATH` by default — set
`SCRAPLING_PYTHON` to point at a dedicated venv (see the main README).

## Notes

* Long-running tools (`transcribe_source`, `synthesize_voice`, `render_reel`)
  spawn the existing `instagram-reel-generator.mjs` CLI as a subprocess, so the
  MCP server stays a thin orchestration layer with no duplicated logic.
* `set_strategy` writes a temp `mcp-strategy.json` into the run directory and
  passes `--strategy-file <path>` to the script stage. The generator skips its
  LLM call when this flag is present.
