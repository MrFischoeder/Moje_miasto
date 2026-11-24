// Telefon: ekran domowy, zlecenie od NPC (oferta, przyjęcie, cel na mapie), aparat i galeria, teleport z mapy.
import { expect, test } from '@playwright/test';
type G = { __game: { session?: { player(): unknown }; controlled(): { x: number; z: number } | null } };

test('telefon: zlecenie NPC, mapa z teleportem, aparat', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/?miasto=warszawa');
  await expect.poll(() => page.evaluate(() => !!(window as unknown as G).__game.session?.player()), { timeout: 30_000 }).toBe(true);
  await page.keyboard.press('KeyC');
  await expect(page.locator('#phone.open')).toBeVisible();
  await expect(page.locator('#phone .app', { hasText: 'Wiadomości' })).toBeVisible();
  // oferta zlecenia przychodzi po ok. 20 s
  await expect(page.locator('#phoneBtn .n')).toBeVisible({ timeout: 40_000 });
  await page.locator('#phone .app', { hasText: 'Wiadomości' }).click();
  await page.locator('#phone .row').first().click();
  await page.locator('#phone .job .ok').click();
  await expect(page.locator('#phone .msg .loc').last()).toBeVisible({ timeout: 5000 });
  // mapa i teleport
  await page.locator('#phone .msg .loc').last().click();
  await expect(page.locator('#phone canvas.map')).toBeVisible();
  const before = await page.evaluate(() => { const e = (window as unknown as G).__game.controlled()!; return [e.x, e.z]; });
  const box = (await page.locator('#phone canvas.map').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2 + 50, box.y + box.height / 2 - 70);
  await page.locator('#phone .pop .blue').click();
  await expect.poll(() => page.evaluate(([x, z]) => { const e = (window as unknown as G).__game.controlled()!; return Math.hypot(e.x - x, e.z - z); }, before), { timeout: 10_000 }).toBeGreaterThan(30);
  // aparat: zdjęcie trafia do galerii
  await page.locator('#phone .homebar').click();
  await page.locator('#phone .app', { hasText: 'Aparat' }).click();
  await page.locator('#viewfinder .shutter').click();
  await expect(page.locator('#viewfinder .vb').nth(1)).toContainText('(1)', { timeout: 5000 });
  await page.locator('#viewfinder .vb').nth(1).click();
  await expect(page.locator('#phone .grid img')).toHaveCount(1);
  expect(errors).toEqual([]);
});
