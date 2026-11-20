// Test dymny: start, Warszawa, przejście peronem do tunelu, wyjście na ulicę, Londyn, brak błędów w konsoli.
import { expect, test, type Page } from '@playwright/test';

type G = { __game: any }; // eslint-disable-line @typescript-eslint/no-explicit-any

const regionKind = (page: Page) => page.evaluate(() => {
  const g = (window as unknown as G).__game, e = g.controlled();
  return e.reg >= 0 ? g.world.regions.list[e.reg].kind : 'street';
});

test('miasto i metro: smoke', async ({ page }) => {
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
  await expect(page.locator('#cityName')).toHaveText('LONDYN');
  await expect(page.locator('#info')).toContainText('268 stacji');
  await expect(page.locator('#loc')).toContainText('Peron Oxford Circus');

  expect(errors).toEqual([]);
});

test('wczytanie pliku OSM: budynki i stacja z OSM', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('#cityName')).toHaveText('WARSZAWA');
  await page.locator('#fileIn').setInputFiles('tests/fixtures/swietokrzyska.json');
  await expect(page.locator('#info')).toContainText('budynki: 40 · stacje z OSM: 1');
  await expect(page.locator('#loc')).toContainText('Ulica');
  expect(errors).toEqual([]);
});
