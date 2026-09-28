// Enemies: game data describing the enemies -- no 3D code.
//
// Zombies are random characters put together from the character creator's
// options (see characterAppearance.js), then made undead: their skin is
// drained towards grey and a few wounds are chosen where the flesh is gone
// and bone shows through (the rot, torn clothes and wounds are drawn by the
// renderer, see decayModel.js).
import { APPEARANCE_OPTIONS, createAppearance } from './characterAppearance.js';

// Natural skin tones to start from, before they're greyed.
const SKIN_TONES = ['#f6d9c6', '#efc9a8', '#e0ac85', '#c68e64', '#9a6844', '#6e4a31'];
const HAIR_COLORS = ['#2b1d16', '#4a3328', '#7a5232', '#a8743f', '#d8b36a', '#8a8580', '#1c1c1c', '#9c3b1d'];
const EYE_COLORS = ['#3f7fd6', '#3f9a4f', '#6b4a2e', '#7c7f86'];

// Where wounds can be (see decayModel.js).
const WOUND_SITES = ['forearm', 'upperArm', 'shin'].flatMap((limb) => ['left', 'right'].map((side) => ({ limb, side })));

// A random zombie: { appearance, decay: { seed, wounds } }.
// random: a function returning numbers in [0, 1) (Math.random by default).
export function createZombie(random = Math.random) {
  const pick = (list) => list[Math.floor(random() * list.length)];
  const option = (key) => pick(APPEARANCE_OPTIONS[key].choices);

  const skin = greyed(pick(SKIN_TONES), 0.65);
  const appearance = createAppearance({
    bodyType: option('bodyType'),
    // (Sizes come in a few steps, rather than any value, so zombies can share
    // the slow-to-make parts of their models.)
    height: pick([0.92, 0.97, 1, 1.04]),
    build: pick([0.9, 1, 1.1]),
    headSize: pick([0.95, 1, 1.05]),
    eyeSize: pick([0.9, 1]),
    skinColor: skin,
    eyeColor: mixColors(pick(EYE_COLORS), '#c9cfc7', 0.6), // clouded over
    blush: 0,
    freckles: random() < 0.3 ? 0.5 : 0,
    hairStyle: option('hairStyle'),
    hairColor: mixColors(pick(HAIR_COLORS), '#6d6a64', 0.3), // dulled
    outfit: random() < 0.8 ? 'casual' : 'dress',
    shirtColor: grimy(randomColor(random)),
    pantsColor: grimy(randomColor(random)),
    footwear: random() < 0.8 ? 'shoes' : 'sandals',
    shoeColor: grimy(randomColor(random)),
  });

  // One to three wounds, on different limbs.
  const sites = [...WOUND_SITES];
  const wounds = [];
  const count = 1 + Math.floor(random() * 3);
  for (let i = 0; i < count; i++) wounds.push(sites.splice(Math.floor(random() * sites.length), 1)[0]);

  return { appearance, decay: { seed: Math.floor(random() * 1000) / 10, wounds } };
}

// A random skeleton: { appearance, decay: { seed, wounds: [], skeletal: true },
// weapon }. Built like a zombie's (for their size and a shirt's colour), but
// nothing's left of them but bones in a torn shirt -- armed with either a
// sword or a short bow, equally likely.
export function createSkeleton(random = Math.random) {
  const { appearance } = createZombie(random);
  appearance.outfit = 'casual';
  return {
    appearance,
    decay: { seed: Math.floor(random() * 1000) / 10, wounds: [], skeletal: true },
    weapon: random() < 0.5 ? 'sword' : 'shortbow',
  };
}

// --- Colours ---------------------------------------------------------------

function toRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(rgb) {
  return `#${rgb.map((v) => Math.round(Math.min(Math.max(v, 0), 255)).toString(16).padStart(2, '0')).join('')}`;
}

function mixColors(a, b, t) {
  const [ca, cb] = [toRgb(a), toRgb(b)];
  return toHex(ca.map((v, i) => v + (cb[i] - v) * t));
}

// Drained of colour towards a cold, slightly green grey, and a little darker.
function greyed(hex, amount) {
  const rgb = toRgb(hex);
  const grey = (rgb[0] + rgb[1] + rgb[2]) / 3;
  const drained = [grey * 0.97, grey * 1.0, grey * 0.95];
  return toHex(rgb.map((v, i) => (v + (drained[i] - v) * amount) * 0.9));
}

// Clothes that have seen better days: faded and dirtied.
function grimy(hex) {
  return mixColors(hex, '#5b5446', 0.45);
}

function randomColor(random) {
  return toHex([random() * 255, random() * 255, random() * 255]);
}
