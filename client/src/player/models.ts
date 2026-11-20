// Wektorowe modele pojazdów (wypełnienie + krawędzie).
import * as THREE from 'three';

function part(geo: THREE.BufferGeometry, x: number, y: number, z: number, fill: number, edge: number): THREE.Group {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: fill, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 })));
  g.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 20), new THREE.LineBasicMaterial({ color: edge })));
  g.position.set(x, y, z); return g;
}

export interface VehicleModel { root: THREE.Group; rotor?: THREE.Group; trotor?: THREE.Group; lights?: THREE.Group[] }

export function makeCar(edge = 0xffcc33): VehicleModel {
  const car = new THREE.Group(), E = edge, F = new THREE.Color(edge).multiplyScalar(.1).getHex();
  car.add(part(new THREE.BoxGeometry(1.9, .7, 4.4), 0, .62, 0, F, E));
  car.add(part(new THREE.BoxGeometry(1.6, .6, 2.1), 0, 1.27, .25, F, E));
  for (const [x, z] of [[-.95, -1.4], [.95, -1.4], [-.95, 1.45], [.95, 1.45]]) { const w = new THREE.CylinderGeometry(.38, .38, .3, 10); w.rotateZ(Math.PI / 2); car.add(part(w, x, .38, z, 0x050505, 0xcfe9ff)); }
  for (const x of [-.6, .6]) {
    car.add(part(new THREE.BoxGeometry(.4, .15, .05), x, .75, -2.22, 0xffffcc, 0xffffff));
    car.add(part(new THREE.BoxGeometry(.4, .15, .05), x, .75, 2.22, 0xff2a2a, 0xff6666));
  }
  return { root: car };
}

/** Radiowóz: biało-niebieskie krawędzie, migająca belka świetlna (czerwony/niebieski). */
export function makePoliceCar(): VehicleModel {
  const m = makeCar(0x4a8cff), bar = new THREE.Group();
  bar.add(part(new THREE.BoxGeometry(1.2, .14, .3), 0, 1.65, .25, 0x0a0a14, 0xe8f0ff));
  const red = part(new THREE.BoxGeometry(.5, .16, .32), -.33, 1.66, .25, 0xff2a2a, 0xff8080), blue = part(new THREE.BoxGeometry(.5, .16, .32), .33, 1.66, .25, 0x2a5aff, 0x80a0ff);
  bar.add(red, blue); m.root.add(bar);
  for (const x of [-.96, .96]) m.root.add(part(new THREE.BoxGeometry(.02, .12, 3.6), x, .7, 0, 0xe8f0ff, 0xe8f0ff));
  return { root: m.root, lights: [red, blue] };
}

export function makeHeli(): VehicleModel {
  const heli = new THREE.Group(), rotor = new THREE.Group(), trotor = new THREE.Group(), E = 0x66e0ff, F = 0x06141a, R = 0xcfe9ff;
  const body = new THREE.SphereGeometry(1.5, 8, 6); body.scale(1, .95, 1.9); heli.add(part(body, 0, 1.9, 0, F, E));
  heli.add(part(new THREE.BoxGeometry(.35, .35, 4.6), 0, 2.2, 4.4, F, E));
  heli.add(part(new THREE.BoxGeometry(.12, 1.3, .8), 0, 2.8, 6.5, F, E));
  for (const x of [-.9, .9]) { heli.add(part(new THREE.BoxGeometry(.12, .12, 3.6), x, .15, 0, F, E)); for (const z of [-.9, .9]) heli.add(part(new THREE.BoxGeometry(.08, .7, .08), x, .5, z, F, E)); }
  rotor.add(part(new THREE.BoxGeometry(11, .05, .35), 0, 0, 0, F, R)); rotor.add(part(new THREE.BoxGeometry(.35, .05, 11), 0, 0, 0, F, R)); rotor.position.set(0, 3.35, 0); heli.add(rotor);
  trotor.add(part(new THREE.BoxGeometry(.05, 1.8, .2), 0, 0, 0, F, R)); trotor.position.set(.25, 2.9, 6.6); heli.add(trotor);
  heli.rotation.order = 'YXZ';
  return { root: heli, rotor, trotor };
}

export function disposeModel(m: VehicleModel): void {
  m.root.traverse(o => { const x = o as THREE.Mesh; if (x.geometry) x.geometry.dispose(); if (x.material) { const mt = x.material as THREE.SpriteMaterial; mt.map?.dispose(); mt.dispose(); } });
}

