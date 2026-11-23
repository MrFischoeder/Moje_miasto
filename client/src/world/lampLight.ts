// Światło latarni na prawdziwym terenie: ciepłe plamy światła na gruncie, jezdni, chodnikach, torowiskach i ścianach
// wokół najbliższych latarni (pozycje w świecie, więc światło układa się na zboczach i krawężnikach).
// Zamiast setek świateł sceny (za drogie): jeden fragment shadera z listą najbliższych latarni, natężenie wg pory nocy.
import * as THREE from 'three';

export const MAX_LAMPS = 40;

export interface LampUniforms {
  /** x, y (wysokość oprawy), z, zasięg [m] */
  uLamps: { value: THREE.Vector4[] };
  uLampN: { value: number };
  /** 0 dzień .. 1 noc */
  uLampNight: { value: number };
}

export function lampUniforms(): LampUniforms {
  return { uLamps: { value: Array.from({ length: MAX_LAMPS }, () => new THREE.Vector4()) }, uLampN: { value: 0 }, uLampNight: { value: 0 } };
}

/** Dodaje światło latarni do materiału Lambert (zachowuje wcześniejsze modyfikacje shadera, np. okna). */
export function installLamps(m: THREE.Material, U: LampUniforms): void {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    prev.call(m, sh, r);
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vLampW;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvLampW = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vLampW;\nuniform vec4 uLamps[${MAX_LAMPS}]; uniform int uLampN; uniform float uLampNight;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
if (uLampNight > 0.01) {
  vec3 lampSum = vec3(0.0);
  for (int i = 0; i < ${MAX_LAMPS}; i++) {
    if (i >= uLampN) break;
    vec4 L = uLamps[i]; vec3 d = vLampW - L.xyz;
    float r2 = dot(d.xz, d.xz), R = L.w;
    if (r2 > R * R) continue;
    float h = max(0.5, L.y - vLampW.y);                       // wysokość oprawy nad punktem
    float a = (1.0 - r2 / (R * R)); a *= a;                    // łagodne wygaszenie na skraju plamy
    lampSum += vec3(1.0, 0.78, 0.48) * a * (36.0 / (h * h + r2 * 0.6 + 6.0));
  }
  totalEmissiveRadiance += diffuseColor.rgb * lampSum * uLampNight * 1.4;
}`);
  };
  m.needsUpdate = true;
}
