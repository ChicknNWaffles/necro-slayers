// 3D renderer: sets up and draws the 3D scene (camera, lights, meshes).
// Game logic does not belong here -- that lives in game.js. The game tells the
// renderer what exists and where it is; the renderer only draws it.
import * as THREE from '../node_modules/three/build/three.module.js';
import { CharacterModel } from './characterModel.js';

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
  // pose: how they stand when still; decay: for the undead (see characterModel.js).
  addNpc({ appearance, position, yaw, pose, decay }) {
    const model = new CharacterModel(appearance, { pose, decay });
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
    this.renderer.render(this.scene, this.camera);
  }
}
