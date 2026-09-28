// HUD: the on-screen display drawn over the 3D view with HTML and CSS (see
// style.css). It only draws; the game (game.js) tells it what to show.
//
// In combat mode it shows the party's health bars in the top left corner --
// each attached to a round portrait of that character -- and a health bar
// floating over each enemy's head. At all times, it shows the player's spells
// along the bottom: which one is selected, and which are recharging.
export class Hud {
  constructor(container) {
    this.root = element('div', 'hud', container);
    this.root.id = 'hud';
    this.partyList = element('div', 'party', this.root);
    this.enemyLayer = element('div', 'enemy-bars', this.root);
    this.party = new Map();   // id -> { fill }
    this.enemies = new Map(); // id -> { bar, fill }
    this.spellBar = element('div', 'spell-bar', container); // (always shown, so not inside the combat HUD)
    this.spellSlots = [];
  }

  // spells: [{ label, key, detail }] -- the player's spells (or weapons), in
  // order. detail: a line of smaller text under the label, e.g. the controls.
  setSpells(spells) {
    this.spellBar.replaceChildren();
    this.spellSlots = spells.map(({ label, key, detail }) => {
      const slot = element('div', 'spell', this.spellBar);
      element('div', 'key', slot).textContent = key;
      const text = element('div', 'label', slot);
      text.textContent = label;
      if (detail) {
        slot.classList.add('detailed');
        element('span', 'detail', text).textContent = detail;
      }
      return { slot, recharge: element('div', 'recharge', slot) };
    });
  }

