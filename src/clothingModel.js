// Loose clothing: parts of an outfit that hang away from the body (a skirt,
// flowing sleeves), so they can't just be painted onto the sculpt the way the
// fitted parts of an outfit are (see characterModel.js). Part of the renderer.
//
// Each piece is a thin sheet of fabric: an outer surface that curls round a
// rounded hem into an inner surface, so it has a little thickness and outlines
// like the rest of the model. Heights and sizes are in body units (see BODY in
// characterModel.js), before the character's height scaling.
import * as THREE from '../node_modules/three/build/three.module.js';
import { profile } from './sculptedSurface.js';
import { buildDepth } from './characterAppearance.js';

const FABRIC_THICKNESS = 0.006;
const HEM_STEPS = 6; // points round the rounded hem

// --- Skirt ---------------------------------------------------------------

// A tunic's lower half: hanging straight from the waist to the top of the
// thighs, loose but not flared. hem: where it ends (lower when it isn't
// belted). Its folds are shallow.
export function tunicSkirt(hem, tied = true) {
  if (!tied) return {
    top: 1.34, hem, gap: 0.009, straightHang: true,
    flare: [[1.34, 0.165], [hem, 0.175]],
    foldDepth: 0.018, hemWave: 0.005, rows: 40, columns: 96,
  };
  return {
    top: 1.16, hem, gap: 0.009,
    flare: [[1.16, 0.1], [1.16 - (1.16 - hem) * 0.35, 0.135],
      [1.16 - (1.16 - hem) * 0.7, 0.157], [hem, 0.17]],
    foldDepth: 0.05, hemWave: 0.008,
    rows: 28, columns: 96,
  };
}

// A flowing skirt from the waist to the middle of the calves.
const SKIRT = {
  top: 1.16,  // waist (tucked just inside the body)
  hem: 0.3,   // mid-calf
  gap: 0.012, // how far it stands off the body where the body pushes it out
  // Its outline from the side: [height, radius] -- fitted over the hips, then
  // falling in a gentle flare.
  flare: [[1.16, 0.1], [1.1, 0.15], [1.0, 0.2], [0.85, 0.235], [0.6, 0.275], [0.42, 0.3], [0.3, 0.315]],
  foldDepth: 0.13, // the folds' depth (a fraction of the radius) at the hem
  rows: 56,
  columns: 120,
};

export const ROBE_SKIRT = { ...SKIRT, hem: 0.22, foldDepth: 0, hemWave: 0, split: 0.14,
  flare: [[1.16, 0.1], [1.0, 0.2], [0.8, 0.23], [0.5, 0.26], [0.22, 0.29]] };

// `bodyDistance(x, y, z)`: the body the skirt hangs over (torso and legs), in
// body coordinates. `width`: the body's build, widening the skirt with it.
// spec: the skirt's shape (SKIRT, a dress's, by default; see TUNIC_SKIRT).
export function skirtGeometry(bodyDistance, width = 1, spec = SKIRT) {
  const SKIRT = spec;
  const { top, rows, columns } = SKIRT;
  // (Smooth curves through the keyframes, as for the body.)
  const flareCurve = profile([...SKIRT.flare].reverse().map(([y, r]) => [y, r, r, 0]));
  const flare = (y) => flareCurve(y).rx * width;

  // How far out the body reaches in each direction, blurred so the skirt only
  // follows its general shape (fabric bridges over small hollows).
  const heights = Array.from({ length: rows }, (_, i) => top + ((SKIRT.hem - top) * i) / (rows - 1));
  const skirtAngle = (i, j) => {
    if (!SKIRT.split) return angleOf(j, columns);
    const gap = 0.008 + SKIRT.split * Math.pow(i / (rows - 1), 0.8);
    return gap + (Math.PI * 2 - 2 * gap) * j / (columns - 1);
  };
  let reach = heights.map((y, i) => Array.from({ length: columns }, (_, j) => outerRadius(bodyDistance, y, skirtAngle(i, j))));
  for (let pass = 0; pass < 3; pass++) reach = blur(reach);
  const hangingReach = SKIRT.straightHang
    ? Array.from({ length: columns }, (_, j) => Math.max(...reach.map((row) => row[j])) + SKIRT.gap)
    : null;

  const rings = [];
  for (let i = 0; i < rows; i++) {
    const ring = [];
    for (let j = 0; j < columns; j++) {
      const a = skirtAngle(i, j);
      // Where the hem is at this angle: a little higher over each fold's crest.
      const folds = foldWave(a, SKIRT.hem);
      const hemY = SKIRT.hem + (SKIRT.hemWave ?? 0.02) * (folds + 1);
      const y = top + ((hemY - top) * i) / (rows - 1);
      const t = (top - y) / (top - SKIRT.hem); // 0 at the waist, 1 at the hem
      // Slightly narrower front to back near the waist, round further down.
      const oval = 1 - (0.2 - 0.15 * t) * Math.cos(a) ** 2;
      let r = smoothMax(flare(y) * oval, reach[i][j] + SKIRT.gap, 0.02);
      // Unbelted fabric follows the torso with a little ease, retaining
      // some straight drape so it does not look cinched by an invisible belt.
      if (hangingReach) {
        const straight = reach[0][j] + (hangingReach[j] - reach[0][j]) * t;
        const fitted = reach[i][j] + SKIRT.gap;
        r = fitted + Math.max(0, straight - fitted) * 0.25;
      }
      // The top tucks just inside the waist, so the skirt grows out of the bodice.
      const tuck = THREE.MathUtils.smoothstep(y, top - (hangingReach ? 0.1 : 0.04), top);
      r += (reach[i][j] - 0.003 - r) * tuck;
      // Folds, deepening towards the hem and turning slightly as they fall.
      r *= 1 + SKIRT.foldDepth * t ** 1.3 * foldWave(a, y);
      // A tunic's inward folds must still clear the trousers under it.
      if (spec !== undefined && SKIRT.hem > 0.7 && tuck < 0.01) r = Math.max(r, reach[i][j] + SKIRT.gap);
      ring.push({ p: [Math.sin(a) * r, y, -Math.cos(a) * r], inward: [-Math.sin(a), 0, Math.cos(a)] });
    }
    rings.push(ring);
  }
  const geometry = fabricGeometry(rings, [0, -1, 0], !SKIRT.split);
  geometry.userData.skirt = { rows, columns, top, hem: SKIRT.hem };
  return geometry;
}

