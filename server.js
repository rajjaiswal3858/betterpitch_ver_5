// Replays the archive recorded by capture.js on http://localhost:PORT.
// Usage: node server.js   (PORT env var optional, default 5000)
// On Vercel the same handler runs as a function (api/index.js, vercel.json).
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { recolorHex } = require('./betterpitch/recolor');

const PORT = Number(process.env.PORT) || 5000;
const ARCHIVE = path.join(__dirname, 'archive');
const manifest = JSON.parse(fs.readFileSync(path.join(ARCHIVE, 'manifest.json'), 'utf8'));
// Images with purple swapped for the BetterPitch palette (made by recolor-images.js).
const RECOLORED = path.join(__dirname, 'betterpitch', 'recolored');
const recolored = new Set(fs.existsSync(RECOLORED) ? fs.readdirSync(RECOLORED) : []);
const SITE = 'www.artisan.co';
// Other archived hosts, served under /__ext/<host>. The dashboard hosts are the
// "Ava" web-chat widget: its loader, its iframe app and its API.
const EXT_HOSTS = [
  'images.ctfassets.net',
  'artisanai-storage.sfo3.cdn.digitaloceanspaces.com',
  'dashboard.artisan.co',
  'api.dashboard.artisan.co',
  'cdn.replica.tavus.io',
];
const CHAT_API = 'api.dashboard.artisan.co/api/public/web-chat/';

// Indexes for fuzzy fallbacks.
const imageByUrl = {};   // /_next/image?url=X  -> [{w, key}]
const rscByPath = {};    // pathname            -> key of any recorded ?_rsc= response
const extByPath = {};    // pathname            -> key on another archived host (the chat iframe
                         //                        requests root-relative /_next/... and /embed/...)
for (const key of Object.keys(manifest)) {
  if (key.startsWith('POST ')) continue;
  if (!key.startsWith(SITE + '/')) {
    extByPath[new URL('http://' + key).pathname] ||= key;
    continue;
  }
  const u = new URL('http://' + key);
  if (u.pathname === '/_next/image') {
    const src = u.searchParams.get('url');
    (imageByUrl[src] ||= []).push({ w: Number(u.searchParams.get('w')) || 0, key });
  } else if (u.searchParams.has('_rsc')) {
    rscByPath[u.pathname] ||= key;
  }
}

// Redirects the live site performs (checked with curl).
const REDIRECTS = {
  '/talk-to-sales': '/request-demo',
};

const TEXT_RE =/text\/|javascript|json|x-component|svg|xml/;

// Pages may only load from localhost (plus the few third parties listed), so
// analytics, ad pixels and session recorders injected by GTM or the chat
// widget can't phone home from the replica.
const ALLOWED = [
  'https://jobs.ashbyhq.com', 'https://app.ashbyhq.com', 'https://cdn.ashbyprd.com', // /careers job board
  'https://hatscripts.github.io', // flag icons
  'https://www.youtube.com', 'https://www.youtube-nocookie.com', 'https://i.ytimg.com', // video embeds
];
const CSP = [
  "default-src 'self' data: blob:",
  `script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: ${ALLOWED.join(' ')}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${ALLOWED.join(' ')}`,
  `connect-src 'self' ${ALLOWED.join(' ')}`,
  `frame-src 'self' ${ALLOWED.join(' ')}`,
].join('; ');

// Replacements must keep the exact byte length: Next.js embeds RSC "T" rows
// whose length prefix covers this text, and a mismatch breaks hydration
// ("Connection closed."). "https://www.artisan.co" (22 chars) becomes 22 chars
// of "/." segments, which URL resolution collapses to "/" - a root-relative
// link that works on any host or port; "/__ext//" is 8 chars, same as "https://".
const LOCAL_ORIGIN = '/.'.repeat(11);

function rewrite(body) {
  let s = body.toString('utf8');
  s = s.split('https://www.artisan.co').join(LOCAL_ORIGIN);
  // Only the chat widget's /embed/ URLs: other dashboard links (e.g. "Login" ->
  // /sign-in) must stay absolute, or Next.js treats them as in-site pages.
  // The loader URL is built as `${origin || "https://dashboard.artisan.co"}/embed/loader.js`.
  s = s.split('https://dashboard.artisan.co/embed/').join('/__ext//dashboard.artisan.co/embed/');
  s = s.split('"https://dashboard.artisan.co"').join('"/__ext//dashboard.artisan.co"');
  for (const h of EXT_HOSTS) if (h !== 'dashboard.artisan.co') s = s.split('https://' + h).join('/__ext//' + h);
  // purple hex colours -> BetterPitch palette (same length, so RSC prefixes stay valid)
  return recolorHex(s);
}

