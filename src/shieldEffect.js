// Shield of Faith's look: a pearlescent, shimmering, see-through membrane
// over a character's whole model. Part of the renderer; it only draws.
//
// The membrane is a copy of each of the character's meshes (body, head, hair,
// hands, feet, clothes...), sharing their shapes -- so it bends, moves and
// sways with them -- drawn slightly larger, with a glassy material: nearly
// clear where it faces you, brighter towards the edges, and shifting through
// soft rainbow colours like the inside of a shell.
import * as THREE from '../node_modules/three/build/three.module.js';

const THICKNESS = 0.014; // how far the membrane stands off the body (world units)

export class ShieldEffect {
  // model: a CharacterModel.
  constructor(model) {
    this.materials = [];
    this.meshes = [];
    const sources = [];
    model.body.traverse((o) => {
      if (!o.isMesh || !o.visible || o.userData.shieldCopy) return;
      const m = o.material;
      if (m.side === THREE.BackSide || m.blending === THREE.AdditiveBlending || m.transparent) return; // (outlines and glows)
      sources.push(o);
    });
    model.body.updateMatrixWorld(true);
    const scale = new THREE.Vector3();
    for (const source of sources) {
      source.getWorldScale(scale);
      const material = shieldMaterial(THICKNESS / (scale.x || 1));
      source.userData.bendWrist?.(material); // (hands bend at the wrist -- see handModel.js)
      let copy;
      if (source.isSkinnedMesh) {
        copy = new THREE.SkinnedMesh(source.geometry, material);
        copy.bind(source.skeleton, source.bindMatrix);
      } else {
        copy = new THREE.Mesh(source.geometry, material);
      }
      if (source.morphTargetInfluences) copy.morphTargetInfluences = source.morphTargetInfluences; // (shared, so it drapes with it)
      copy.frustumCulled = false;
      copy.renderOrder = 2; // (after everything solid)
      copy.userData.shieldCopy = true;
      copy.visible = false;
      source.add(copy);
      this.meshes.push(copy);
      this.materials.push(material);
    }
  }

  // amount: 0 (none) to 1 (fully shielded); time: seconds, for the shimmer.
  set(amount, time) {
    for (const mesh of this.meshes) mesh.visible = amount > 0.01;
    for (const material of this.materials) {
      material.userData.uniforms.shieldAmount.value = amount;
      material.userData.uniforms.shieldTime.value = time;
    }
  }
}

function shieldMaterial(thickness) {
  const material = new THREE.MeshLambertMaterial({ transparent: true, depthWrite: false });
  const uniforms = {
    shieldAmount: { value: 0 },
    shieldTime: { value: 0 },
    shieldThickness: { value: thickness },
  };
  material.userData.uniforms = uniforms;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = `uniform float shieldThickness;
varying vec3 vShieldPos;
${shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
  transformed += normalize(objectNormal) * shieldThickness;
  vShieldPos = (modelMatrix * vec4(position, 1.0)).xyz;`)}`;
    shader.fragmentShader = `uniform float shieldAmount;
uniform float shieldTime;
varying vec3 vShieldPos;
${shader.fragmentShader.replace('#include <opaque_fragment>', `
  {
    vec3 n = normalize(normal);
    vec3 v = normalize(vViewPosition);
    float edge = pow(1.0 - abs(dot(n, v)), 2.2); // (0 facing you, 1 at the edges)
    // Soft rainbow sheen, drifting with position and time (mother-of-pearl).
    float phase = edge * 1.4 + dot(vShieldPos, vec3(1.3, 2.1, 1.7)) + shieldTime * 0.35;
    vec3 sheen = 0.5 + 0.5 * cos(6.2832 * (phase + vec3(0.0, 0.33, 0.67)));
    vec3 pearl = mix(vec3(0.95, 0.93, 1.0), sheen, 0.45);
    // Faint bands of shimmer rippling over it.
    float ripple = 0.5 + 0.5 * sin(dot(vShieldPos, vec3(9.0, 14.0, 7.0)) - shieldTime * 3.0);
    float alpha = (0.05 + 0.5 * edge + 0.06 * ripple) * shieldAmount;
    gl_FragColor = vec4(pearl + 0.15 * ripple, alpha);
  }`)}`;
  };
  material.customProgramCacheKey = () => 'shield-membrane';
  return material;
}
