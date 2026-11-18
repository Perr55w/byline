// Run the daily workflow once (for cron / Task Scheduler). Safe to repeat: runs are idempotent per date.
import { seedDefaults } from '../src/seed.js';
import { runDaily } from '../src/pipeline.js';
seedDefaults();
const date = process.argv[2];
const r = await runDaily({ date, trigger: 'cli' });
console.log(JSON.stringify(r, null, 2));
process.exit(r.status === 'done' ? 0 : 1);
