// Modele low-poly: auta, radiowóz, helikopter, samoloty, postacie. Płaskie cieniowanie, bez krawędzi.
// Geometrie i materiały są współdzielone (jedna kopia na kształt i kolor): mniej pamięci i szybsze rysowanie.
import * as THREE from 'three';

const GEO = new Map<string, THREE.BufferGeometry>();
const MAT = new Map<string, THREE.MeshLambertMaterial>();
const geo = (key: string, make: () => THREE.BufferGeometry) => { let g = GEO.get(key); if (!g) { g = make().toNonIndexed(); g.computeVertexNormals(); GEO.set(key, g); } return g; };
const mat = (c: number, emissive = 0, fog = true) => { const k = c + ':' + emissive + ':' + fog; let m = MAT.get(k); if (!m) MAT.set(k, m = new THREE.MeshLambertMaterial({ color: c, emissive, flatShading: true, fog })); return m; };
const box = (w: number, h: number, d: number) => geo(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d));

function part(g: THREE.BufferGeometry, x: number, y: number, z: number, color: number, emissive = 0, fog = true): THREE.Mesh {
  const m = new THREE.Mesh(g, mat(color, emissive, fog)); m.position.set(x, y, z); return m;
}

export interface VehicleModel { root: THREE.Group; rotor?: THREE.Group; trotor?: THREE.Group; lights?: THREE.Object3D[] }

/** Kabina auta: prostopadłościan zwężony ku górze (szyby). */
const cabinGeo = () => geo('kabina', () => {
  const g = new THREE.BoxGeometry(1.62, .62, 2.1), p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) { p.setX(i, p.getX(i) * .86); p.setZ(i, p.getZ(i) * (p.getZ(i) < 0 ? .72 : .86)); }
  return g;
});
const wheelGeo = () => geo('koło', () => { const g = new THREE.CylinderGeometry(.36, .36, .26, 8); g.rotateZ(Math.PI / 2); return g; });

/** Samochód osobowy w kolorze color (domyślnie żółty: auto gracza). */
export function makeCar(color = 0xe8b830): VehicleModel {
  const car = new THREE.Group();
  car.add(part(box(1.86, .62, 4.4), 0, .62, 0, color));                       // nadwozie
  car.add(part(box(1.7, .12, 1.2), 0, .97, -1.55, color));                    // maska
  car.add(part(cabinGeo(), 0, 1.24, .2, 0x2a3a48));                            // kabina z szybami
  car.add(part(box(1.36, .06, 1.6), 0, 1.57, .3, color));                     // dach
  for (const [x, z] of [[-.9, -1.4], [.9, -1.4], [-.9, 1.42], [.9, 1.42]]) car.add(part(wheelGeo(), x, .36, z, 0x1c1c1e));
  for (const x of [-.62, .62]) {
    car.add(part(box(.36, .14, .05), x, .76, -2.21, 0xfff6d8, 0x6a6450));    // reflektory
    car.add(part(box(.36, .14, .05), x, .76, 2.21, 0xc81818, 0x501010));     // tylne światła
  }
  return { root: car };
}

/** Radiowóz: biały z niebieskim pasem i migającą belką (czerwony / niebieski). */
export function makePoliceCar(): VehicleModel {
  const m = makeCar(0xf0f0f0);
  for (const x of [-.94, .94]) m.root.add(part(box(.02, .16, 3.6), x, .66, 0, 0x2050c8));
  m.root.add(part(box(1.2, .12, .3), 0, 1.66, .3, 0x202024));
  const red = part(box(.5, .14, .32), -.33, 1.68, .3, 0xff2a2a, 0xa01010), blue = part(box(.5, .14, .32), .33, 1.68, .3, 0x2a5aff, 0x1030a0);
  m.root.add(red, blue);
  return { root: m.root, lights: [red, blue] };
}

export function makeHeli(): VehicleModel {
  const heli = new THREE.Group(), rotor = new THREE.Group(), trotor = new THREE.Group(), C = 0xd04030, D = 0x2a3a48, R = 0x303034;
  heli.add(part(geo('heli', () => { const g = new THREE.SphereGeometry(1.5, 8, 6); g.scale(1, .95, 1.9); return g; }), 0, 1.9, 0, C));
  heli.add(part(box(1.4, .8, 1.2), 0, 2.2, -1.6, D));
  heli.add(part(box(.35, .35, 4.6), 0, 2.2, 4.4, C));
  heli.add(part(box(.12, 1.3, .8), 0, 2.8, 6.5, C));
  for (const x of [-.9, .9]) { heli.add(part(box(.12, .12, 3.6), x, .15, 0, R)); for (const z of [-.9, .9]) heli.add(part(box(.08, .7, .08), x, .5, z, R)); }
  rotor.add(part(box(11, .05, .35), 0, 0, 0, R)); rotor.add(part(box(.35, .05, 11), 0, 0, 0, R)); rotor.position.set(0, 3.35, 0); heli.add(rotor);
  trotor.add(part(box(.05, 1.8, .2), 0, 0, 0, R)); trotor.position.set(.25, 2.9, 6.6); heli.add(trotor);
  heli.rotation.order = 'YXZ';
  return { root: heli, rotor, trotor };
}

