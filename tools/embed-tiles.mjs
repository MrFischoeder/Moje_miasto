// Wybiera kafle centrum miasta do wbudowania w wersję jednoplikową (client/embedded/<miasto>/).
//   node tools/embed-tiles.mjs [--city warszawa] [--station Świętokrzyska] [--radius 1500]
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
const ROOT = new URL('..', import.meta.url).pathname, a = process.argv.slice(2), arg = (k, d) => { const i = a.indexOf('--' + k); return i >= 0 ? a[i + 1] : d; };
const key = arg('city', 'warszawa'), R = +arg('radius', '1500'), cities = JSON.parse(readFileSync(join(ROOT, 'data/cities.json'), 'utf8')), city = cities[key];
const st = city.st.find(s => s[0] === arg('station', city.spawn)), kx = Math.cos(city.o[0] * Math.PI / 180) * 111320, ky = 110540;
const sx = (st[2] - city.o[1]) * kx, sz = -(st[1] - city.o[0]) * ky;
const src = join(ROOT, 'client/public/tiles', key), dst = join(ROOT, 'client/embedded', key);
if (existsSync(dst)) rmSync(dst, { recursive: true }); mkdirSync(dst, { recursive: true });
if (!existsSync(join(src, 'index.json'))) { console.log('brak kafli', key); process.exit(0); }
let n = 0, bytes = 0;
for (const [x, y, b] of JSON.parse(readFileSync(join(src, 'index.json'), 'utf8')).tiles) {
  const dx = Math.max(0, Math.abs((x + .5) * 500 - sx) - 250), dz = Math.max(0, Math.abs((y + .5) * 500 - sz) - 250);
  if (Math.hypot(dx, dz) > R) continue; copyFileSync(join(src, `${x}_${y}.json.gz`), join(dst, `${x}_${y}.json.gz`)); n++; bytes += b;
}
console.log(`wbudowane kafle ${key}: ${n} (${(bytes / 1e6).toFixed(1)} MB) wokół ${st[0]}`);
