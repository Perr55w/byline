// Byline v4 — the Canvas2D field on an OffscreenCanvas (see bg2d.js). Messages from bg.js:
//   { m: 'init', canvas }  then  { m: 'layout' | 'heat' | 'rail' | 'draw', a: [args] }
// Draws are coalesced: if several arrive while one is being drawn, only the newest is painted.
import { createField } from './bg2d.js';

let field = null, pending = null, queued = false;
self.onmessage = (e) => {
  const { m, a, canvas } = e.data || {};
  if (m === 'init') { const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true }); field = ctx ? createField(ctx) : null; return; }
  if (!field) return;
  if (m === 'draw') {
    pending = a[0];
    if (!queued) { queued = true; queueMicrotask(() => { queued = false; const p = pending; pending = null; if (p) field.draw(p); }); }
    return;
  }
  if (typeof field[m] === 'function') field[m](...(a || []));
};
