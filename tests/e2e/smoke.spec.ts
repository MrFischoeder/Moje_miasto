// Test dymny: start, Warszawa, przejście peronem do tunelu, wyjście na ulicę, Londyn, brak błędów w konsoli.
import { expect, test, type Page } from '@playwright/test';

type G = { __game: any }; // eslint-disable-line @typescript-eslint/no-explicit-any

const regionKind = (page: Page) => page.evaluate(() => {
  const g = (window as unknown as G).__game, e = g.controlled();
  return e.reg >= 0 ? g.world.regions.list[e.reg].kind : 'street';
});

const noTiles = (page: Page) => page.route(/\/tiles\/(warszawa|londyn)\/index\.json/, r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ v: 1, city: 'x', size: 500, tiles: [], generated: '', source: 'test' }) }));

test('miasto i metro: smoke', async ({ page }) => {
  await noTiles(page); // metro i przełączanie miast; kafle sprawdzają osobne testy
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto('/');
  await expect(page.locator('#cityName')).toHaveText('WARSZAWA');
  await expect(page.locator('#info')).toContainText('41 stacji · 40 tuneli');
  await expect(page.locator('#loc')).toContainText('Peron Świętokrzyska');

  // peron wyspowy na stacji z sąsiadami po obu stronach: idziemy osią hali do tunelu
  const st = await page.evaluate(() => {
    const w = (window as unknown as G).__game.world;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return w.stations.find((s: any) => { const h = s.halls[0]; return h.island && h.W - 7 > 1.2 && s.lines.get(h.l).length === 2; }).i;
  });
  await page.evaluate(i => (window as unknown as G).__game.goStation(i, false), st);
  expect(await regionKind(page)).toBe('hall');
  await page.locator('#c').click();
  await page.keyboard.down('Shift'); await page.keyboard.down('KeyW');
  await expect.poll(() => regionKind(page), { timeout: 40_000 }).toBe('tunnel');
  await page.keyboard.up('KeyW'); await page.keyboard.up('Shift');
  await expect(page.locator('#loc')).toContainText('Tunel M');

  // wyjście na ulicę przez menu
  await page.evaluate(() => document.exitPointerLock()); // Esc w przeglądarce bez okna nie zwalnia kursora
  await page.locator('#menuBtn').click();
  await page.locator('#upBtn').click();
  await expect(page.locator('#loc')).toContainText('Ulica');
  expect(await regionKind(page)).toBe('street');

  // auto i powrót do chodzenia
  await page.keyboard.press('KeyG');
  await expect(page.locator('#loc')).toContainText('Samochód');
  await page.keyboard.press('Digit1');
  await expect(page.locator('#loc')).toContainText('Ulica');

  // Londyn
  await page.locator('#menuBtn').click();
  await page.locator('#cityL').click();
  await expect(page.locator('#cityName')).toHaveText('LONDYN', { timeout: 30_000 });
  await expect(page.locator('#info')).toContainText('268 stacji');
  await expect(page.locator('#loc')).toContainText('Peron Oxford Circus', { timeout: 15_000 });

  expect(errors).toEqual([]);
});

test('wczytanie pliku OSM: budynki i stacja z OSM', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('#cityName')).toHaveText('WARSZAWA');
  await page.locator('#fileIn').setInputFiles('tests/fixtures/swietokrzyska.json');
  await expect(page.locator('#info')).toContainText('budynki: 40 · stacje z OSM: 1', { timeout: 30_000 });
  await expect(page.locator('#loc')).toContainText('Ulica', { timeout: 15_000 });
  expect(errors).toEqual([]);
});

test('kafelki przez HTTP: doładowanie wokół gracza, kolizje, zwalnianie', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.route('**/tiles/warszawa/**', async route => {
    const name = new URL(route.request().url()).pathname.split('/').pop()!;
    try { await route.fulfill({ path: `tests/fixtures/tiles/warszawa/${name}` }); } catch { await route.fulfill({ status: 404, body: '' }); }
  });
  await page.goto('/');
  await expect(page.locator('#cityName')).toHaveText('WARSZAWA');
  // gracz na Świętokrzyskiej (start): kafelki w promieniu 600 m pod ziemią / 900 m na ulicy
  await expect.poll(() => page.evaluate(() => (window as unknown as G).__game.view.streamer.stats.visible), { timeout: 20_000 }).toBeGreaterThan(3);
  await expect(page.locator('#info')).toContainText('kafelki:');
  const r = await page.evaluate(() => {
    const g = (window as unknown as G).__game, w = g.world, o = w.proj(52.2355, 21.0082);
    return { wall: w.blocked(o[0] - 134, o[1] - 225), yard: w.blocked(o[0] - 75, o[1] - 225), water: w.blocked(o[0] + 375, o[1] + 100), bridge: w.blocked(o[0] + 375, o[1]) };
  });
  expect(r).toEqual({ wall: true, yard: false, water: true, bridge: false });
  // daleko (Kabaty): kafelki zwolnione
  await page.evaluate(() => { const g = (window as unknown as G).__game; g.goStation(0, true); });
  await expect.poll(() => page.evaluate(() => (window as unknown as G).__game.view.streamer.stats.visible), { timeout: 20_000 }).toBe(0);
  expect(errors).toEqual([]);
});

test('prawdziwe kafle Warszawy z OSM: budynki wokół Świętokrzyskiej', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('#cityName')).toHaveText('WARSZAWA');
  await expect.poll(() => page.evaluate(() => (window as unknown as G).__game.view.streamer.stats.indexed), { timeout: 20_000 }).toBeGreaterThan(1000);
  await expect.poll(() => page.evaluate(() => (window as unknown as G).__game.view.buildingCount), { timeout: 60_000 }).toBeGreaterThan(2000);
  // stacja z prawdziwą pozycją i wejściami z OSM
  const st = await page.evaluate(() => { const s = (window as unknown as G).__game.world.stations.find((x: { name: string }) => x.name === 'Świętokrzyska'); return { exits: s.exitGeoms.length }; });
  expect(st.exits).toBeGreaterThan(1);
  expect(errors).toEqual([]);
});
