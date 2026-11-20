// Outbound fetches of user- or feed-supplied URLs (feeds, article pages, image imports) go through safeFetch:
// http(s) only, the host is resolved first and every address must be public (no loopback, private, link-local,
// CGNAT, multicast, IPv6 ULA ...), and each redirect hop is checked again before it is followed.
//
// Limits, stated honestly: the HTTP client resolves the name again when it connects, so a hostile DNS server could
// still swap answers between the check and the connect (DNS rebinding). For a single-user app on a home network
// this closes the easy paths (http://127.0.0.1:4317/api/..., http://192.168.1.1/, http://169.254.169.254/).
import dns from 'node:dns/promises';
import net from 'node:net';

const fail = (msg) => Object.assign(new Error(msg), { status: 400, code: 'EBLOCKED' });

function v4parts(ip) { return ip.split('.').map(Number); }

/** True if the address must not be fetched (anything that is not a public unicast address). */
export function isBlockedIp(ip) {
  ip = String(ip || '').trim().replace(/^\[|\]$/g, '').split('%')[0];
  const fam = net.isIP(ip);
  if (fam === 4) {
    const [a, b] = v4parts(ip);
    return a === 0 || a === 10 || a === 127 || a >= 224 ||                 // this-network, private, loopback, multicast/reserved
      (a === 100 && b >= 64 && b <= 127) ||                               // CGNAT 100.64/10 (Tailscale lives here)
      (a === 169 && b === 254) ||                                         // link-local, cloud metadata
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||    // private
      (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19));    // IETF protocol assignments, benchmarking
  }
  if (fam === 6) {
    const x = ip.toLowerCase();
    if (x === '::' || x === '::1') return true;
    const mapped = x.match(/^::ffff:(?:0:)?(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isBlockedIp(mapped[1]);
    const hex = x.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hex) { const n = (parseInt(hex[1], 16) << 16) | parseInt(hex[2], 16); return isBlockedIp([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.')); }
    const first = parseInt(x.split(':')[0] || '0', 16);
    return (first & 0xfe00) === 0xfc00 ||   // fc00::/7 unique local
      (first & 0xffc0) === 0xfe80 ||         // fe80::/10 link-local
      (first & 0xffc0) === 0xfec0 ||         // fec0::/10 site-local (deprecated)
      (first & 0xff00) === 0xff00 ||         // multicast
      x.startsWith('64:ff9b:') ||            // NAT64 (could reach v4 private space)
      x.startsWith('2001:db8:') || x.startsWith('2002:'); // documentation, 6to4
  }
  return true; // not an IP at all
}

const LOCAL_NAMES = /^(localhost|.*\.localhost|.*\.local|.*\.internal|.*\.lan|.*\.home|.*\.home\.arpa|.*\.ts\.net)$/i;
const viaProxy = () => process.env.NODE_USE_ENV_PROXY === '1' && !!(process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy);

/**
 * Throws unless every address `hostname` resolves to is public. `lookup` is injectable for tests.
 * Behind an outbound proxy that resolves names itself (NODE_USE_ENV_PROXY=1 with HTTPS_PROXY set, as in some
 * sandboxes), a name the local resolver can't find is allowed if it is a dotted public-looking name; IP literals
 * and local names are still checked.
 */
export async function assertPublicHost(hostname, { lookup = (h) => dns.lookup(h, { all: true, verbatim: true }), proxyResolves = viaProxy() } = {}) {
  const host = String(hostname || '').replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (!host) throw fail('URL has no host');
  if (net.isIP(host)) { if (isBlockedIp(host)) throw fail(`Blocked address ${host}: Byline only fetches public internet addresses.`); return [host]; }
  if (LOCAL_NAMES.test(host) || !host.includes('.')) throw fail(`Blocked host ${host}: Byline only fetches public internet addresses.`);
  let addrs;
  try { addrs = (await lookup(host)).map(a => (typeof a === 'string' ? a : a.address)); }
  catch (e) {
    if (proxyResolves && ['ENOTFOUND', 'EAI_AGAIN', 'ESERVFAIL'].includes(e.code)) return [];
    throw Object.assign(new Error(`Could not resolve ${host} (${e.code || e.message})`), { status: 502 });
  }
  if (!addrs.length) throw Object.assign(new Error(`Could not resolve ${host}`), { status: 502 });
  const bad = addrs.find(isBlockedIp);
  if (bad) throw fail(`Blocked host ${host} (resolves to ${bad}): Byline only fetches public internet addresses.`);
  return addrs;
}

/** Throws unless `url` is an http(s) URL on a public host. */
export async function assertPublicUrl(url, opts) {
  let u;
  try { u = new URL(url); } catch { throw fail('Invalid URL'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw fail('Only http(s) URLs can be fetched');
  if (u.username || u.password) throw fail('URLs with credentials are not fetched');
  await assertPublicHost(u.hostname, opts);
  return u;
}

/**
 * fetch() for untrusted URLs: the host is checked before the request and on every redirect (max 5 hops).
 * Same options as fetch; `redirect` is always handled here. Extra option: `lookup` (tests).
 */
export async function safeFetch(url, { lookup, maxRedirects = 5, ...init } = {}) {
  let current = String(url);
  for (let hop = 0; hop <= maxRedirects; hop++) {
    await assertPublicUrl(current, lookup ? { lookup } : undefined);
    const res = await fetch(current, { ...init, redirect: 'manual' });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = new URL(res.headers.get('location'), current).toString();
      try { await res.body?.cancel(); } catch { /* ignore */ }
      if (init.method && !['GET', 'HEAD'].includes(init.method.toUpperCase()) && res.status !== 307 && res.status !== 308) { init = { ...init, method: 'GET', body: undefined }; }
      continue;
    }
    return res;
  }
  throw Object.assign(new Error('Too many redirects'), { status: 502 });
}
