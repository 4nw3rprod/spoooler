# Instagram Reel Generator Tool

This tool turns an Instagram/video URL into a Remotion reel by chaining:

- an external MCP-compatible transcriber (path set via `IG_TRANSCRIBER_ROOT`, optional) through its `transcribe_input` tool for download + Whisper transcript
- Google Gemini for the viral hook, spoken text, scenes, CTA, asset queries, and Remotion props plan
- Pexels/Unsplash for vertical stock video/images
- Kokoro TTS through an OpenAI-compatible endpoint for voiceover audio
- the isolated `instagram-reel-tool/remotion` Remotion composition for rendering

The prompt uses the hook categories from `jakeolschewski/viral-hook-formulas` and writing cleanup rules inspired by `blader/humanizer`.

## Core Video Pipeline

- Use only Advercase if available, otherwise DM Sans. The current composition uses DM Sans from `@remotion/google-fonts`.
- Text generation follows a six-scene table: Hook, Problem, Solution 1, Solution 2, Solution 3, CTA.
- On-screen text is short punchy display copy, while spoken text is fuller narration.
- Hook/on-screen text is large and reveals one word at a time with blur reveal.
- Brand logos are primary visual elements in a split-screen layout.
- Stock footage/images sit beside the logo side and use jump cuts every 2-3 seconds.
- Motion defaults: zoom in/out, fade in/out, and blur reveal.
- CTA renders as a pearl/pill-style comment keyword scene.
- Prefer logo.dev for real tool logos, then Untitled UI placeholder logos, then generated SVG fallback.
- If a specific tool website is supplied, use that site as an asset source when stock footage is not enough.
- `--tool-url` fetches a public OG/social preview image from the tool website and places it into the tool/product slide.
- Do not store private API keys in this repo. Server-only secrets must come from local env files.

## Setup

Copy `.env.example` to `.env` and fill in the keys you need (see the main
[README.md](README.md) for the full list and setup steps).

Required for full generation:

```bash
export GOOGLE_API_KEY="..."
export KOKORO_API_URL="http://localhost:8880/v1/audio/speech"
export PEXELS_API_KEY="..."
export UNSPLASH_ACCESS_KEY="..."
```

Optional:

```bash
export GEMINI_MODEL="gemini-2.5-flash"
export KOKORO_VOICE="af_bella"
export KOKORO_SPEED="1.04"
export LOGO_DEV_PUBLIC_KEY="..."
export LOGO_DEV_TOKEN="..." # server-side only; do not commit
export WHISPER_MODEL="base"
```

## UI

Build and start the local UI:

```bash
cd instagram-reel-tool
npm install
npm run dev
```

Open:

```text
http://127.0.0.1:4317
```

For live Vite development, run the API server and Vite in two terminals:

```bash
cd instagram-reel-tool
npm run server
npm run vite
```

## Generate Props Only

```bash
node instagram-reel-tool/instagram-reel-generator.mjs \
  --url "https://www.instagram.com/reel/SHORTCODE/" \
  --topic "AI workflow automation for founders" \
  --template kinetic \
  --brands "Outgrow,bolt.new,replit.com" \
  --tool-url "https://bolt.new/"
```

## Generate and Render

```bash
node instagram-reel-tool/instagram-reel-generator.mjs \
  --url "https://www.instagram.com/reel/SHORTCODE/" \
  --topic "AI workflow automation for founders" \
  --template noir \
  --brands "Outgrow,bolt.new,replit.com" \
  --tool-url "https://bolt.new/" \
  --render
```

Outputs:

- `instagram-reel-tool/runs/<slug>/<slug>.json` for Remotion
- `instagram-reel-tool/runs/<slug>/<slug>.strategy.json` for source transcript, strategy, and asset metadata
- `instagram-reel-tool/runs/<slug>/<slug>.mp4` when `--render` is passed
- `public/instagram-reel-tool/<slug>/...` for only the media/audio files Remotion must read through `staticFile()`

## Fast Local Test

This bypasses Instagram, Google scripting, media APIs, and Kokoro:

```bash
node instagram-reel-tool/instagram-reel-generator.mjs \
  --skip-transcribe \
  --skip-tts \
  --offline \
  --transcript "Stop automating random tasks. The best AI systems start by finding the workflow bottleneck. Then they remove one handoff and measure the result." \
  --topic "AI workflow automation for founders"
```

Render that props file manually:

```bash
npx remotion render instagram-reel-tool/remotion/index.ts ToolReel instagram-reel-tool/runs/<slug>/test.mp4 --props instagram-reel-tool/runs/<slug>/<slug>.json
```
