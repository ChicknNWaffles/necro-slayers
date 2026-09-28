// Skeleton model: the bones of an undead skeleton, built onto the same
// skeleton of joints as any character (see characterModel.js), so it walks,
// fights and falls with the same animations. The ribcage is hidden under a
// ragged shirt (drawn by characterModel.js), so only the bones that show are
// modelled: the skull and neck, the spine below the shirt, the pelvis, the
// arms and legs, and simplified hands and feet. Part of the renderer.
import * as THREE from '../node_modules/three/build/three.module.js';
import { smoothNormals } from './sculptedSurface.js';

const BONE = '#e9dfc4';      // weathered, off-white bone
const SOCKET = '#1c1418';    // the dark hollows of the eyes and nose

// A long bone, running from y = 0 down to y = -length: a shaft, knobbly at
// both ends. radius: the shaft's; ends: how much wider the knobs are.
function longBone(length, radius, ends = 1.9) {
  const points = [];
  const steps = 20;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    // (Swelling into rounded knobs at the ends, closed off at the very tips.)
    const knob = Math.max(1 - Math.min(t, 1 - t) / 0.14, 0);
    const cap = Math.sqrt(Math.max(Math.min(t, 1 - t) * 30, 0.0001));
    const r = radius * (1 + (ends - 1) * knob * knob) * Math.min(cap, 1);
    points.push(new THREE.Vector2(Math.max(r, 0.0005), -t * length));
  }
  points.reverse(); // (bottom to top, so the surface faces outwards)
  return smoothNormals(new THREE.LatheGeometry(points, 10));
}