function lookup(u) {
  if (u.pathname.startsWith('/__ext/')) {
    const k = u.pathname.replace(/^\/__ext\/+/, '') + u.search;
    return manifest[k] ? k : null;
  }
  const exact = SITE + u.pathname + u.search;
  if (manifest[exact]) return exact;

  if (u.pathname === '/_next/image') {
    // Image URLs rewritten to /__ext/<host> by rewrite() come back here; map them to the original.
    const src = u.searchParams.get('url').replace(/^\/__ext\/+/, 'https://');
    const list = imageByUrl[src];
    if (!list) return null;
    const w = Number(u.searchParams.get('w')) || 0;
    return list.slice().sort((a, b) => Math.abs(a.w - w) - Math.abs(b.w - w))[0].key;
  }
  if (u.searchParams.has('_rsc')) return rscByPath[u.pathname] || null;

  // Same path without query string, and trailing-slash variants.
  const bare = u.pathname.replace(/\/+$/, '') || '/';
  for (const k of [SITE + bare, SITE + bare + '/']) if (manifest[k]) return k;
  return extByPath[u.pathname] || null;
}

// Archive file as served: recoloured image if there is one, text rewritten.
function load(entry) {
  const body = fs.readFileSync(recolored.has(entry.file) ? path.join(RECOLORED, entry.file) : path.join(ARCHIVE, 'files', entry.file));
  return TEXT_RE.test(entry.type) ? rewrite(body) : body;
}

// On Vercel the CDN may cache responses (the archive only changes with a new
// deployment, which clears the cache); locally always revalidate.
const CACHE = process.env.VERCEL ? 'public, max-age=0, s-maxage=31536000' : 'no-cache';

function send(req, res, entry) {
  let body = load(entry);
  const headers = { 'content-type': entry.type || 'application/octet-stream', 'cache-control': CACHE };
  if (/text\/html/.test(entry.type)) {
    headers['content-security-policy'] = CSP;
    // BetterPitch copy is swapped in on the client (betterpitch/content.js) so the
    // recorded markup and RSC payloads stay byte-identical.
    // The home page's first section is added the same way (betterpitch/hero.js).
    // The colour/motion theme is a stylesheet plus a small script (betterpitch/theme.*),
    // linked last so it wins over the recorded CSS.
    body = body.replace('</head>', '<link rel="stylesheet" href="/__bp/theme.css"><script src="/__bp/content.js"></script><script src="/__bp/hero.js"></script><script src="/__bp/theme.js"></script></head>');
  }
  // gzip text: smaller pages, and keeps big JSON/SVG under Vercel's 4.5 MB response limit
  if (typeof body === 'string' && body.length > 1024 && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
    body = zlib.gzipSync(body);
    headers['content-encoding'] = 'gzip';
    headers['vary'] = 'Accept-Encoding';
  }
  res.writeHead(entry.status, headers);
  res.end(body);
}

function handler(req, res) {
  const u = new URL(req.url, 'http://localhost');
  // Analytics endpoints (PostHog proxy) - answer with an empty success so nothing errors.
  const BP = { '/__bp/content.js': 'application/javascript', '/__bp/hero.js': 'application/javascript', '/__bp/hero.css': 'text/css', '/__bp/theme.css': 'text/css', '/__bp/theme.js': 'application/javascript' };
  if (BP[u.pathname]) {
    res.writeHead(200, { 'content-type': BP[u.pathname], 'cache-control': CACHE });
    return res.end(fs.readFileSync(path.join(__dirname, 'betterpitch', path.basename(u.pathname))));
  }
  if (u.pathname.startsWith('/ingest')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end('{}');
  }
  if (req.method !== 'GET') {
    // The chat widget's start-up calls (bootstrap, opener) were recorded, so the
    // panel renders as it does live. Anything else - sending a message, starting
    // a call - needs Artisan's live AI backend, which only accepts artisan.co.
    const k = 'POST ' + u.pathname.replace(/^\/__ext\/+/, '');
    if (manifest[k]) return send(req, res, manifest[k]);
    if (k.includes(CHAT_API)) {
      res.writeHead(503, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: { code: 'OFFLINE_REPLICA', message: 'Chat is not available in the local replica.' } }));
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end('{}');
  }
  const key = lookup(u);
  if (!key && REDIRECTS[u.pathname]) {
    res.writeHead(308, { location: REDIRECTS[u.pathname] });
    return res.end();
  }
  if (!key) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    return res.end('Not in archive: ' + u.pathname + u.search + '\nRun: node capture.js ' + u.pathname);
  }
  send(req, res, manifest[key]);
}

module.exports = { handler, manifest, load };

if (require.main === module) {
  http.createServer(handler).listen(PORT, () => console.log(`Artisan replica running at http://localhost:${PORT}`));
}