export interface AvatarModel extends VehicleModel { legs: THREE.Group[]; arms: THREE.Group[]; label: THREE.Sprite }

/** Wektorowa postać innego gracza: kolor gracza na krawędziach, nick nad głową. */
export function makeAvatar(color: string, name: string): AvatarModel {
  const root = new THREE.Group(), c = new THREE.Color(color).getHex(), F = 0x07120c;
  root.add(part(new THREE.BoxGeometry(.5, .7, .28), 0, 1.25, 0, F, c));
  root.add(part(new THREE.BoxGeometry(.28, .3, .28), 0, 1.78, 0, F, c));
  const limb = (x: number, y: number, h: number) => { const g = new THREE.Group(); g.position.set(x, y, 0); const p = part(new THREE.BoxGeometry(.16, h, .16), 0, -h / 2, 0, F, c); g.add(p); root.add(g); return g; };
  const legs = [limb(-.13, .9, .9), limb(.13, .9, .9)], arms = [limb(-.34, 1.55, .65), limb(.34, 1.55, .65)];
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64; const x = cv.getContext('2d')!;
  x.fillStyle = 'rgba(0,0,0,.6)'; x.fillRect(0, 0, 256, 64); x.fillStyle = color; x.fillRect(0, 60, 256, 4);
  x.font = '600 34px "Chakra Petch", sans-serif'; x.fillStyle = '#fff'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(name.slice(0, 16), 128, 32);
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthTest: false }));
  label.scale.set(1.6, .4, 1); label.position.y = 2.35; label.renderOrder = 10; if (name) root.add(label);
  return { root, legs, arms, label };
}

/** Policjant: granatowy mundur, czapka. */
export function makeOfficer(): AvatarModel {
  const a = makeAvatar('#4a8cff', '');
  a.root.add(part(new THREE.BoxGeometry(.34, .1, .36), 0, 1.98, -.03, 0x0a1430, 0x4a8cff));
  return a;
}

/** Samolot pasażerski (kadłub, skrzydła, usterzenie, silniki) w skali wg rozmiaru. */
export function makePlane(size: 'heavy' | 'medium' | 'regional' | 'light'): VehicleModel {
  const root = new THREE.Group(), E = 0xe8f4ff, F = 0x0a1418, S = { heavy: 1.75, medium: 1, regional: .85, light: .32 }[size];
  const L = 38 * S, R = 2 * S;
  const body = new THREE.CylinderGeometry(R, R * .7, L, 10); body.rotateX(Math.PI / 2); root.add(part(body, 0, R + 1.2 * S, 0, F, E));
  const nose = new THREE.ConeGeometry(R, 4 * S, 10); nose.rotateX(-Math.PI / 2); root.add(part(nose, 0, R + 1.2 * S, -L / 2 - 2 * S, F, E));
  root.add(part(new THREE.BoxGeometry(34 * S, .5 * S, 6 * S), 0, R * .6 + 1.2 * S, -1 * S, F, E));
  root.add(part(new THREE.BoxGeometry(12 * S, .4 * S, 3 * S), 0, R + 2 * S, L / 2 - 2 * S, F, E));
  root.add(part(new THREE.BoxGeometry(.4 * S, 7 * S, 4 * S), 0, R + 5 * S, L / 2 - 2.5 * S, F, E));
  if (size !== 'light') for (const x of [-7 * S, 7 * S]) { const en = new THREE.CylinderGeometry(1.2 * S, 1.2 * S, 4.5 * S, 8); en.rotateX(Math.PI / 2); root.add(part(en, x, R * .6, -3 * S, F, 0x66e0ff)); }
  // światła: czerwone i zielone na końcach skrzydeł
  root.add(part(new THREE.BoxGeometry(.6 * S, .6 * S, .6 * S), -17 * S, R * .6 + 1.2 * S, -1 * S, 0xff3030, 0xff6060));
  root.add(part(new THREE.BoxGeometry(.6 * S, .6 * S, .6 * S), 17 * S, R * .6 + 1.2 * S, -1 * S, 0x30ff60, 0x80ff9f));
  root.rotation.order = 'YXZ';
  root.traverse(o => { const m = (o as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined; if (m) m.fog = false; }); // widoczne z daleka na niebie
  return { root };
}
