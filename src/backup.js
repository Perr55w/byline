// Database + media backups. VACUUM INTO writes a consistent snapshot even while the server is writing (WAL mode).
// Used by `npm run backup`, by the scheduler (one backup a day, the last BYLINE_BACKUP_KEEP kept) and by go-live.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const dataDir = () => process.env.BYLINE_DATA_DIR || path.resolve('data');
/** backups/ next to the default data folder; inside a custom BYLINE_DATA_DIR; or BYLINE_BACKUP_DIR. */
export const backupDir = () => process.env.BYLINE_BACKUP_DIR ? path.resolve(process.env.BYLINE_BACKUP_DIR)
  : process.env.BYLINE_DATA_DIR ? path.join(process.env.BYLINE_DATA_DIR, 'backups') : path.resolve('backups');
export const backupKeep = () => Math.max(1, Number(process.env.BYLINE_BACKUP_KEEP) || 7);

export function listBackups(root = backupDir()) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).filter(n => /^byline-\d{4}-\d{2}-\d{2}T/.test(n) && fs.statSync(path.join(root, n)).isDirectory()).sort();
}

/** Write backups/byline-<UTC stamp>/ (byline.db + media/). Media files are hard-linked when possible (no extra space). */
export function backupNow({ root = backupDir(), keep = null, label = '', now = new Date() } = {}) {
  const stamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  let out = path.join(root, `byline-${stamp}${label ? `-${label}` : ''}`);
  for (let n = 2; fs.existsSync(out); n++) out = path.join(root, `byline-${stamp}${label ? `-${label}` : ''}-${n}`);
  fs.mkdirSync(path.join(out, 'media'), { recursive: true });
  const db = new DatabaseSync(path.join(dataDir(), 'byline.db'));
  try { db.exec(`VACUUM INTO '${path.join(out, 'byline.db').replace(/'/g, "''")}'`); } finally { db.close(); }
  let files = 0, bytes = 0;
  const media = path.join(dataDir(), 'media');
  for (const f of fs.existsSync(media) ? fs.readdirSync(media) : []) {
    const src = path.join(media, f);
    const st = fs.statSync(src);
    if (!st.isFile()) continue;
    try { fs.linkSync(src, path.join(out, 'media', f)); } catch { fs.copyFileSync(src, path.join(out, 'media', f)); }
    files++; bytes += st.size;
  }
  const dbBytes = fs.statSync(path.join(out, 'byline.db')).size;
  const pruned = keep ? prune(root, keep) : [];
  return { dir: out, files, bytes, db_bytes: dbBytes, pruned };
}

/** Keep the newest `keep` backup folders. */
export function prune(root = backupDir(), keep = backupKeep()) {
  const list = listBackups(root);
  const gone = list.slice(0, Math.max(0, list.length - keep));
  for (const n of gone) fs.rmSync(path.join(root, n), { recursive: true, force: true });
  return gone;
}

/** The scheduler's daily backup: once per UTC day, then prune. Off with BYLINE_BACKUPS=0. */
export function dailyBackup({ root = backupDir(), keep = backupKeep(), now = new Date() } = {}) {
  if (process.env.BYLINE_BACKUPS === '0') return { skipped: 'disabled' };
  const today = now.toISOString().slice(0, 10);
  if (listBackups(root).some(n => n.startsWith(`byline-${today}`))) return { skipped: 'already backed up today' };
  return backupNow({ root, keep, now });
}
