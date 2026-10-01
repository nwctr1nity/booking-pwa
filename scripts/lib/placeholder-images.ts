// Placeholder artwork for demo/new tenants (no stock photos involved):
// a monogram logo and stylised car scenes rendered from SVG with sharp.
// Real owner photos always replace these.
import sharp from 'sharp';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function monogram(name: string) {
  const words = name.replace(/[«»"']/g, '').split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? words[0][0] + words[1][0] : words[0]?.slice(0, 2) ?? '?';
  return letters.toUpperCase();
}

export async function renderLogo(name: string, accent: string, size = 1024) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">
    <defs>
      <radialGradient id="g" cx="30%" cy="20%" r="90%">
        <stop offset="0" stop-color="#1b1d22"/><stop offset="1" stop-color="#050506"/>
      </radialGradient>
    </defs>
    <rect width="1024" height="1024" fill="url(#g)"/>
    <circle cx="512" cy="512" r="330" fill="none" stroke="${accent}" stroke-width="28" opacity="0.9"/>
    <text x="512" y="600" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-weight="700"
      font-size="250" fill="#ffffff" letter-spacing="-6">${esc(monogram(name))}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

const carPath =
  'M120 470 C150 420 230 380 330 360 L470 290 C520 265 600 255 690 258 C800 262 880 300 950 360 L1060 380 C1110 390 1140 420 1150 460 L1160 520 C1160 540 1145 552 1125 552 L1060 552 A90 90 0 0 0 880 552 L420 552 A90 90 0 0 0 240 552 L150 552 C128 552 112 538 112 516 Z';

export async function renderScene(opts: { width: number; height: number; accent: string; hue?: number; seed?: number; label?: string }) {
  const { width, height, accent } = opts;
  const seed = opts.seed ?? 1;
  const hue = opts.hue ?? 215;
  const flip = seed % 2 === 1 ? 'scale(-1,1) translate(-1280,0)' : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 1280 800" preserveAspectRatio="xMidYMid slice">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="hsl(${hue},18%,9%)"/><stop offset="0.62" stop-color="hsl(${hue},14%,5%)"/>
        <stop offset="1" stop-color="#000"/>
      </linearGradient>
      <radialGradient id="spot" cx="${45 + (seed % 3) * 10}%" cy="8%" r="70%">
        <stop offset="0" stop-color="${accent}" stop-opacity="0.38"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="body" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="hsl(${hue},10%,${22 + (seed % 3) * 4}%)"/><stop offset="0.55" stop-color="hsl(${hue},12%,8%)"/>
        <stop offset="1" stop-color="#020203"/>
      </linearGradient>
      <linearGradient id="glare" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="0.5" stop-color="#fff" stop-opacity="0.55"/>
        <stop offset="1" stop-color="#fff" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <rect width="1280" height="800" fill="url(#bg)"/>
    <rect width="1280" height="800" fill="url(#spot)"/>
    ${Array.from({ length: 7 }, (_, i) => `<rect x="${110 + i * 160}" y="40" width="70" height="6" rx="3" fill="#fff" opacity="${0.5 - i * 0.04}"/>`).join('')}
    <ellipse cx="640" cy="640" rx="560" ry="40" fill="#000" opacity="0.8"/>
    <g transform="${flip} translate(0,70)">
      <path d="${carPath}" fill="url(#body)" stroke="hsl(${hue},20%,30%)" stroke-width="2"/>
      <path d="M470 300 C520 278 600 270 690 272 C780 275 850 305 905 352 L520 352 Z" fill="hsl(${hue},30%,14%)" opacity="0.9"/>
      <path d="M330 372 C520 352 820 350 1050 386" stroke="url(#glare)" stroke-width="6" fill="none"/>
      <circle cx="330" cy="552" r="72" fill="#0b0b0d" stroke="#2a2c31" stroke-width="10"/>
      <circle cx="330" cy="552" r="34" fill="#16181c" stroke="${accent}" stroke-opacity="0.5" stroke-width="3"/>
      <circle cx="970" cy="552" r="72" fill="#0b0b0d" stroke="#2a2c31" stroke-width="10"/>
      <circle cx="970" cy="552" r="34" fill="#16181c" stroke="${accent}" stroke-opacity="0.5" stroke-width="3"/>
      <rect x="1100" y="430" width="44" height="14" rx="7" fill="${accent}" opacity="0.9"/>
    </g>
    <rect y="700" width="1280" height="100" fill="#000" opacity="0.55"/>
    ${opts.label ? `<text x="1240" y="770" text-anchor="end" font-family="DejaVu Sans, Arial" font-size="22" fill="#fff" opacity="0.45">${esc(opts.label)}</text>` : ''}
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
}
