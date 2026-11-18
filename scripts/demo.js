// Load the fictional sample data and run today's workflow on it.
import { seedDefaults } from '../src/seed.js';
import { loadDemo } from '../src/demo.js';
seedDefaults();
console.log(JSON.stringify(await loadDemo(), null, 2));