// Adds a skeleton's bones to a set of joints (see characterModel.js).
//   body: the body's measurements (BODY in characterModel.js)
//   part(geometry, material): makes an outlined mesh; toon(color): a cel-shaded material
// Returns the wrist joints (for bending the hands, as for a normal character).
export function addSkeletonBones(joints, body, { part, toon }) {
  const bone = toon(BONE);
  const dark = toon(SOCKET);
  const add = (joint, geometry, [x, y, z] = [0, 0, 0], rotation = null, material = bone) => {
    const mesh = part(geometry, material);
    mesh.position.set(x, y, z);
    if (rotation) mesh.rotation.set(...rotation);
    joints[joint].add(mesh);
    return mesh;
  };

  // The spine, from the pelvis up to the skull (mostly hidden by the shirt,
  // but showing at the neck and waist), and the pelvis.
  add('root', longBone(body.neckTop - 0.92, 0.02, 1.4), [0, body.neckTop, -0.01]);
  for (let i = 0; i < 9; i++) {
    const y = 0.98 + (i / 8) * (body.neckTop - 1.0);
    add('root', new THREE.CylinderGeometry(0.032, 0.032, 0.022, 10), [0, y, 0.005]); // (vertebrae)
  }
  for (const s of [-1, 1]) {
    // (The two wings of the hip bones, flaring out either side.)
    add('root', new THREE.SphereGeometry(0.07, 14, 10).scale(1, 1.1, 0.45), [s * 0.08, 1.0, 0.015], [0, s * 0.5, s * 0.25]);
  }
  add('root', new THREE.SphereGeometry(0.06, 12, 10).scale(1.6, 0.9, 0.9), [0, 0.93, 0.02]); // (the base of the pelvis)

  const wrists = {};
  for (const side of ['left', 'right']) {
    const sign = side === 'left' ? -1 : 1;
    // Arms: the upper arm bone, then two bones side by side in the forearm.
    add(`${side}Shoulder`, longBone(body.upperArmLength, 0.018));
    add(`${side}Elbow`, longBone(body.forearmLength, 0.012), [sign * 0.012, 0, 0.004]);
    add(`${side}Elbow`, longBone(body.forearmLength, 0.011), [-sign * 0.012, 0, -0.004]);
    // Hands (simplified): a flat, knuckled palm and four jointed fingers and a
    // thumb, curled a little. Carried by the elbow, like a normal hand, with a
    // wrist to bend them.
    const hand = new THREE.Group();
    hand.position.y = -body.forearmLength;
    joints[`${side}Elbow`].add(hand);
    const palm = part(new THREE.BoxGeometry(0.018, 0.075, 0.07), bone);
    palm.position.set(0, -0.045, 0);
    hand.add(palm);
    for (let f = 0; f < 4; f++) {
      const z = -0.027 + f * 0.018;
      let joint = hand;
      let y = -0.085, bend = 0.25;
      for (let k = 0; k < 3; k++) {
        const segment = new THREE.Group();
        segment.position.set(0, y, z);
        segment.rotation.z = sign * bend;
        const length = [0.035, 0.024, 0.018][k] * (f === 0 || f === 3 ? 0.9 : 1);
        const piece = part(longBone(length, 0.0045, 1.5), bone);
        segment.add(piece);
        joint.add(segment);
        joint = segment;
        y = -length;
        bend = 0.35;
      }
    }
    const thumb = part(longBone(0.05, 0.005, 1.5), bone);
    thumb.position.set(sign * 0.008, -0.03, -0.035);
    thumb.rotation.set(0.7, 0, sign * 0.3);
    hand.add(thumb);
    const wrist = new THREE.Object3D();
    wrist.userData.bend = new THREE.Vector3(); // (the hand bones don't bend at the wrist)
    wrists[side] = wrist;

    // Legs: the thigh bone, the two shin bones, the kneecap, and the foot.
    add(`${side}Hip`, longBone(body.thighLength, 0.022));
    add(`${side}Knee`, longBone(body.shinLength, 0.018), [0, 0, -0.008]);
    add(`${side}Knee`, longBone(body.shinLength * 0.95, 0.009), [sign * 0.022, -0.01, 0.008]);
    add(`${side}Knee`, new THREE.SphereGeometry(0.022, 10, 8).scale(1, 1.2, 0.7), [0, 0.01, -0.035]);
    const heel = new THREE.SphereGeometry(0.03, 10, 8).scale(1, 0.9, 1.3);
    add(`${side}Ankle`, heel, [0, -0.055, 0.02]);
    add(`${side}Ankle`, new THREE.BoxGeometry(0.06, 0.03, 0.08), [0, -0.06, -0.04]);
    for (let t = 0; t < 4; t++) {
      add(`${side}Ankle`, longBone(0.07, 0.006, 1.5), [(t - 1.5) * 0.016, -0.07, -0.08], [-Math.PI / 2 + 0.15, 0, 0]);
    }
  }

  // The skull: a rounded cranium, a narrower face, deep eye sockets and a
  // nose hole, cheekbones, and a jaw with a row of teeth.
  const R = body.headRadius;
  const skull = new THREE.Group();
  skull.position.y = 0.85 * R;
  joints.head.add(skull);
  const piece = (geometry, [x, y, z], material = bone) => {
    const mesh = part(geometry, material);
    mesh.position.set(x * R, y * R, z * R);
    skull.add(mesh);
    return mesh;
  };
  piece(new THREE.SphereGeometry(R, 24, 18).scale(0.86, 0.9, 1.0), [0, 0.12, 0.08]);           // cranium
  piece(new THREE.SphereGeometry(R, 20, 14).scale(0.62, 0.55, 0.62), [0, -0.38, -0.28]);        // face
  for (const s of [-1, 1]) {
    piece(new THREE.SphereGeometry(R * 0.2, 12, 10).scale(1, 1.1, 0.6), [s * 0.3, -0.12, -0.8], dark); // eye socket
    piece(new THREE.SphereGeometry(R * 0.16, 10, 8).scale(1.4, 0.8, 1), [s * 0.5, -0.38, -0.5]);      // cheekbone
  }
  piece(new THREE.ConeGeometry(R * 0.09, R * 0.2, 3).rotateX(Math.PI), [0, -0.42, -0.84], dark);    // nose hole
  const jaw = piece(new THREE.BoxGeometry(R * 0.85, R * 0.26, R * 0.7), [0, -0.8, -0.28]);
  jaw.rotation.x = 0.15;
  for (let t = 0; t < 8; t++) {
    const a = (t / 7 - 0.5) * 1.3;
    piece(new THREE.BoxGeometry(R * 0.075, R * 0.13, R * 0.06), [Math.sin(a) * 0.33, -0.62, -0.62 + (1 - Math.cos(a)) * 0.3]);
  }
  return wrists;
}
