// footage/ingest.mjs
// Normalize raw talking-head footage for the reel pipeline:
//   • probe metadata (ffprobe)
//   • re-encode to 1080x1920@30 cover-crop with loudness-normalized audio
//   • extract 16kHz mono WAV for whisper
// All I/O lives here; the generator stage is a thin wrapper.
import {spawnSync} from 'node:child_process';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';

export function probeVideo(ffprobe, inputPath) {
  const res = spawnSync(ffprobe, [
    '-v', 'error', '-print_format', 'json',
    '-show_format', '-show_streams', inputPath,
  ], {encoding: 'utf8'});
  if (res.status === null) throw new Error('ffprobe not found or failed to run (set FFPROBE_PATH?)');
  if (res.status !== 0) throw new Error(`ffprobe failed: ${(res.stderr || '').slice(-400)}`);
  const data = JSON.parse(res.stdout);
  const v = (data.streams || []).find((s) => s.codec_type === 'video');
  const a = (data.streams || []).find((s) => s.codec_type === 'audio');
  if (!v) throw new Error('No video stream found in input');
  if (!a) throw new Error('No audio stream found in input — footage mode needs speech');
  return {
    durationSeconds: Number(data.format?.duration || v.duration || 0),
    width: Number(v.width), height: Number(v.height),
    fps: parseFps(v.r_frame_rate),
    audioChannels: Number(a.channels || 1),
  };
}

const parseFps = (r) => { const [n, d] = String(r || '30/1').split('/').map(Number); return d ? n / d : n || 30; };

// Re-encode to the reel master + extract whisper wav.
//   mode 'cover' (default): 1080x1920 cover-crop — single framing, vertical source.
//   mode 'wide': scale to 1920 tall, KEEP full width (e.g. 3413x1920) so BOTH
//     speakers stay in the master and the composition can crop to either one
//     per beat (dual-speaker reframing). Audio is loudness-corrected + a gentle
//     presence/high-pass clean-up to even multi-mic podcasts.
// Returns {master, wav, width, height}.
export function normalizeFootage(ffmpeg, inputPath, outDir, {mode = 'cover'} = {}) {
  mkdirSync(outDir, {recursive: true});
  const master = join(outDir, 'master.mp4');
  const wav = join(outDir, 'master.wav');
  const vf = mode === 'wide'
    ? 'scale=-2:1920,fps=30'
    : 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30';
  const af = 'highpass=f=85,equalizer=f=3800:t=q:w=1.4:g=4,loudnorm=I=-16:TP=-1.5:LRA=11,dynaudnorm=f=200:g=8';
  let res = spawnSync(ffmpeg, [
    '-y', '-i', inputPath,
    '-vf', vf,
    '-af', af,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
    '-c:a', 'aac', '-b:a', '192k',
    master,
  ], {stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8', maxBuffer: 16 * 1024 * 1024});
  if (res.status !== 0) throw new Error(`ffmpeg normalize failed: ${(res.stderr || '').slice(-400)}`);
  res = spawnSync(ffmpeg, ['-y', '-i', master, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav],
    {stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8', maxBuffer: 16 * 1024 * 1024});
  if (res.status !== 0) throw new Error(`ffmpeg wav extract failed: ${(res.stderr || '').slice(-400)}`);
  return {master, wav};
}
