// Uruchomienie serwera gry:  npm run server  [-- --port 8787 --max 64]
// Otwórz http://localhost:8787 (po `npm run build`) albo grę z `npm run dev` i wpisz adres serwera w menu.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_STATIC, GameServer } from './gameServer';
import { ROOT } from './files';

const a = process.argv.slice(2), arg = (k: string, d: string) => { const i = a.indexOf('--' + k); return i >= 0 ? a[i + 1] : d; };
const srv = new GameServer({
  port: +arg('port', process.env.PORT || '8787'), maxPlayers: +arg('max', '64'), maxSessions: +arg('sessions', '8'),
  dataFile: join(ROOT, 'server/data/players.json'), staticDir: existsSync(DEFAULT_STATIC) ? DEFAULT_STATIC : null,
  log: s => console.log(new Date().toISOString().slice(11, 19), s),
});
srv.createSession('wroclaw'); srv.createSession('warszawa'); srv.createSession('londyn');
const port = await srv.listen();
console.log(`Serwer gry: http://localhost:${port}  (WebSocket /ws, lobby /api/sessions, statystyki /api/stats)`);
if (!srv.opt.staticDir) console.log('Gra nie jest zbudowana: uruchom `npm run build` albo `npm run dev` i podaj adres serwera w menu.');
