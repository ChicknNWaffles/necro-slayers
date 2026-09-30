// Character appearance: the data that describes how the player looks.
// Pure game data -- no 3D code. The renderer builds the model from it
// (characterModel.js), a character creator can build its controls from
// APPEARANCE_OPTIONS, and it is plain JSON so it can go in a save file.

// Every customizable option. Adding an option here (and using it in
// characterModel.js) is all a character creator should need.
//   range:  a number between min and max (sizes are multipliers of the default)
//   color:  a '#rrggbb' hex colour
//   choice: one of a fixed list of values
// A colour can list a `palette` of suggested colours (e.g. for clothes).

// Colours for clothes: muted, earthy versions of the usual colours, a little
// faded and warmed towards sepia (as cloth dyed with natural dyes would be) --
// plus plain white, and a creamy tan (white given the same treatment).
export const CLOTHING_COLORS = {
  red: '#9c5a4c',
  orange: '#b07a4e',
  yellow: '#b8a066',
  green: '#6f8158',
  teal: '#587a72',
  blue: '#58708f',
  purple: '#76627e',
  pink: '#b0848a',
  brown: '#6e5440',
  grey: '#7d776d',
  black: '#2e2a26',
  white: '#f4f1ea',
  cream: '#e3d4b4',
};
const CLOTHING_PALETTE = Object.values(CLOTHING_COLORS);

// Named presets for every colour control in the creator.
export const COLOR_PALETTES = {
  skinColor: { Porcelain: '#f6d9c6', Ivory: '#efc9a8', Peach: '#e8b695', Sand: '#d8b28b', 'Light olive': '#cea77c', Olive: '#b69a70', Bronze: '#bd8b61', Copper: '#a86f4b', Umber: '#895c40', Walnut: '#6e4a31', Espresso: '#503628', Ebony: '#372a24' },
  hairColor: { Chestnut: '#4a3328', Black: '#211d1b', 'Dark brown': '#34251f', Auburn: '#6e3226', Copper: '#a65332', Ginger: '#bd7845', Honey: '#b28b52', Blonde: '#d1b879', Ash: '#8d8170', Silver: '#bfc0b7', White: '#e4dfcf', Plum: '#624556' },
  eyeColor: { Blue: '#3f7fd6', Slate: '#647988', Green: '#59844c', Hazel: '#8b853f', Brown: '#765032', Amber: '#c28b36', Grey: '#979b91', Violet: '#817098', Teal: '#447f7a', 'Dark brown': '#3d2c24' },
  shirtColor: CLOTHING_COLORS,
  pantsColor: CLOTHING_COLORS,
  shoeColor: { ...CLOTHING_COLORS, 'Dark leather': '#3a2b26' },
  leatherColor: { Saddle: '#6b4428', Chestnut: '#795138', Umber: '#51382b', Tan: '#a48158', Oxblood: '#643932', Charcoal: '#302a25', Cream: '#c9b68c' },
};

// Extra depth makes build read as body volume rather than mainly width.
export function buildDepth(build) { return 1 + (build - 1) * (build > 1 ? 2.4 : 1.5); }

export const APPEARANCE_OPTIONS = {
  bodyType:   { type: 'choice', label: 'Body type',  choices: ['female', 'male'], default: 'female' },
  height:     { type: 'range',  label: 'Height',     min: 0.85, max: 1.15, step: 0.01, default: 1 },
  build:      { type: 'range',  label: 'Weight',      min: 0.8,  max: 1.3,  step: 0.01, default: 1 },
  chestWeight: { type: 'range', label: 'Chest & upper back', min: 0.7, max: 1.4, step: 0.01, default: 1 },
  bellyWeight: { type: 'range', label: 'Belly & waist', min: 0.7, max: 1.4, step: 0.01, default: 1 },
  hipWeight: { type: 'range', label: 'Hips & seat', min: 0.7, max: 1.4, step: 0.01, default: 1 },
  armWeight: { type: 'range', label: 'Arms', min: 0.7, max: 1.4, step: 0.01, default: 1 },
  legWeight: { type: 'range', label: 'Legs', min: 0.7, max: 1.4, step: 0.01, default: 1 },
  headSize:   { type: 'range',  label: 'Head size',  min: 0.85, max: 1.2,  step: 0.01, default: 1 },
  eyeSize:    { type: 'range',  label: 'Eye size',   min: 0.8,  max: 1.25, step: 0.01, default: 1 },
  skinColor:  { type: 'color',  label: 'Skin',       default: '#f6d9c6' },
  eyeColor:   { type: 'color',  label: 'Eyes',       default: '#3f7fd6' },
  blush:      { type: 'range',  label: 'Blush',      min: 0, max: 1, step: 0.01, default: 0.3 },
  freckles:   { type: 'range',  label: 'Freckles',   min: 0, max: 1, step: 0.01, default: 0 },
  hairStyle:  { type: 'choice', label: 'Hair style', choices: ['bob', 'short', 'long', 'ponytail', 'twintails', 'braid', 'manBun', 'none'], default: 'bob' },
  // Bangs are separate from the style, so any bangs go with any hairstyle.
  bangs:      { type: 'choice', label: 'Bangs',      choices: ['straight', 'sideSwept', 'fringe', 'blowout', 'none'], default: 'straight' },
  hairColor:  { type: 'color',  label: 'Hair',       default: '#4a3328' },
  // A tunic (laced at the neck, with wide sleeves, short or long, and either
  // belted at the waist or hanging loose) and trousers -- or a dress.
  outfit:     { type: 'choice', label: 'Top',     choices: ['tunic', 'dress', 'robes'], default: 'tunic' },
  tunicSleeves: { type: 'choice', label: 'Tunic sleeves', choices: ['short', 'long'], default: 'short' },
  tunicBelt:  { type: 'choice', label: 'Tunic belt', choices: ['untied', 'tied'], default: 'untied' },
  shirtColor: { type: 'color',  label: 'Top color', default: CLOTHING_COLORS.blue, palette: CLOTHING_PALETTE },
  pantsFit:   { type: 'choice', label: 'Pants',   choices: ['fitted', 'loose'], default: 'fitted' },
  pantsColor: { type: 'color',  label: 'Pants color', default: CLOTHING_COLORS.black, palette: CLOTHING_PALETTE },
  footwear:   { type: 'choice', label: 'Footwear',   choices: ['shoes', 'boots', 'sandals'], default: 'shoes' },
  shoeColor:  { type: 'color',  label: 'Shoes',      default: '#3a2b26', palette: CLOTHING_PALETTE },
  // Leather armour: shoulder pauldrons (strapped on) and arm bracers.
  // Or chainmail (a sleeveless mail shirt over everything), or metal plate
  // (chest plate, pauldrons and thigh plates) -- one or the other.
  armor:      { type: 'choice', label: 'Armour',     choices: ['none', 'leather', 'chainmail', 'plate'], default: 'none' },
  leatherColor: { type: 'color', label: 'Leather',   default: '#6b4428' },
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
    const legacyBangs = key === 'bangs' ? ({ braid: 'sideSwept', manBun: 'fringe' }[values.hairStyle ?? base.hairStyle] ?? 'straight') : option.default;
    const fallback = isValid(option, base[key]) ? base[key] : legacyBangs;
    let value = isValid(option, values[key]) ? values[key] : fallback;
    if (option.type === 'range') value = Math.min(Math.max(value, option.min), option.max);
    appearance[key] = value;
  }
  return appearance;
}
