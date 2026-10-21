// Purple -> BetterPitch teal/ocean hue mapping, shared by server.js (hex colours
// in CSS/SVG/HTML/JS) and recolor-images.js (pixels). Only purple-to-magenta hues
// move; skin tones, blues, greens and oranges are left alone, so photos of people
// and partner logos keep their colours.

// 0..1 weight of how "purple" a hue (degrees) is, feathered at the edges.
function purpleWeight(h, s) {
  let w = 0;
  if (h >= 250 && h <= 320) w = 1;
  else if (h > 235 && h < 250) w = (h - 235) / 15;
  else if (h > 320 && h < 338) w = (338 - h) / 18;
  return w * Math.min(1, s / 0.15);
}

// r,g,b 0..255 -> [r,g,b]; unchanged when not purple.
function shift(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (d < 1e-6) return null;
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  const w = purpleWeight(h, s);
  if (w <= 0) return null;
  // dark purples become deep ocean blue, light ones (lavender) a soft teal
  const dark = Math.max(0, Math.min(1, (0.5 - l) / 0.3));
  const target = 186 + 18 * dark;
  const nh = h + (target - h) * w;
  const ns = s * (1 - 0.2 * dark * w);
  const c = (1 - Math.abs(2 * l - 1)) * ns, x = c * (1 - Math.abs((nh / 60) % 2 - 1)), m = l - c / 2;
  const [r1, g1, b1] = nh < 60 ? [c, x, 0] : nh < 120 ? [x, c, 0] : nh < 180 ? [0, c, x] : nh < 240 ? [0, x, c] : nh < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r1 + m) * 255), Math.round((g1 + m) * 255), Math.round((b1 + m) * 255)];
}

const hexCache = new Map();
// Rewrites purple #rrggbb(aa) / #rgb(a) colours in text, keeping any alpha.
// Output keeps the exact length (Next.js RSC payloads carry byte-length prefixes).
function recolorHex(text) {
  return text.replace(/#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![0-9a-zA-Z_-])/g, (all, hex) => {
    if (hexCache.has(all)) return hexCache.get(all);
    const long = hex.length > 4;
    const full = long ? hex : hex.replace(/./g, ch => ch + ch);
    const out = shift(parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16));
    let res = all;
    if (out && long) res = '#' + out.map(v => v.toString(16).padStart(2, '0')).join('') + hex.slice(6);
    // short forms: round the shifted colour to one digit per channel
    else if (out) res = '#' + out.map(v => Math.round(v / 17).toString(16)).join('') + hex.slice(3);
    if (hex === hex.toUpperCase()) res = res.toUpperCase();
    hexCache.set(all, res);
    return res;
  });
}

if (typeof module !== 'undefined') module.exports = { shift, recolorHex, purpleWeight };
