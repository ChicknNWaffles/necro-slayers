// Main game script: game state, rules, input handling and the game loop.
// Uses the 3D renderer (renderer.js) to draw each frame.
import { GameRenderer } from './renderer.js';
import { createAppearance } from './characterAppearance.js';

// --- World ---------------------------------------------------------------

const FLOOR = { width: 40, depth: 40, y: 0 };
const GRAVITY = 20;       // units per second squared
const FALL_LIMIT = -30;   // respawn if the player falls this far below the floor

// --- Player --------------------------------------------------------------

const PLAYER = {
  speed: 8,      // walking
  runSpeed: 14,  // while Caps Lock is on
  backwardSpeedFactor: 0.6, // moving backwards is this fraction of walk/run speed
  jumpSpeed: 8,  // jump height = jumpSpeed² / (2 × GRAVITY) = 1.6
};
const SPAWN = { x: 0, y: 2, z: 0 };

// Pressing jump while falling this close to the floor still jumps, as soon as
// the player lands.
const JUMP_BUFFER_HEIGHT = 0.75;

// Holding a sideways key turns the character's body this far towards that
// side (the camera and facing direction are unaffected).
const STRAFE_TURN_ANGLE = 40 * Math.PI / 180;
const STRAFE_TURN_RATE = 15; // how quickly the body turns into and out of it

const player = {
  position: { ...SPAWN }, // position of the player's feet
  yaw: 0,                 // facing direction in radians; 0 faces -Z
  velocityY: 0,
  onGround: false,
  jumpBuffered: false,    // jump was pressed just before landing
  strafeTurn: 0,          // extra body rotation while moving sideways (visual only)
  appearance: createAppearance(), // how the character looks (see characterAppearance.js)
};

// Change how the player looks, e.g. from a character creator. Accepts a full
// or partial appearance; anything missing or invalid keeps its current value.
export function setPlayerAppearance(values) {
  player.appearance = createAppearance(values, player.appearance);
  renderer.setPlayerAppearance(player.appearance);
}

// --- Camera --------------------------------------------------------------

const MOUSE_SENSITIVITY = 0.0025; // radians per pixel of mouse movement

// One camera that circles the player. Moving the mouse up/down tilts it.
// Moving it sideways normally turns the player (the camera stays behind them);
// while Shift is held it swings the camera around the player instead.
const CAMERA_PITCH = { initial: 0.28, min: -0.2, max: 1.2 };
const CAMERA_RETURN_RATE = 12; // how fast the camera swings back behind the player after Shift

const camera = {
  pitch: CAMERA_PITCH.initial,
  orbiting: false, // true while Shift is held
  yawOffset: 0,    // how far the camera has been swung away from behind the player
};

function startOrbit() {
  camera.orbiting = true;
}

function stopOrbit() {
  camera.orbiting = false;
  // Swing back the short way round.
  camera.yawOffset = Math.atan2(Math.sin(camera.yawOffset), Math.cos(camera.yawOffset));
}

function clamp(value, { min, max }) {
  return Math.min(Math.max(value, min), max);
}

function onMouseMove(dx, dy) {
  const turn = -dx * MOUSE_SENSITIVITY; // moving the mouse right turns right
  const tilt = dy * MOUSE_SENSITIVITY;  // moving the mouse up looks up

  if (camera.orbiting) {
    camera.yawOffset += turn;
  } else {
    player.yaw += turn;
  }
  camera.pitch = clamp(camera.pitch + tilt, CAMERA_PITCH);
}

function updateCamera(dt) {
  // After Shift is released, ease the camera back behind the player.
  if (!camera.orbiting && camera.yawOffset !== 0) {
    camera.yawOffset *= Math.exp(-CAMERA_RETURN_RATE * dt);
    if (Math.abs(camera.yawOffset) < 0.001) camera.yawOffset = 0;
  }
}

// Horizontal direction the camera faces (same convention as player.yaw).
function getCameraYaw() {
  return player.yaw + camera.yawOffset;
}

