// Wnętrza: wejście z ulicy do bloku przy Złotej 6 (prawdziwy budynek z OSM), klatka schodowa, okna fasady.
import { expect, test } from '@playwright/test';

type G = { __game: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
const ID = 30302703, DOOR = [-61.11, -373.84]; // Złota 6

test('wejście do bloku: drzwi w fasadzie, klatka schodowa w HUD', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => !!(window as unknown as G).__game.session?.player()), { timeout: 30_000 }).toBe(true);
  const go = () => page.evaluate(([x, z]) => (window as unknown as G).__game.session.sendCommand({ type: 'teleport', x, z }), DOOR);
  await go(); await page.waitForTimeout(3000); await go();
  await expect.poll(() => page.evaluate(id => (window as unknown as G).__game.world.interiors.live.has(id), ID), { timeout: 30_000 }).toBe(true);
  // okna na fasadzie: shader ma uniform z odsetkiem zapalonych okien, drzwi wycięte w ścianie
  expect(await page.evaluate(() => (window as unknown as G).__game.view.streamer.mats.windows.uDoorN.value)).toBeGreaterThan(0);
  // start: przed pierwszymi drzwiami z planu budynku (ten sam plan na serwerze i u klienta)
  const N = await page.evaluate(id => {
    const g = (window as unknown as G).__game, p = g.world.interiors.live.get(id).plan, e = p.ext[0], f = p.frame;
    const x = f.ox + f.ux * e.x + f.uz * (e.tOut + 1), z = f.oz + f.uz * e.x - f.ux * (e.tOut + 1);
    g.session.sendCommand({ type: 'teleport', x, z }); return [-f.uz, f.ux];
  }, ID);
  await page.waitForTimeout(1500);
  await page.evaluate(([a, b]) => { const g = (window as unknown as G).__game; g.viewYaw = Math.atan2(-a, -b); g.viewPitch = 0; }, N);
  await page.keyboard.down('w');
  await expect(page.locator('#loc')).toContainText('Klatka schodowa', { timeout: 40_000 });
  await page.keyboard.up('w');
  // serwer zgadza się z klientem: pieszy gracza jest w regionie wnętrza
  await expect.poll(() => page.evaluate(() => { const g = (window as unknown as G).__game, e = g.controlled(); return g.world.regions.get(e.reg)?.info.b ?? null; }), { timeout: 5_000 }).toBe(ID);
  expect(errors).toEqual([]);
});

test('przełącznik wnętrz: wyłączenie usuwa wnętrza (klient i serwer), gracz w środku wychodzi na ulicę', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => !!(window as unknown as G).__game.session?.player()), { timeout: 30_000 }).toBe(true);
  const go = () => page.evaluate(([x, z]) => (window as unknown as G).__game.session.sendCommand({ type: 'teleport', x, z }), DOOR);
  await go(); await page.waitForTimeout(3000); await go();
  await expect.poll(() => page.evaluate(id => (window as unknown as G).__game.world.interiors.live.has(id), ID), { timeout: 30_000 }).toBe(true);
  // wejdź do środka (teleport na podest klatki z planu)
  await page.evaluate(id => {
    const g = (window as unknown as G).__game, p = g.world.interiors.live.get(id).plan, c = p.cores.find((q: { sealed?: boolean }) => !q.sealed), f = p.frame;
    const lx = (c.r.x0 + c.r.x1) / 2, ly = c.r.y1 - 1;
    g.session.sendCommand({ type: 'teleport', x: f.ox + f.ux * lx - f.uz * ly, z: f.oz + f.uz * lx + f.ux * ly });
  }, ID);
  // menu: wyłącz wnętrza
  await page.evaluate(() => { const c = document.getElementById('intChk') as HTMLInputElement; c.checked = false; c.dispatchEvent(new Event('change')); });
  await expect.poll(() => page.evaluate(() => { const g = (window as unknown as G).__game; return g.world.interiors.live.size + g.interiors.group.children.length + g.view.streamer.mats.windows.uDoorN.value; }), { timeout: 5_000 }).toBe(0);
  await page.waitForTimeout(2000);
  expect(await page.evaluate(() => (window as unknown as G).__game.world.interiors.live.size)).toBe(0); // nie wracają same
  // gracz nie utknął: stoi na ulicy (poza wnętrzem) i może iść
  expect(await page.evaluate(() => { const g = (window as unknown as G).__game, e = g.controlled(); return g.world.regions.get(e.reg)?.info.b ?? null; })).toBeNull();
  expect(await page.evaluate(() => { try { return localStorage.getItem('mm.wnetrza'); } catch { return null; } })).toBe('0');
  // włącz z powrotem
  await page.evaluate(() => { const c = document.getElementById('intChk') as HTMLInputElement; c.checked = true; c.dispatchEvent(new Event('change')); });
  await expect.poll(() => page.evaluate(id => (window as unknown as G).__game.world.interiors.live.has(id), ID), { timeout: 15_000 }).toBe(true);
  expect(errors).toEqual([]);
});
