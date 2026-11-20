// Honest placeholder for a tab whose module hasn't been built yet (e.g. the Map before map.js lands).
// Real data only: it states what exists, and nothing else.
import { api } from '../api.js';
import { html } from '../ui.js';

export async function render(view, { name }) {
  let stories = null;
  try { stories = await api.get('/stories?limit=200'); } catch (e) { /* keep the honest fallback */ }
  const n = Array.isArray(stories) ? stories.length : null;
  const label = name ? name[0].toUpperCase() + name.slice(1) : 'This tab';
  view.innerHTML = String(html`
    <div class="page-head">
      <p class="eyebrow">${label}</p>
      <h1>The ${label.toLowerCase()} isn’t built yet.</h1>
      <p class="lede">${n != null ? html`It will connect <b>${n}</b> stor${n === 1 ? 'y' : 'ies'} by shared companies, sources and watchlist hits.` : 'It will connect your stories by shared companies, sources and watchlist hits.'}</p>
    </div>
    <div class="empty"><h3>Nothing to show here yet</h3><p>Open the Feed to browse the same stories as a ranked list.</p><div class="cluster"><a class="btn btn--secondary" href="#/feed">Open the Feed</a></div></div>`);
}
