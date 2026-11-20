// Back up the database and media into backups/byline-<timestamp>/ (safe while the server runs).
// Copy that folder anywhere free: Google Drive, OneDrive, iCloud, a USB drive, or Cloudflare R2 / Backblaze B2.
// The server also makes one of these every day by itself and keeps the last 7 (BYLINE_BACKUP_KEEP).
import path from 'node:path';
import { backupNow } from '../src/backup.js';

const r = backupNow({ root: process.argv[2] ? path.resolve(process.argv[2]) : undefined });
console.log(`Backup written to ${r.dir} (database + ${r.files} media files, ${(r.bytes / 1e6).toFixed(1)} MB).`);
console.log('Restore: stop Byline, copy byline.db and media/ into the data folder, start Byline.');