/** Modele mają wspólne geometrie i materiały: zwalniamy tylko etykiety (unikalne tekstury). */
export function disposeModel(m: VehicleModel): void {
  m.root.traverse(o => { if ((o as THREE.Sprite).isSprite) { const s = o as THREE.Sprite; s.material.map?.dispose(); s.material.dispose(); } });
}

export interface AvatarModel extends VehicleModel { legs: THREE.Group[]; arms: THREE.Group[]; label: THREE.Sprite }

const SKIN = [0xf1c8a8, 0xe0b090, 0xc89070, 0x9a6a4a, 0x6a4430];
const PANTS = [0x2a3448, 0x3a3a3c, 0x4a3a2a, 0x1e2430, 0x5a5a60, 0x2a4a6a];

/** Postać low-poly: głowa (kolor skóry), koszula/kurtka w kolorze color, spodnie; nick nad głową (gracze). */
export function makeAvatar(color: string, name: string, seed = 0): AvatarModel {
  const root = new THREE.Group(), shirt = new THREE.Color(color).getHex(), h = Math.abs(seed * 2654435761 | 0);
  const skin = SKIN[h % SKIN.length], pants = PANTS[(h >> 3) % PANTS.length];
  root.add(part(box(.5, .7, .28), 0, 1.25, 0, shirt));
  root.add(part(box(.26, .28, .26), 0, 1.76, 0, skin));
  root.add(part(box(.28, .08, .28), 0, 1.92, 0, (h >> 5) % 2 ? 0x2a2018 : 0x5a4028)); // włosy
  const limb = (x: number, y: number, len: number, c: number) => { const g = new THREE.Group(); g.position.set(x, y, 0); g.add(part(box(.16, len, .16), 0, -len / 2, 0, c)); root.add(g); return g; };
  const legs = [limb(-.13, .9, .9, pants), limb(.13, .9, .9, pants)], arms = [limb(-.34, 1.55, .65, shirt), limb(.34, 1.55, .65, shirt)];
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64; const x = cv.getContext('2d')!;
  x.fillStyle = 'rgba(0,0,0,.55)'; x.fillRect(0, 0, 256, 64); x.fillStyle = color; x.fillRect(0, 60, 256, 4);
  x.font = '600 34px "Chakra Petch", sans-serif'; x.fillStyle = '#fff'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(name.slice(0, 16), 128, 32);
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthTest: false }));
  label.scale.set(1.6, .4, 1); label.position.y = 2.35; label.renderOrder = 10; if (name) root.add(label);
  return { root, legs, arms, label };
}

/** Policjant: granatowy mundur, czapka. */
export function makeOfficer(seed = 0): AvatarModel {
  const a = makeAvatar('#1e2c58', '', seed);
  a.root.add(part(box(.32, .1, .36), 0, 1.97, -.03, 0x141c3a));
  return a;
}

/** Samolot pasażerski (kadłub, skrzydła, usterzenie, silniki) w skali wg rozmiaru. */
export function makePlane(size: 'heavy' | 'medium' | 'regional' | 'light'): VehicleModel {
  const root = new THREE.Group(), W = 0xeef2f6, G = 0x9aa4ae, S = { heavy: 1.75, medium: 1, regional: .85, light: .32 }[size];
  const L = 38 * S, R = 2 * S;
  root.add(part(geo('kadłub' + size, () => { const g = new THREE.CylinderGeometry(R, R * .7, L, 10); g.rotateX(Math.PI / 2); return g; }), 0, R + 1.2 * S, 0, W));
  root.add(part(geo('nos' + size, () => { const g = new THREE.ConeGeometry(R, 4 * S, 10); g.rotateX(-Math.PI / 2); return g; }), 0, R + 1.2 * S, -L / 2 - 2 * S, W));
  root.add(part(box(34 * S, .5 * S, 6 * S), 0, R * .6 + 1.2 * S, -1 * S, G));
  root.add(part(box(12 * S, .4 * S, 3 * S), 0, R + 2 * S, L / 2 - 2 * S, G));
  root.add(part(box(.4 * S, 7 * S, 4 * S), 0, R + 5 * S, L / 2 - 2.5 * S, 0x2a5aa8));
  if (size !== 'light') for (const x of [-7 * S, 7 * S]) root.add(part(geo('silnik' + size, () => { const g = new THREE.CylinderGeometry(1.2 * S, 1.2 * S, 4.5 * S, 8); g.rotateX(Math.PI / 2); return g; }), x, R * .6, -3 * S, G));
  root.add(part(box(.6 * S, .6 * S, .6 * S), -17 * S, R * .6 + 1.2 * S, -1 * S, 0xff3030, 0xff3030));
  root.add(part(box(.6 * S, .6 * S, .6 * S), 17 * S, R * .6 + 1.2 * S, -1 * S, 0x30ff60, 0x30ff60));
  root.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) m.material = mat((m.material as THREE.MeshLambertMaterial).color.getHex(), (m.material as THREE.MeshLambertMaterial).emissive.getHex(), false); }); // widoczne z daleka na niebie
  root.rotation.order = 'YXZ';
  return { root };
}
