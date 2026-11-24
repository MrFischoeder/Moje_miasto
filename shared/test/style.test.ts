import { describe, expect, it } from 'vitest';
import { smoothStyles, styleOf, yearOf, type StyleIn } from '../src/world/style';

const base: StyleIn = { t: 'apartments', lv: 5, lvTag: true, A: 700, W: 70, D: 10, rect: 1, dEff: 9.7, mE: 40, holes: 0, members: 1, attached: false, dc: 5000 };

describe('styl budynku', () => {
  it('długa prostokątna płyta poza centrum to blok', () => expect(styleOf(base)).toEqual({ st: 'blok', sure: true }));
  it('łamany „wężowiec” to blok', () => expect(styleOf({ ...base, W: 240, D: 60, rect: .5, dEff: 10, mE: 25, members: 8, attached: true }).st).toBe('blok'));
  it('kwartał z podwórzem to kamienice', () => expect(styleOf({ ...base, W: 120, D: 80, rect: .4, dEff: 14, mE: 12, holes: 1, members: 12, attached: true, dc: 1500 })).toEqual({ st: 'kam', sure: true }));
  it('mały niski budynek to dom', () => expect(styleOf({ ...base, t: 'yes', lv: 2, A: 140, W: 12, D: 11.7, dEff: 6 }).st).toBe('dom'));
  it('przemysł i biura', () => { expect(styleOf({ ...base, t: 'warehouse' }).st).toBe('przem'); expect(styleOf({ ...base, t: 'office' }).st).toBe('biuro'); });
  it('rok budowy rozstrzyga', () => { expect(styleOf({ ...base, yr: 1905 }).st).toBe('kam'); expect(styleOf({ ...base, yr: 2015 }).st).toBe('wsp'); });
  it('wysoki budynek nie staje się kamienicą przez okolicę', () => {
    const it2 = [...Array(5)].map((_, i) => ({ x: i, z: 0, st: 'kam' as const, sure: true, res: true, lv: 5 }));
    const q = { x: 3, z: 3, st: 'blok' as 'blok' | 'kam', sure: false, res: true, lv: 8 }; smoothStyles([...it2, q]); expect(q.st).toBe('blok');
  });
  it('rok z start_date', () => { expect(yearOf('1885-05-01')).toBe(1885); expect(yearOf('C19')).toBe(1850); expect(yearOf('ok.')).toBeUndefined(); });
});
