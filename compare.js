// Screenshots each page on the live site and the local replica at the same
// viewport sizes, one viewport-sized segment at a time down the page (the site
// scrolls inside #page-scroller, so full-page screenshots only show the top),
// and reports how many pixels differ per segment, plus missing files / JS
// errors on the local side. server.js must be running.
// Usage: node compare.js [paths...]   (defaults to pages.txt)
// Output: comparisons/<page>@<width>/<n>.{live,local,diff}.png and comparisons/report.json
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const { scrollThrough, scrollTo } = require('./scroller');
const { decode, encode } = require('./png');

const LIVE = 'https://www.artisan.co';
const LOCAL = process.env.BASE || 'http://localhost:5000';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = path.join(__dirname, 'comparisons');
const BLOCK_RE = /googletagmanager|google-analytics|posthog|facebook|licdn|cookiebot|chilipiper|hotjar|clarity|doubleclick|hubspot|intercom|segment|withsherpa|leadresponse/;
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 768, height: 1024, isMobile: true, hasTouch: true },
  { width: 375, height: 812, isMobile: true, hasTouch: true },
];
const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const MAX_SEGMENTS = 40;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shoot(browser, base, p, vp, problems) {
  const page = await browser.newPage();
  await page.setViewport(vp);
  if (vp.isMobile) await page.setUserAgent(MOBILE_UA);
  await page.setRequestInterception(true);
  page.on('request', (r) => (BLOCK_RE.test(new URL(r.url()).host) ? r.abort() : r.continue()));
  if (problems) {
    page.on('response', (r) => { if (r.url().startsWith(base) && r.status() >= 400) problems.push(`missing ${r.status()} ${r.url().slice(base.length)}`); });
    page.on('pageerror', (e) => problems.push('error ' + e.message.split('\n')[0].slice(0, 100)));
  }
  await page.goto(base + p, { waitUntil: 'networkidle2', timeout: 90000 }).catch((e) => problems && problems.push(e.message));
  await scrollThrough(page, 200);
  await page.waitForNetworkIdle({ idleTime: 1000, timeout: 15000 }).catch(() => {});
  const shots = [];
  let height = 0;
  for (let i = 0; i < MAX_SEGMENTS; i++) {
    const pos = await scrollTo(page, i * vp.height);
    height = pos.height;
    if (i && pos.y < i * vp.height - vp.height / 2) break; // reached the bottom
    await sleep(1200); // let scroll-triggered animations play
    shots.push(await page.screenshot());
  }
  await page.close();
  return { shots, height };
}

// Pixel diff of two screenshots; differing pixels are red on a faded copy of the live shot.
function diff(a, b) {
  const A = decode(a), B = decode(b);
  const w = Math.min(A.width, B.width), h = Math.min(A.height, B.height);
  const out = { width: w, height: h, data: Buffer.alloc(w * h * 4) };
  let n = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * A.width + x) * 4, j = (y * B.width + x) * 4, o = (y * w + x) * 4;
      const hit = Math.abs(A.data[i] - B.data[j]) + Math.abs(A.data[i + 1] - B.data[j + 1]) + Math.abs(A.data[i + 2] - B.data[j + 2]) > 48;
      if (hit) { n++; out.data[o] = 255; } else out.data[o] = out.data[o + 1] = out.data[o + 2] = (A.data[i] + A.data[i + 1] + A.data[i + 2]) / 9 + 170;
      out.data[o + 3] = 255;
    }
  }
  return { pct: (100 * n) / (w * h), png: encode(out) };
}

(async () => {
  const pages = process.argv.slice(2).length
    ? process.argv.slice(2)
    : fs.readFileSync(path.join(__dirname, 'pages.txt'), 'utf8').split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith('#'));
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'], protocolTimeout: 300000 });
  const reportFile = path.join(OUT, 'report.json');
  const report = fs.existsSync(reportFile) ? JSON.parse(fs.readFileSync(reportFile, 'utf8')) : {};
  for (const p of pages) {
    for (const vp of VIEWPORTS) {
      const problems = [];
      // One page at a time: a background tab's timers are throttled, which stalls scrolling.
      const live = await shoot(browser, LIVE, p, vp);
      const local = await shoot(browser, LOCAL, p, vp, problems);
      const name = `${p === '/' ? 'home' : p.slice(1).replace(/\//g, '_')}@${vp.width}`;
      const dir = path.join(OUT, name);
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(dir, { recursive: true });
      const segments = [];
      for (let i = 0; i < Math.max(live.shots.length, local.shots.length); i++) {
        const a = live.shots[i], b = local.shots[i];
        if (a) fs.writeFileSync(path.join(dir, `${i}.live.png`), a);
        if (b) fs.writeFileSync(path.join(dir, `${i}.local.png`), b);
        if (!a || !b) { segments.push(100); continue; }
        const d = diff(a, b);
        fs.writeFileSync(path.join(dir, `${i}.diff.png`), d.png);
        segments.push(+d.pct.toFixed(1));
      }
      const avg = +(segments.reduce((s, x) => s + x, 0) / segments.length).toFixed(1);
      report[name] = { page: p, width: vp.width, avgDiffPct: avg, segments, liveHeight: live.height, localHeight: local.height, problems: [...new Set(problems)] };
      console.log(`${String(avg).padStart(5)}% avg  h ${live.height}/${local.height}  ${name}  [${segments.join(' ')}]`);
      for (const pr of report[name].problems) console.log('         ' + pr);
      fs.writeFileSync(reportFile, JSON.stringify(report, null, 1));
    }
  }
  await browser.close();
})();
