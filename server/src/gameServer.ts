// Serwer gry: sesje (jedno miasto każda), WebSocket, API lobby, zapis postępu graczy w pliku.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync, createReadStream, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { CITIES, CITY_KEYS, type CityKey } from '@miasto/shared/data/cities';
import { Room } from '@miasto/shared/server/room';
import { SIM_DT } from '@miasto/shared/sim/loop';
import { World } from '@miasto/shared/world/world';
import { loadTerrain, loadTransit, ROOT, tileLoader } from './files';

export interface ServerOptions { port: number; maxPlayers: number; maxSessions: number; dataFile: string | null; staticDir: string | null; log: (s: string) => void }
interface Session { room: Room; city: CityKey; created: number }

const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.gz': 'application/gzip', '.woff2': 'font/woff2', '.woff': 'font/woff', '.png': 'image/png', '.svg': 'image/svg+xml' };

export class GameServer {
  readonly sessions = new Map<string, Session>();
  readonly http: Server;
  private wss: WebSocketServer;
  private timer: ReturnType<typeof setInterval> | null = null;
  private saved: Record<string, { x: number; y: number; z: number; yaw: number; money?: number }> = {};
  private nextSession = 1;

  constructor(readonly opt: ServerOptions) {
    if (opt.dataFile && existsSync(opt.dataFile)) try { this.saved = JSON.parse(readFileSync(opt.dataFile, 'utf8')); } catch { this.saved = {}; }
    this.http = createServer((q, r) => this.request(q, r));
    this.wss = new WebSocketServer({ server: this.http, path: '/ws', maxPayload: 64 * 1024 });
    this.wss.on('connection', (ws, req) => this.connect(ws, req));
  }

  createSession(city: CityKey): Session {
    const id = `${city}-${this.nextSession++}`, world = new World(city, { terrain: loadTerrain(city) });
    const room = new Room(id, world, tileLoader(city), { maxPlayers: this.opt.maxPlayers, dev: process.env.MIASTO_DEV !== '0' }, () => performance.now()); // dev: teleport z mapy telefonu
    const tr = loadTransit(city);
    if (tr) { const t = room.setTransit(tr); this.opt.log(`rozkłady ${CITIES[city].name}: ${t.tt.patterns.length} wzorców, metro w tunelach ${t.metro.ok}`); }
    room.enableTraffic();
    room.onLeave = (p, pos) => { this.saved[`${city}:${p.name}`] = pos; this.persist(); };
    const s = { room, city, created: Date.now() }; this.sessions.set(id, s);
    this.opt.log(`sesja ${id} (${CITIES[city].name})`);
    return s;
  }

  listen(): Promise<number> {
    return new Promise(res => this.http.listen(this.opt.port, () => {
      const a = this.http.address(); const port = typeof a === 'object' && a ? a.port : this.opt.port;
      this.startLoop(); res(port);
    }));
  }

  /** Stały krok 30 Hz z nadrabianiem (bez dryfu setInterval). */
  private startLoop(): void {
    let last = performance.now(), acc = 0;
    this.timer = setInterval(() => {
      const now = performance.now(); acc += Math.min(.25, (now - last) / 1000); last = now;
      while (acc >= SIM_DT) { acc -= SIM_DT; for (const s of this.sessions.values()) s.room.tick(); }
    }, 5);
  }

  async close(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    for (const c of this.wss.clients) c.terminate();
    await new Promise<void>(r => this.wss.close(() => r()));
    await new Promise<void>(r => this.http.close(() => r()));
  }

  private persist(): void {
    if (!this.opt.dataFile) return;
    try { mkdirSync(join(this.opt.dataFile, '..'), { recursive: true }); writeFileSync(this.opt.dataFile, JSON.stringify(this.saved)); } catch (e) { this.opt.log('zapis: ' + (e as Error).message); }
  }

  private connect(ws: WebSocket, req: IncomingMessage): void {
    const u = new URL(req.url || '/', 'http://x'), s = this.sessions.get(u.searchParams.get('session') || '');
    if (!s) { ws.send(JSON.stringify({ t: 'error', text: 'Nie ma takiej sesji' })); ws.close(); return; }
    const name = (u.searchParams.get('name') || 'Gracz').slice(0, 20);
    const conn = { send: (d: ArrayBuffer | string) => { if (ws.readyState === ws.OPEN) ws.send(d); }, close: () => ws.close() };
    const pid = s.room.join(conn, name, this.saved[`${s.city}:${name}`]);
    if (pid == null) return;
    this.opt.log(`${name} -> ${s.room.id} (${s.room.clients.size}/${s.room.opt.maxPlayers})`);
    ws.on('message', (data, isBinary) => {
      if (isBinary) { const b = data as Buffer; s.room.message(pid, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer); }
      else s.room.message(pid, data.toString());
    });
    ws.on('close', () => { s.room.leave(pid); this.opt.log(`${name} wychodzi z ${s.room.id}`); });
  }

  private request(q: IncomingMessage, r: ServerResponse): void {
    r.setHeader('Access-Control-Allow-Origin', '*'); r.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    const u = new URL(q.url || '/', 'http://x');
    const json = (code: number, body: unknown) => { r.writeHead(code, { 'Content-Type': 'application/json' }); r.end(JSON.stringify(body)); };
    if (q.method === 'OPTIONS') { r.writeHead(204); r.end(); return; }
    if (u.pathname === '/api/sessions' && q.method === 'GET') {
      json(200, [...this.sessions.entries()].map(([id, s]) => ({ id, city: s.city, cityName: CITIES[s.city].name, players: s.room.clients.size, max: s.room.opt.maxPlayers })));
      return;
    }
    if (u.pathname === '/api/sessions' && q.method === 'POST') {
      let body = ''; q.on('data', c => { body += c; if (body.length > 1000) q.destroy(); });
      q.on('end', () => {
        let city: CityKey; try { city = JSON.parse(body).city; } catch { json(400, 'Zły format'); return; }
        if (!CITY_KEYS.includes(city)) { json(400, 'Nieznane miasto'); return; }
        if (this.sessions.size >= this.opt.maxSessions) { json(429, 'Za dużo sesji na serwerze'); return; }
        const s = this.createSession(city); json(200, { id: s.room.id, city, cityName: CITIES[city].name, players: 0, max: s.room.opt.maxPlayers });
      });
      return;
    }
    if (u.pathname === '/api/stats') { json(200, [...this.sessions.values()].map(s => ({ id: s.room.id, ...s.room.stats }))); return; }
    // zbudowana gra (client/dist) – znajomi otwierają po prostu adres serwera
    if (this.opt.staticDir && q.method === 'GET') {
      const p = normalize(decodeURIComponent(u.pathname)).replace(/^(\.\.[/\\])+/, ''), f = join(this.opt.staticDir, p === '/' ? 'index.html' : p);
      if (f.startsWith(this.opt.staticDir) && existsSync(f) && statSync(f).isFile()) { r.writeHead(200, { 'Content-Type': MIME[extname(f)] || 'application/octet-stream' }); createReadStream(f).pipe(r); return; }
    }
    json(404, 'Nie znaleziono');
  }
}

export const DEFAULT_STATIC = join(ROOT, 'client/dist');
