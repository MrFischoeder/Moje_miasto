// Ruch uliczny i piesi: auto NPC zatrzymuje się przed graczem, E wyrzuca kierowcę (ucieka), gracz prowadzi.
import { expect, test } from '@playwright/test';

type G = { __game: any }; // eslint-disable-line @typescript-eslint/no-explicit-any

test('przejęcie auta NPC i piesi na chodnikach', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/?miasto=warszawa');
  await expect.poll(() => page.evaluate(() => { const g = (window as unknown as G).__game; return !!g.transit && !!g.session?.player(); }), { timeout: 30_000 }).toBe(true);
  await page.evaluate(() => (window as unknown as G).__game.session.setTime(61200, 1)); // 17:00
  await page.evaluate(() => { const g = (window as unknown as G).__game; g.goStation(g.world.stations.find((s: { name: string }) => s.name === 'Świętokrzyska').i, true); });
  const count = (kind: string) => page.evaluate(k => [...(window as unknown as G).__game.session.entities()].filter((e: { npc?: boolean; kind: string }) => e.npc && e.kind === k).length, kind);
  await expect.poll(() => count('walker'), { timeout: 60_000 }).toBeGreaterThan(10);
  await expect.poll(() => count('car'), { timeout: 60_000 }).toBeGreaterThan(10);
  // stań przed jadącym autem; jeśli skręci w inną ulicę, spróbuj z następnym
  let car = -1;
  for (let attempt = 0; attempt < 12 && car < 0; attempt++) {
    const id = await page.evaluate(n => {
      const g = (window as unknown as G).__game, me = g.controlled();
      const cs = [...g.session.entities()].filter((e: { npc?: boolean; kind: string; speed: number }) => e.npc && e.kind === 'car' && e.speed > 3)
        .sort((a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - me.x, a.z - me.z) - Math.hypot(b.x - me.x, b.z - me.z));
      const c = cs[n % Math.max(1, cs.length)]; if (!c) return -1;
      g.session.sendCommand({ type: 'teleport', x: c.x - Math.sin(c.yaw) * 22, z: c.z - Math.cos(c.yaw) * 22 }); return c.id;
    }, attempt);
    if (id < 0) { await page.waitForTimeout(1000); continue; }
    const ok = await page.waitForFunction(i => { const c = (window as unknown as G).__game.session.entity(i); return c && Math.abs(c.speed) < .2; }, id, { timeout: 10_000, polling: 100 }).then(() => true, () => false);
    if (ok) car = id;
  }
  expect(car).toBeGreaterThan(0);
  await page.evaluate(id => { const g = (window as unknown as G).__game, c = g.session.entity(id); g.session.sendCommand({ type: 'teleport', x: c.x - Math.cos(c.yaw) * 1.8 - Math.sin(c.yaw) * 1.2, z: c.z + Math.sin(c.yaw) * 1.8 - Math.cos(c.yaw) * 1.2 }); }, car); // przy przednim błotniku: auto dalej hamuje
  await page.waitForTimeout(800);
  await page.evaluate(() => (window as unknown as G).__game.action('interact'));
  await expect(page.locator('#loc')).toContainText('Samochód', { timeout: 10_000 });
  expect(await page.evaluate(() => (window as unknown as G).__game.session.player().vehicle)).toBe(car);
  // kradzież: gwiazdka w HUD, komunikat, policja wysyła radiowóz
  await expect(page.locator('#stars')).toContainText('★', { timeout: 5_000 });
  await expect(page.locator('#evt')).toContainText('Kradzież');
  await expect(page.locator('#money')).toContainText('zł');
  await expect.poll(() => page.evaluate(() => [...(window as unknown as G).__game.session.entities()].some((e: { police?: boolean; kind: string }) => e.police && e.kind === 'car')), { timeout: 15_000 }).toBe(true);
  expect(errors).toEqual([]);
});
