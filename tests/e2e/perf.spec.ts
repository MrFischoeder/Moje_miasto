// Licznik wydajności (P) i suwaki liczby aut i pieszych NPC (gra jednoosobowa).
import { expect, test } from '@playwright/test';

type G = { __game: any }; // eslint-disable-line @typescript-eslint/no-explicit-any

test('licznik wydajności i suwaki aut i pieszych', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => { const g = (window as unknown as G).__game; return !!g.session?.player() && !!g.transitVisible !== undefined; }), { timeout: 30_000 }).toBe(true);
  await page.evaluate(() => (window as unknown as G).__game.session.setTime(61200, 1)); // 17:00, szczyt
  await page.keyboard.press('p');
  await expect(page.locator('#perf')).toBeVisible();
  await expect(page.locator('#perf')).toContainText('FPS', { timeout: 5_000 });
  await expect(page.locator('#perf')).toContainText('Symulacja (wątek gry)', { timeout: 8_000 });
  await expect(page.locator('#perf')).toContainText('rysowanie');
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
  const npc = (kind: string) => page.evaluate(k => [...(window as unknown as G).__game.session.entities()].filter((e: { npc?: boolean; kind: string }) => e.npc && e.kind === k).length, kind);
  await expect.poll(() => npc('car'), { timeout: 60_000 }).toBeGreaterThan(10);
  await expect.poll(() => npc('walker'), { timeout: 60_000 }).toBeGreaterThan(5);
  // suwaki na 0: auta i piesi znikają
  await page.evaluate(() => {
    for (const id of ['carRng', 'pedRng']) { const r = document.getElementById(id) as HTMLInputElement; r.value = '0'; r.dispatchEvent(new Event('input')); r.dispatchEvent(new Event('change')); }
  });
  await expect.poll(() => npc('car'), { timeout: 30_000 }).toBe(0);
  await expect.poll(() => npc('walker'), { timeout: 30_000 }).toBe(0);
  expect(await page.evaluate(() => localStorage.getItem('mm.auta'))).toBe('0');
  // z powrotem 40 aut: pojawiają się, ale nie więcej niż limit
  await page.evaluate(() => { const r = document.getElementById('carRng') as HTMLInputElement; r.value = '40'; r.dispatchEvent(new Event('change')); });
  await expect.poll(() => npc('car'), { timeout: 30_000 }).toBeGreaterThan(5);
  await page.waitForTimeout(4000);
  expect(await npc('car')).toBeLessThanOrEqual(42);
  expect(errors).toEqual([]);
});
