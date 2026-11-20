// Test obciążenia: serwer w osobnym procesie, N botów przez WebSocket jeździ i chodzi po mieście.
// Mierzy czas kroku serwera i przepustowość na gracza; zapisuje raport w docs/RAPORT-MULTIPLAYER.md.
//   npm run bots                 # 8, 16, 32, 64 graczy, po 12 s na scenariusz
//   npm run bots -- --n 8,64 --sec 20
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { encodeInput, MSG_SNAPSHOT } from '@miasto/shared/net/protocol';
import { CITIES } from '@miasto/shared/data/cities';
import { ROOT } from './files';

const a = process.argv.slice(2), arg = (k: string, d: string) => { const i = a.indexOf('--' + k); return i >= 0 ? a[i + 1] : d; };
const COUNTS = arg('n', '8,16,32,64').split(',').map(Number), SEC = +arg('sec', '12'), PORT = 8799;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const srv = spawn(process.execPath, [...process.execArgv, join(ROOT, 'server/src/main.ts'), '--port', String(PORT), '--max', '64', '--sessions', '64'], { stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise<void>(res => srv.stdout!.on('data', d => { if (String(d).includes('Serwer gry')) res(); }));
const http = `http://localhost:${PORT}`;

interface Bot { ws: WebSocket; bytes: number; snaps: number; seq: number; timer: ReturnType<typeof setInterval> }

async function runBots(n: number, spread: boolean): Promise<Record<string, number>> {
  const st = CITIES.warszawa.st.length;
  const r = await fetch(`${http}/api/sessions`, { method: 'POST', body: JSON.stringify({ city: 'warszawa' }), headers: { 'Content-Type': 'application/json' } });
  const sess = (await r.json() as { id: string }).id, bots: Bot[] = [];
  for (let i = 0; i < n; i++) {
    const ws = new WebSocket(`ws://localhost:${PORT}/ws?session=${sess}&name=bot${i}`); ws.binaryType = 'arraybuffer';
    const b: Bot = { ws, bytes: 0, snaps: 0, seq: 0, timer: setInterval(() => {}, 1e9) };
    ws.onmessage = e => { const d = e.data as ArrayBuffer | string; b.bytes += typeof d === 'string' ? d.length : d.byteLength; if (typeof d !== 'string' && new DataView(d).getUint8(0) === MSG_SNAPSHOT) b.snaps++; };
    await new Promise<void>(res => { ws.onopen = () => res(); });
    // rozproszeni: każdy na innej stacji; skupieni: wszyscy przy jednej
    const station = spread ? Math.floor(i * st / n) : 12;
    ws.send(JSON.stringify({ t: 'cmd', c: { type: 'goStation', station, street: true } }));
    if (i % 3 !== 2) ws.send(JSON.stringify({ t: 'cmd', c: { type: 'mode', mode: i % 3 === 0 ? 'car' : 'heli' } }));
    clearInterval(b.timer);
    b.timer = setInterval(() => { // 30 Hz jak prawdziwy klient
      b.seq++; const t = b.seq / 30;
      if (ws.readyState === ws.OPEN) ws.send(encodeInput(b.seq, { f: .8, s: Math.sin(t * .5 + i) * .6, run: i % 2 === 0, brake: false, lift: i % 3 === 1 ? (t < 4 ? 1 : 0) : 0, yaw: t * .3 + i, pitch: 0 }));
    }, 1000 / 30);
    bots.push(b);
  }
  await sleep(3000); for (const b of bots) { b.bytes = 0; b.snaps = 0; }
  const samples: { tickMs: number; tickMsMax: number; entities: number; bytesPerClientPerSec: number }[] = [];
  const t0 = Date.now();
  while (Date.now() - t0 < SEC * 1000) { await sleep(2100); const s = (await (await fetch(`${http}/api/stats`)).json() as ({ id: string } & typeof samples[0])[]).find(x => x.id === sess); if (s) samples.push(s); }
  const sec = (Date.now() - t0) / 1000;
  for (const b of bots) { clearInterval(b.timer); b.ws.close(); }
  await sleep(500);
  const avg = (f: (x: typeof samples[0]) => number) => samples.reduce((s, x) => s + f(x), 0) / Math.max(1, samples.length);
  const inKB = bots.reduce((s, b) => s + b.bytes, 0) / n / sec / 1024;
  return { n, tickMs: avg(x => x.tickMs), tickMsMax: Math.max(...samples.map(x => x.tickMsMax)), entities: avg(x => x.entities), downKBs: inKB, snapsPerSec: bots.reduce((s, b) => s + b.snaps, 0) / n / sec, upKBs: 13 * 30 / 1024 };
}

const rows: string[] = [];
for (const spread of [true, false]) for (const n of COUNTS) {
  const r = await runBots(n, spread);
  const line = `| ${spread ? 'rozproszeni' : 'skupieni'} | ${n} | ${r.tickMs.toFixed(2)} | ${r.tickMsMax.toFixed(1)} | ${(r.tickMs / (1000 / 30) * 100).toFixed(1)}% | ${r.downKBs.toFixed(1)} | ${r.upKBs.toFixed(1)} | ${r.snapsPerSec.toFixed(1)} | ${Math.round(r.entities)} |`;
  console.log(line); rows.push(line);
}
srv.kill();
const report = `# Raport: test obciążenia serwera (boty)

Wygenerowany: ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC, \`npm run bots\` (${SEC} s na scenariusz, po 3 s rozgrzewki).
Maszyna: ${process.platform}, Node ${process.version}. Serwer w osobnym procesie, boty przez prawdziwe WebSockety na tym samym komputerze.
Świat: Warszawa z terenem, bez kafelków OSM (zablokowane pobieranie), więc kolizje z budynkami nie obciążają kroku.

Boty: 1/3 jeździ autem, 1/3 lata helikopterem, 1/3 chodzi; wejście 30 Hz jak prawdziwy klient.
„Rozproszeni” = każdy przy innej stacji; „skupieni” = wszyscy przy Świętokrzyskiej (najgorszy przypadek dla zarządzania zainteresowaniem).

| scenariusz | graczy | krok śr. [ms] | krok maks. [ms] | budżet kroku 33 ms | w dół [KB/s/gracza] | w górę [KB/s/gracza] | migawki/s | byty |
|---|---|---|---|---|---|---|---|---|
${rows.join('\n')}

`;
const out = join(ROOT, 'docs/RAPORT-MULTIPLAYER.md'), old = existsSync(out) ? readFileSync(out, 'utf8') : '', i = old.indexOf('## Wnioski');
writeFileSync(out, report + (i >= 0 ? old.slice(i) : '')); // wnioski pisane ręcznie zostają
console.log('raport: docs/RAPORT-MULTIPLAYER.md');
process.exit(0);
