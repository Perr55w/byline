// Source connectors. Each connector exposes:
//   status(source)  -> { ready: bool, reason?: string }
//   collect(source) -> Promise<Item[]>  (Item: url, title, summary, content, author, published_at, image_url, engagement)
// Retrieved content is untrusted data: it is stored as plain text and never interpreted as instructions.
import { stripHtml, decodeEntities, truncate } from '../text.js';

const UA = 'Byline/1.0 (personal news reader)';
const TIMEOUT_MS = 15000;

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*' }, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).hostname}`);
  const len = Number(res.headers.get('content-length') || 0);
  if (len > 8e6) throw new Error('Response too large');
  return res.text();
}

const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? decodeEntities(m[1]).trim() : '';
};
const attr = (xml, name, a) => {
  const m = xml.match(new RegExp(`<${name}\\b[^>]*\\b${a}=["']([^"']+)["']`, 'i'));
  return m ? decodeEntities(m[1]) : '';
};

export function parseFeed(xml) {
  const isAtom = /<feed[\s>]/i.test(xml) && !/<rss[\s>]/i.test(xml);
  const blocks = xml.match(isAtom ? /<entry[\s>][\s\S]*?<\/entry>/gi : /<item[\s>][\s\S]*?<\/item>/gi) || [];
  return blocks.map(b => {
    let link = isAtom ? (b.match(/<link\b[^>]*rel=["']alternate["'][^>]*>/i) ? attr(b.match(/<link\b[^>]*rel=["']alternate["'][^>]*>/i)[0], 'link', 'href') : attr(b, 'link', 'href')) : tag(b, 'link');
    if (!link) link = tag(b, 'guid');
    const rawContent = tag(b, 'content:encoded') || tag(b, 'content') || tag(b, 'description') || tag(b, 'summary');
    const summaryRaw = tag(b, 'description') || tag(b, 'summary') || rawContent;
    const date = tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date');
    return {
      url: link.trim(),
      title: stripHtml(tag(b, 'title')),
      summary: truncate(stripHtml(summaryRaw), 600),
      content: truncate(stripHtml(rawContent), 12000),
      author: stripHtml(tag(b, 'dc:creator') || tag(b, 'name') || tag(b, 'author')),
      published_at: date && !isNaN(Date.parse(date)) ? new Date(date).toISOString() : null,
      image_url: attr(b, 'media:content', 'url') || attr(b, 'media:thumbnail', 'url') || attr(b, 'enclosure', 'url') || null
    };
  }).filter(i => i.url && i.title && /^https?:\/\//.test(i.url));
}

const meta = (html, key) => {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*>`, 'i');
  const m = html.match(re);
  return m ? (m[0].match(/content=["']([^"']*)["']/i) || [])[1] && decodeEntities(m[0].match(/content=["']([^"']*)["']/i)[1]) : '';
};

export async function fetchArticle(url) {
  const html = await fetchText(url);
  const article = html.match(/<article[\s\S]*?<\/article>/i)?.[0] || html.match(/<main[\s\S]*?<\/main>/i)?.[0] || html;
  const paras = (article.match(/<p[\s>][\s\S]*?<\/p>/gi) || []).map(stripHtml).filter(p => p.length > 40);
  const published = meta(html, 'article:published_time') || meta(html, 'date') || (html.match(/<time[^>]+datetime=["']([^"']+)/i) || [])[1];
  const site = stripHtml(meta(html, 'og:site_name'));
  let title = stripHtml(meta(html, 'og:title') || tag(html, 'title')) || url;
  // Drop a trailing " | Site name" / " - Example Blog" suffix.
  const suffix = title.match(/\s+[|\-–—]\s+([^|\-–—]{2,40})$/);
  if (suffix && ((site && suffix[1].toLowerCase().includes(site.toLowerCase().split(' ')[0])) || /blog|news|newsroom/i.test(suffix[1]))) title = title.slice(0, suffix.index);
  return {
    url,
    title,
    summary: truncate(stripHtml(meta(html, 'og:description') || meta(html, 'description') || paras[0] || ''), 600),
    content: truncate(paras.join('\n\n'), 12000),
    author: stripHtml(meta(html, 'author')),
    site: stripHtml(meta(html, 'og:site_name')),
    image_url: meta(html, 'og:image') || null,
    published_at: published && !isNaN(Date.parse(published)) ? new Date(published).toISOString() : null
  };
}

const rss = {
  label: 'RSS / Atom feed',
  status: (s) => s.url ? { ready: true } : { ready: false, reason: 'Missing feed URL' },
  collect: async (s) => parseFeed(await fetchText(s.url))
};

// X/Twitter recent search (API v2). Requires X_BEARER_TOKEN; source.url holds the search query.
const x = {
  label: 'X / Twitter (API v2 recent search)',
  status: () => process.env.X_BEARER_TOKEN ? { ready: true } : { ready: false, reason: 'Needs X_BEARER_TOKEN (approved X API access)' },
  collect: async (s) => {
    const q = encodeURIComponent(`${s.url} -is:retweet lang:en`);
    const res = await fetch(`https://api.x.com/2/tweets/search/recent?query=${q}&max_results=25&tweet.fields=created_at,public_metrics,author_id,entities`, {
      headers: { Authorization: `Bearer ${process.env.X_BEARER_TOKEN}` }, signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    if (!res.ok) throw new Error(`X API HTTP ${res.status}`);
    const data = await res.json();
    return (data.data || []).map(t => ({
      url: `https://x.com/i/web/status/${t.id}`,
      title: truncate(t.text.replace(/\s+/g, ' '), 140),
      summary: t.text, content: t.text, author: t.author_id,
      published_at: t.created_at, engagement: t.public_metrics
    }));
  }
};

// Web page with a list of article links (for official sites without RSS, e.g. anthropic.com/news).
// source.url is the listing page; links deeper under the same path are treated as articles.
const page = {
  label: 'Web page (article list)',
  status: (s) => s.url ? { ready: true } : { ready: false, reason: 'Missing listing page URL' },
  collect: async (s, { isKnown = () => false, max = 8 } = {}) => {
    const base = new URL(s.url);
    const prefix = base.pathname.replace(/\/?$/, '/');
    const html = await fetchText(s.url);
    const links = new Map();
    for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
      let u; try { u = new URL(decodeEntities(m[1]), base); } catch { continue; }
      if (u.hostname !== base.hostname || !u.pathname.startsWith(prefix) || u.pathname.replace(/\/$/, '') === prefix.replace(/\/$/, '')) continue;
      if (/\/(page|tag|category|author)\//.test(u.pathname)) continue;
      const key = u.origin + u.pathname;
      const text = stripHtml(m[2]).replace(/\s+/g, ' ').trim();
      if (!links.has(key) || text.length > (links.get(key) || '').length) links.set(key, text);
    }
    const out = [];
    for (const [url, text] of links) {
      if (out.length >= max) break;
      if (isKnown(url)) continue;
      if (text && text.split(/\s+/).length < 3) continue; // nav/category links ("Announcements", "Policy")
      try { out.push(await fetchArticle(url)); }
      catch { if (text.length > 15) out.push({ url, title: truncate(text, 160), summary: '', content: '' }); }
    }
    return out;
  }
};

// GitHub releases (Atom). Release titles are often just a tag ("v2.1.0"), so prefix the repository.
const github = {
  label: 'GitHub releases (Atom)',
  status: rss.status,
  collect: async (s) => {
    const repo = new URL(s.url).pathname.split('/').slice(1, 3).join('/');
    return (await rss.collect(s)).map(i => ({ ...i, title: i.title.toLowerCase().includes(repo.split('/')[1].toLowerCase()) ? i.title : `${repo} ${i.title}` }));
  }
};

// Manual sources hold user-submitted URLs; nothing to poll.
const manual = { label: 'Manual URL submissions', status: () => ({ ready: true }), collect: async () => [] };

export const connectors = { rss, blog: rss, docs: rss, research: rss, community: rss, github, page, x, manual };

export const connectorFor = (kind) => connectors[kind] || rss;
