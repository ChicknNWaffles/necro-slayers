// A forest clearing: the layout of the place the game happens in (game logic
// -- the renderer draws it, see forestModel.js). A rough circle of grass with
// forest all round it, a few trees deep, and two paths leading off into the
// forest. Everything is placed at random from a seed, so a new clearing can be
// made for each scene (e.g. when the player walks off down a path).
//
// Characters can walk anywhere in the clearing and along the paths, but not
// into the trees.

// Sizes, in units (a person is about 2 tall).
const CLEARING = {
  radius: 18,       // the clearing's average radius
  wobble: 1.4,      // how far its edge wanders in and out
  forestDepth: 15,  // how deep the trees go round it (past that, the backdrop)
  farDepth: 32,     // a few sparser, hazier trees further out still
  pathWidth: 2.6,
  pathLength: 22,   // how far the paths go into the trees (from the clearing's edge)
};

// A seeded random number generator (mulberry32): the same seed always gives
// the same clearing.
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createClearing(seed = Math.floor(Math.random() * 2 ** 31)) {
  const random = seededRandom(seed);
  const between = (lo, hi) => lo + (hi - lo) * random();

  // The edge of the clearing: a circle, pushed in and out by a few waves.
  const waves = [2, 3, 5].map((n) => ({ n, amp: between(0.3, 1) * CLEARING.wobble / 2, phase: between(0, Math.PI * 2) }));
  const radiusAt = (angle) => CLEARING.radius + waves.reduce((sum, w) => sum + w.amp * Math.sin(w.n * angle + w.phase), 0);

  // Two paths, leaving the clearing on roughly opposite sides (never too
  // close together), each winding a little as it goes into the trees.
  const first = between(0, Math.PI * 2);
  const exits = [first, first + Math.PI + between(-0.9, 0.9)];
  const paths = exits.map((angle) => {
    const points = [];
    let heading = angle;
    const bend = between(-0.05, 0.05);
    const start = radiusAt(angle) - 5; // (starting a little inside the clearing, so it runs out of it)
    let x = Math.sin(angle) * start, z = -Math.cos(angle) * start;
    const steps = Math.ceil((CLEARING.pathLength + 5) / 1.5);
    for (let i = 0; i <= steps; i++) {
      points.push({ x, z });
      heading += bend + 0.08 * Math.sin(i * 0.7 + angle * 3);
      x += Math.sin(heading) * 1.5;
      z -= Math.cos(heading) * 1.5;
    }
    return { angle, points, halfWidth: CLEARING.pathWidth / 2, end: points[points.length - 1] };
  });
  const pathDistance = (x, z) => {
    let best = Infinity;
    for (const path of paths) best = Math.min(best, polylineDistance(path.points, x, z).distance);
    return best;
  };
  // How far along a path a point is (0 at its start in the clearing, 1 at its end).
  const alongPath = (path, x, z) => polylineDistance(path.points, x, z).along;

  // Trees: scattered through a ring round the clearing, spaced out so their
  // trunks don't crowd each other, and keeping off the paths. The inner ring is
  // dense (a wall of forest); a few more stand further out, fading into the haze.
  const trees = [];
  const place = (count, inner, outer, spacing, pathClearance) => {
    for (let tries = 0; tries < count * 30 && count > 0; tries++) {
      const angle = between(0, Math.PI * 2);
      const r = radiusAt(angle) + inner + (outer - inner) * Math.sqrt(random());
      const x = Math.sin(angle) * r, z = -Math.cos(angle) * r;
      if (pathDistance(x, z) < CLEARING.pathWidth / 2 + pathClearance) continue;
      if (trees.some((t) => Math.hypot(t.x - x, t.z - z) < spacing * (t.scale + 0.2))) continue;
      const conifer = random() < 0.4;
      trees.push({
        x, z, conifer,
        variant: Math.floor(random() * 4),  // (which of the tree shapes -- see forestModel.js)
        scale: between(0.8, 1.25),
        rotation: between(0, Math.PI * 2),
        lean: between(-0.04, 0.04),
      });
      count--;
    }
  };
  place(26, 0.6, 3.5, 2.8, 1.2);                        // the edge of the forest
  place(70, 3.5, CLEARING.forestDepth, 3.2, 1.6);        // the forest round it
  place(40, CLEARING.forestDepth, CLEARING.farDepth, 4.5, 2.5); // further out, in the haze

  // Bushes along the edge of the clearing and the sides of the paths, and a
  // few rocks.
  const bushes = [];
  for (let tries = 0; tries < 400 && bushes.length < 34; tries++) {
    const angle = between(0, Math.PI * 2);
    const r = radiusAt(angle) + between(-0.6, 3);
    const x = Math.sin(angle) * r, z = -Math.cos(angle) * r;
    if (pathDistance(x, z) < CLEARING.pathWidth / 2 + 0.5) continue;
    if (trees.some((t) => Math.hypot(t.x - x, t.z - z) < 1)) continue;
    bushes.push({ x, z, scale: between(0.6, 1.2), rotation: between(0, Math.PI * 2), variant: Math.floor(random() * 3) });
  }
  for (const path of paths) {
    for (let i = 4; i < path.points.length - 1; i += 2) {
      const p = path.points[i], q = path.points[i + 1];
      const side = random() < 0.5 ? -1 : 1, dx = q.x - p.x, dz = q.z - p.z, d = Math.hypot(dx, dz);
      const off = CLEARING.pathWidth / 2 + between(0.6, 1.4);
      bushes.push({ x: p.x + (-dz / d) * side * off, z: p.z + (dx / d) * side * off, scale: between(0.5, 0.9), rotation: between(0, Math.PI * 2), variant: Math.floor(random() * 3) });
    }
  }
  const rocks = [];
  for (let tries = 0; tries < 200 && rocks.length < 9; tries++) {
    const angle = between(0, Math.PI * 2);
    const r = radiusAt(angle) + between(-2.5, 1.5);
    const x = Math.sin(angle) * r, z = -Math.cos(angle) * r;
    if (pathDistance(x, z) < CLEARING.pathWidth / 2 + 0.3) continue;
    rocks.push({ x, z, scale: between(0.3, 0.8), rotation: between(0, Math.PI * 2), seed: random() });
  }

  // Where characters can go: in the clearing, or along a path (not past its end).
  const isWalkable = (x, z, margin = 0) => {
    const r = Math.hypot(x, z), angle = Math.atan2(x, -z);
    if (r <= radiusAt(angle) - 0.6 - margin) return true;
    return paths.some((path) => {
      const { distance, along } = polylineDistance(path.points, x, z);
      return distance <= path.halfWidth - 0.2 - margin && along < 0.98;
    });
  };

  // Moves a position back inside where characters can go, if it's outside:
  // sliding along the edge from where it was (`from`), or failing that,
  // pulled in towards the middle of the clearing.
  const keepWalkable = (pos, margin = 0, from = null) => {
    if (isWalkable(pos.x, pos.z, margin)) return pos;
    if (from) {
      if (isWalkable(pos.x, from.z, margin)) { pos.z = from.z; return pos; }
      if (isWalkable(from.x, pos.z, margin)) { pos.x = from.x; return pos; }
      if (isWalkable(from.x, from.z, margin)) { pos.x = from.x; pos.z = from.z; return pos; }
    }
    for (let k = 0.97; k > 0; k -= 0.03) {
      if (isWalkable(pos.x * k, pos.z * k, margin)) { pos.x *= k; pos.z *= k; return pos; }
    }
    pos.x = pos.z = 0;
    return pos;
  };

  return {
    seed, radiusAt, paths, trees, bushes, rocks,
    forestDepth: CLEARING.forestDepth, farDepth: CLEARING.farDepth,
    pathDistance, alongPath, isWalkable, keepWalkable,
    // (A point in the open clearing, for keeping wandering characters there.)
    inClearing: (x, z, margin = 0) => Math.hypot(x, z) <= radiusAt(Math.atan2(x, -z)) - 0.6 - margin,
  };
}

// The distance from (x, z) to a line through points, and how far along the
// line the nearest point is (0 to 1).
function polylineDistance(points, x, z) {
  let best = Infinity, along = 0, total = 0;
  const lengths = [];
  for (let i = 0; i < points.length - 1; i++) {
    const d = Math.hypot(points[i + 1].x - points[i].x, points[i + 1].z - points[i].z);
    lengths.push(d);
    total += d;
  }
  let walked = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const dx = b.x - a.x, dz = b.z - a.z;
    const t = Math.min(Math.max(((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1), 0), 1);
    const d = Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t));
    if (d < best) { best = d; along = (walked + lengths[i] * t) / total; }
    walked += lengths[i];
  }
  return { distance: best, along };
}