// --- Input ---------------------------------------------------------------

// Keys are matched lower-cased, so controls work regardless of Shift/Caps Lock.
const KEY_BINDINGS = {
  w: 'forward', arrowup: 'forward',
  s: 'back',    arrowdown: 'back',
  a: 'left',    arrowleft: 'left',
  d: 'right',   arrowright: 'right',
};

const heldKeys = new Set();

window.addEventListener('keydown', (e) => {
  if (e.key === 'Shift') startOrbit();

  const key = e.key.toLowerCase();
  if (key in KEY_BINDINGS) {
    heldKeys.add(key);
    e.preventDefault(); // stop arrow keys from scrolling the page
  }
});

window.addEventListener('keyup', (e) => {
  if (e.key === 'Shift') stopOrbit();
  heldKeys.delete(e.key.toLowerCase());
});

// Keyup events are lost if the window loses focus while a key is held.
window.addEventListener('blur', () => {
  heldKeys.clear();
  stopOrbit();
});

// Set by a right click (see the mouse handlers below) and used up on the next frame.
let jumpRequested = false;

// Caps Lock on = running. Its state can be read from any keyboard or mouse
// event, so check it on all of them (mouse movement keeps it up to date).
let capsLockOn = false;

for (const type of ['keydown', 'keyup', 'mousemove', 'mousedown']) {
  window.addEventListener(type, (e) => {
    capsLockOn = e.getModifierState('CapsLock');
  });
}

// True if any key bound to the action is held (e.g. both W and ArrowUp).
function isActionHeld(action) {
  for (const key of heldKeys) {
    if (KEY_BINDINGS[key] === action) return true;
  }
  return false;
}

// --- Physics -------------------------------------------------------------

function isAboveFloor(x, z) {
  return Math.abs(x) <= FLOOR.width / 2 && Math.abs(z) <= FLOOR.depth / 2;
}

function isFallingNearFloor() {
  const pos = player.position;
  return player.velocityY < 0
    && isAboveFloor(pos.x, pos.z)
    && pos.y - FLOOR.y <= JUMP_BUFFER_HEIGHT;
}

function updatePlayer(dt) {
  const pos = player.position;

  // Horizontal movement, relative to the direction the camera faces.
  const forward = Number(isActionHeld('forward')) - Number(isActionHeld('back'));
  const strafe = Number(isActionHeld('right')) - Number(isActionHeld('left'));
  const length = Math.hypot(forward, strafe);
  let sideways = 0; // +1 moving to the character's right, -1 to their left
  if (length > 0) {
    // Direction of movement in the world, normalised so diagonals aren't faster.
    // For a yaw, forward is (-sin, -cos) and right is (cos, -sin) in the XZ plane.
    const yaw = getCameraYaw();
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    const dirX = (-sin * forward + cos * strafe) / length;
    const dirZ = (-cos * forward - sin * strafe) / length;

    // Moving away from the way the character faces (not the camera) is slower.
    const facingX = -Math.sin(player.yaw);
    const facingZ = -Math.cos(player.yaw);
    const forwardAmount = dirX * facingX + dirZ * facingZ;
    const movingBackward = forwardAmount < 0;

    // Sideways relative to the character (not the camera), for the body turn.
    // Moving backwards (including backward diagonals) doesn't turn the body.
    // The small dead zones stop tiny angles, e.g. walking almost straight
    // ahead while orbiting, from counting.
    const rightAmount = dirX * -facingZ + dirZ * facingX; // character's right is (-facingZ, facingX)
    if (Math.abs(rightAmount) > 0.1 && forwardAmount > -0.1) sideways = Math.sign(rightAmount);

    let speed = capsLockOn ? PLAYER.runSpeed : PLAYER.speed;
    if (movingBackward) speed *= PLAYER.backwardSpeedFactor;

    pos.x += dirX * speed * dt;
    pos.z += dirZ * speed * dt;
    player.moveSpeed = speed;
    player.movingBackward = movingBackward;
  } else {
    player.moveSpeed = 0;
  }

  // Turn the body towards the side being moved to (right is a negative yaw),
  // easing back to the normal orientation when sideways movement stops.
  const targetTurn = -sideways * STRAFE_TURN_ANGLE;
  player.strafeTurn += (targetTurn - player.strafeTurn) * (1 - Math.exp(-STRAFE_TURN_RATE * dt));

  // Jumping: only possible while standing on the floor. A jump pressed just
  // before landing is remembered and happens as soon as the player lands.
  if (jumpRequested && !player.onGround && isFallingNearFloor()) {
    player.jumpBuffered = true;
  }
  if ((jumpRequested || player.jumpBuffered) && player.onGround) {
    player.velocityY = PLAYER.jumpSpeed;
    player.jumpBuffered = false;
  }
  jumpRequested = false;

  // Gravity.
  const previousY = pos.y;
  player.velocityY -= GRAVITY * dt;
  pos.y += player.velocityY * dt;

  // Floor collision: land on the floor if we crossed its surface from above
  // while over it. Walking off the edge lets the player fall.
  player.onGround = false;
  if (isAboveFloor(pos.x, pos.z) && pos.y <= FLOOR.y && previousY >= FLOOR.y) {
    pos.y = FLOOR.y;
    player.velocityY = 0;
    player.onGround = true;
  }

  if (pos.y < FALL_LIMIT) {
    Object.assign(pos, SPAWN);
    player.velocityY = 0;
    player.jumpBuffered = false;
  }
}

