// A long, thick three-strand braid hanging from the back of the head, lying
// over the back (and anything worn over it, like a full skirt). Part of the
// renderer (used by characterModel.js); it only makes geometry.
//
// Anime style: the braid is drawn as its woven sections -- rounded lobes
// angled alternately left and right in a chevron pattern -- ending in a tie
// and a loose tuft. Everything is in body units, in body coordinates.
import * as THREE from '../node_modules/three/build/three.module.js';
import { smoothNormals } from './sculptedSurface.js';

// width: across the braid at the top (it narrows a little towards the end).
// start: the top of the braid (just below the tie at the nape).
// endY: the height of the tip.
// backOf(y, x): how far back (+z) the body reaches at a height and sideways position.
export function braidGeometry({ start, endY, width, backOf }) {
  const path = hangingPath(start, endY, width, backOf);
  const length = path[path.length - 1].s;
  const tuftLength = width * 1.1;
  const woven = length - tuftLength - width * 0.25; // where the tie at the end is
  const widthAt = (s) => width * (1 - 0.3 * Math.min(s / woven, 1));

  // The woven part: lobes alternating from side to side, each angled down
  // towards the middle.
  const lobes = [];
  const sphere = new THREE.SphereGeometry(1, 16, 12);
  for (let s = width * 0.25, i = 0; s < woven; i++) {
    const w = widthAt(s);
    const side = i % 2 ? 1 : -1;
    const { p, T, N, B } = frameAt(path, s);
    const tilt = 0.62;
    const axis = T.clone().multiplyScalar(Math.cos(tilt)).addScaledVector(B, -side * Math.sin(tilt));
    const across = new THREE.Vector3().crossVectors(axis, N).normalize();
    const centre = p.clone().addScaledVector(B, side * w * 0.2);
    const m = new THREE.Matrix4().makeBasis(across, axis, N)
      .scale(new THREE.Vector3(w * 0.27, w * 0.52, w * 0.24))
      .setPosition(centre);
    lobes.push(sphere.clone().applyMatrix4(m));
    s += w * 0.4;
  }

  // The loose tuft below the tie: a few tapering bunches, fanning out slightly.
  const tuftStart = woven + width * 0.12;
  const tuft = [];
  const { p: tp, T: tT, N: tN, B: tB } = frameAt(path, tuftStart);
  for (const [spread, scale] of [[-0.3, 0.8], [0.3, 0.8], [0, 1]]) {
    const dir = tT.clone().addScaledVector(tB, spread).normalize();
    const g = spindle(widthAt(woven) * 0.33 * scale, tuftLength * (0.8 + 0.2 * scale));
    const across = new THREE.Vector3().crossVectors(dir, tN).normalize();
    g.applyMatrix4(new THREE.Matrix4().makeBasis(across, dir.clone().negate(), tN).setPosition(tp.clone().addScaledVector(tN, 0.004 * scale)));
    tuft.push(g);
  }

  return {
    braid: smoothNormals(mergeGeometries([...lobes, ...tuft])),
    // The tie at the end: a band round the braid.
    endTie: tieGeometry(frameAt(path, woven + width * 0.05), widthAt(woven) * 0.36),
  };
}

// A band round a strand of hair, at a point on the braid's path.
function tieGeometry({ p, T, N }, radius) {
  const g = new THREE.TorusGeometry(radius, radius * 0.3, 10, 24);
  const B = new THREE.Vector3().crossVectors(T, N).normalize();
  // The torus is round the z axis: turn that onto the braid's direction.
  g.applyMatrix4(new THREE.Matrix4().makeBasis(B, N, T).setPosition(p));
  return smoothNormals(g);
}

// The line the braid hangs along: from the nape it falls straight down, until
// the body (or skirt) pushes it out, and it then lies over the body like a
// rope pulled taut by its weight (straight between the places it touches),
// with the corners softened.
function hangingPath(start, endY, width, backOf) {
  const clearance = width * 0.26; // from the braid's centre to the surface under it
  const step = 0.01;
  const ys = [];
  for (let y = start[1]; y > endY; y -= step) ys.push(y);
  ys.push(endY);
  const surface = ys.map((y) => Math.max(
    backOf(y, 0), backOf(y, -width * 0.35), backOf(y, width * 0.35),
  ) + clearance);

  const z = new Array(ys.length);
  z[0] = start[2];
  let i = 0;
  while (i < ys.length - 1) {
    // The steepest way out to any point below (0 if nothing is in the way).
    let best = -1, bestSlope = 0;
    for (let j = i + 1; j < ys.length; j++) {
      const slope = (surface[j] - z[i]) / (ys[i] - ys[j]);
      if (slope > bestSlope) { bestSlope = slope; best = j; }
    }
    if (best < 0) { z[i + 1] = z[i]; i++; continue; }
    for (let j = i + 1; j <= best; j++) z[j] = z[i] + bestSlope * (ys[i] - ys[j]);
    i = best;
  }
  // Soften the corners, keeping it clear of the body.
  for (let pass = 0; pass < 8; pass++) {
    for (let k = 1; k < z.length - 1; k++) z[k] = Math.max((z[k - 1] + 2 * z[k] + z[k + 1]) / 4, surface[k]);
  }

  let s = 0;
  return ys.map((y, k) => {
    if (k > 0) s += Math.hypot(ys[k - 1] - y, z[k - 1] - z[k]);
    return { p: new THREE.Vector3(start[0], y, z[k]), s };
  });
}

// Position and directions at a distance `s` along the path: T down the braid,
// N out away from the body, B across.
function frameAt(path, s) {
  let k = 1;
  while (k < path.length - 1 && path[k].s < s) k++;
  const a = path[k - 1], b = path[k];
  const t = Math.min(Math.max((s - a.s) / (b.s - a.s || 1), 0), 1);
  const p = a.p.clone().lerp(b.p, t);
  const T = b.p.clone().sub(a.p).normalize();
  const N = new THREE.Vector3(0, 0, 1).addScaledVector(T, -T.z).normalize();
  const B = new THREE.Vector3().crossVectors(T, N).normalize();
  return { p, T, N, B };
}

// A bunch of hair, round at the top and tapering to a point, hanging down -y from the origin.
function spindle(radius, length) {
  const points = [];
  const steps = 16;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const r = t < 0.25 ? Math.sin((t / 0.25) * Math.PI / 2) : ((1 - t) / 0.75) ** 0.8;
    points.push(new THREE.Vector2(Math.max(r * radius, 1e-4), -t * length));
  }
  return new THREE.LatheGeometry(points, 16);
}

// Joins meshes into one (positions, normals and triangles).
function mergeGeometries(geometries) {
  const positions = [], indices = [];
  let offset = 0;
  for (const g of geometries) {
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
    if (g.index) for (const i of g.index.array) indices.push(i + offset);
    else for (let i = 0; i < pos.count; i++) indices.push(i + offset);
    offset += pos.count;
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  merged.setIndex(indices);
  return merged;
}
