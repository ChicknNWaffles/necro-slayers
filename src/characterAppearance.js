// Character appearance: the data that describes how the player looks.
// Pure game data -- no 3D code. The renderer builds the model from it
// (characterModel.js), a character creator can build its controls from
// APPEARANCE_OPTIONS, and it is plain JSON so it can go in a save file.

// Every customizable option. Adding an option here (and using it in
// characterModel.js) is all a character creator should need.
//   range:  a number between min and max (sizes are multipliers of the default)
//   color:  a '#rrggbb' hex colour
//   choice: one of a fixed list of values
export const APPEARANCE_OPTIONS = {
  bodyType:   { type: 'choice', label: 'Body type',  choices: ['female', 'male'], default: 'female' },
  height:     { type: 'range',  label: 'Height',     min: 0.85, max: 1.15, step: 0.01, default: 1 },
  build:      { type: 'range',  label: 'Build',      min: 0.8,  max: 1.3,  step: 0.01, default: 1 },
  headSize:   { type: 'range',  label: 'Head size',  min: 0.85, max: 1.2,  step: 0.01, default: 1 },
  eyeSize:    { type: 'range',  label: 'Eye size',   min: 0.8,  max: 1.25, step: 0.01, default: 1 },
  skinColor:  { type: 'color',  label: 'Skin',       default: '#f6d9c6' },
  eyeColor:   { type: 'color',  label: 'Eyes',       default: '#3f7fd6' },
  blush:      { type: 'range',  label: 'Blush',      min: 0, max: 1, step: 0.01, default: 0.3 },
  freckles:   { type: 'range',  label: 'Freckles',   min: 0, max: 1, step: 0.01, default: 0 },
  hairStyle:  { type: 'choice', label: 'Hair style', choices: ['short', 'long', 'ponytail', 'twintails', 'braid', 'none'], default: 'short' },
  hairColor:  { type: 'color',  label: 'Hair',       default: '#4a3328' },
  outfit:     { type: 'choice', label: 'Outfit',     choices: ['casual', 'dress'], default: 'casual' },
  shirtColor: { type: 'color',  label: 'Top / dress', default: '#5b7fd6' },
  pantsColor: { type: 'color',  label: 'Pants',      default: '#2d3142' },
  footwear:   { type: 'choice', label: 'Footwear',   choices: ['shoes', 'sandals'], default: 'shoes' },
  shoeColor:  { type: 'color',  label: 'Shoes',      default: '#3a2b26' },
};

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function isValid(option, value) {
  switch (option.type) {
    case 'range':  return typeof value === 'number' && Number.isFinite(value);
    case 'color':  return typeof value === 'string' && HEX_COLOR.test(value);
    case 'choice': return option.choices.includes(value);
    default:       return false;
  }
}

// Build a complete, valid appearance from any (possibly partial or invalid)
// values, e.g. from a save file or a character creator. Missing or invalid
// values keep their value from `base` (if given) or fall back to the default;
// numbers are clamped to their range.
export function createAppearance(values = {}, base = {}) {
  const appearance = {};
  for (const [key, option] of Object.entries(APPEARANCE_OPTIONS)) {
    const fallback = isValid(option, base[key]) ? base[key] : option.default;
    let value = isValid(option, values[key]) ? values[key] : fallback;
    if (option.type === 'range') value = Math.min(Math.max(value, option.min), option.max);
    appearance[key] = value;
  }
  return appearance;
}
