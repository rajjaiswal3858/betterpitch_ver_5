// Recolours purple in the archived raster images to the BetterPitch palette
// (same hue mapping as betterpitch/recolor.js) and writes the results to
// betterpitch/recolored/<archive file name>; server.js serves those in place of
// the originals. Pixels are decoded/encoded by headless Chrome/Edge, so no image
// library is needed. Re-run after a new capture: node recolor-images.js
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const { shift, purpleWeight } = require('./betterpitch/recolor');

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const ARCHIVE = path.join(__dirname, 'archive');
const OUT = path.join(__dirname, 'betterpitch', 'recolored');
const MIN_PURPLE = 0.003; // share of visible pixels that must be purple before an image is touched

(async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ARCHIVE, 'manifest.json'), 'utf8'));
  const jobs = new Map();
  for (const v of Object.values(manifest)) if (/^image\/(webp|png|jpeg)$/.test(v.type)) jobs.set(v.file, v.type);
  fs.mkdirSync(OUT, { recursive: true });

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage();
  await page.evaluate(`window.purpleWeight = ${purpleWeight}; window.shift = ${shift};`);

  let done = 0, changed = 0, skipped = 0;
  for (const [file, type] of jobs) {
    const buf = fs.readFileSync(path.join(ARCHIVE, 'files', file));
    // animated WebP: canvas would keep only the first frame
    if (type === 'image/webp' && buf.subarray(0, 4096).includes('ANIM')) { skipped++; continue; }
    const res = await page.evaluate(async (b64, type, minPurple) => {
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      let bmp;
      try { bmp = await createImageBitmap(new Blob([bytes], { type })); } catch { return { err: 'decode' }; }
      const cv = new OffscreenCanvas(bmp.width, bmp.height), ctx = cv.getContext('2d');
      ctx.drawImage(bmp, 0, 0);
      const img = ctx.getImageData(0, 0, cv.width, cv.height), px = img.data;
      let visible = 0, purple = 0;
      const cache = new Map();
      for (let i = 0; i < px.length; i += 4) {
        if (px[i + 3] < 8) continue;
        visible++;
        const key = (px[i] << 16) | (px[i + 1] << 8) | px[i + 2];
        let out = cache.get(key);
        if (out === undefined) { out = shift(px[i], px[i + 1], px[i + 2]); cache.set(key, out); }
        if (!out) continue;
        purple++;
        px[i] = out[0]; px[i + 1] = out[1]; px[i + 2] = out[2];
      }
      if (!visible || purple / visible < minPurple) return { share: purple / (visible || 1) };
      ctx.putImageData(img, 0, 0);
      const blob = await cv.convertToBlob(type === 'image/png' ? { type } : { type, quality: 0.92 });
      const out = new Uint8Array(await blob.arrayBuffer());
      let s = '';
      for (let i = 0; i < out.length; i += 0x8000) s += String.fromCharCode.apply(null, out.subarray(i, i + 0x8000));
      return { share: purple / visible, data: btoa(s) };
    }, buf.toString('base64'), type, MIN_PURPLE);
    if (res.data) { fs.writeFileSync(path.join(OUT, file), Buffer.from(res.data, 'base64')); changed++; }
    if (++done % 50 === 0) console.log(`${done}/${jobs.size} checked, ${changed} recoloured`);
  }
  await browser.close();
  console.log(`done: ${changed} recoloured, ${done - changed} unchanged, ${skipped} animated skipped -> ${path.relative(__dirname, OUT)}`);
})();
