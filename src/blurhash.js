// BlurHash encoder (https://blurha.sh algorithm) for image placeholders.
// Images are decoded to a tiny RGB thumbnail with ffmpeg (handles PNG/JPEG/WebP/SVG), then encoded.
import { execFileSync } from 'node:child_process';

const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~';
const b83 = (v, len) => { let s = ''; for (let i = 1; i <= len; i++) s += CHARS[Math.floor(v / 83 ** (len - i)) % 83]; return s; };
const sRGBToLinear = (v) => { const x = v / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
const linearToSRGB = (v) => { const x = Math.max(0, Math.min(1, v)); return Math.round((x <= 0.0031308 ? x * 12.92 : 1.055 * x ** (1 / 2.4) - 0.055) * 255); };
const signPow = (v, e) => Math.sign(v) * Math.abs(v) ** e;

export function encode(pixels, w, h, cx = 4, cy = 3) {
  const factors = [];
  for (let y = 0; y < cy; y++) for (let x = 0; x < cx; x++) {
    const norm = x === 0 && y === 0 ? 1 : 2;
    let r = 0, g = 0, b = 0;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const basis = norm * Math.cos((Math.PI * x * i) / w) * Math.cos((Math.PI * y * j) / h);
      const p = 3 * (j * w + i);
      r += basis * sRGBToLinear(pixels[p]); g += basis * sRGBToLinear(pixels[p + 1]); b += basis * sRGBToLinear(pixels[p + 2]);
    }
    const s = 1 / (w * h);
    factors.push([r * s, g * s, b * s]);
  }
  const [dc, ...ac] = factors;
  let hash = b83((cx - 1) + (cy - 1) * 9, 1);
  let maxVal = 1;
  if (ac.length) {
    const actual = Math.max(...ac.flat().map(Math.abs));
    const q = Math.max(0, Math.min(82, Math.floor(actual * 166 - 0.5)));
    maxVal = (q + 1) / 166;
    hash += b83(q, 1);
  } else hash += b83(0, 1);
  hash += b83((linearToSRGB(dc[0]) << 16) + (linearToSRGB(dc[1]) << 8) + linearToSRGB(dc[2]), 4);
  for (const [r, g, b] of ac) {
    const qq = (v) => Math.max(0, Math.min(18, Math.floor(signPow(v / maxVal, 0.5) * 9 + 9.5)));
    hash += b83(qq(r) * 19 * 19 + qq(g) * 19 + qq(b), 2);
  }
  return hash;
}

/** BlurHash + aspect ratio for an image file, or null if it can't be decoded (e.g. audio/video). */
export function hashFile(file) {
  try {
    const probe = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    const [ow, oh] = probe.split(',').map(Number);
    const W = 32, H = Math.max(1, Math.round(32 * (oh / ow || 1)));
    const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-frames:v', '1', '-vf', `scale=${W}:${H}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1e6 });
    if (raw.length < W * H * 3) return null;
    return { hash: encode(raw, W, H), ar: ow && oh ? +(ow / oh).toFixed(4) : 1 };
  } catch { return null; }
}
