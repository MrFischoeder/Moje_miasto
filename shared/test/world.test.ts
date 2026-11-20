import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { World } from '../src/world/world';
import { rng } from '../src/util/rng';

const hashRegions = (w: World) => {
  let h = 0;
  for (const r of w.regions.list) for (const v of [r.a[0], r.a[1], r.u[0], r.u[1], r.len, r.hw, r.y0, r.y1]) h = (Math.imul(h, 31) + Math.round(v * 1000)) | 0;
  return h;
};

describe('świat', () => {
  it('jest deterministyczny (ziarno = nazwa miasta + stacji)', () => {
    const a = new World('warszawa'), b = new World('warszawa');
    expect(hashRegions(a)).toBe(hashRegions(b));
    expect(a.regions.list.length).toBe(243); // tyle samo co prototyp (legacy/index.html)
    expect(new World('londyn').regions.list.length).toBe(1766);
  });

  it('rng daje ten sam ciąg dla tego samego ziarna', () => {
    const r1 = rng('WarszawaCentrum'), r2 = rng('WarszawaCentrum');
    for (let i = 0; i < 5; i++) expect(r1()).toBe(r2());
  });

  it('peron stacji startowej jest podłożem', () => {
    const w = new World('warszawa'), p = w.spawnPose();
    const g = w.regions.support(p.x, p.z, p.y, w.buildings);
    expect(g?.r?.kind).toBe('hall');
  });
});

describe('shared bez three.js i DOM', () => {
  const files: string[] = [];
  const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.ts')) files.push(p); } };
  walk(join(__dirname, '../src'));
  it.each(files)('%s', f => {
    const src = readFileSync(f, 'utf8');
    expect(src).not.toMatch(/from ['"]three['"]/);
    expect(src).not.toMatch(/\b(document|window|requestAnimationFrame|DOMParser)\b/);
  });
});