// Moves a skirt with the body under it, so the legs never push
// through it: wherever a leg reaches out further than the skirt, the fabric
// is pushed out over it with a little room to spare, tenting out gently round
// it and hanging down from it (rather than clinging back in underneath). It
// also trails behind a little when running, and billows out as it falls.
// Works on its own copy of the skirt's mesh.
const SKIRT_MOTION = {
  gap: 0.02,      // room between the fabric and a leg pushing it out
  spread: 0.08,   // how far to the sides of a leg the fabric is lifted too
  hang: 1.1,      // how steeply fabric pushed out by a leg can fall back in below it...
  rise: 0.7,      // ...and above it (the top stays fixed at the waist)
};

export class SkirtMotion {
  constructor(geometry) {
    this.geometry = geometry;
    const { rows, columns, top, hem } = geometry.userData.skirt;
    this.rows = rows;
    this.columns = columns;
    this.top = top;
    this.hem = hem;
    this.rest = Float32Array.from(geometry.attributes.position.array);
    this.push = new Float32Array(rows * columns); // how far each point of the outer surface is pushed out
    this.lift = new Float32Array(rows * columns); // (and up)
    this.smoothPush = new Float32Array(rows * columns); // (blurred round the skirt, for things lying on it)
  }

  // spheres: [{ x, y, z, r }] -- the legs, as chains of spheres, in
  // the skirt's coordinates. trail: 0-1, how much the skirt streams back
  // (running). billow: 0-1, how much it floats up and out (falling).
  update(spheres, { trail = 0, billow = 0 } = {}) {
    const { rows, columns, rest, push, lift } = this;
    const { gap, spread, hang, rise } = SKIRT_MOTION;
    const range = this.top - this.hem;
    for (let j = 0; j < columns; j++) {
      let above = 0, aboveY = 0;
      for (let i = 0; i < rows; i++) {
        const v = (i * columns + j) * 3;
        const x = rest[v], y = rest[v + 1], z = rest[v + 2];
        const r = Math.hypot(x, z);
        const ex = x / r, ez = z / r;
        // How far out the legs reach in this direction, at this height.
        let reach = 0;
        for (const s of spheres) {
          const dy = y - s.y;
          if (dy >= s.r || dy <= -s.r) continue;
          const along = s.x * ex + s.z * ez;
          if (along <= 0) continue;
          const across = Math.abs(s.x * ez - s.z * ex);
          const radius = Math.sqrt(s.r * s.r - dy * dy);
          const wide = radius + spread;
          if (across >= wide) continue;
          reach = Math.max(reach, along + radius * Math.sqrt(1 - (across / wide) ** 2));
        }
        let out = reach > 0 ? Math.max(0, smoothMax(r, reach + gap, 0.03) - r) : 0;
        // Fabric pushed out higher up hangs down from there.
        if (i > 0) out = Math.max(out, above - hang * (aboveY - y));
        above = out;
        aboveY = y;
        push[i * columns + j] = out;
      }
    }
    // Smooth the pushes out a little (the legs are made of spheres, which
    // would otherwise leave ripples), without letting the fabric sink back
    // into the gap it keeps from the legs.
    smoothField(push, rows, columns, this.smoothPush);
    for (let k = 0; k < push.length; k++) push[k] = Math.max(this.smoothPush[k], push[k] - gap * 0.6);
    for (let j = 0; j < columns; j++) {
      // Fabric pushed out lower down is drawn out gradually above it too,
      // easing to nothing at the waist.
      for (let i = rows - 2; i >= 0; i--) {
        const k = i * columns + j, below = k + columns;
        const y = rest[k * 3 + 1], yBelow = rest[below * 3 + 1];
        const t = Math.min(Math.max((this.top - y) / range, 0), 1);
        push[k] = Math.max(push[k], (push[below] - rise * (y - yBelow)) * Math.min(t / 0.25, 1));
      }
      for (let i = 0; i < rows; i++) {
        const k = i * columns + j;
        const y = rest[k * 3 + 1];
        const t = Math.min(Math.max((this.top - y) / range, 0), 1);
        push[k] += Math.hypot(rest[k * 3], rest[k * 3 + 2]) * 0.12 * billow * t * t;
        lift[k] = 0.05 * billow * t * t;
      }
    }

    // Move the outer surface, the rounded hem and the inner surface together.
    const pos = this.geometry.attributes.position.array;
    const total = pos.length / 3 / columns;
    for (let row = 0; row < total; row++) {
      const i = row < rows ? row : row >= total - rows ? total - 1 - row : rows - 1;
      for (let j = 0; j < columns; j++) {
        const v = (row * columns + j) * 3;
        const x = rest[v], y = rest[v + 1], z = rest[v + 2];
        const r = Math.hypot(x, z) || 1;
        const k = i * columns + j;
        const t = Math.min(Math.max((this.top - y) / range, 0), 1);
        // (Trailing back only moves the back and sides, so the front never
        // falls back onto the legs.)
        const back = (1 + z / r) / 2;
        pos[v] = x + (x / r) * push[k];
        pos[v + 1] = y + lift[k];
        pos[v + 2] = z + (z / r) * push[k] + trail * 0.06 * t * t * back;
      }
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.computeVertexNormals();
    this.trail = trail;
    // (Things lying on the skirt follow a smoother version of it, so they bend
    // gently rather than crumpling.)
    smoothField(push, rows, columns, this.blurred ??= new Float32Array(push.length));
    smoothField(this.blurred, rows, columns, this.smoothPush);
  }

  // How far the skirt's surface has moved out (and back, and up) at a point
  // near it, e.g. to keep a braid lying on it: [dx, dy, dz].
  // (Smoothly interpolated, so things lying on it keep their shape.)
  offsetAt(x, y, z) {
    const { rows, columns, rest, smoothPush, lift } = this;
    if (y > this.top) return [0, 0, 0];
    const a = Math.atan2(x, -z);
    const u = ((((a / (2 * Math.PI)) * columns) % columns) + columns) % columns;
    const j0 = Math.floor(u) % columns, j1 = (j0 + 1) % columns, fu = u - Math.floor(u);
    // Rows are at (nearly) the same heights in every column.
    let i = 0;
    while (i < rows - 2 && rest[((i + 1) * columns + j0) * 3 + 1] > y) i++;
    const y0 = rest[(i * columns + j0) * 3 + 1], y1 = rest[((i + 1) * columns + j0) * 3 + 1];
    const fv = Math.min(Math.max((y0 - y) / (y0 - y1 || 1), 0), 1);
    const at = (field) => {
      const row = (ii) => field[ii * columns + j0] * (1 - fu) + field[ii * columns + j1] * fu;
      return row(i) * (1 - fv) + row(i + 1) * fv;
    };
    const out = at(smoothPush);
    const r = Math.hypot(x, z) || 1;
    const t = Math.min(Math.max((this.top - y) / (this.top - this.hem), 0), 1);
    return [(x / r) * out, at(lift), (z / r) * out + (this.trail ?? 0) * 0.06 * t * t];
  }
}

// A mix of waves round the skirt, between -1 and 1.
function foldWave(a, y) {
  const drift = 0.08 * (1 - y); // the folds turn gently as they fall, so they look loose
  return 0.8 * Math.sin(8 * (a + drift) + 0.3) + 0.2 * Math.sin(13 * a + 1.7);
}

// Distance from the centre line to the outside of the body at a height, in the
// direction `a` (surface angle: 0 = front). 0 if the body isn't there.
function outerRadius(distance, y, a) {
  const dx = Math.sin(a), dz = -Math.cos(a);
  let r = 0.9;
  for (let step = 0; step < 80 && r > 0; step++) {
    const d = distance(dx * r, y, dz * r);
    if (d < 0.0005) return r;
    r -= Math.max(d * 0.8, 0.001);
  }
  return 0;
}

// --- Sleeves ------------------------------------------------------------

// A loose sleeve that opens out from the elbow into a wide bell, ending
// halfway down the forearm. Built in the elbow's coordinates (the forearm hangs along -y).
// `down`: the direction of gravity in those coordinates -- when the forearm is
// raised, the lower side of the sleeve drapes down below the arm.
const SLEEVE = {
  top: 0.02,     // just above the elbow (inside the fitted upper sleeve)
  length: 0.145, // down to the middle of the forearm
  // Radius along the sleeve: [distance down, half width, half depth].
  shape: [[0, 0.033, 0.025], [0.03, 0.047, 0.04], [0.07, 0.056, 0.051], [0.11, 0.068, 0.064], [0.145, 0.08, 0.077]],
  drape: 0.12,   // how far the fabric hangs below a raised arm at the hem
  rows: 28,
  columns: 48,
};

const SLEEVE_SHAPE = profile(SLEEVE.shape.map(([s, rx, rz]) => [s, rx, rz, 0]));

// standingDown: if given, the direction of gravity with the arm hanging
// normally, stored as a morph target, so the sleeve's drape can follow the
// arm between the two (see CharacterModel.animate).
export function sleeveGeometry(down, width = 1, standingDown = null, robes = false) {
  const geometry = sleeveShape(down, width, robes);
  if (standingDown) {
    const standing = sleeveShape(standingDown, width, robes);
    geometry.morphAttributes.position = [standing.attributes.position];
    geometry.morphAttributes.normal = [standing.attributes.normal];
  }
  return geometry;
}

function sleeveShape(down, width, robes = false) {
  const { top, rows, columns } = SLEEVE;
  const length = robes ? 0.28 : SLEEVE.length;
  const axis = [0, -1, 0];
  const g = normalize(down);
  // Gravity across the sleeve (0 when the arm hangs straight down).
  const along = dot(g, axis);
  const across = g.map((v, k) => v - along * axis[k]);
  const acrossAmount = Math.hypot(...across);
  const acrossDir = acrossAmount > 1e-3 ? across.map((v) => v / acrossAmount) : [0, 0, 0];

  const rings = [];
  for (let i = 0; i < rows; i++) {
    const t = i / (rows - 1);
    const s = t * length;
    const section = SLEEVE_SHAPE(robes ? s / length * SLEEVE.length : s);
    const rx = section.rx + (robes ? 0.015 * (1 - t) : 0);
    const rz = section.rz + (robes ? 0.019 * (1 - t) : 0);
    const ring = [];
    for (let j = 0; j < columns; j++) {
      const a = angleOf(j, columns);
      const e = [Math.sin(a), 0, -Math.cos(a)];
      const fold = 1 + 0.06 * t * Math.sin(7 * a + 1.1);
      const p = [e[0] * rx * width * fold, top - s, e[2] * rz * buildDepth(width) * fold];
      // The lower side of the sleeve hangs down under its own weight.
      const hang = SLEEVE.drape * acrossAmount * t ** 1.6 * Math.max(dot(e, acrossDir), 0) ** 1.5;
      for (let k = 0; k < 3; k++) p[k] += g[k] * hang;
      ring.push({ p, inward: e.map((v) => -v) });
    }
    rings.push(ring);
  }
  return fabricGeometry(rings, axis);
}

// --- Loose tubes -----------------------------------------------------------

// A loose tube of fabric (or leather) round a limb -- a wide sleeve, a loose
// trouser leg, a boot's shaft -- hanging down its joint's -y from `top`.
// shape: [distance down, half width, half depth], from the top down.
// folds: how rumpled it is. Built in the joint's own coordinates.
export function looseTube(shape, { top = 0, folds = 0.04, rows = 16, columns = 32 } = {}) {
  const curve = profile(shape.map(([s, rx, rz]) => [s, rx, rz, 0]));
  const length = shape[shape.length - 1][0] - shape[0][0];
  const rings = [];
  for (let i = 0; i < rows; i++) {
    const t = i / (rows - 1);
    const s = shape[0][0] + t * length;
    const { rx, rz } = curve(s);
    const ring = [];
    for (let j = 0; j < columns; j++) {
      const a = angleOf(j, columns);
      const e = [Math.sin(a), 0, -Math.cos(a)];
      const fold = 1 + folds * Math.sin(5 * a + 0.7 + t * 2) * (0.4 + 0.6 * t);
      ring.push({ p: [e[0] * rx * fold, top - s, e[2] * rz * fold], inward: e.map((v) => -v) });
    }
    rings.push(ring);
  }
  return fabricGeometry(rings, [0, -1, 0]);
}

// --- Fabric sheet --------------------------------------------------------

// Builds the sheet from rings of points down the outer surface (top to hem),
// each with the direction into the garment. The outer surface curls round the
// hem (continuing in `hemDirection`) and back up as the inner surface.
export function fabricGeometry(rings, hemDirection, closed = true) {
  const columns = rings[0].length;
  const half = FABRIC_THICKNESS / 2;
  const outer = rings.map((ring) => ring.map(({ p }) => p));
  const hem = rings[rings.length - 1];
  const curl = [];
  for (let k = 1; k < HEM_STEPS; k++) {
    const phi = (Math.PI * k) / HEM_STEPS;
    curl.push(hem.map(({ p, inward }) => p.map((v, c) => v
      + inward[c] * half * (1 - Math.cos(phi))
      + hemDirection[c] * half * Math.sin(phi))));
  }
  const inner = rings.map((ring) => ring.map(({ p, inward }) => p.map((v, c) => v + inward[c] * FABRIC_THICKNESS))).reverse();
  const rows = [...outer, ...curl, ...inner];

  const positions = [];
  for (const row of rows) for (const p of row) positions.push(...p);
  const indices = [];
  for (let i = 0; i < rows.length - 1; i++) {
    for (let j = 0; j < (closed ? columns : columns - 1); j++) {
      const a = i * columns + j, b = i * columns + ((j + 1) % columns);
      const c = a + columns, d = b + columns;
      indices.push(a, b, c, b, d, c);
    }
  }
  if (!closed) {
    // Turn the lining back into each open front edge, preserving thickness.
    for (let i = 0; i < rings.length - 1; i++) for (const j of [0, columns - 1]) {
      const a = i * columns + j, b = (i + 1) * columns + j;
      const c = (rows.length - 1 - i) * columns + j, d = c - columns;
      if (j === 0) indices.push(a, c, b, b, c, d);
      else indices.push(a, b, c, b, d, c);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  // Make sure the outer surface faces outwards.
  const n = geometry.attributes.normal;
  const { inward } = rings[Math.floor(rings.length / 2)][0];
  const v = Math.floor(rings.length / 2) * columns;
  if (n.getX(v) * inward[0] + n.getY(v) * inward[1] + n.getZ(v) * inward[2] > 0) {
    const index = geometry.index.array;
    for (let i = 0; i < index.length; i += 3) [index[i + 1], index[i + 2]] = [index[i + 2], index[i + 1]];
    geometry.computeVertexNormals();
  }
  return geometry;
}

// --- Helpers -------------------------------------------------------------

function angleOf(j, columns) {
  return (2 * Math.PI * j) / columns;
}

// Blurs a grid of values (rows x columns, wrapping round the columns) into `out`.
function smoothField(field, rows, columns, out) {
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < columns; j++) {
      let sum = 0, weight = 0;
      for (let di = -2; di <= 2; di++) {
        const ii = Math.min(Math.max(i + di, 0), rows - 1);
        for (let dj = -2; dj <= 2; dj++) {
          const w = (3 - Math.abs(di)) * (3 - Math.abs(dj));
          sum += field[ii * columns + ((j + dj + columns) % columns)] * w;
          weight += w;
        }
      }
      out[i * columns + j] = sum / weight;
    }
  }
}

// The larger of two values, rounded off where they cross over `k`.
function smoothMax(a, b, k) {
  const h = Math.min(Math.max(0.5 + (0.5 * (a - b)) / k, 0), 1);
  return b + (a - b) * h + k * h * (1 - h);
}

// Averages each value with its neighbours (wrapping round, not up and down).
function blur(grid) {
  const rows = grid.length, cols = grid[0].length;
  return grid.map((row, i) => row.map((_, j) => {
    let sum = 0, count = 0;
    for (let di = -1; di <= 1; di++) {
      const r = grid[Math.min(Math.max(i + di, 0), rows - 1)];
      for (let dj = -2; dj <= 2; dj++) { sum += r[(j + dj + cols) % cols]; count++; }
    }
    return sum / count;
  }));
}

function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function normalize(v) { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); }
