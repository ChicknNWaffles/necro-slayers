// HUD: the on-screen display drawn over the 3D view with HTML and CSS (see
// style.css). It only draws; the game (game.js) tells it what to show.
//
// In combat mode it shows the party's health bars in the top left corner --
// each attached to a round portrait of that character -- and a health bar
// floating over each enemy's head.
export class Hud {
  constructor(container) {
    this.root = element('div', 'hud', container);
    this.root.id = 'hud';
    this.partyList = element('div', 'party', this.root);
    this.enemyLayer = element('div', 'enemy-bars', this.root);
    this.party = new Map();   // id -> { fill }
    this.enemies = new Map(); // id -> { bar, fill }
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
  update({ combat, party, enemies }) {
    this.root.classList.toggle('combat', combat);
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

// Status icons, drawn in SVG.
const EFFECT_ICONS = {
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
