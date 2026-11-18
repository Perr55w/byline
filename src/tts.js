// Text-to-speech with the Kokoro "Heart" voice (af_heart): free, open-weight, runs on the CPU.
// The ~90 MB model downloads once from Hugging Face into data/models; clips are cached in data/media.
// If kokoro-js is not installed or the model can't load, the app falls back to the browser's voice.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR, MEDIA_DIR } from './db.js';

const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
export const VOICE = process.env.BYLINE_TTS_VOICE || 'af_heart';
let loading = null;
let lastError = null;

async function engine() {
  loading ||= (async () => {
    const [{ KokoroTTS }, { env }] = await Promise.all([import('kokoro-js'), import('@huggingface/transformers')]);
    env.cacheDir = path.join(DATA_DIR, 'models');
    return KokoroTTS.from_pretrained(MODEL, { dtype: 'q8', device: 'cpu' });
  })().catch((e) => { lastError = e.message; loading = null; throw e; });
  return loading;
}

export async function ttsStatus() {
  let installed = true;
  try { await import('kokoro-js'); } catch { installed = false; }
  const cached = fs.existsSync(path.join(DATA_DIR, 'models', MODEL));
  return { installed, model_cached: cached, voice: VOICE, last_error: lastError };
}

/** Split long text into sentence-sized chunks so playback can start and highlight per sentence. */
export function chunk(text, max = 280) {
  const parts = String(text).replace(/\s+/g, ' ').match(/[^.!?]+[.!?]+["”’)]?\s*|[^.!?]+$/g) || [];
  const out = []; let cur = '';
  for (const p of parts) {
    if ((cur + p).length > max && cur) { out.push(cur.trim()); cur = ''; }
    cur += p;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Synthesize one chunk; returns the cached WAV filename. */
export async function speak(text, voice = VOICE) {
  const key = crypto.createHash('sha1').update(`${voice}:${text}`).digest('hex').slice(0, 16);
  const file = `tts-${key}.wav`;
  const full = path.join(MEDIA_DIR, file);
  if (fs.existsSync(full)) return file;
  const tts = await engine();
  const audio = await tts.generate(text, { voice });
  await audio.save(full);
  return file;
}
