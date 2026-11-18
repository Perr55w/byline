// RFC 6238 TOTP (and the RFC 4226 HOTP it rests on), node:crypto only.
// Defaults match every authenticator app: SHA-1, 30-second steps, 6 digits.
import crypto from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const STEP = 30;
export const DIGITS = 6;

/** RFC 4648 base32, upper case, no padding. */
export function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** Lenient decode: ignores case, spaces, dashes and '=' padding; throws on any other character. */
export function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0, value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error(`Invalid base32 character "${ch}"`);
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

/** HOTP value for a raw key and counter, zero-padded to `digits`. */
export function hotp(key, counter, { digits = DIGITS, algorithm = 'sha1' } = {}) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = crypto.createHmac(algorithm, key).update(msg).digest();
  const off = mac[mac.length - 1] & 0x0f;
  const bin = ((mac[off] & 0x7f) << 24) | (mac[off + 1] << 16) | (mac[off + 2] << 8) | mac[off + 3];
  return String(bin % 10 ** digits).padStart(digits, '0');
}

const stepOf = (ms) => Math.floor(ms / 1000 / STEP);

/** TOTP code for a base32 secret at a time in ms (default now). */
export function totp(secret, ms = Date.now(), opts = {}) {
  return hotp(base32Decode(secret), stepOf(ms), opts);
}

/** 160-bit random secret, base32 (32 characters). */
export function generateSecret(bytes = 20) {
  return base32Encode(crypto.randomBytes(bytes));
}

// Replay protection: the last accepted time step per secret, kept in memory only.
// Keyed by a hash so the secret itself is never held as a map key.
const lastStep = new Map();
const keyOf = (secret) => crypto.createHash('sha256').update(base32Encode(base32Decode(secret))).digest('hex');

/**
 * Check a 6-digit code against the secret, allowing `window` steps of clock drift either way.
 * Every candidate is computed and compared in constant time (no early exit).
 * A code for a step at or before the last accepted one is rejected, so each code works once.
 */
export function verify(secret, code, window = 1, now = Date.now()) {
  const given = String(code ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(given) || !secret) return false;
  let key;
  try { key = base32Decode(secret); } catch { return false; }
  if (!key.length) return false;
  const current = stepOf(now);
  const givenBuf = Buffer.from(given);
  let matched = -1;
  for (let i = -window; i <= window; i++) {
    const s = current + i;
    if (s < 0) continue;
    const ok = crypto.timingSafeEqual(Buffer.from(hotp(key, s)), givenBuf);
    if (ok && matched < 0) matched = s;
  }
  if (matched < 0) return false;
  const k = keyOf(secret);
  if (lastStep.has(k) && matched <= lastStep.get(k)) return false;
  lastStep.set(k, matched);
  return true;
}

/** otpauth:// URI for manual entry or a QR code. */
export function otpauthUrl(secret, label = 'Byline') {
  const issuer = 'Byline';
  const name = label === issuer || label.includes(':') ? label : `${issuer}:${label}`;
  const q = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: String(DIGITS), period: String(STEP) });
  return `otpauth://totp/${encodeURIComponent(name)}?${q}`;
}

/** "ABCD EFGH …" for reading a key aloud or typing it by hand. */
export const groupKey = (secret) => String(secret).replace(/(.{4})(?=.)/g, '$1 ');
