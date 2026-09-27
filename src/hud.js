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
      this.party.set(id, { fill: element('div', 'fill', track) });
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
  // party: [{ id, health, maxHealth }]
  // enemies: [{ id, health, maxHealth, screen: { x, y, visible } }] -- screen:
  //   where the top of their head is on screen, in pixels
  update({ combat, party, enemies }) {
    this.root.classList.toggle('combat', combat);
    for (const { id, health, maxHealth } of party) {
      const view = this.party.get(id);
      if (view) view.fill.style.width = `${percent(health, maxHealth)}%`;
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

function element(tag, className, parent) {
  const el = document.createElement(tag);
  el.className = className;
  parent.append(el);
  return el;
}

function percent(value, max) {
  return Math.min(Math.max((value / max) * 100, 0), 100);
}