  // members: [{ id, name, portrait }] -- portrait: a canvas with their headshot.
  setParty(members) {
    this.partyList.replaceChildren();
    this.party.clear();
    for (const { id, name, portrait } of members) {
      const row = element('div', 'member', this.partyList);
      const face = element('div', 'portrait', row);
      face.append(portrait);
      const bar = element('div', 'bar', row);
      element('div', 'name', bar).textContent = name;
      const track = element('div', 'track', bar);
      // Icons for anything affecting them (e.g. a shield), under the bar.
      const effects = element('div', 'effects', bar);
      const icons = {};
      for (const [effect, svg] of Object.entries(EFFECT_ICONS)) {
        const icon = element('div', `effect ${effect}`, effects);
        // (Each copy gets its own ids for its gradients and shapes: a hidden
        // icon's definitions can't be borrowed by another.)
        const suffix = `-${++iconCount}`;
        icon.innerHTML = svg.replace(/id="([\w-]+)"/g, `id="$1${suffix}"`).replace(/url\(#([\w-]+)\)/g, `url(#$1${suffix})`);
        icons[effect] = icon;
      }
      this.party.set(id, { fill: element('div', 'fill', track), icons });
    }
  }

  // enemies: [{ id }]
  setEnemies(enemies) {
    this.enemyLayer.replaceChildren();
    this.enemies.clear();
    for (const { id } of enemies) {
      const bar = element('div', 'enemy-bar', this.enemyLayer);
      this.enemies.set(id, { bar, fill: element('div', 'fill', bar) });
    }
  }

  // combat: whether combat mode is on (the health bars only show during it).
  // party: [{ id, health, maxHealth, effects: { name: seconds left } }]
  // enemies: [{ id, health, maxHealth, screen: { x, y, visible } }] -- screen:
  //   where the top of their head is on screen, in pixels
  // spells: { selected (index), recharging: [0-1 for each spell -- the share
  //   of its recharge still to go] }
  update({ combat, party, enemies, spells }) {
    this.root.classList.toggle('combat', combat);
    this.spellSlots.forEach(({ slot, recharge }, i) => {
      slot.classList.toggle('selected', i === spells?.selected);
      const left = spells?.recharging[i] ?? 0;
      recharge.style.height = `${left * 100}%`;
      slot.classList.toggle('ready', left === 0);
    });
    for (const { id, health, maxHealth, effects = {} } of party) {
      const view = this.party.get(id);
      if (!view) continue;
      view.fill.style.width = `${percent(health, maxHealth)}%`;
      for (const [effect, icon] of Object.entries(view.icons)) {
        const left = effects[effect] ?? 0;
        icon.classList.toggle('on', left > 0);
        icon.classList.toggle('ending', left > 0 && left < 3); // (blinks as it's about to wear off)
      }
    }
    for (const { id, health, maxHealth, screen } of enemies) {
      const view = this.enemies.get(id);
      if (!view) continue;
      view.bar.style.display = screen.visible && health > 0 ? '' : 'none';
      view.bar.style.transform = `translate(${screen.x}px, ${screen.y}px) translate(-50%, -100%)`;
      view.fill.style.width = `${percent(health, maxHealth)}%`;
    }
  }
}

let iconCount = 0;

// The two hands in the Sovereign Aid icon, as strokes: [path, width].
// Drawn twice -- a darker, wider outline, then the skin over it.
const HANDS = [
  // Adam's hand, raised limply from below on the left: the arm, the back of
  // the hand, the thumb, the fingers curled loosely under, and the index
  // finger reaching out, drooping slightly.
  ['M-1 28.5 L7.6 21.6', 4.2],
  ['M7.6 21.6 L10.8 19.8', 3.1],
  ['M8.8 20.4 L9.9 18.3', 1.2],
  ['M10.4 21 C11.3 22.1 12.4 22.4 12.9 21.8', 1.6],
  ['M10.8 19.8 C12.3 19.1 13.6 18.6 14.9 18.2', 1.15],
  // God's hand, reaching down from above on the right: firm, the index
  // finger held straight out towards Adam's.
  ['M33 3.5 L24.4 10.4', 4.2],
  ['M24.4 10.4 L21.2 12.4', 3.1],
  ['M23.4 12.2 L22.2 14.3', 1.2],
  ['M21.4 13.8 C20.6 15 19.6 15.5 19.1 15', 1.6],
  ['M21.2 12.4 C19.9 13.3 18.6 14.2 17.3 15.1', 1.15],
];

function handStrokes(extra) {
  return HANDS.map(([d, width]) => `<path d="${d}" stroke-width="${width + extra}"/>`).join('');
}

// Status icons, drawn in SVG.
const EFFECT_ICONS = {
  // (Both share a white-rimmed circle with a yellow background.)
  // Shield of Faith: a pale pastel purple shield with a glowing yellow
  // diagonal stripe, in a white-rimmed circle with a yellow background.
  shield: `<svg viewBox="0 0 32 32" aria-label="Shield of Faith">
    <defs>
      <radialGradient id="shield-bg" cx="50%" cy="45%" r="60%">
        <stop offset="0" stop-color="#fff3a6"/><stop offset="1" stop-color="#f7d54a"/>
      </radialGradient>
      <clipPath id="shield-shape"><path d="M16 6 L24.5 9 V15.5 C24.5 21 20.8 24.6 16 26.5 C11.2 24.6 7.5 21 7.5 15.5 V9 Z"/></clipPath>
      <filter id="shield-glow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="1.1"/>
      </filter>
    </defs>
    <circle cx="16" cy="16" r="14.5" fill="url(#shield-bg)" stroke="#ffffff" stroke-width="2.2"/>
    <path d="M16 6 L24.5 9 V15.5 C24.5 21 20.8 24.6 16 26.5 C11.2 24.6 7.5 21 7.5 15.5 V9 Z" fill="#d8c8f0" stroke="#b9a3de" stroke-width="0.9"/>
    <g clip-path="url(#shield-shape)">
      <path d="M5 23 L23 5" stroke="#ffe066" stroke-width="5.5" filter="url(#shield-glow)" opacity="0.9"/>
      <path d="M5 23 L23 5" stroke="#fff6b8" stroke-width="2.6"/>
    </g>
  </svg>`,
  // Sovereign Aid: two hands reaching towards each other, fingertips all but
  // touching, as in Michelangelo's "The Creation of Adam" -- one reaching down
  // from above on the right, the other raised limply from below on the left.
  aid: `<svg viewBox="0 0 32 32" aria-label="Sovereign Aid">
    <defs>
      <radialGradient id="aid-bg" cx="50%" cy="45%" r="60%">
        <stop offset="0" stop-color="#fff3a6"/><stop offset="1" stop-color="#f7d54a"/>
      </radialGradient>
      <clipPath id="aid-inside"><circle cx="16" cy="16" r="13.4"/></clipPath>
      <radialGradient id="aid-spark" cx="50%" cy="50%" r="50%">
        <stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <circle cx="16" cy="16" r="14.5" fill="url(#aid-bg)" stroke="#ffffff" stroke-width="2.2"/>
    <g clip-path="url(#aid-inside)" stroke-linecap="round" stroke-linejoin="round" fill="none">
      <g stroke="#9c7160">${handStrokes(1.1)}</g>
      <g stroke="#f4d6c2">${handStrokes(0)}</g>
    </g>
    <!-- The spark in the gap between the fingertips. -->
    <circle cx="16.1" cy="16.65" r="2.1" fill="url(#aid-spark)"/>
  </svg>`,
};

function element(tag, className, parent) {
  const el = document.createElement(tag);
  el.className = className;
  parent.append(el);
  return el;
}

function percent(value, max) {
  return Math.min(Math.max((value / max) * 100, 0), 100);
}
