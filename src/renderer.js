// 3D renderer: sets up and draws the 3D scene (camera, lights, meshes).
// Game logic does not belong here -- that lives in game.js. The game tells the
// renderer what exists and where it is; the renderer only draws it.
import * as THREE from '../node_modules/three/build/three.module.js';
import { CharacterModel, glowTexture } from './characterModel.js';

const PORTRAIT_BACKGROUND = '#d9e4ee'; // (matches the portrait frames in style.css)

// Third-person camera: circles a point at the player's chest, `distance` away.
const CAMERA = { distance: 4.5, pivotHeight: 1.5 };
const CAMERA_MIN_HEIGHT = 0.3; // keep the camera above the floor

export class GameRenderer {
  constructor(container) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.shadowMap.enabled = true;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xbfd9ee);
    this.scene.fog = new THREE.Fog(0xbfd9ee, 30, 90);

    this.camera = new THREE.PerspectiveCamera(70, 1, 0.1, 200);
    this.scene.add(this.camera);

    this.effects = []; // short-lived visual effects, e.g. a spell hitting (see effect())
    this.lastRender = performance.now();

    this.addLights();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  // The canvas the game is drawn into (used by the game for mouse capture).
  get canvas() {
    return this.renderer.domElement;
  }

  addLights() {
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x667766, 1.2));

    const sun = new THREE.DirectionalLight(0xffffff, 1.5);
    sun.position.set(10, 20, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const s = 30; // shadow camera covers the whole floor
    Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s });
    this.scene.add(sun);
  }

  // A flat horizontal floor centred on the origin, with a grid so movement is visible.
  addFloor({ width, depth, y }) {
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(width, depth),
      new THREE.MeshStandardMaterial({ color: 0x7fa36b }),
    );
    floor.rotation.x = -Math.PI / 2; // PlaneGeometry is vertical by default
    floor.position.y = y;
    floor.receiveShadow = true;
    this.scene.add(floor);

    const grid = new THREE.GridHelper(Math.max(width, depth), Math.max(width, depth), 0x4d6b40, 0x5d7f4f);
    grid.position.y = y + 0.01; // just above the floor to avoid z-fighting
    this.scene.add(grid);
  }

  // The player's character model, built from their appearance (see characterModel.js).
  addPlayer(appearance) {
    this.player = new THREE.Group(); // origin is at the player's feet
    this.playerModel = new CharacterModel(appearance);
    this.player.add(this.playerModel.root);
    this.scene.add(this.player);
  }

  // A non-player character. Returns the NPC's model, which the game passes
  // back to updateNpc and animateNpc.
  // yaw: the direction they face (same convention as the player).
  // pose: how they stand when still; decay: for the undead; caster: casts
  // spells (see characterModel.js).
  addNpc({ appearance, position, yaw, pose, decay, caster }) {
    const model = new CharacterModel(appearance, { pose, decay, caster });
    this.scene.add(model.root);
    this.updateNpc(model, position, yaw);
    return model;
  }

  updateNpc(model, position, yaw) {
    model.root.position.set(position.x, position.y, position.z);
    model.root.rotation.y = yaw;
  }

  // Play a gesture on the player's model (see characterAnimation.js).
  playerGesture(name) {
    this.playerModel.gesture(name);
  }

  // An NPC gestures (e.g. casts a spell), flinches from a hit, or falls down dead.
  npcGesture(model, name) {
    model.gesture(name);
  }

  // (With no model given, it's the player who flinches.)
  npcFlinch(model = this.playerModel) {
    model.flinch();
  }

  npcDie(model) {
    model.die();
  }

  // A burst of holy light where a smite lands: a flash, a ring spreading out
  // and a few sparks flying off. position: { x, y, z } in the world.
  smiteBurst(position) {
    const group = new THREE.Group();
    group.position.set(position.x, position.y, position.z);
    const additive = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false };
    const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#ffe38a', ...additive }));
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 40), new THREE.MeshBasicMaterial({ color: '#fff0b8', side: THREE.DoubleSide, ...additive }));
    const sparks = Array.from({ length: 10 }, () => {
      const spark = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#fff6d0', ...additive }));
      spark.userData.velocity = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).normalize().multiplyScalar(2 + Math.random() * 2);
      return spark;
    });
    group.add(flash, ring, ...sparks);
    this.scene.add(group);
    const duration = 0.45;
    this.addEffect({
      group,
      age: 0,
      update: (age, dt) => {
        const t = age / duration;
        flash.scale.setScalar(0.4 + 1.2 * t);
        flash.material.opacity = 1 - t;
        ring.scale.setScalar(0.15 + 0.7 * t);
        ring.material.opacity = (1 - t) * 0.9;
        ring.lookAt(this.camera.position); // (facing the camera)
        for (const spark of sparks) {
          spark.position.addScaledVector(spark.userData.velocity, dt);
          spark.userData.velocity.y -= 6 * dt;
          spark.scale.setScalar(0.12 * (1 - t));
          spark.material.opacity = 1 - t;
        }
        return t < 1;
      },
    });
  }

  // Divine Blade's area: a ring of golden light on the ground, pulsing, for
  // `duration` seconds. centre: { x, z } on the floor.
  bladeArea(centre, radius, duration) {
    const additive = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false };
    const group = new THREE.Group();
    group.position.set(centre.x, 0.03, centre.z);
    const ring = new THREE.Mesh(new THREE.RingGeometry(radius * 0.94, radius, 64), new THREE.MeshBasicMaterial({ color: '#ffd45c', side: THREE.DoubleSide, ...additive }));
    const fill = new THREE.Mesh(new THREE.CircleGeometry(radius, 64), new THREE.MeshBasicMaterial({ color: '#ffe9a8', side: THREE.DoubleSide, ...additive }));
    for (const mesh of [ring, fill]) mesh.rotation.x = -Math.PI / 2;
    group.add(fill, ring);
    this.scene.add(group);
    this.addEffect({
      group,
      age: 0,
      update: (age) => {
        const fadeIn = Math.min(age / 0.25, 1), fadeOut = Math.min((duration - age) / 0.4, 1);
        const pulse = 0.75 + 0.25 * Math.sin(age * 12);
        ring.material.opacity = fadeIn * fadeOut * pulse;
        fill.material.opacity = 0.18 * fadeIn * fadeOut;
        return age < duration;
      },
    });
  }

  // One of Divine Blade's swords: glowing, it drops point-first from high
  // above, landing on `at` ({ x, z } on the floor) after `fallTime` seconds,
  // where it sticks in the ground in a spray of sparks and then fades away.
  fallingSword(at, fallTime) {
    const sword = new THREE.Group();
    const material = new THREE.MeshBasicMaterial({ color: '#fff3c4', transparent: true });
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(), color: '#ffcf4a', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    halo.scale.set(0.5, 1.3, 1);
    halo.position.y = 0.55;
    sword.add(...swordParts(material), halo);
    sword.rotation.y = Math.random() * Math.PI;
    sword.rotation.z = (Math.random() - 0.5) * 0.25; // (a little off vertical)
    const height = 7, sink = 0.18;
    sword.position.set(at.x, height, at.z);
    this.scene.add(sword);
    let landed = false;
    this.addEffect({
      group: sword,
      age: 0,
      update: (age) => {
        if (age < fallTime) {
          const t = age / fallTime;
          sword.position.y = -sink + (height + sink) * (1 - t * t); // (speeding up as it falls)
          return true;
        }
        if (!landed) {
          landed = true;
          sword.position.y = -sink;
          this.sparks({ x: at.x, y: 0.05, z: at.z }, 6, 0.35);
        }
        const fade = 1 - Math.min((age - fallTime - 0.5) / 0.6, 1);
        material.opacity = fade;
        halo.material.opacity = fade * 0.8;
        return fade > 0;
      },
    });
  }

  // Shield of Faith on a character (the player's model if none is given):
  // amount 0 (none) to 1 (fully shielded).
  setShield(model = this.playerModel, amount) {
    model.setShield(amount, performance.now() / 1000);
  }

  // Healing light (Divine Restoration) on someone: a soft glow rising round
  // them from a ring of light at their feet, and motes of light drifting up.
  // position: { x, y, z } -- their feet.
  healingLight(position) {
    const additive = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false };
    const group = new THREE.Group();
    group.position.set(position.x, position.y, position.z);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.7, 48), new THREE.MeshBasicMaterial({ color: '#ffe8a0', side: THREE.DoubleSide, ...additive }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.03;
    const column = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 0.62, 2.2, 32, 1, true).translate(0, 1.1, 0),
      new THREE.MeshBasicMaterial({ color: '#fff0c0', side: THREE.DoubleSide, ...additive }),
    );
    const motes = Array.from({ length: 22 }, () => {
      const mote = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#fff4cc', ...additive }));
      const angle = Math.random() * Math.PI * 2, r = 0.25 + Math.random() * 0.4;
      mote.position.set(Math.sin(angle) * r, Math.random() * 0.4, Math.cos(angle) * r);
      mote.userData = { speed: 0.9 + Math.random() * 0.9, delay: Math.random() * 0.6, swirl: (Math.random() - 0.5) * 2 };
      return mote;
    });
    group.add(ring, column, ...motes);
    this.scene.add(group);
    const duration = 1.8;
    this.addEffect({
      group,
      age: 0,
      update: (age, dt) => {
        const t = age / duration;
        const fade = Math.min(t / 0.15, 1) * Math.min((1 - t) / 0.35, 1);
        ring.material.opacity = 0.9 * fade;
        ring.scale.setScalar(1 + 0.2 * Math.sin(age * 8));
        column.material.opacity = 0.16 * fade;
        for (const mote of motes) {
          const { speed, delay, swirl } = mote.userData;
          const live = age > delay;
          mote.visible = live;
          if (!live) continue;
          mote.position.y += speed * dt;
          const a = swirl * dt, c = Math.cos(a), s = Math.sin(a);
          const { x, z } = mote.position;
          mote.position.x = x * c - z * s;
          mote.position.z = x * s + z * c;
          mote.scale.setScalar(0.09 * fade);
          mote.material.opacity = fade;
        }
        return t < 1;
      },
    });
  }

  // Where a zombie's claws or teeth land: a spatter of dark blood.
  // position: { x, y, z } in the world.
  bloodSpatter(position) {
    this.sparks(position, 9, 0.5, { color: '#7a0e12', glow: false, size: 0.07 });
  }

  // A small spray of glowing sparks (e.g. where a sword lands), or with
  // glow: false, of drops (e.g. blood).
  sparks(position, count, duration, { color = '#fff2c0', glow = true, size = 0.1 } = {}) {
    const group = new THREE.Group();
    group.position.set(position.x, position.y, position.z);
    const sparks = Array.from({ length: count }, () => {
      const spark = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTexture(), color, transparent: true, depthWrite: false,
        blending: glow ? THREE.AdditiveBlending : THREE.NormalBlending,
      }));
      spark.userData.velocity = new THREE.Vector3(Math.random() - 0.5, 0.6 + Math.random(), Math.random() - 0.5).normalize().multiplyScalar(1.5 + Math.random() * 2);
      return spark;
    });
    group.add(...sparks);
    this.scene.add(group);
    this.addEffect({
      group,
      age: 0,
      update: (age, dt) => {
        const t = age / duration;
        for (const spark of sparks) {
          spark.position.addScaledVector(spark.userData.velocity, dt);
          spark.userData.velocity.y -= 7 * dt;
          spark.scale.setScalar(size * (1 - t));
          spark.material.opacity = 1 - t;
        }
        return t < 1;
      },
    });
  }

  // Starts an effect: { group (added to the scene), age, update(age, dt) --
  // returns false when it's over }. (Its first frame is set up straight away.)
  addEffect(effect) {
    effect.update(0, 0);
    this.effects.push(effect);
  }

  updateEffects(dt) {
    // (Effects can start new ones as they go -- e.g. a landing sword's sparks --
    // which are collected separately and kept.)
    const current = this.effects;
    this.effects = [];
    const kept = current.filter((effect) => {
      effect.age += dt;
      if (effect.update(effect.age, dt)) return true;
      this.scene.remove(effect.group);
      effect.group.traverse((o) => {
        if (!o.geometry?.userData.shared) o.geometry?.dispose(); // (shared shapes, like the sword's, are kept)
        o.material?.dispose();
      });
      return false;
    });
    this.effects = kept.concat(this.effects);
  }

  // Animate an NPC's body, like animatePlayer.
  animateNpc(model, state, dt) {
    model.animate(state, dt);
  }

  // Redraw the player with a new appearance (e.g. from a character creator).
  setPlayerAppearance(appearance) {
    this.playerModel.setAppearance(appearance);
  }

  updatePlayer(position, yaw) {
    this.player.position.set(position.x, position.y, position.z);
    this.player.rotation.y = yaw;
  }

  // Animate the player's body (walking, running) -- see characterAnimation.js.
  animatePlayer(state, dt) {
    this.playerModel.animate(state, dt);
  }

  // Place the camera around the player.
  // yaw:   which direction the camera looks horizontally (same convention as the player)
  // pitch: how far above the player the camera sits, in radians (negative = below)
  updateCamera({ yaw, pitch }) {
    const { distance, pivotHeight } = CAMERA;
    const p = this.player.position;

    // Camera sits `distance` away from the pivot, opposite to the direction it faces.
    const horizontal = Math.cos(pitch) * distance;
    this.camera.position.set(
      p.x + Math.sin(yaw) * horizontal,
      Math.max(p.y + pivotHeight + Math.sin(pitch) * distance, CAMERA_MIN_HEIGHT),
      p.z + Math.cos(yaw) * horizontal,
    );
    this.camera.lookAt(p.x, p.y + pivotHeight, p.z);
  }

  // --- For the HUD (see hud.js) ------------------------------------------

  // A headshot of a character (the player's model if none is given), as a
  // square canvas: their head and shoulders on a plain background, turned
  // slightly to look off to the right of the picture.
  portrait(model = this.playerModel, size = 128) {
    const head = new THREE.Vector3();
    model.joints.head.getWorldPosition(head);
    head.y += 0.1 * model.height; // (the middle of the face, above the neck joint)
    // The camera sits in front of the face, a little round to the character's
    // left, so they appear turned towards the picture's right.
    const yaw = model.root.getWorldQuaternion(new THREE.Quaternion());
    const toCamera = new THREE.Vector3(-Math.sin(-0.45), 0.08, -Math.cos(-0.45)).applyQuaternion(yaw).normalize();
    const camera = new THREE.PerspectiveCamera(24, 1, 0.05, 10);
    camera.position.copy(head).addScaledVector(toCamera, 0.95 * model.height);
    camera.lookAt(head.x, head.y - 0.04 * model.height, head.z);

    // Draw just this character, on a plain background.
    const owner = model.root.parent === this.scene ? model.root : model.root.parent; // (the player's model is in a group)
    const hidden = this.scene.children.filter((c) => c !== owner && !c.isLight && c.visible);
    for (const c of hidden) c.visible = false;
    const { background, fog } = this.scene;
    this.scene.background = new THREE.Color(PORTRAIT_BACKGROUND);
    this.scene.fog = null;
    const target = new THREE.WebGLRenderTarget(size, size, { samples: 4 });
    target.texture.colorSpace = THREE.SRGBColorSpace; // (colours as on screen)
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, camera);
    this.renderer.setRenderTarget(null);
    this.scene.background = background;
    this.scene.fog = fog;
    for (const c of hidden) c.visible = true;

    // Copy it into a canvas (the render comes out upside down).
    const pixels = new Uint8Array(size * size * 4);
    this.renderer.readRenderTargetPixels(target, 0, 0, size, size, pixels);
    target.dispose();
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const context = canvas.getContext('2d');
    const image = context.createImageData(size, size);
    for (let row = 0; row < size; row++) {
      image.data.set(pixels.subarray((size - 1 - row) * size * 4, (size - row) * size * 4), row * size * 4);
    }
    context.putImageData(image, 0, 0);
    return canvas;
  }

  // Where just above a character's head is on screen, in pixels (for a
  // health bar floating over it). visible: false if it's behind the camera.
  overHead(model) {
    const point = new THREE.Vector3();
    model.root.getWorldPosition(point);
    point.y += 2.25 * model.height;
    this.camera.updateMatrixWorld();
    point.project(this.camera);
    return {
      x: (point.x + 1) / 2 * window.innerWidth,
      y: (1 - point.y) / 2 * window.innerHeight,
      visible: point.z < 1 && Math.abs(point.x) < 1.2 && Math.abs(point.y) < 1.2,
    };
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render() {
    const now = performance.now();
    this.updateEffects(Math.min((now - this.lastRender) / 1000, 0.1));
    this.lastRender = now;
    this.renderer.render(this.scene, this.camera);
  }
}

// A sword, point down, its tip at y = 0: a long, slim blade with a point, a
// crossguard, a grip and a round pommel. (About 1.1 units long.)
const swordGeometry = (() => {
  const blade = new THREE.BoxGeometry(0.07, 0.72, 0.012).translate(0, 0.23 + 0.36, 0);
  const tip = new THREE.ConeGeometry(0.05, 0.23, 4).rotateX(Math.PI).rotateY(Math.PI / 4).scale(1, 1, 0.24).translate(0, 0.115, 0);
  const guard = new THREE.BoxGeometry(0.3, 0.04, 0.045).translate(0, 0.97, 0);
  const grip = new THREE.CylinderGeometry(0.018, 0.018, 0.18, 8).translate(0, 1.08, 0);
  const pommel = new THREE.SphereGeometry(0.035, 10, 8).translate(0, 1.19, 0);
  const parts = [blade, tip, guard, grip, pommel];
  for (const part of parts) part.userData.shared = true;
  return parts;
})();

function swordParts(material) {
  return swordGeometry.map((geometry) => new THREE.Mesh(geometry, material));
}
