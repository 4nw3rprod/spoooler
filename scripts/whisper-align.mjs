// ─────────────────────────────────────────────────────────────────────────────
// WHISPER ALIGNMENT — word-level speech↔text alignment via whisper.cpp.
//
// Runs AFTER voiceover audio is generated and BEFORE the Remotion render. It
// transcribes the generated VO with token-level timestamps and returns word-level
// captions (and per-scene precise timings). This lets on-screen text + captions
// sync to the ACTUAL spoken words rather than estimated, evenly-divided chunks.
//
// Everything here is best-effort: any failure (build tools missing, model
// download blocked, etc.) is swallowed by the caller so the render never breaks.
// ─────────────────────────────────────────────────────────────────────────────
import {spawnSync} from 'node:child_process';
import {existsSync, mkdirSync} from 'node:fs';
import {join} from 'node:path';

// whisper.cpp version + model. base.en is a good speed/accuracy tradeoff for the
// short, clean TTS VO we feed it. The install + model download are cached under
// <toolRoot>/.cache/whisper so subsequent runs are instant.
const WHISPER_VERSION = '1.5.5';
const WHISPER_MODEL = 'base.en';

// Convert an arbitrary audio file to the 16kHz mono WAV whisper.cpp requires.
function toWhisperWav(ffmpeg, inputPath, outPath) {
  const res = spawnSync(ffmpeg, [
    '-y', '-i', inputPath,
    '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le',
    outPath,
  ], {stdio: 'ignore'});
  return res.status === 0 && existsSync(outPath);
}

// Walk whisper.cpp's tokens and produce a clean word list. With
// `splitOnWord: true` whisper splits aggressively at sub-word boundaries
// ("retreats" → "retreat" + "s"). Whisper marks word-starts by leading
// whitespace in the raw token text — we use that to merge continuation tokens
// onto the previous word, while keeping start/end timestamps spanning the
// whole word.
function wordsFromTranscription(json) {
  const out = [];
  for (const item of json.transcription || []) {
    for (const tok of item.tokens || []) {
      const raw = String(tok.text || '');
      const text = raw.trim();
      if (!text) continue;
      // whisper meta tokens like [_BEG_], <|endoftext|>, [_TT_xxx]
      if (text.startsWith('[') || text.startsWith('<')) continue;
      const start = (tok.offsets?.from ?? 0) / 1000;
      const end = (tok.offsets?.to ?? 0) / 1000;
      const isPunctOnly = /^[\p{P}\p{S}]+$/u.test(text);
      const isContinuation = !/^\s/.test(raw); // no leading space → BPE sub-word
      if ((isContinuation || isPunctOnly) && out.length) {
        // Glue onto the previous word — extending its end timestamp.
        out[out.length - 1].text += text;
        out[out.length - 1].end = end;
        continue;
      }
      out.push({text, start, end});
    }
  }
  return out;
}

// Group words into caption lines of ~maxWords, each carrying precise start/end.
function wordsToCaptions(words, maxWords = 5) {
  const caps = [];
  for (let i = 0; i < words.length; i += maxWords) {
    const slice = words.slice(i, i + maxWords);
    if (!slice.length) continue;
    caps.push({
      text: slice.map((w) => w.text).join(' '),
      start: Number(slice[0].start.toFixed(2)),
      end: Number(slice[slice.length - 1].end.toFixed(2)),
      words: slice.map((w) => ({text: w.text, start: Number(w.start.toFixed(2)), end: Number(w.end.toFixed(2))})),
    });
  }
  return caps;
}

/**
 * Align a voiceover audio file to word-level timestamps.
 * @param {object} opts
 * @param {string} opts.audioPath  Absolute path to the VO audio (wav/mp3).
 * @param {string} opts.cacheDir   Where to install whisper + model + temp wav.
 * @param {string} [opts.ffmpeg]   ffmpeg binary (default 'ffmpeg').
 * @param {(p:number,msg?:string)=>void} [opts.onProgress]
 * @returns {Promise<{ok:boolean, words?:Array, captions?:Array, reason?:string}>}
 */
export async function alignVoiceover({audioPath, cacheDir, ffmpeg = 'ffmpeg', onProgress = () => {}}) {
  if (!audioPath || !existsSync(audioPath)) {
    return {ok: false, reason: 'audio file not found'};
  }
  let mod;
  try {
    mod = await import('@remotion/install-whisper-cpp');
  } catch (e) {
    return {ok: false, reason: `@remotion/install-whisper-cpp not resolvable: ${e.message}`};
  }
  const {installWhisperCpp, downloadWhisperModel, transcribe} = mod;

  // IMPORTANT: do NOT pre-create the whisper dir. installWhisperCpp treats an
  // existing folder as "already installed" and then fails when the binary is
  // absent. Only ensure the parent cacheDir exists for the temp wav + model.
  mkdirSync(cacheDir, {recursive: true});
  const whisperDir = join(cacheDir, 'whisper');

  try {
    onProgress(2, 'Installing whisper.cpp (cached after first run)');
    await installWhisperCpp({version: WHISPER_VERSION, to: whisperDir, printOutput: false});

    onProgress(20, `Downloading whisper model ${WHISPER_MODEL} (cached)`);
    await downloadWhisperModel({model: WHISPER_MODEL, folder: whisperDir, printOutput: false});

    onProgress(40, 'Converting audio to 16kHz mono WAV');
    const wavPath = join(cacheDir, 'align-input.wav');
    if (!toWhisperWav(ffmpeg, audioPath, wavPath)) {
      return {ok: false, reason: 'ffmpeg failed to produce 16kHz wav'};
    }

    onProgress(55, 'Transcribing with token-level timestamps');
    const json = await transcribe({
      inputPath: wavPath,
      whisperPath: whisperDir,
      whisperCppVersion: WHISPER_VERSION,
      model: WHISPER_MODEL,
      tokenLevelTimestamps: true,
      language: 'en',
      splitOnWord: true,
      printOutput: false,
    });

    const words = wordsFromTranscription(json);
    if (!words.length) return {ok: false, reason: 'no words transcribed'};
    const captions = wordsToCaptions(words, 5);
    onProgress(95, `Aligned ${words.length} words → ${captions.length} caption lines`);
    return {ok: true, words, captions};
  } catch (e) {
    return {ok: false, reason: e?.message || String(e)};
  }
}

// CLI entry: node whisper-align.mjs <audioPath> <cacheDir> [ffmpeg]
// Prints the alignment JSON to stdout. Used by the generator via spawn so a
// hard crash (segfault during whisper build) can't take down the parent.
const isMain = process.argv[1] && process.argv[1].endsWith('whisper-align.mjs');
if (isMain) {
  const [, , audioPath, cacheDir, ffmpeg] = process.argv;
  alignVoiceover({audioPath, cacheDir, ffmpeg: ffmpeg || 'ffmpeg', onProgress: (p, m) => process.stderr.write(`[align ${p}%] ${m || ''}\n`)})
    .then((res) => {
      process.stdout.write(JSON.stringify(res), () => {
        process.exit(res.ok ? 0 : 0); // exit 0 even on soft failure — caller decides
      });
    })
    .catch((e) => {
      process.stdout.write(JSON.stringify({ok: false, reason: e?.message || String(e)}), () => {
        process.exit(0);
      });
    });
}
