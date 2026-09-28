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
//   bows:    the middle of the grip (left hand); the limbs run along z
//   crossbow, dagger: the grip (right hand); pointing along -z
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
  } else if (name === 'shortbow' || name === 'longbow') {
    // A simple wooden bow: two limbs curving back from the grip to the tips,
    // the string straight between them. Held in the left hand: the limbs run
    // along z, bowing away from the archer (-y), the string towards them.
    const long = name === 'longbow';
    const half = long ? 0.82 : 0.48, bulge = long ? 0.11 : 0.1;
    const tipY = 0.02;
    const limb = [];
    for (let i = 0; i <= 16; i++) {
      const z = -half + (2 * half * i) / 16;
      const u = z / half;
      // (A recurve at the tips of the short bow.)
      const recurve = long ? 0 : 0.03 * Math.max(Math.abs(u) - 0.8, 0) / 0.2;
      limb.push(new THREE.Vector3(0, -bulge * (1 - u * u) + tipY - recurve, z));
    }
    add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(limb), 48, long ? 0.014 : 0.013, 8), long ? '#7a4a24' : 'wood');
    add(new THREE.CylinderGeometry(0.022, 0.022, 0.13, 10).rotateX(Math.PI / 2).translate(0, -bulge + tipY, 0), 'leather'); // grip
    const ends = [limb[0], limb[limb.length - 1]];
    const string = new THREE.CylinderGeometry(0.0025, 0.0025, ends[1].distanceTo(ends[0]), 4).rotateX(Math.PI / 2).translate(0, ends[0].y, 0);
    add(string, '#eee6cf');
    group.userData.stringY = ends[0].y;
  } else if (name === 'crossbow') {
    // A crossbow: a wooden stock along -z (the front), a steel bow (the prod)
    // across its front, the string drawn back to the latch, and a bolt ready.
    add(new THREE.BoxGeometry(0.05, 0.06, 0.6).translate(0, 0.04, -0.07), 'wood');           // stock
    add(new THREE.BoxGeometry(0.06, 0.1, 0.16).translate(0, 0.01, 0.2), 'wood');             // butt
    add(new THREE.BoxGeometry(0.03, 0.08, 0.04).translate(0, -0.03, 0.02), 'leather');       // trigger grip
    const prod = [];
    for (let i = 0; i <= 12; i++) {
      const x = -0.3 + (0.6 * i) / 12, u = x / 0.3;
      prod.push(new THREE.Vector3(x, 0.07, -0.36 - 0.06 * (1 - u * u)));
    }
    add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(prod), 32, 0.012, 8), 'darkSteel');
    add(new THREE.CylinderGeometry(0.002, 0.002, 0.6, 4).rotateZ(Math.PI / 2).translate(0, 0.07, -0.36), '#eee6cf'); // string
    const bolt = createArrow('bolt', { part, toon });
    bolt.position.set(0, 0.09, -0.12);
    group.add(bolt);
    group.userData.bolt = bolt;
  } else if (name === 'dagger') {
    // A short dagger: a leaf-shaped blade, a small guard, a wrapped grip.
    add(bladeGeometry(0.2, 0.032, 0.006).translate(0, 0, -0.04), 'steel');
    add(new THREE.BoxGeometry(0.08, 0.016, 0.02).translate(0, 0, -0.04), 'darkSteel');
    add(new THREE.CylinderGeometry(0.012, 0.013, 0.08, 8).rotateX(Math.PI / 2), 'leather');
    add(new THREE.SphereGeometry(0.016, 10, 8).translate(0, 0, 0.05), 'darkSteel');
  }
  return group;
}

// An arrow ('arrow', for bows) or a crossbow bolt ('bolt'), pointing along
// -z, with its middle at the origin.
export function createArrow(kind, { part, toon }) {
  const group = new THREE.Group();
  const bolt = kind === 'bolt';
  const length = bolt ? 0.36 : 0.72;
  const add = (geometry, color) => group.add(part(smoothNormals(geometry), toon(COLORS[color] ?? color)));
  add(new THREE.CylinderGeometry(0.006, 0.006, length, 6).rotateX(Math.PI / 2), bolt ? 'darkSteel' : '#c9a36b');
  add(new THREE.ConeGeometry(0.014, 0.06, 6).rotateX(-Math.PI / 2).translate(0, 0, -length / 2 - 0.02), 'steel');
  for (const a of [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3]) {
    const vane = new THREE.BoxGeometry(0.002, bolt ? 0.022 : 0.03, bolt ? 0.06 : 0.1).translate(0, bolt ? 0.014 : 0.019, length / 2 - (bolt ? 0.04 : 0.06));
    vane.rotateZ(a);
    add(vane, bolt ? '#3a3a3a' : '#e8e2d6');
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
