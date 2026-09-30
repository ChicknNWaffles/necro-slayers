// 3D renderer: sets up and draws the 3D scene (camera, lights, meshes).
// Game logic does not belong here -- that lives in game.js. The game tells the
// renderer what exists and where it is; the renderer only draws it.
import * as THREE from '../node_modules/three/build/three.module.js';
import { CharacterModel, glowTexture } from './characterModel.js';
import { createArrow } from './weaponModel.js';
import { createForest, HAZE_COLOR, SKY_COLOR } from './forestModel.js';

// How long a Wall of Earth takes to crumble away, from its top row to its bottom.
export const WALL_CRUMBLE_TIME = 1.0;

// The camera while aiming a bow: closer, and over the right shoulder.
const AIM_CAMERA = { distance: 3.0, side: 0.75, up: 0.2 };

const PORTRAIT_BACKGROUND = '#d9e4ee'; // (matches the portrait frames in style.css)

// Third-person camera: circles a point at the player's chest, `distance` away.
const CAMERA = { distance: 4.5, pivotHeight: 1.5 };
const CAMERA_MIN_HEIGHT = 0.3; // keep the camera above the floor

export class GameRenderer {
  constructor(container) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.shadowMap.enabled = true;
    this.renderer.localClippingEnabled = true; // (for walls crumbling away from the top -- see earthWall)
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    // (Above the painted backdrop, the sky; the haze fades distant trees into the painting.)
    this.scene.background = new THREE.Color(SKY_COLOR);
    this.scene.fog = new THREE.Fog(HAZE_COLOR, 24, 80);

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
    this.scene.add(new THREE.HemisphereLight(0xeef6ff, 0x5d6b45, 1.2));

