// Sculpting tools: build a smooth body in code the way a sculptor would --
// base shapes whose cross-sections follow width/depth profiles, with muscles,
// bones and hollows added as smooth raised or sunken areas, all melted
// together into one surface ("clay") and turned into a mesh.
// Used by characterModel.js (part of the renderer; it only makes geometry).
import * as THREE from '../node_modules/three/build/three.module.js';

// Positions on a body part are given in "surface coordinates":
//   angle: around the part's vertical axis in radians. 0 = front (-Z),
//          +π/2 = the character's right (+X), -π/2 = their left, ±π = back.
//   y:     height along the part.

// A smooth base shape from keyframes [y, halfWidth, halfDepth, forwardOffset]
// (ascending y). forwardOffset moves that slice back (+) or forward (-).
// Returns y -> { rx, rz, cz }, smoothly interpolated between keyframes.
export function profile(keys) {
  const at = (i) => keys[Math.min(Math.max(i, 0), keys.length - 1)];
  return (y) => {
    let i = 0;
    while (i < keys.length - 2 && y > keys[i + 1][0]) i++;
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    const t = Math.min(Math.max((y - p1[0]) / (p2[0] - p1[0]), 0), 1);
    return {
      rx: Math.max(catmullRom(p0[1], p1[1], p2[1], p3[1], t), 0.0005),
      rz: Math.max(catmullRom(p0[2], p1[2], p2[2], p3[2], t), 0.0005),
      cz: catmullRom(p0[3], p1[3], p2[3], p3[3], t),
    };
  };
}

function catmullRom(p0, p1, p2, p3, t) {
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t
    + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
}

// A rounded raised (positive amp) or sunken (negative amp) area, e.g. a muscle belly.
//   width/height: its size across the surface and vertically
export function blob({ angle, y, amp, width, height }) {
  return (a, py, r) => {
    const v = (py - y) / height;
    if (v > 3 || v < -3) return 0;
    const u = angleDiff(a, angle) * r / width;
    return amp * Math.exp(-(u * u + v * v));
  };
}

// A long ridge (positive amp) or groove (negative amp) between two surface
// points, tapering off at both ends, e.g. a tendon, a bone or the spine.
export function ridge({ from: [a0, y0], to: [a1, y1], amp, width }) {
  const yMin = Math.min(y0, y1) - width * 3, yMax = Math.max(y0, y1) + width * 3;
  return (a, py, r) => {
    if (py < yMin || py > yMax) return 0;
    const bx = angleDiff(a1, a0) * r, by = y1 - y0;
    const px = angleDiff(a, a0) * r, pz = py - y0;
    const t = Math.min(Math.max((px * bx + pz * by) / (bx * bx + by * by), 0), 1);
    const dx = px - bx * t, dy = pz - by * t;
    const d2 = (dx * dx + dy * dy) / (width * width);
    const taper = Math.sin(Math.PI * t) ** 2; // eases in and out, so the ends leave no crease
    return d2 > 9 ? 0 : amp * taper * Math.exp(-d2);
  };
}

function angleDiff(a, b) {
  const d = (a - b) % (Math.PI * 2);
  return d > Math.PI ? d - Math.PI * 2 : d < -Math.PI ? d + Math.PI * 2 : d;
}

// The angle (surface coordinate) of a point around a part's vertical axis.
export function angleAround(x, z, cz) {
  return Math.atan2(x, -(z - cz));
}

// A body part as a distance function: (x, y, z) -> how far the point is
// outside the part's surface (negative = inside). Points are in the part's
// own coordinates, with its vertical axis along y.
//   shape: base shape from profile(); bumps: muscles from blob() and ridge()
//   range: [bottomY, topY] of the part
export function partDistance({ shape, bumps = [], range: [lo, hi] }) {
  // Rough size, so points far from the part can skip the detailed work.
  let maxR = 0;
  for (let i = 0; i <= 20; i++) {
    const { rx, rz, cz } = shape(lo + ((hi - lo) * i) / 20);
    maxR = Math.max(maxR, rx, rz + Math.abs(cz));
  }
  maxR += 0.04;

  return (x, y, z) => {
    const yc = y < lo ? lo : y > hi ? hi : y;
    const beyond = y < lo ? lo - y : y > hi ? y - hi : 0;
    const quick = Math.hypot(x, z) - maxR;
    if (quick > 0.12) return Math.hypot(quick, beyond); // (well beyond the widest blend between parts)

    const { rx, rz, cz } = shape(yc);
    const dz = z - cz;
    const a = Math.atan2(x, -dz);
    const sin = Math.sin(a), cos = Math.cos(a);
    // Radius of the (elliptical) cross-section in this direction, plus muscles.
    let r = (rx * rz) / Math.hypot(rz * sin, rx * cos);
    const rMean = (rx + rz) / 2;
    let bump = 0;
    for (let i = 0; i < bumps.length; i++) bump += bumps[i](a, yc, rMean);
    r += bump * Math.min(1, rMean / 0.02); // no bumps where the part closes to a point

    const radial = Math.hypot(x, dz) - r;
    return beyond > 0 ? Math.hypot(Math.max(radial, 0), beyond) : radial;
  };
}

