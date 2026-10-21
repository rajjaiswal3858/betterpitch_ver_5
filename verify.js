// Loads pages from the local replica (server.js must be running) and reports
// requests missing from the archive, JS errors, and saves screenshots.
// Usage: node verify.js [paths...]   (defaults to pages.txt)
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const { scrollThrough } = require('./scroller');

const BASE = process.env.BASE || 'http://localhost:5000';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SHOTS = path.join(__dirname, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

(async () => {
  const pages = process.argv.slice(2).length
    ? process.argv.slice(2)
    : fs.readFileSync(path.join(__dirname, 'pages.txt'), 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
  let problems = 0;
  for (const p of pages) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    const missing = new Set();
    const errors = [];
    page.on('response', (r) => {
      if (r.url().startsWith(BASE) && r.status() >= 400) missing.add(r.status() + ' ' + r.url().slice(BASE.length));
    });
    let blocked = 0;
    page.on('pageerror', (e) => {
      // Trackers' fetches refused by server.js's CSP reject with a bare "Failed to fetch";
      // missing local files are caught as 404s above, so these aren't page faults.
      if (e.message === 'Failed to fetch') blocked++;
      else errors.push(e.message.split('\n')[0]);
    });
    await page.goto(BASE + p, { waitUntil: 'networkidle2', timeout: 60000 }).catch((e) => errors.push(e.message));
    await scrollThrough(page, 120);
    await page.waitForNetworkIdle({ idleTime: 1000, timeout: 15000 }).catch(() => {});
    const name = (p === '/' ? 'home' : p.slice(1).replace(/\//g, '_')) + '.png';
    await page.screenshot({ path: path.join(SHOTS, name) });
    const ok = !missing.size && !errors.length;
    if (!ok) problems++;
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${p}${blocked ? `  (${blocked} blocked tracker fetches)` : ''}`);
    for (const m of missing) console.log('     missing ' + m);
    for (const e of errors) console.log('     error   ' + e);
    await page.close();
  }
  await browser.close();
  console.log(`\n${pages.length - problems}/${pages.length} pages clean.`);
})();
