// Weapon models: a sword, a shield and a halberd, in the same toon style as
// the characters (cel shading and dark outlines). Part of the renderer (used
// by characterModel.js); it only makes meshes.
//
// Each is built in its own frame, with its origin where it's held:
//   sword:   the middle of the grip; the blade points along -z
//   halberd: where the right hand grips the shaft; the shaft runs along y
//            (the head at +y), the axe blade faces -z, the hammer +z
//   shield:  the middle of its back, strapped to the forearm; its face
//            looks along -x
import * as THREE from '../node_modules/three/build/three.module.js';
import { smoothNormals } from './sculptedSurface.js';

const COLORS = {
  steel: '#c9ced6',
  darkSteel: '#8d939c',
  gold: '#d6a93a',
  leather: '#6b4028',
  wood: '#8a5a33',
  shieldFace: '#3d5fa8',
};

// part(geometry, material): makes an outlined mesh (see characterModel.js).
// toon(color): a cel-shaded material.
export function createWeapon(name, { part, toon }) {
  const m = (color) => toon(COLORS[color] ?? color);
  const group = new THREE.Group();
  const add = (geometry, color) => {
    const mesh = part(smoothNormals(geometry), m(color));
    group.add(mesh);
    return mesh;
  };

  if (name === 'sword') {
    // A straight, double-edged arming sword, about a metre long.
    add(bladeGeometry(0.62, 0.042, 0.007).translate(0, 0, -0.05), 'steel');
    add(new THREE.BoxGeometry(0.2, 0.022, 0.028).translate(0, 0, -0.05), 'gold');           // crossguard
    add(new THREE.CylinderGeometry(0.014, 0.016, 0.1, 10).rotateX(Math.PI / 2), 'leather'); // grip
    add(new THREE.SphereGeometry(0.024, 12, 10).translate(0, 0, 0.065), 'gold');            // pommel
  } else if (name === 'shield') {
    // A heater shield: flat-topped, curving to a point at the bottom, with a
    // steel rim, a boss in the middle and a leather strap behind.
    const shape = heaterShape(0.19, 0.5);
    const face = new THREE.ExtrudeGeometry(shape, { depth: 0.03, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 2, curveSegments: 16 });
    face.translate(0, -0.03, -0.015);
    face.rotateY(-Math.PI / 2); // (its face towards -x)
    add(face, 'shieldFace');
    const rim = new THREE.ExtrudeGeometry(heaterShape(0.205, 0.525), { depth: 0.02, bevelEnabled: false, curveSegments: 16 });
    rim.translate(0, -0.03, -0.01);
    rim.rotateY(-Math.PI / 2);
    rim.translate(0.004, 0, 0);
    add(rim, 'darkSteel');
    add(new THREE.SphereGeometry(0.055, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2).rotateZ(Math.PI / 2).translate(-0.03, 0, 0), 'steel'); // boss
    add(new THREE.BoxGeometry(0.02, 0.05, 0.16).translate(0.035, 0, 0), 'leather'); // strap
  } else if (name === 'halberd') {
    // A long wooden shaft with a spike on top, an axe blade on one side and a
    // hammer head on the other.
    add(new THREE.CylinderGeometry(0.02, 0.022, 1.9, 10).translate(0, 0.35, 0), 'wood');
    add(new THREE.ConeGeometry(0.03, 0.24, 8).translate(0, 1.42, 0), 'steel');               // spike
    add(new THREE.CylinderGeometry(0.03, 0.03, 0.12, 10).translate(0, 1.22, 0), 'darkSteel'); // socket
    const axe = new THREE.ExtrudeGeometry(axeShape(), { depth: 0.012, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 1, curveSegments: 16 });
    axe.translate(0, 0, -0.006);
    axe.rotateY(Math.PI / 2); // (the blade towards -z)
    axe.translate(0, 1.2, 0);
    add(axe, 'steel');
    add(new THREE.BoxGeometry(0.07, 0.07, 0.12).translate(0, 1.2, 0.1), 'darkSteel'); // hammer head
    add(new THREE.BoxGeometry(0.085, 0.085, 0.03).translate(0, 1.2, 0.17), 'darkSteel'); // (its striking face)
    add(new THREE.CylinderGeometry(0.024, 0.024, 0.16, 10).translate(0, 0, 0), 'leather'); // grip wrapping
  }
  return group;
}

// A blade, point towards -z: flat, tapering to a point in its last part.
function bladeGeometry(length, width, thickness) {
  const shape = new THREE.Shape();
  const tip = length * 0.18;
  shape.moveTo(-width / 2, 0);
  shape.lineTo(-width / 2, length - tip);
  shape.lineTo(0, length);
  shape.lineTo(width / 2, length - tip);
  shape.lineTo(width / 2, 0);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: true, bevelThickness: thickness / 2, bevelSize: thickness * 0.8, bevelSegments: 1 });
  g.translate(0, 0, -thickness / 2);
  g.rotateX(-Math.PI / 2); // (length along -z)
  g.rotateZ(Math.PI / 2);  // (flat side facing sideways, edges up and down)
  return g;
}

// A heater shield's outline: straight top, sides curving in to a point.
function heaterShape(halfWidth, height) {
  const s = new THREE.Shape();
  const top = height * 0.45, bottom = -height * 0.55;
  s.moveTo(-halfWidth, top);
  s.lineTo(halfWidth, top);
  s.lineTo(halfWidth, top - height * 0.3);
  s.bezierCurveTo(halfWidth, bottom + height * 0.35, halfWidth * 0.4, bottom + height * 0.1, 0, bottom);
  s.bezierCurveTo(-halfWidth * 0.4, bottom + height * 0.1, -halfWidth, bottom + height * 0.35, -halfWidth, top - height * 0.3);
  s.lineTo(-halfWidth, top);
  return s;
}

// A halberd's axe blade (in its own plane): a crescent-edged blade flaring
// out from the shaft, on the +x side.
function axeShape() {
  const s = new THREE.Shape();
  s.moveTo(0.02, 0.07);
  s.lineTo(0.1, 0.1);
  s.quadraticCurveTo(0.2, 0.12, 0.23, 0.16);
  s.quadraticCurveTo(0.27, 0, 0.23, -0.16);
  s.quadraticCurveTo(0.18, -0.1, 0.1, -0.09);
  s.lineTo(0.02, -0.06);
  s.closePath();
  return s;
}