// Melts two distances together, blending the surfaces over about `k` units
// (0 = a sharp join), like smoothing clay where two parts meet.
export function smoothUnion(a, b, k) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

// Turns a distance function into a smooth mesh ("surface nets").
//   bounds: { min: [x, y, z], max: [x, y, z] } containing the whole surface
//   cell:   size of the sampling grid (smaller = more detail, slower)
export function meshFromDistance(distance, { min, max }, cell) {
  const nx = Math.ceil((max[0] - min[0]) / cell) + 1;
  const ny = Math.ceil((max[1] - min[1]) / cell) + 1;
  const nz = Math.ceil((max[2] - min[2]) / cell) + 1;
  const index = (i, j, k) => i + nx * (j + ny * k);
  const values = new Float32Array(nx * ny * nz);
  const exact = new Uint8Array(nx * ny * nz);

  // Only sample finely near the surface: check blocks of the grid first and
  // skip the ones that are clearly all inside or all outside.
  const B = 6;
  const reach = Math.sqrt(3) * B * cell; // twice the half-diagonal of a block
  for (let k0 = 0; k0 < nz - 1; k0 += B) {
    for (let j0 = 0; j0 < ny - 1; j0 += B) {
      for (let i0 = 0; i0 < nx - 1; i0 += B) {
        const i1 = Math.min(i0 + B, nx - 1), j1 = Math.min(j0 + B, ny - 1), k1 = Math.min(k0 + B, nz - 1);
        const d = distance(
          min[0] + ((i0 + i1) / 2) * cell, min[1] + ((j0 + j1) / 2) * cell, min[2] + ((k0 + k1) / 2) * cell);
        const near = Math.abs(d) < reach;
        for (let k = k0; k <= k1; k++) {
          for (let j = j0; j <= j1; j++) {
            for (let i = i0; i <= i1; i++) {
              const n = index(i, j, k);
              if (exact[n]) continue;
              if (near) {
                values[n] = distance(min[0] + i * cell, min[1] + j * cell, min[2] + k * cell);
                exact[n] = 1;
              } else if (values[n] === 0) {
                values[n] = d; // same side of the surface as the block's centre
              }
            }
          }
        }
      }
    }
  }

  // One vertex per grid cell that the surface passes through, at the average
  // of the points where the surface crosses the cell's edges.
  const cellIndex = (i, j, k) => i + (nx - 1) * (j + (ny - 1) * k);
  const vertexOf = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
  const positions = [];
  const corners = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const v = new Float32Array(8);
  for (let k = 0; k < nz - 1; k++) {
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        let inside = 0;
        for (let c = 0; c < 8; c++) {
          v[c] = values[index(i + corners[c][0], j + corners[c][1], k + corners[c][2])];
          if (v[c] < 0) inside++;
        }
        if (inside === 0 || inside === 8) continue;
        let sx = 0, sy = 0, sz = 0, count = 0;
        for (const [a, b] of edges) {
          if ((v[a] < 0) === (v[b] < 0)) continue;
          const t = v[a] / (v[a] - v[b]);
          sx += corners[a][0] + (corners[b][0] - corners[a][0]) * t;
          sy += corners[a][1] + (corners[b][1] - corners[a][1]) * t;
          sz += corners[a][2] + (corners[b][2] - corners[a][2]) * t;
          count++;
        }
        vertexOf[cellIndex(i, j, k)] = positions.length / 3;
        positions.push(
          min[0] + (i + sx / count) * cell, min[1] + (j + sy / count) * cell, min[2] + (k + sz / count) * cell);
      }
    }
  }

  // Connect the vertices of the 4 cells around every grid edge the surface
  // crosses. Each 4-sided patch is split into two triangles along whichever
  // diagonal keeps both facing outwards (the other can fold over at creases).
  const indices = [];
  const facing = (a, b, c, axis) => {
    const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2];
    const u = [positions[b * 3] - ax, positions[b * 3 + 1] - ay, positions[b * 3 + 2] - az];
    const v = [positions[c * 3] - ax, positions[c * 3 + 1] - ay, positions[c * 3 + 2] - az];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    return n[axis] / (Math.hypot(n[0], n[1], n[2]) || 1);
  };
  const quad = (a, b, c, d, flip, axis) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) [b, d] = [d, b]; // reverse the winding
    const s = flip ? -1 : 1;
    const splitAC = Math.min(s * facing(a, b, c, axis), s * facing(a, c, d, axis));
    const splitBD = Math.min(s * facing(a, b, d, axis), s * facing(b, c, d, axis));
    if (splitAC >= splitBD) indices.push(a, b, c, a, c, d);
    else indices.push(a, b, d, b, c, d);
  };
  for (let k = 0; k < nz - 1; k++) {
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const inside = values[index(i, j, k)] < 0;
        // Edge along x (needs cells at j-1 and k-1).
        if (j > 0 && k > 0 && inside !== (values[index(i + 1, j, k)] < 0)) {
          quad(vertexOf[cellIndex(i, j - 1, k - 1)], vertexOf[cellIndex(i, j, k - 1)],
            vertexOf[cellIndex(i, j, k)], vertexOf[cellIndex(i, j - 1, k)], !inside, 0);
        }
        // Edge along y.
        if (i > 0 && k > 0 && inside !== (values[index(i, j + 1, k)] < 0)) {
          quad(vertexOf[cellIndex(i - 1, j, k - 1)], vertexOf[cellIndex(i - 1, j, k)],
            vertexOf[cellIndex(i, j, k)], vertexOf[cellIndex(i, j, k - 1)], !inside, 1);
        }
        // Edge along z.
        if (i > 0 && j > 0 && inside !== (values[index(i, j, k + 1)] < 0)) {
          quad(vertexOf[cellIndex(i - 1, j - 1, k)], vertexOf[cellIndex(i, j - 1, k)],
            vertexOf[cellIndex(i, j, k)], vertexOf[cellIndex(i - 1, j, k)], !inside, 2);
        }
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  relax(geometry, 2);
  geometry.computeVertexNormals();
  return geometry;
}

