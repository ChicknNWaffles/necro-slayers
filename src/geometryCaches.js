// The character models keep the shapes that take a while to sculpt (a body,
// a head, hands, feet, clothes -- see characterModel.js and friends) in
// caches, so they needn't be sculpted again for the same build. Those caches
// are registered here by name, so shapes sculpted in the background (see
// enemyWorker.js) can be packed up, sent over, and put into the page's caches
// -- after which making those characters is quick.
import * as THREE from '../node_modules/three/build/three.module.js';

const caches = new Map(); // name -> Map (key -> geometry)

export function registerGeometryCache(name, map = new Map()) {
  caches.set(name, map);
  return map;
}

// Empties every cache (in the background builder, so each character's shapes
// are all made afresh, and all sent).
export function clearGeometryCaches() {
  for (const map of caches.values()) map.clear();
}

// Everything in the caches, packed to send to the page: { entries, transfer }
// (the arrays are handed over, not copied).
export function packGeometryCaches() {
  const entries = [], transfer = [];
  for (const [name, map] of caches) {
    for (const [key, geometry] of map) {
      const attributes = {};
      for (const [attr, { array, itemSize, normalized }] of Object.entries(geometry.attributes)) {
        attributes[attr] = { array, itemSize, normalized };
        transfer.push(array.buffer);
      }
      const index = geometry.index?.array ?? null;
      if (index) transfer.push(index.buffer);
      entries.push({ name, key, attributes, index, userData: geometry.userData });
    }
  }
  return { entries, transfer };
}

// Puts packed shapes into the page's caches.
export function installGeometry(entries) {
  for (const { name, key, attributes, index, userData } of entries) {
    const map = caches.get(name);
    if (!map || map.has(key)) continue;
    const geometry = new THREE.BufferGeometry();
    for (const [attr, { array, itemSize, normalized }] of Object.entries(attributes)) {
      geometry.setAttribute(attr, new THREE.BufferAttribute(array, itemSize, normalized));
    }
    if (index) geometry.setIndex(new THREE.BufferAttribute(index, 1));
    geometry.userData = { ...userData, cached: true };
    geometry.computeBoundingSphere();
    map.set(key, geometry);
  }
}
