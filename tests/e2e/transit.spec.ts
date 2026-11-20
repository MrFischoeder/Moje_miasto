// Komunikacja wg prawdziwego rozkładu: przejazd metrem M1 z Centrum do następnej stacji.
import { expect, test } from '@playwright/test';

type G = { __game: any }; // eslint-disable-line @typescript-eslint/no-explicit-any

test('metro M1: wsiadanie w Centrum, przejazd, wysiadanie na następnej stacji', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route(/\/tiles\/(warszawa|londyn)\/index\.json/, r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ v: 1, city: 'x', size: 500, tiles: [], generated: '', source: 'test' }) }));
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => { const g = (window as unknown as G).__game; return !!g.transit && !!g.session?.player(); }), { timeout: 30_000 }).toBe(true);
  // 7:30, czas ×10
  await page.evaluate(() => (window as unknown as G).__game.session.setTime(27000, 10));
  await page.evaluate(() => { const g = (window as unknown as G).__game; g.goStation(g.world.stations.find((s: { name: string }) => s.name === 'Centrum').i, false); });
  await expect(page.locator('#loc')).toContainText('Peron Centrum');
  await page.waitForFunction(() => { const g = (window as unknown as G).__game, P = g.pose; return !!g.transit.boardable(P.x, P.y, P.z); }, null, { timeout: 60_000, polling: 100 });
  await page.evaluate(() => (window as unknown as G).__game.action('interact'));
  await expect(page.locator('#loc')).toContainText('Metro M1', { timeout: 10_000 });
  const ride = await page.evaluate(() => (window as unknown as G).__game.riding);
  expect(ride).toBeTruthy();
  // wysiadanie na najbliższym przystanku
  const first = await page.evaluate(() => { const g = (window as unknown as G).__game; return g.transit.trip(g.riding).st.stop; });
  await page.waitForFunction(f => { const g = (window as unknown as G).__game, a = g.transit.trip(g.riding); return a && a.st.stop >= 0 && a.st.stop !== f; }, first, { timeout: 60_000, polling: 100 });
  await page.evaluate(() => (window as unknown as G).__game.action('interact'));
  await expect.poll(() => page.evaluate(() => (window as unknown as G).__game.riding)).toBeNull();
  await expect(page.locator('#loc')).toContainText(/Peron (Politechnika|Świętokrzyska)/);
  expect(errors).toEqual([]);
});
