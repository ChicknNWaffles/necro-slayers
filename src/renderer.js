// 3D renderer: sets up and draws the 3D scene (camera, lights, meshes).
// Game logic does not belong here -- that lives in game.js. The game tells the
// renderer what exists and where it is; the renderer only draws it.
import * as THREE from '../node_modules/three/build/three.module.js';
import { CharacterModel } from './characterModel.js';

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

  // Redraw the player with a new appearance (e.g. from a character creator).
  setPlayerAppearance(appearance) {
    this.playerModel.setAppearance(appearance);
  }

  updatePlayer(position, yaw) {
    this.player.position.set(position.x, position.y, position.z);
    this.player.rotation.y = yaw;
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