    const sun = new THREE.DirectionalLight(0xfff1dc, 1.6);
    sun.position.set(10, 20, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    sun.shadow.bias = -0.0004;
    const s = 36; // shadow camera covers the clearing and the trees round it
    Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s });
    this.scene.add(sun);
  }

  // The forest clearing (see clearing.js for its layout, and forestModel.js
  // for how it's drawn).
  addClearing(clearing) {
    this.forest = createForest(clearing);
    this.scene.add(this.forest.group);
  }

  // The player's character model, built from their appearance (see characterModel.js).
  // caster: whether they cast spells (their hand can glow); weapons: the
  // weapons they carry (see weaponModel.js).
  addPlayer(appearance, { caster = false, weapons = [] } = {}) {
    this.player = new THREE.Group(); // origin is at the player's feet
    this.playerModel = new CharacterModel(appearance, { caster, weapons });
    this.player.add(this.playerModel.root);
    this.scene.add(this.player);
  }

  // A non-player character. Returns the NPC's model, which the game passes
  // back to updateNpc and animateNpc.
  // yaw: the direction they face (same convention as the player).
  // pose: how they stand when still; decay: for the undead; caster: casts
  // spells (see characterModel.js).
  // weapons: the weapons they carry (see weaponModel.js).
  addNpc({ appearance, position, yaw, pose, decay, caster, weapons = [] }) {
    const model = new CharacterModel(appearance, { pose, decay, caster, weapons });
    this.scene.add(model.root);
    this.updateNpc(model, position, yaw);
    return model;
  }

  updateNpc(model, position, yaw) {
    model.root.position.set(position.x, position.y, position.z);
    model.root.rotation.y = yaw;
  }

  // A burst of golden motes swirling up round someone as they're empowered
  // (Sovereign Aid). position: { x, y, z } -- their feet.
  empowerBurst(position) {
    this.sparks({ x: position.x, y: position.y + 1.2, z: position.z }, 18, 0.7, { color: '#ffcf4a', size: 0.12 });
    this.sparks({ x: position.x, y: position.y + 0.6, z: position.z }, 10, 0.6, { color: '#fff1b0', size: 0.08 });
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

  // Cleansing Light: a beam of holy light shining straight out from a
  // character's palm, level with the ground, `length` long, for `duration`
  // seconds -- a white-hot core in a soft golden glow, with a flare at the hand.
  lightBeam(model = this.playerModel, length, duration) {
    const additive = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false };
    const group = new THREE.Group();
    model.palmPosition(group.position);
    const facing = new THREE.Vector3(0, 0, -1).applyQuaternion(model.root.getWorldQuaternion(new THREE.Quaternion()));
    facing.y = 0;
    group.lookAt(group.position.clone().sub(facing.normalize())); // (so the group's -z points along the beam)
    const beamPart = (radius, color) => {
      const mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(radius, radius * 1.3, length, 24, 1, true).rotateX(Math.PI / 2).translate(0, 0, -length / 2),
        new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, ...additive }),
      );
      group.add(mesh);
      return mesh;
    };
    const core = beamPart(0.07, '#ffffff');
    const inner = beamPart(0.18, '#fff2b8');
    const outer = beamPart(0.38, '#ffd45c');
    const flare = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#fff6d0', ...additive }));
    group.add(flare);
    this.scene.add(group);
    this.addEffect({
      group,
      age: 0,
      update: (age) => {
        const t = age / duration;
        const on = Math.min(age / 0.08, 1) * Math.min((duration - age) / 0.2, 1); // (snapping on, fading off)
        const flicker = 0.85 + 0.15 * Math.sin(age * 60);
        core.material.opacity = on;
        inner.material.opacity = 0.55 * on * flicker;
        outer.material.opacity = 0.22 * on * flicker;
        const swell = 1 + 0.15 * Math.sin(age * 25);
        inner.scale.set(swell, swell, 1);
        flare.scale.setScalar(0.9 * on * flicker);
        flare.material.opacity = on;
        return t < 1;
      },
    });
  }

  // Stunned (e.g. by Cleansing Light): little stars circling over a
  // character's head for as long as it lasts. (Called every frame.)
  setDazed(model = this.playerModel, dazed) {
    model.userData ??= {};
    const state = model.userData;
    state.dazed = dazed;
    if (!dazed || state.daze) return;
    const group = new THREE.Group();
    group.position.y = 2.15 * model.height;
    const stars = Array.from({ length: 3 }, () => {
      const star = new THREE.Sprite(new THREE.SpriteMaterial({ map: starTexture(), color: '#ffe36b', transparent: true, depthWrite: false }));
      star.scale.setScalar(0.16);
      group.add(star);
      return star;
    });
    model.root.add(group);
    state.daze = group;
    this.addEffect({
      group,
      age: 0,
      update: (age) => {
        if (!state.dazed) {
          group.parent?.remove(group);
          state.daze = null;
          return false;
        }
        stars.forEach((star, i) => {
          const a = age * 4 + (i * Math.PI * 2) / 3;
          star.position.set(Math.cos(a) * 0.25, 0.04 * Math.sin(a * 2), Math.sin(a) * 0.25);
        });
        return true;
      },
    });
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

  // Raise or lower a character's shield (the player's if no model is given).
  setBlocking(model = this.playerModel, blocking) {
    model.setBlocking(blocking);
  }

  // Where a weapon strikes metal (e.g. a blocked blow): bright sparks.
  weaponSparks(position) {
    this.sparks(position, 10, 0.35, { color: '#fff4c8', size: 0.08 });
  }

  // Where a skeleton is struck: chips of bone flying off.
  boneChips(position) {
    this.sparks(position, 10, 0.45, { color: '#e9dfc4', glow: false, size: 0.06 });
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
    this.lastDt = dt; // (for effects that move things along by it)
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
        if (o.material !== arrowOutline && ![...arrowMaterials.values()].includes(o.material)) o.material?.dispose();
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
  // aiming: 0-1 -- moves the camera in closer, over the player's right
  //   shoulder, so the middle of the screen (where a crosshair goes) is clear
  //   of them
  updateCamera({ yaw, pitch, aiming = 0 }) {
    const { distance, pivotHeight } = CAMERA;
    const p = this.player.position;
    const d = distance - (distance - AIM_CAMERA.distance) * aiming;
    const side = AIM_CAMERA.side * aiming, up = AIM_CAMERA.up * aiming;
    const rightX = Math.cos(yaw), rightZ = -Math.sin(yaw); // (the camera's right, on the ground)
    const pivot = { x: p.x + rightX * side, y: p.y + pivotHeight + up, z: p.z + rightZ * side };

    // Camera sits `d` away from the pivot, opposite to the direction it faces.
    const horizontal = Math.cos(pitch) * d;
    this.camera.position.set(
      pivot.x + Math.sin(yaw) * horizontal,
      Math.max(pivot.y + Math.sin(pitch) * d, CAMERA_MIN_HEIGHT),
      pivot.z + Math.cos(yaw) * horizontal,
    );
    this.camera.lookAt(pivot.x, pivot.y, pivot.z);
  }

  // The line through the middle of the screen, from the camera, in the world
  // (for aiming): { origin, direction } -- plain { x, y, z } objects.
  aimRay() {
    this.camera.updateMatrixWorld();
    const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const { x, y, z } = this.camera.position;
    return { origin: { x, y, z }, direction: { x: direction.x, y: direction.y, z: direction.z } };
  }

  // Where the middle of a character's right palm is (the player's if no
  // model is given), as { x, y, z }.
  palmPosition(model = this.playerModel) {
    const { x, y, z } = model.palmPosition();
    return { x, y, z };
  }

  // Show or hide a weapon the player carries, and whether their crossbow is loaded.
  showPlayerWeapon(name, visible) {
    this.playerModel.showWeapon(name, visible);
  }

  setPlayerLoaded(loaded) {
    this.playerModel.setLoaded(loaded);
  }

  cancelPlayerGesture() {
    this.playerModel.cancelGesture();
  }

  // A fireball in flight: a white-hot core in a roiling orange blaze, with a
  // warm light and a trail of embers. Moved with moveArrow; ended with
  // endArrow (which leaves no trace -- see fireExplosion).
  addFireball() {
    const additive = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false };
    const group = new THREE.Group();
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), new THREE.MeshBasicMaterial({ color: '#ffc27a', ...additive }));
    const flames = [['#ff6a14', 0.7], ['#c8320a', 1.1], ['#ff9a30', 0.45]].map(([color, size]) => {
      const flame = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, ...additive }));
      flame.scale.setScalar(size);
      flame.userData.size = size;
      return flame;
    });
    const light = new THREE.PointLight('#ff8a2a', 3, 6, 2);
    // Sparks crackling round it: darting about close to the ball, flickering.
    const sparks = Array.from({ length: 10 }, () => {
      const spark = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: Math.random() < 0.5 ? '#ffd27a' : '#ff9a3a', ...additive }));
      spark.userData = { phase: Math.random() * 10, speed: 6 + Math.random() * 8, tilt: Math.random() * Math.PI, reach: 0.18 + Math.random() * 0.14 };
      return spark;
    });
    group.add(core, ...flames, light, ...sparks);
    this.scene.add(group);
    group.userData.alive = true;
    this.addEffect({
      group,
      age: 0,
      update: (age, dt) => {
        if (!group.userData.alive) return false;
        flames.forEach((flame, i) => flame.scale.setScalar(flame.userData.size * (0.85 + 0.2 * Math.sin(age * (23 + i * 7) + i))));
        for (const spark of sparks) {
          const { phase, speed, tilt, reach } = spark.userData;
          const a = phase + age * speed;
          const r = reach * (0.8 + 0.3 * Math.sin(age * 17 + phase));
          spark.position.set(Math.cos(a) * r, Math.sin(a) * Math.cos(tilt) * r, Math.sin(a) * Math.sin(tilt) * r);
          const flicker = Math.max(Math.sin(age * 40 + phase * 3), 0);
          spark.scale.setScalar(0.05 + 0.05 * flicker);
          spark.material.opacity = 0.4 + 0.6 * flicker;
        }
        light.intensity = 2.5 + Math.sin(age * 31) * 0.6;
        // Embers left behind, drifting up and fading.
        group.userData.emberTime = (group.userData.emberTime ?? 0) + dt;
        if (group.userData.emberTime > 0.025) {
          group.userData.emberTime = 0;
          this.sparks(group.position, 2, 0.4, { color: Math.random() < 0.5 ? '#ff8a2a' : '#ffcf5a', size: 0.14 });
        }
        return true;
      },
    });
    return group;
  }

  // Wall of Earth: a wall of packed dirt bursting up out of the ground (in a
  // spray of earth), standing for `duration` seconds, then crumbling -- chunks
  // breaking off and tumbling as it sinks back into the ground and fades.
  // position: { x, z } on the floor; angle: which way it runs (radians round
  // the vertical, 0 = along x); size: { width, thickness, height }.
  earthWall(position, angle, { width, thickness, height }, duration) {
    const group = new THREE.Group();
    group.position.set(position.x, 0, position.z);
    group.rotation.y = angle;
    // A rough, lumpy slab: a box with its surface pushed in and out, and a
    // ragged top.
    const geometry = new THREE.BoxGeometry(width, height, thickness, 18, 14, 3);
    const pos = geometry.attributes.position;
    const seed = Math.random() * 100;
    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const n = Math.sin(x * 5.1 + seed) * Math.cos(y * 4.3 + seed * 0.7) + 0.5 * Math.sin(x * 11 + y * 9 + seed);
      const edge = Math.min(1, (height / 2 - Math.abs(y)) * 4 + 0.3);
      z += Math.sign(z) * 0.04 * n * edge;
      x += Math.sign(x) * 0.03 * n;
      if (y > height / 2 - 0.01) y += 0.12 * (Math.sin(x * 3.7 + seed) + 0.6 * Math.sin(x * 8.3 + seed * 2));
      pos.setXYZ(i, x, y + height / 2, z);
    }
    geometry.computeVertexNormals();
    // (While it crumbles, everything above `cut` is gone -- turned into clods.)
    const cut = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1000);
    const material = new THREE.MeshToonMaterial({ color: '#7a5634', gradientMap: arrowToonGradient, clippingPlanes: [cut] });
    const outline = new THREE.MeshBasicMaterial({ color: '#2b2030', side: THREE.BackSide, clippingPlanes: [cut] });
    outline.onBeforeCompile = arrowOutline.onBeforeCompile;
    const wall = new THREE.Mesh(geometry, material);
    wall.castShadow = true;
    wall.add(new THREE.Mesh(geometry, outline));
    // Stones and clods stuck in it.
    for (let i = 0; i < 14; i++) {
      const stone = arrowPart(new THREE.DodecahedronGeometry(0.06 + Math.random() * 0.08), arrowToon(Math.random() < 0.5 ? '#8a8378' : '#5e4128'));
      const side = Math.random() < 0.5 ? -1 : 1;
      stone.position.set((Math.random() - 0.5) * width * 0.9, 0.2 + Math.random() * (height - 0.4), side * thickness * 0.5);
      stone.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      stone.userData.stone = true;
      wall.add(stone);
    }
    group.add(wall);
    this.scene.add(group);
    const rise = 0.45, crumble = 3.2;
    let crumbled = false, chunks = [];
    // Breaking the wall into lumpy chunks of earth (in a grid filling it).
    // It crumbles from the top down: each row breaks away and falls in turn,
    // the rows below standing until their turn comes (WALL_CRUMBLE_TIME in
    // all, from the top row to the bottom).
    const breakIntoChunks = () => {
      const across = 7, up = 6, pieces = [];
      for (let i = 0; i < across; i++) {
        for (let j = 0; j < up; j++) {
          const size = Math.min(width / across, height / up) * (0.95 + Math.random() * 0.3);
          // (A rough clod: a many-sided lump, stretched to fill its part of
          // the wall, its corners pushed in and out.)
          const geometry = new THREE.IcosahedronGeometry(0.5, 1);
          geometry.scale(width / across * 1.15, height / up * 1.15, thickness * 1.0);
          const p = geometry.attributes.position;
          const bumps = new Map();
          for (let k = 0; k < p.count; k++) {
            const key = `${p.getX(k).toFixed(3)},${p.getY(k).toFixed(3)},${p.getZ(k).toFixed(3)}`; // (moving shared corners together)
            if (!bumps.has(key)) bumps.set(key, 0.78 + Math.random() * 0.35);
            const b = bumps.get(key);
            p.setXYZ(k, p.getX(k) * b, p.getY(k) * b, p.getZ(k) * b);
          }
          geometry.computeVertexNormals();
          const chunk = arrowPart(geometry, arrowToon(Math.random() < 0.6 ? '#7a5634' : '#6a4a2c'));
          const u = (i + 0.5) / across - 0.5, h = (j + 0.5) / up;
          chunk.position.set(u * width, h * height, 0);
          chunk.userData = {
            size: size * 0.6,
            row: j,
            delay: (1 - (j + 1) / up) * WALL_CRUMBLE_TIME, // (when its row breaks away)
            loosen: Math.random() * 0.1,                   // (and how long it clings on after)
            velocity: new THREE.Vector3(u * 1.5 + (Math.random() - 0.5) * 0.8, Math.random() * 0.6, (Math.random() - 0.5) * 2.5),
            spin: new THREE.Vector3((Math.random() - 0.5) * 8, 0, (Math.random() - 0.5) * 8),
            landed: 0,
          };
          group.add(chunk);
          pieces.push(chunk);
        }
      }
      return pieces;
    };
    const dust = (count) => {
      for (let k = 0; k < 5; k++) {
        const u = (k / 4 - 0.5) * width;
        const at = { x: position.x + Math.cos(angle) * u, y: 0.1, z: position.z - Math.sin(angle) * u };
        this.sparks(at, count, 0.6, { color: '#6b4a2a', glow: false, size: 0.12 });
      }
    };
    dust(6);
    this.addEffect({
      group,
      age: 0,
      update: (age) => {
        if (age < rise) {
          // Bursting up: from below the ground, overshooting a little.
          const t = age / rise;
          wall.position.y = -height * (1 - t) ** 2 + 0.05 * Math.sin(Math.PI * t);
        } else if (age < duration) {
          wall.position.y = 0;
        } else {
          if (!crumbled) {
            crumbled = true;
            // It falls to pieces, row by row from the top: as each row goes,
            // that part of the solid wall is replaced by the clods it breaks
            // into, which tumble down.
            dust(8);
            chunks = breakIntoChunks();
            for (const chunk of chunks) chunk.visible = false;
            // (Showing the inside of the wall at the break, so it looks solid
            // earth all the way through rather than hollow.)
            material.side = THREE.DoubleSide;
            material.needsUpdate = true;
          }
          const t = age - duration;
          // How much of the solid wall is still standing: the rows not yet broken.
          // (Row j, counting up from the bottom, breaks at (5 - j) / 6 of the way through.)
          const rowsLeft = Math.max(0, Math.ceil(5 - (6 * t) / WALL_CRUMBLE_TIME - 1e-6));
          const top = (rowsLeft / 6) * height;
          wall.visible = rowsLeft > 0;
          cut.constant = group.position.y + wall.position.y + top; // (the world height of the break)
          wall.traverse((o) => { if (o !== wall && o.userData.stone) o.visible = o.position.y < top; });
          for (const chunk of chunks) {
            const c = chunk.userData;
            if (t < c.delay) continue;
            chunk.visible = true;
            if (t < c.delay + c.loosen) continue;
            if (!c.landed) {
              c.velocity.y -= 12 * this.lastDt;
              chunk.position.addScaledVector(c.velocity, this.lastDt);
              chunk.rotation.x += c.spin.x * this.lastDt;
              chunk.rotation.z += c.spin.z * this.lastDt;
              if (chunk.position.y < c.size * 0.5) {
                chunk.position.y = c.size * 0.5;
                if (Math.abs(c.velocity.y) > 1.5) {
                  c.velocity.y *= -0.3; // (a little bounce)
                  c.velocity.x *= 0.5; c.velocity.z *= 0.5;
                } else {
                  c.landed = t;
                }
              }
            } else {
              // Settled: sinking back into the ground.
              chunk.position.y = c.size * 0.5 - (t - c.landed) * 0.9;
              chunk.visible = chunk.position.y > -c.size;
            }
          }
        }
        return age < duration + crumble;
      },
    });
  }

  // Burning Ground: a patch of ground turned to glowing coals -- a bed of
  // dark embers glowing orange, lumps of coal, flickering flames and rising
  // sparks -- for `duration` seconds, then dying down to ash and fading.
  // position: { x, z } on the floor; radius: its size.
  burningGround(position, radius, duration) {
    const additive = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false };
    const group = new THREE.Group();
    group.position.set(position.x, 0.02, position.z);
    // The bed of coals: dark, with a hot glow that pulses unevenly. Its edge
    // is ragged -- pushed in and out at random all the way round, with a few
    // tongues of scorched ground reaching further out -- rather than a circle.
    const seed = Math.random() * 100;
    const edge = (a) => 1
      + 0.12 * Math.sin(a * 3 + seed) + 0.08 * Math.sin(a * 7 + seed * 1.7)
      + 0.05 * Math.sin(a * 13 + seed * 2.3) + 0.12 * Math.max(Math.sin(a * 5 + seed * 0.6), 0) ** 4;
    const raggedDisc = (size) => {
      const shape = new THREE.Shape();
      const steps = 96;
      for (let i = 0; i <= steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        const r = size * edge(a) * (0.94 + 0.06 * Math.random());
        if (i === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      const g = new THREE.ShapeGeometry(shape).rotateX(Math.PI / 2);
      // (Texture coordinates spread over the whole patch, for the glow.)
      const p = g.attributes.position, uv = g.attributes.uv;
      for (let i = 0; i < p.count; i++) uv.setXY(i, 0.5 + p.getX(i) / (size * 2.6), 0.5 + p.getZ(i) / (size * 2.6));
      return g;
    };
    const bed = new THREE.Mesh(raggedDisc(radius), new THREE.MeshBasicMaterial({ color: '#2a1410', transparent: true, side: THREE.DoubleSide }));
    const glow = new THREE.Mesh(raggedDisc(radius * 0.9).translate(0, 0.005, 0),
      new THREE.MeshBasicMaterial({ map: glowTexture(), color: '#ff5a10', side: THREE.DoubleSide, ...additive }));
    // A scorched, darkened fringe round the edge.
    const scorch = new THREE.Mesh(raggedDisc(radius * 1.12).translate(0, -0.004, 0),
      new THREE.MeshBasicMaterial({ color: '#3a2a1a', transparent: true, opacity: 0.6, side: THREE.DoubleSide }));
    group.add(scorch);
    group.add(bed, glow);
    // Lumps of coal, some glowing.
    const coals = [];
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2, r = radius * edge(a) * Math.sqrt(Math.random()) * 0.92;
      const hot = Math.random() < 0.5;
      const coal = arrowPart(new THREE.DodecahedronGeometry(0.05 + Math.random() * 0.07), arrowToon(hot ? '#e0501a' : '#2e2420'));
      coal.position.set(Math.cos(a) * r, 0.03, Math.sin(a) * r);
      coal.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      coal.scale.y = 0.6;
      group.add(coal);
      coals.push(coal);
    }
    // Little flames licking up here and there.
    const flames = Array.from({ length: 16 }, () => {
      const flame = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: Math.random() < 0.5 ? '#ff7a1f' : '#ffb040', ...additive }));
      const a = Math.random() * Math.PI * 2, r = radius * Math.sqrt(Math.random()) * 0.9;
      flame.userData = { x: Math.cos(a) * r, z: Math.sin(a) * r, phase: Math.random() * 10, speed: 1.5 + Math.random() };
      group.add(flame);
      return flame;
    });
    const light = new THREE.PointLight('#ff6a1a', 4, radius * 4, 2);
    light.position.y = 0.5;
    group.add(light);
    this.scene.add(group);
    this.sparks({ x: position.x, y: 0.1, z: position.z }, 20, 0.6, { color: '#ffae40', size: 0.12 });
    const fadeIn = 0.4, fadeOut = 1.2;
    let sparkTime = 0;
    this.addEffect({
      group,
      age: 0,
      update: (age, dt) => {
        const on = Math.min(age / fadeIn, 1) * Math.min(Math.max((duration + fadeOut - age) / fadeOut, 0), 1);
        const dying = age > duration ? Math.min((age - duration) / fadeOut, 1) : 0;
        const pulse = 0.75 + 0.15 * Math.sin(age * 3.1) + 0.1 * Math.sin(age * 7.3);
        glow.material.opacity = 0.75 * on * pulse * (1 - dying);
        bed.material.opacity = on;
        scorch.material.opacity = 0.6 * on;
        light.intensity = 4 * on * pulse * (1 - dying);
        for (const flame of flames) {
          const { x, z, phase, speed } = flame.userData;
          const t = ((age * speed + phase) % 1);
          flame.position.set(x, 0.05 + t * 0.45, z);
          flame.scale.set(0.25 * (1 - t), 0.4 * (1 - t), 1);
          flame.material.opacity = on * (1 - dying) * (1 - t);
        }
        for (const coal of coals) coal.visible = on > 0.05;
        // Sparks drifting up now and then.
        sparkTime += dt;
        if (sparkTime > 0.15 && dying < 1) {
          sparkTime = 0;
          const a = Math.random() * Math.PI * 2, r = radius * Math.sqrt(Math.random());
          this.sparks({ x: position.x + Math.cos(a) * r, y: 0.1, z: position.z + Math.sin(a) * r }, 2, 0.6, { color: '#ffae40', size: 0.08 });
        }
        return age < duration + fadeOut;
      },
    });
  }

  // Leach Bomb: a fat, glistening leech clinging to a character's chest, its
  // glowing sacs pulsing faster and brighter, and its body swelling, as it
  // gets ready to burst (over `fuse` seconds). Returns it, for popLeech.
  attachLeech(model, fuse) {
    const additive = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false };
    // (It clings to the body itself -- the root of its skeleton -- so it moves
    // with it: leaning, twisting, and falling with it if they die. The
    // skeleton is scaled with the character, so it's placed in its units.)
    const leech = new THREE.Group();
    const bodyScale = model.body.scale.x / (model.height ?? 1); // (the skeleton's units, per world unit at normal height)
    leech.position.set(0.02 / bodyScale, 1.3 / bodyScale, -0.22 / bodyScale);
    leech.rotation.z = 0.4;
    leech.scale.setScalar(1.5 / bodyScale);
    const body = new THREE.Group();
    const sacs = [];
    for (let i = 0; i < 6; i++) {
      const t = i / 5;
      const r = 0.045 * Math.sin(Math.PI * (0.2 + 0.8 * t)) + 0.02;
      const segment = arrowPart(new THREE.SphereGeometry(1, 12, 8).scale(r * 1.1, r, r * 0.8), arrowToon(i % 2 ? '#6a2a52' : '#522044'));
      segment.position.set((t - 0.5) * 0.24, 0.015 * Math.sin(t * 6), -0.01);
      body.add(segment);
      if (i > 0 && i < 5) {
        const sac = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#a8ff3a', ...additive }));
        sac.position.set(segment.position.x, segment.position.y + 0.01, -0.06);
        sac.userData.phase = i * 0.7;
        body.add(sac);
        sacs.push(sac);
      }
    }
    leech.add(body);
    model.joints.root.add(leech);
    model.root.updateMatrixWorld(true);
    this.sparks(leech.getWorldPosition(new THREE.Vector3()), 8, 0.35, { color: '#6a8a20', glow: false, size: 0.05 });
    leech.userData.alive = true;
    this.addEffect({
      group: leech,
      age: 0,
      update: (age) => {
        if (!leech.userData.alive) return false;
        const t = Math.min(age / fuse, 1);
        const rate = 3 + 18 * t * t; // (throbbing faster and faster)
        const throb = 0.5 + 0.5 * Math.sin(age * rate * Math.PI);
        body.scale.setScalar(1 + 0.45 * t + 0.08 * throb * (0.3 + t));
        for (const sac of sacs) {
          sac.scale.setScalar(0.09 + 0.07 * t + 0.06 * throb);
          sac.material.opacity = 0.35 + 0.65 * throb * (0.4 + 0.6 * t);
        }
        return true;
      },
    });
    return leech;
  }

  // The leech bursting: a sickly green-and-purple blast, and a spray of goo.
  // Returns where it was, in the world.
  popLeech(leech, radius) {
    const at = leech.getWorldPosition(new THREE.Vector3());
    leech.userData.alive = false;
    leech.parent?.remove(leech);
    const additive = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false };
    const group = new THREE.Group();
    group.position.copy(at);
    const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#c8ff5a', ...additive }));
    const cloud = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), new THREE.MeshBasicMaterial({ color: '#7a3aa0', ...additive }));
    const light = new THREE.PointLight('#a8ff3a', 6, radius * 5, 2);
    group.add(flash, cloud, light);
    this.scene.add(group);
    this.sparks(at, 22, 0.8, { color: '#5a7a18', glow: false, size: 0.12 }); // (goo)
    this.sparks(at, 16, 0.6, { color: '#b8ff4a', size: 0.12 });
    this.sparks(at, 10, 0.7, { color: '#a060d0', size: 0.14 });
    const duration = 0.6;
    this.addEffect({
      group,
      age: 0,
      update: (age) => {
        const t = age / duration;
        flash.scale.setScalar(radius * (1.2 + 2 * t));
        flash.material.opacity = Math.max(1 - 1.5 * t, 0);
        cloud.scale.setScalar(radius * (0.3 + 0.75 * Math.sqrt(t)));
        cloud.material.opacity = 0.55 * (1 - t);
        light.intensity = 6 * (1 - t);
        return t < 1;
      },
    });
    return { x: at.x, y: at.y, z: at.z };
  }

  // Power Shove: a wave of violet force rushing from the caster's palm to the
  // target -- a few rippling rings, one after another, facing the way they
  // travel -- arriving after `duration` seconds. from, to: { x, y, z }.
  forcePulse(from, to, duration) {
    const additive = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide };
    const start = new THREE.Vector3(from.x, from.y, from.z), end = new THREE.Vector3(to.x, to.y, to.z);
    const group = new THREE.Group();
    const rings = [0, 0.06, 0.12].map((delay) => {
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.7, 1, 40), new THREE.MeshBasicMaterial({ color: '#a88cff', ...additive }));
      ring.userData.delay = delay;
      group.add(ring);
      return ring;
    });
    this.scene.add(group);
    this.addEffect({
      group,
      age: 0,
      update: (age) => {
        for (const ring of rings) {
          const t = Math.min(Math.max((age - ring.userData.delay) / duration, 0), 1);
          ring.visible = age >= ring.userData.delay && t < 1;
          ring.position.lerpVectors(start, end, t);
          ring.lookAt(end);
          ring.scale.setScalar(0.18 + 0.3 * t);
          ring.material.opacity = 0.85 * (1 - 0.4 * t);
        }
        return age < duration + 0.13;
      },
    });
  }

  // Where a Power Shove lands: a burst of violet force -- a ring flung out
  // and a spray of sparks. position: { x, y, z }.
  forceBurst(position) {
    const additive = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide };
    const group = new THREE.Group();
    group.position.set(position.x, position.y, position.z);
    const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#b8a2ff', ...additive }));
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 48), new THREE.MeshBasicMaterial({ color: '#d4c6ff', ...additive }));
    group.add(flash, ring);
    this.scene.add(group);
    this.sparks(position, 16, 0.45, { color: '#c4b2ff', size: 0.1 });
    const duration = 0.4;
    this.addEffect({
      group,
      age: 0,
      update: (age) => {
        const t = age / duration;
        flash.scale.setScalar(0.6 + 1.4 * t);
        flash.material.opacity = 1 - t;
        ring.scale.setScalar(0.2 + 1.3 * t);
        ring.material.opacity = 0.9 * (1 - t);
        ring.lookAt(this.camera.position);
        return t < 1;
      },
    });
  }

  // Vine Trap: vines bursting out of the ground round a character, rapidly
  // growing and twining up round them (holding them fast), then -- after
  // `duration` seconds -- unwinding and sinking back into the ground.
  vineTrap(model, duration) {
    const group = new THREE.Group();
    model.root.getWorldPosition(group.position);
    const height = 1.25 * (model.height ?? 1);
    const vines = [];
    const vineColors = ['#3f7a2a', '#4f8f33', '#35682a'];
    for (let i = 0; i < 7; i++) {
      // Each vine: from the ground a little way out, spiralling in and up
      // round the body, and ending in a curl.
      const start = (i / 7) * Math.PI * 2 + Math.random() * 0.4;
      const turns = 0.9 + Math.random() * 0.5, direction = i % 2 ? 1 : -1;
      const top = height * (0.55 + Math.random() * 0.45);
      const points = [];
      for (let k = 0; k <= 24; k++) {
        const t = k / 24;
        const a = start + direction * turns * Math.PI * 2 * t;
        const r = 0.55 - 0.28 * Math.min(t * 3, 1) + 0.04 * Math.sin(t * 20);
        points.push(new THREE.Vector3(Math.cos(a) * r, -0.25 + (top + 0.25) * t, Math.sin(a) * r));
      }
      const geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 64, 0.035 - 0.01 * (i % 3) / 2, 6);
      // (Thinning towards the tip.)
      const pos = geometry.attributes.position, centre = new THREE.Vector3();
      const curve = new THREE.CatmullRomCurve3(points);
      for (let v = 0; v < pos.count; v++) {
        const ring = Math.floor(v / 7), t = ring / 64;
        curve.getPoint(t, centre);
        const k = 1 - 0.75 * t;
        pos.setXYZ(v, centre.x + (pos.getX(v) - centre.x) * k, centre.y + (pos.getY(v) - centre.y) * k, centre.z + (pos.getZ(v) - centre.z) * k);
      }
      geometry.computeVertexNormals();
      const vine = arrowPart(geometry, arrowToon(vineColors[i % 3]));
      // Leaves along it, appearing as it grows past them.
      const leaves = [];
      for (let k = 0; k < 5; k++) {
        const t = 0.2 + k * 0.16 + Math.random() * 0.05;
        const leaf = arrowPart(new THREE.SphereGeometry(1, 8, 6).scale(0.07, 0.02, 0.04), arrowToon('#5aa03a'));
        curve.getPoint(t, leaf.position);
        leaf.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
        leaf.userData.t = t;
        vine.add(leaf);
        leaves.push(leaf);
      }
      group.add(vine);
      vines.push({ vine, geometry, leaves, full: geometry.index.count });
    }
    this.scene.add(group);
    // Clods of earth thrown up as they break through.
    this.sparks({ x: group.position.x, y: group.position.y + 0.05, z: group.position.z }, 16, 0.5, { color: '#6b4a2a', glow: false, size: 0.08 });
    const grow = 0.35, retreat = 0.5;
    this.addEffect({
      group,
      age: 0,
      update: (age) => {
        // How far along each vine is showing: growing, holding, then sinking back.
        let shown;
        if (age < grow) shown = 1 - (1 - age / grow) ** 3;
        else if (age < duration) shown = 1;
        else shown = 1 - Math.min((age - duration) / retreat, 1);
        vines.forEach(({ vine, geometry, leaves, full }, i) => {
          const rings = Math.floor(shown * 64);
          geometry.setDrawRange(0, rings * 6 * 6);
          for (const leaf of leaves) leaf.visible = leaf.userData.t < shown - 0.02;
          // (Unwinding a little as they let go.)
          vine.rotation.y = age > duration ? (i % 2 ? 1 : -1) * (age - duration) * 1.2 : 0;
          vine.position.y = age > duration ? -0.25 * (age - duration) / retreat : 0;
        });
        return age < duration + retreat;
      },
    });
  }

  // A fireball bursting: a flash, a ball of flame swelling and fading, and a
  // spray of burning sparks. position: { x, y, z }; radius: how far it spreads.
  fireExplosion(position, radius) {
    const additive = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false };
    const group = new THREE.Group();
    group.position.set(position.x, position.y, position.z);
    const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#ff9a40', ...additive }));
    const blaze = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), new THREE.MeshBasicMaterial({ color: '#d8400c', ...additive }));
    const light = new THREE.PointLight('#ff8a2a', 8, radius * 5, 2);
    group.add(flash, blaze, light);
    this.scene.add(group);
    this.sparks(position, 24, 0.7, { color: '#ffae40', size: 0.16 });
    this.sparks(position, 12, 0.5, { color: '#fff0c0', size: 0.1 });
    const duration = 0.55;
    this.addEffect({
      group,
      age: 0,
      update: (age) => {
        const t = age / duration;
        flash.scale.setScalar(radius * (1.5 + 2 * t));
        flash.material.opacity = Math.max(1 - t * 1.6, 0);
        blaze.scale.setScalar(radius * (0.3 + 0.8 * Math.sqrt(t)));
        blaze.material.opacity = 0.7 * (1 - t);
        light.intensity = 8 * (1 - t);
        return t < 1;
      },
    });
  }

  // An arrow (or bolt) in flight. Returns it, to be moved with moveArrow.
  addArrow(kind) {
    const arrow = createArrow(kind, { part: arrowPart, toon: arrowToon });
    this.scene.add(arrow);
    return arrow;
  }

  // position, direction: { x, y, z } (the way it's flying).
  moveArrow(arrow, position, direction) {
    arrow.position.set(position.x, position.y, position.z);
    arrow.lookAt(position.x - direction.x, position.y - direction.y, position.z - direction.z); // (its tip is at -z)
  }

  // An arrow stops: left stuck where it landed for a while, then fades away
  // (or, with stick: false, it's simply gone -- e.g. when it hits someone).
  endArrow(arrow, { stick = true } = {}) {
    if (!stick) {
      arrow.userData.alive = false; // (a fireball's own effect clears it up)
      this.scene.remove(arrow);
      return;
    }
    this.addEffect({ group: arrow, age: 0, update: (age) => age < 4 });
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
    this.forest?.update(now / 1000);
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

// A five-pointed star with a bright middle (for being dazed).
let starMap = null;
function starTexture() {
  if (!starMap) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const context = canvas.getContext('2d');
    context.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 12 : 28, a = (i * Math.PI) / 5 - Math.PI / 2;
      context.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r);
    }
    context.closePath();
    context.fillStyle = '#ffffff';
    context.fill();
    context.lineWidth = 3;
    context.strokeStyle = 'rgba(120, 90, 20, 0.9)';
    context.stroke();
    starMap = new THREE.CanvasTexture(canvas);
    starMap.colorSpace = THREE.SRGBColorSpace;
  }
  return starMap;
}

// Arrows are drawn in the same toon style as the characters, with outlines.
const arrowToonGradient = (() => {
  const g = new THREE.DataTexture(new Uint8Array([150, 210, 255]), 3, 1, THREE.RedFormat);
  g.minFilter = g.magFilter = THREE.NearestFilter;
  g.needsUpdate = true;
  return g;
})();
const arrowMaterials = new Map();
function arrowToon(color) {
  if (!arrowMaterials.has(color)) arrowMaterials.set(color, new THREE.MeshToonMaterial({ color, gradientMap: arrowToonGradient }));
  return arrowMaterials.get(color);
}
const arrowOutline = new THREE.MeshBasicMaterial({ color: '#2b2030', side: THREE.BackSide });
arrowOutline.onBeforeCompile = (shader) => {
  shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
  transformed += normalize(normal) * 0.0025;`);
};
function arrowPart(geometry, material) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.add(new THREE.Mesh(geometry, arrowOutline));
  return mesh;
}