// Evens out the mesh slightly without shrinking it (Taubin smoothing).
function relax(geometry, iterations) {
  const pos = geometry.attributes.position.array;
  const idx = geometry.index.array;
  const count = pos.length / 3;
  const neighbours = Array.from({ length: count }, () => new Set());
  for (let t = 0; t < idx.length; t += 3) {
    const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]];
    neighbours[a].add(b).add(c); neighbours[b].add(a).add(c); neighbours[c].add(a).add(b);
  }
  const lists = neighbours.map((s) => [...s]);
  const step = (factor) => {
    const next = new Float32Array(pos);
    for (let v = 0; v < count; v++) {
      const n = lists[v];
      if (!n.length) continue;
      let x = 0, y = 0, z = 0;
      for (const u of n) { x += pos[u * 3]; y += pos[u * 3 + 1]; z += pos[u * 3 + 2]; }
      next[v * 3] += factor * (x / n.length - pos[v * 3]);
      next[v * 3 + 1] += factor * (y / n.length - pos[v * 3 + 1]);
      next[v * 3 + 2] += factor * (z / n.length - pos[v * 3 + 2]);
    }
    pos.set(next);
  };
  for (let i = 0; i < iterations; i++) { step(0.5); step(-0.53); }
  geometry.attributes.position.needsUpdate = true;
}

// Recompute normals so the surface is smooth everywhere, including across the
// seams where generated shapes have duplicate vertices (otherwise lighting and
// outlines would show a crease there).
export function smoothNormals(geometry) {
  geometry.computeVertexNormals();
  const pos = geometry.attributes.position;
  const normal = geometry.attributes.normal;
  const key = (i) => `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`;
  const sums = new Map();
  for (let i = 0; i < pos.count; i++) {
    const k = key(i);
    const s = sums.get(k) ?? [0, 0, 0];
    s[0] += normal.getX(i); s[1] += normal.getY(i); s[2] += normal.getZ(i);
    sums.set(k, s);
  }
  for (let i = 0; i < pos.count; i++) {
    const [x, y, z] = sums.get(key(i));
    const len = Math.hypot(x, y, z) || 1;
    normal.setXYZ(i, x / len, y / len, z / len);
  }
  normal.needsUpdate = true;
  return geometry;
}
