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
attribute vec4 aFacA; attribute vec4 aFacB; attribute vec3 aFacC;
varying vec4 vFacA; varying vec4 vFacB; varying vec3 vFacC; varying vec3 vWPos;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vFacA = aFacA; vFacB = aFacB; vFacC = aFacC; vWPos = (modelMatrix * vec4(position, 1.0)).xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec4 vFacA; varying vec4 vFacB; varying vec3 vFacC; varying vec3 vWPos;
uniform float uLit; uniform vec4 uDoorA[${MAX_DOORS}]; uniform vec4 uDoorB[${MAX_DOORS}]; uniform int uDoorN;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
for (int i = 0; i < ${MAX_DOORS}; i++) {
  if (i >= uDoorN) break;
  vec4 a = uDoorA[i]; vec4 b = uDoorB[i]; vec2 d = vWPos.xz - a.xy;
  if (abs(dot(d, a.zw)) < b.z && abs(dot(d, vec2(-a.w, a.z))) < b.w && vWPos.y > b.x && vWPos.y < b.y) discard;
}
if (vFacA.z > 0.5 && vFacB.x > 0.5) {
  float sp = vFacB.x, L = vFacA.z, n = floor((L - 0.6) / sp);
  if (n >= 1.0) {
    float off = (L - n * sp) * 0.5, lu = (vFacA.x - off) / sp, ci = floor(lu);
    float lv = vFacA.y - vFacB.w, k = floor(lv / vFacA.w), ly = lv - k * vFacA.w;
    float fwu = max(fwidth(vFacA.x), 1e-4), fwv = max(fwidth(vFacA.y), 1e-4);
    float fade = 1.0 - smoothstep(0.035, 0.12, max(fwu, fwv));
    if (k >= 0.0 && k < vFacC.y) {
      float cover = vFacB.y * vFacB.z / (sp * vFacA.w);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.22, 0.3), cover * 0.6 * (1.0 - fade));
      totalEmissiveRadiance += vec3(1.0, 0.8, 0.45) * 1.3 * uLit * cover * (1.0 - fade);
      if (ci >= 0.0 && ci < n && fade > 0.0) {
        float ex = vFacB.y * 0.5 - abs(fract(lu) - 0.5) * sp, ey = min(ly - vFacC.x, vFacC.x + vFacB.z - ly);
        float dIn = min(ex / fwu, ey / fwv);
        float inside = clamp(dIn + 0.5, 0.0, 1.0), frame = clamp(1.2 - abs(dIn), 0.0, 1.0);
        vec3 hp = fract(vec3(ci, k, floor(vFacC.z * 997.0 + 0.5)) * 0.1031); hp += dot(hp, hp.zyx + 31.32);
        float hsh = fract((hp.x + hp.y) * hp.z);
        float lit = step(hsh, uLit);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.22, 0.3), inside * fade);   // szyba
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.93, 0.9), frame * fade);    // rama
        totalEmissiveRadiance += vec3(1.0, 0.8, 0.45) * 0.85 * lit * inside * fade;
      }
    }
  }
}`);
  };
  return U;
}
