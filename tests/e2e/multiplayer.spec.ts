// Dwóch graczy na serwerze: lobby, widoczność, czat, wsiadanie jako pasażer, przewidywanie ruchu.
import { expect, test, type Page } from '@playwright/test';

type G = { __game: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
const SERVER = 'http://localhost:8788';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g = <T>(page: Page, f: (g: any) => T) => page.evaluate(`(${f.toString()})(window.__game)`) as Promise<T>;

async function joinAs(page: Page, nick: string, session: string): Promise<void> {
  // test sieci, nie miasta: bez kafli (renderowanie programowe w testach jest wolne)
  await page.route(/\/tiles\/(warszawa|londyn)\/index\.json/, r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ v: 1, city: 'warszawa', size: 500, tiles: [], generated: '', source: 'test' }) }));
  await page.goto('/');
  await expect(page.locator('#cityName')).toHaveText('WARSZAWA');
  await page.locator('#menuBtn').click();
  await page.locator('#nick').fill(nick); await page.locator('#nick').dispatchEvent('change');
  await page.locator('#server').fill(SERVER); await page.locator('#server').dispatchEvent('change');
  await page.locator('#refreshBtn').click();
  const row = page.locator('#sessList .s', { hasText: 'Warszawa' }).first();
  await expect(row).toBeVisible();
  await page.evaluate(([s, n, srv]) => (window as unknown as G).__game.joinOnline(srv, s, n), [session, nick, SERVER]);
  await expect.poll(() => g(page, x => !!x.online && !!x.session?.player())).toBe(true);
}

test('dwóch graczy: widoczność, czat, pasażer', async ({ browser }) => {
  const r = await fetch(`${SERVER}/api/sessions`, { method: 'POST', body: JSON.stringify({ city: 'warszawa' }), headers: { 'Content-Type': 'application/json' } });
  const sess = (await r.json() as { id: string }).id;
  const pa = await browser.newPage(), pb = await browser.newPage();
  const errors: string[] = [];
  for (const p of [pa, pb]) { p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); }
  await joinAs(pa, 'Ala', sess); await joinAs(pb, 'Bob', sess);
  await expect.poll(() => g(pa, x => x.session.players.size)).toBe(2);
  await expect(pa.locator('#info')).toContainText('sieć: 2 graczy');

  // czat
  await pa.keyboard.press('KeyT'); await pa.locator('#chatIn').fill('cześć Bob'); await pa.locator('#chatIn').press('Enter');
  await expect(pb.locator('#chatLog')).toContainText('Ala: cześć Bob');

  // Ala wychodzi na ulicę i bierze helikopter; Bob staje obok i wsiada jako pasażer (E)
  await g(pa, x => x.goStation(12, true));
  await g(pb, x => x.goStation(12, true));
  await expect.poll(() => g(pa, x => x.controlled()?.reg ?? 0)).toBe(-1);
  await pa.evaluate(() => (window as unknown as G).__game.action('modeHeli'));
  await expect(pa.locator('#loc')).toContainText('Helikopter');
  // Bob widzi postać Ali? (Ala w aucie: postać ukryta, widać auto)
  const carId = await g(pa, x => x.session.player().vehicle);
  await expect.poll(() => pb.evaluate(id => [...(window as unknown as G).__game.session.entities()].some((e: { id: number }) => e.id === id), carId), { timeout: 10_000 }).toBe(true);
  // Bob podchodzi do auta (teleport obok przez polecenie serwera nie istnieje: idzie w stronę auta)
  for (let i = 0; i < 40; i++) {
    const d = await pb.evaluate((id) => { const G2 = (window as unknown as G).__game, me = G2.controlled(), car = G2.session.entity(id); if (!car) return 99;
      G2.viewYaw = Math.atan2(-(car.x - me.x), -(car.z - me.z)); return Math.hypot(car.x - me.x, car.z - me.z); }, carId);
    if (d < 3.5) break;
    await pb.keyboard.down('KeyW'); await pb.waitForTimeout(150); await pb.keyboard.up('KeyW');
  }
  await pb.evaluate(() => (window as unknown as G).__game.action('interact'));
  await expect.poll(() => g(pb, x => x.isPassenger)).toBe(true);
  expect(await g(pb, x => x.session.player().vehicle)).toBe(carId);
  // Ala wznosi się; Bob leci razem z nią
  const before = await g(pb, x => ({ ...x.pose }));
  await pa.bringToFront(); await pa.keyboard.down('Space'); await pa.waitForTimeout(2500); await pa.keyboard.up('Space'); await pb.bringToFront(); await pb.waitForTimeout(500);
  const after = await g(pb, x => ({ ...x.pose }));
  expect(after.y - before.y).toBeGreaterThan(5);
  // Bob wysiada
  await pb.evaluate(() => (window as unknown as G).__game.action('modeWalk'));
  await expect.poll(() => g(pb, x => x.isPassenger)).toBe(false);
  expect(errors).toEqual([]);
});