// --- Setup and game loop -------------------------------------------------

const renderer = new GameRenderer(document.body);
renderer.addFloor(FLOOR);
renderer.addPlayer(player.appearance);

// Mouse look: the mouse is captured automatically when the game opens.
// Esc or switching windows releases it; clicking the game captures it again.
const MOUSE_CAPTURE_RETRY_MS = 250;

// Browsers only let a page capture the mouse after a click, so the startup
// capture goes through the main process (see main.js). The window may not have
// focus straight away, so keep trying until the first capture succeeds.
function captureMouseOnStartup() {
  if (document.pointerLockElement === renderer.canvas) {
    clearInterval(startupCapture);
  } else if (document.hasFocus()) {
    window.electronWindow.captureMouse();
  }
}

const startupCapture = setInterval(captureMouseOnStartup, MOUSE_CAPTURE_RETRY_MS);
captureMouseOnStartup();

renderer.canvas.addEventListener('click', () => {
  if (document.pointerLockElement !== renderer.canvas) {
    // Refused if clicked within about a second of pressing Esc; click again.
    renderer.canvas.requestPointerLock()?.catch(() => {});
  }
});

document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement === renderer.canvas) onMouseMove(e.movementX, e.movementY);
});

// Right click jumps (only while the game has the mouse).
const RIGHT_MOUSE_BUTTON = 2;

document.addEventListener('mousedown', (e) => {
  if (e.button === RIGHT_MOUSE_BUTTON && document.pointerLockElement === renderer.canvas) {
    jumpRequested = true;
  }
});

// Don't open a context menu on right click.
document.addEventListener('contextmenu', (e) => e.preventDefault());

let lastTime = performance.now();

function frame(now) {
  // Clamp dt so a long pause (e.g. window hidden) doesn't cause a huge jump.
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;

  updateCamera(dt);
  updatePlayer(dt);
  renderer.updatePlayer(player.position, player.yaw + player.strafeTurn);
  renderer.animatePlayer({
    speed: player.moveSpeed,
    running: capsLockOn,
    backward: player.movingBackward,
    onGround: player.onGround,
    verticalSpeed: player.velocityY / PLAYER.jumpSpeed, // +1 at take-off, falling below 0
  }, dt);
  renderer.updateCamera({ yaw: getCameraYaw(), pitch: camera.pitch });
  renderer.render();

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
