// Vercel build step (vercel.json "buildCommand"). Everything is served by the
// api/ function, except archive files too big for a function response (4.5 MB
// limit): those are written, already rewritten/recoloured, to public/ at their
// URL path so Vercel's CDN serves them as static files.
const fs = require('fs');
const path = require('path');
const { manifest, load } = require('./server.js');

const OUT = path.join(__dirname, 'public');
const LIMIT = 4 * 1024 * 1024;

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
let n = 0;
for (const [key, entry] of Object.entries(manifest)) {
  if (key.startsWith('POST ') || !key.startsWith('www.artisan.co/')) continue;
  if (fs.statSync(path.join(__dirname, 'archive', 'files', entry.file)).size < LIMIT) continue;
  const file = path.join(OUT, decodeURIComponent(new URL('http://' + key).pathname));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, load(entry));
  console.log('static:', path.relative(OUT, file));
  n++;
}
console.log(`public/ ready (${n} large files served statically)`);
