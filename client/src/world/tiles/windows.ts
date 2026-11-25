// Okna na ścianach budynków liczone w shaderze (bez dodatkowej geometrii): siatka okien z typologii
// budynku (shared/interiors/facade.ts), jasne ramy, szyby, zapalone okna nocą (styl low-poly).
// Do tego wycięcia w ścianach przy drzwiach wejściowych budynków z wygenerowanym wnętrzem.
import * as THREE from 'three';

export const MAX_DOORS = 24;

export interface WindowUniforms {
  uLit: { value: number };
  uDoorA: { value: THREE.Vector4[] };
  uDoorB: { value: THREE.Vector4[] };
  uDoorN: { value: number };
}

export function installWindows(m: THREE.Material): WindowUniforms {
  const U: WindowUniforms = {
    uLit: { value: 0 },
    uDoorA: { value: Array.from({ length: MAX_DOORS }, () => new THREE.Vector4()) },
    uDoorB: { value: Array.from({ length: MAX_DOORS }, () => new THREE.Vector4()) },
    uDoorN: { value: 0 },
  };
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec4 aFacA; attribute vec4 aFacB; attribute vec4 aFacC;
varying vec4 vFacA; varying vec4 vFacB; varying vec4 vFacC; varying vec3 vWPos;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vFacA = aFacA; vFacB = aFacB; vFacC = aFacC; vWPos = (modelMatrix * vec4(position, 1.0)).xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec4 vFacA; varying vec4 vFacB; varying vec4 vFacC; varying vec3 vWPos;
uniform float uLit; uniform vec4 uDoorA[${MAX_DOORS}]; uniform vec4 uDoorB[${MAX_DOORS}]; uniform int uDoorN;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
// wejścia: otwór w murze; wokół brama (obramienie), a w strefie bramy bez okien parteru
float doorZone = 0.0, portal = 0.0;
for (int i = 0; i < ${MAX_DOORS}; i++) {
  if (i >= uDoorN) break;
  vec4 a = uDoorA[i]; vec4 b = uDoorB[i]; vec2 d = vWPos.xz - a.xy;
  float al = abs(dot(d, a.zw)), ac = abs(dot(d, vec2(-a.w, a.z)));
  if (al < b.z && ac < b.w && vWPos.y > b.x && vWPos.y < b.y) discard;
  if (ac < b.w && vWPos.y > b.x - 0.2) {
    if (al < b.z + 1.3 && vWPos.y < b.y + 1.1) doorZone = 1.0;
    if (al < b.z + 0.32 && vWPos.y < b.y + 0.36) portal = 1.0;
  }
}
if (portal > 0.5) diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.42, 0.4, 0.37), 0.75);
// cokół: część ściany poniżej poziomu parteru (budynek na stoku) ciemniejsza, bez okien
if (vFacA.z > 0.5 && vFacA.y < -0.02) diffuseColor.rgb *= 0.72;
// faktura muru: cegła (1) albo ciosy kamienne (2); spoiny wygaszane z odległością
float matW = mod(vFacC.w, 4.0), arch = step(3.5, vFacC.w);
if (matW > 2.5 && vFacA.z > 0.5 && vFacB.x > 0.5) {
  // wielka płyta: spoiny poziome co kondygnację i pionowe między oknami
  float spP = vFacB.x, nP = max(1.0, floor((vFacA.z - 0.6) / spP)), offP = (vFacA.z - nP * spP) * 0.5;
  float fu = fract((vFacA.x - offP) / spP), fv = fract((vFacA.y - vFacB.w) / vFacA.w);
  float wu = fwidth(vFacA.x) / spP, wv = fwidth(vFacA.y) / vFacA.w, g = 0.012;
  float mu = 1.0 - smoothstep(g - wu, g + wu, min(fu, 1.0 - fu)), mv = 1.0 - smoothstep(g * 2.0 - wv, g * 2.0 + wv, min(fv, 1.0 - fv));
  float far = 1.0 - smoothstep(0.03, 0.12, max(wu, wv));
  diffuseColor.rgb *= 1.0 - max(mu, mv) * 0.35 * far;
} else if (matW > 0.5 && vFacA.z > 0.5) {
  float st = matW > 1.5 ? 1.0 : 0.5;                  // wysokość warstwy [m] (powiększona: styl low-poly)
  float bl = st * 2.2, row = floor(vFacA.y / st);
  float u = vFacA.x / bl + 0.5 * mod(row, 2.0), fu = fract(u), fv = fract(vFacA.y / st);
  float wu = fwidth(vFacA.x) / bl, wv = fwidth(vFacA.y) / st, gap = 0.06;
  float mu = 1.0 - smoothstep(gap - wu, gap + wu, min(fu, 1.0 - fu)), mv = 1.0 - smoothstep(gap - wv, gap + wv, min(fv, 1.0 - fv));
  float far = 1.0 - smoothstep(0.08, 0.25, max(wu, wv) * 2.0);
  float hb = fract(sin(dot(vec2(floor(u), row), vec2(12.9898, 78.233))) * 43758.5453);
  diffuseColor.rgb *= mix(1.0, 0.9 + 0.2 * hb, far);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.78, 0.74, 0.68) * 0.8, max(mu, mv) * 0.55 * far);
}
if (vFacA.z > 0.5 && vFacB.x > 0.5 && doorZone < 0.5) {
  float sp = vFacB.x, L = vFacA.z, n = floor((L - 0.6) / sp);
  if (n >= 1.0) {
    float off = (L - n * sp) * 0.5, lu = (vFacA.x - off) / sp, ci = floor(lu);
    float lv = vFacA.y - vFacB.w, k = floor(lv / vFacA.w), ly = lv - k * vFacA.w;
    float fwu = max(fwidth(vFacA.x), 1e-4), fwv = max(fwidth(vFacA.y), 1e-4);
    // okno znika, gdy ma tylko kilka pikseli (rozmiar okna / piksel), cienka rama wcześniej (mniej migotania w oddali)
    float px = max(fwu, fwv), fade = 1.0 - smoothstep(min(vFacB.y, vFacB.z) / 12.0, min(vFacB.y, vFacB.z) / 5.0, px);
    float ffade = 1.0 - smoothstep(0.03, 0.09, px);
    if (k >= 0.0 && k < vFacC.y) {
      float cover = vFacB.y * vFacB.z / (sp * vFacA.w);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.22, 0.3), cover * 0.6 * (1.0 - fade));
      totalEmissiveRadiance += vec3(1.0, 0.8, 0.45) * 1.3 * uLit * cover * (1.0 - fade);
      if (ci >= 0.0 && ci < n && fade > 0.0) {
        float hw = vFacB.y * 0.5, ab = vFacC.x + vFacB.z - vFacB.y * 1.2;         // ostrołuk: górna część okna zwęża się do szpica
        if (arch > 0.5 && ly > ab) hw *= 1.0 - pow(clamp((ly - ab) / (vFacB.y * 1.2), 0.0, 1.0), 1.7);
        float ex = hw - abs(fract(lu) - 0.5) * sp, ey = min(ly - vFacC.x, vFacC.x + vFacB.z - ly);
        float dIn = min(ex / fwu, ey / fwv);
        float inside = clamp(dIn + 0.5, 0.0, 1.0), frame = clamp(1.2 - abs(dIn), 0.0, 1.0);
        vec3 hp = fract(vec3(ci, k, floor(vFacC.z * 997.0 + 0.5)) * 0.1031); hp += dot(hp, hp.zyx + 31.32);
        float hsh = fract((hp.x + hp.y) * hp.z);
        float lit = step(hsh, uLit);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.22, 0.3), inside * fade);   // szyba
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.93, 0.9), frame * ffade * (1.0 - arch * 0.6));    // rama (w kościołach ciemniejsze obramienie)
        totalEmissiveRadiance += vec3(1.0, 0.8, 0.45) * 0.85 * lit * inside * fade;
      }
    }
  }
}`);
  };
  return U;
}
