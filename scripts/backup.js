// Back up the database and media into backups/byline-<timestamp>/ (safe while the server runs).
// Copy that folder anywhere free: Google Drive, OneDrive, iCloud, a USB drive, or Cloudflare R2 / Backblaze B2.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const dataDir = process.env.BYLINE_DATA_DIR || path.resolve('data');
const outRoot = path.resolve(process.argv[2] || 'backups');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const out = path.join(outRoot, `byline-${stamp}`);
fs.mkdirSync(path.join(out, 'media'), { recursive: true });

// VACUUM INTO writes a consistent snapshot even with the server writing (WAL mode).
const db = new DatabaseSync(path.join(dataDir, 'byline.db'));
db.exec(`VACUUM INTO '${path.join(out, 'byline.db').replace(/'/g, "''")}'`);
db.close();

let files = 0, bytes = 0;
for (const f of fs.readdirSync(path.join(dataDir, 'media'))) {
  const src = path.join(dataDir, 'media', f);
  if (!fs.statSync(src).isFile()) continue;
  fs.copyFileSync(src, path.join(out, 'media', f));
  files++; bytes += fs.statSync(src).size;
}
console.log(`Backup written to ${out} (database + ${files} media files, ${(bytes / 1e6).toFixed(1)} MB).`);
console.log('Restore: stop Byline, copy byline.db and media/ into the data folder, start Byline.');
