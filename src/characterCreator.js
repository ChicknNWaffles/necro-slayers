import * as THREE from '../node_modules/three/build/three.module.js';
import { APPEARANCE_OPTIONS, COLOR_PALETTES, createAppearance } from './characterAppearance.js';
import { showSceneLoading, nextPaint } from './loadingScreen.js';
import { CLASSES, WEAPONS } from './characterClasses.js';
import { CharacterModel } from './characterModel.js';

const CLASS_TEXT = {
  cleric: ['Cleric', 'Protect and restore your party, or call down divine power. Choose four of six spells.'],
  fighter: ['Fighter', 'Fight up close with a sword and shield, or a two-handed halberd. Equip two hands’ worth of weapons.'],
  archer: ['Archer', 'Fight at a distance with your chosen bow. Every archer also carries a dagger for close combat.'],
  mage: ['Mage', 'Control the battlefield with fire, earth, vines and force. Choose four of six spells.'],
};
const OPTIONS = {
  smite: ['Smite', 'Strike a nearby enemy with a glowing hand. A quick melee spell that deals holy damage.'],
  divineBlade: ['Divine Blade', 'Summon a hail of swords over a distant area. Anyone beneath the swords can be hurt, including allies.'],
  divineRestoration: ['Divine Restoration', 'Restore 35% of a target’s maximum health by touch, or heal yourself.'],
  shieldOfFaith: ['Shield of Faith', 'Touch yourself or an ally to grant shimmering armour that reduces damage for 12 seconds.'],
  sovereignAid: ['Sovereign Aid', 'Touch yourself or an ally to strengthen their attacks and damaging spells for 14 seconds.'],
  cleansingLight: ['Cleansing Light', 'Send a beam straight ahead. It damages undead and stuns other creatures caught in its path.'],
  fireball: ['Fireball', 'Launch a fireball that bursts on impact, damaging its target and creatures nearby.'],
  vineTrap: ['Vine Trap', 'Restrain a distant target with vines for 3.5 seconds. They cannot move, but can still attack within reach.'],
  powerShove: ['Power Shove', 'Push a distant target backwards with magical force. Causes knockback without damage.'],
  wallOfEarth: ['Wall of Earth', 'Raise a temporary wall that blocks movement, attacks and spells. It crumbles after 10 seconds.'],
  leachBomb: ['Leach Bomb', 'Plant an explosive leech by touch. It detonates after a short delay; get clear of the blast, and keep allies away.'],
  burningGround: ['Burning Ground', 'Turn an area into burning coals for 8 seconds. Anyone standing on it takes damage, including allies.'],
  sword: ['Sword', 'One hand. Stab a single enemy or slash across enemies in front of you. Pair it with a shield.'],
  shield: ['Shield', 'One hand. Hold Block to guard against incoming attacks, or Shield Bash to stun and push an enemy. Pair it with a sword.'],
  halberd: ['Halberd', 'Two hands. Sweep with the axe blade or strike with the hammer to knock enemies back. Cannot be paired with another weapon.'],
  shortbow: ['Short Bow', 'Shortest bow range and fastest firing. Small aiming jitter; easier to aim than the long bow. Includes a dagger.'],
  longbow: ['Long Bow', 'Medium bow range and the highest arrow damage. Slower firing and slightly more aiming jitter. Includes a dagger.'],
  crossbow: ['Crossbow', 'Longest range and no aiming jitter. Each shot requires a longer reload while standing still. Same damage as the short bow. Includes a dagger.'],
};
const HELP = {
  bodyType: 'Choose the base body proportions and facial features.', height: 'Adjust overall character height.',
  build: 'Adjust the width and front-to-back fullness of the torso and limbs.', headSize: 'Scale the head.', eyeSize: 'Adjust the size of the eyes.',
  chestWeight: 'Relative fullness through the chest and upper back.',
  bellyWeight: 'Relative fullness around the belly and waist.',
  hipWeight: 'Relative fullness through the hips and seat.',
  armWeight: 'Relative fullness through the upper arms and forearms.',
  legWeight: 'Relative fullness through the thighs and calves.',
  skinColor: 'Choose a skin tone.', eyeColor: 'Choose the iris colour.', blush: 'Adjust cheek blush intensity.',
  freckles: 'Adjust the amount of freckles.', hairStyle: 'Choose a hairstyle: a bob, short hair (close at the sides, fluffy on top), long hair, tied-back styles, the long braid or the man bun.',
  bangs: 'Mix straight, side-swept, fringe, or cowlick blowout bangs (parted, with a bump that curls in at the cheeks), or no bangs, with your hairstyle.',
  hairColor: 'Choose a hair colour.', outfit: 'Choose a tunic with trousers, a flowing dress, or split-front robes with a sash.',
  tunicSleeves: 'Short sleeves or full-length sleeves.', tunicBelt: 'A shorter tunic with a rope belt, or a longer untied tunic.',
  shirtColor: 'Colour the tunic or dress.', pantsFit: 'Tights follow the legs closely; trousers leave more room through the legs.',
  pantsColor: 'Choose the trouser colour.', footwear: 'Shoes with trousers over the ankle, tall boots, or sandals.',
  shoeColor: 'Choose the footwear colour.', armor: 'Leather pauldrons and bracers; a sleeveless chainmail shirt worn over your clothes; or metal plate (chest plate, pauldrons and thigh plates strapped on with leather).',
  leatherColor: 'Choose the leather armour colour.',
};
const GROUPS = {
  Body: ['bodyType', 'height', 'build', 'chestWeight', 'bellyWeight', 'hipWeight', 'armWeight', 'legWeight', 'headSize'],
  Face: ['eyeSize', 'skinColor', 'eyeColor', 'blush', 'freckles'],
  Hair: ['hairStyle', 'bangs', 'hairColor'],
  Clothing: ['outfit', 'shirtColor', 'pantsFit', 'pantsColor', 'footwear', 'shoeColor', 'armor', 'leatherColor'],
};
const TOPS = {
  shortTunic: { label: 'Short sleeved tunic', outfit: 'tunic', tunicSleeves: 'short', tunicBelt: 'untied' },
  shortBeltedTunic: { label: 'Short sleeved tunic with belt', outfit: 'tunic', tunicSleeves: 'short', tunicBelt: 'tied' },
  longTunic: { label: 'Long sleeved tunic', outfit: 'tunic', tunicSleeves: 'long', tunicBelt: 'untied' },
  longBeltedTunic: { label: 'Long sleeved tunic with belt', outfit: 'tunic', tunicSleeves: 'long', tunicBelt: 'tied' },
  dress: { label: 'Dress', outfit: 'dress' },
  robes: { label: 'Robes', outfit: 'robes' },
};
const ARMOR_LABELS = { none: 'None', leather: 'Leather', chainmail: 'Chainmail', plate: 'Metal plate' };
const pretty = (value) => value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());

export function selectionProblem(characterClass, picks) {
  const spec = CLASSES[characterClass];
  if (!spec) return 'Choose a class, then choose its spells or equipment.';
  const allowed = spec.spells ?? spec.weapons ?? spec.bows;
  if (new Set(picks).size !== picks.length || picks.some((id) => !allowed.includes(id))) return 'Choose options for your current class.';
  if (spec.spells) return picks.length === spec.slots ? '' : `Choose ${spec.slots} spells (${picks.length}/${spec.slots} selected).`;
  if (spec.weapons) return picks.reduce((sum, id) => sum + WEAPONS[id].hands, 0) === spec.slots ? '' : 'Choose sword and shield, or a halberd (two hands).';
  return picks.length === 1 ? '' : 'Choose one bow. Your dagger is included.';
}

export function showCharacterCreator() {
  return new Promise((resolve) => {
    const screen = document.createElement('main');
    screen.id = 'character-creator';
    screen.innerHTML = `
      <section class="creator-preview" aria-label="Character preview">
        <div class="creator-title"><span>YOUR ADVENTURE BEGINS</span><h1>Create your character</h1><p>Make them your own.</p></div>
        <div class="creator-stage"></div>
        <div class="creator-turn"><button type="button" data-turn="left" aria-label="Rotate left">↶</button><span>Hold <kbd>A</kbd> / <kbd>D</kbd> or <kbd>←</kbd> / <kbd>→</kbd> to rotate</span><button type="button" data-turn="right" aria-label="Rotate right">↷</button></div>
        <p class="creator-render-status" role="status">Preparing your character…</p>
        <div class="preview-loading" role="progressbar" aria-label="Updating character preview"><span></span></div>
      </section>
      <section class="creator-editor" aria-label="Character options">
        <nav class="creator-tabs" aria-label="Creation pages"><button type="button" data-page="appearance" aria-current="page">1 · Appearance</button><button type="button" data-page="class">2 · Class & abilities</button></nav>
        <div class="creator-pages"><section data-panel="appearance"><h2>Appearance</h2><p class="creator-intro">Adjust your features, hair and clothing.</p><div class="appearance-category-tabs" role="tablist" aria-label="Appearance categories"></div><div class="appearance-fields"></div><button class="creator-next" type="button">Next: class & abilities →</button></section>
        <section data-panel="class" hidden><h2>Choose your class</h2><p class="creator-intro">Choose how you will fight and support your party.</p><div class="class-cards"></div><fieldset class="loadout-options" hidden><legend></legend><p class="loadout-help"></p><div class="loadout-cards"></div></fieldset></section></div>
        <footer class="creator-footer"><p class="creator-validation" aria-live="polite"></p><button class="creator-done" type="button" disabled>Done — enter the game</button></footer>
      </section>`;
    document.body.append(screen);
    const find = (selector) => screen.querySelector(selector);
    let appearance = createAppearance(), characterClass = null, picks = [], model = null;
    let busy = true, closed = false, timer = null, frameId = null, yaw = 0, previous = performance.now();
    const held = new Set();
    const abort = new AbortController();
    const listen = (target, event, fn, options = {}) => target.addEventListener(event, fn, { ...options, signal: abort.signal });
    const stage = find('.creator-stage');
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setClearColor('#b4a17c');
    stage.append(renderer.domElement);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x667766, 1.2));
    const light = new THREE.DirectionalLight(0xffffff, 1.5);
    light.position.set(-3, 6, -5); scene.add(light);
    const camera = new THREE.OrthographicCamera(-1, 1, 1.5, -1.5, 0.1, 30);
    camera.position.set(0, 1.28, -6); camera.lookAt(0, 1.13, 0);
    function resize() {
      const width = Math.max(stage.clientWidth, 1), height = Math.max(stage.clientHeight, 1);
      const half = Math.max(1.4, 0.85 * height / width);
      camera.left = -half * width / height; camera.right = -camera.left;
      camera.top = half; camera.bottom = -half; camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    }
    const observer = new ResizeObserver(resize); observer.observe(stage); resize();
    function validate() {
      const problem = selectionProblem(characterClass, picks);
      find('.creator-validation').textContent = busy ? 'Updating your character preview…' : problem || 'Ready to begin. You can still adjust your appearance.';
      find('.creator-done').disabled = busy || Boolean(problem);
    }
    let previewRevision = 0;
    function rebuild() {
      const revision = ++previewRevision;
      clearTimeout(timer); busy = true; validate();
      find('.preview-loading').hidden = false;
      stage.setAttribute('aria-busy', 'true');
      find('.creator-render-status').textContent = 'Updating preview…';
      timer = setTimeout(async () => {
        if (closed) return;
        await nextPaint();
        if (closed || revision !== previewRevision) return;
        try {
          if (model) model.setAppearance(appearance);
          else { model = new CharacterModel(appearance); scene.add(model.root); }
          renderer.render(scene, camera);
          busy = false; find('.creator-render-status').textContent = 'Preview ready';
          find('.preview-loading').hidden = true; stage.setAttribute('aria-busy', 'false'); validate();
        } catch (error) {
          find('.creator-render-status').textContent = 'Could not update the preview. Change an option to try again.';
          find('.preview-loading').hidden = true; stage.setAttribute('aria-busy', 'false');
          console.error(error);
        }
      }, 120);
    }
    function page(name) {
      screen.querySelectorAll('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== name; });
      screen.querySelectorAll('[data-page]').forEach((p) => { if (p.dataset.page === name) p.setAttribute('aria-current', 'page'); else p.removeAttribute('aria-current'); });
      find('.creator-pages').scrollTop = 0;
    }
    screen.querySelectorAll('[data-page]').forEach((button) => listen(button, 'click', () => page(button.dataset.page)));
    listen(find('.creator-next'), 'click', () => page('class'));
    function selectCategory(name) {
      screen.querySelectorAll('[data-category]').forEach(button => {
        const selected = button.dataset.category === name;
        button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1;
      });
      screen.querySelectorAll('[data-category-panel]').forEach(panel => { panel.hidden = panel.dataset.categoryPanel !== name; });
      find('.creator-pages').scrollTop = 0;
    }
    for (const [group, keys] of Object.entries(GROUPS)) {
      const id = group.toLowerCase();
      const tab = document.createElement('button'); tab.type = 'button'; tab.textContent = group;
      tab.id = 'category-' + id; tab.dataset.category = group; tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-controls', 'category-panel-' + id);
      tab.setAttribute('aria-selected', String(group === 'Body')); tab.tabIndex = group === 'Body' ? 0 : -1;
      listen(tab, 'click', () => selectCategory(group));
      listen(tab, 'keydown', e => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
        e.preventDefault(); e.stopPropagation();
        const names = Object.keys(GROUPS), index = names.indexOf(group);
        const next = e.key === 'Home' ? 0 : e.key === 'End' ? names.length - 1 : (index + (e.key === 'ArrowRight' ? 1 : -1) + names.length) % names.length;
        selectCategory(names[next]); screen.querySelector('[data-category="' + names[next] + '"]').focus();
      });
      find('.appearance-category-tabs').append(tab);
      const section = document.createElement('section'); section.className = 'appearance-group'; section.id = 'category-panel-' + id; section.dataset.categoryPanel = group; section.setAttribute('role', 'tabpanel'); section.setAttribute('aria-labelledby', tab.id); section.hidden = group !== 'Body';
      const legend = document.createElement('h3'); legend.textContent = group; section.append(legend);
      for (const key of keys) {
        const option = APPEARANCE_OPTIONS[key];
        const row = document.createElement('div'); row.className = 'appearance-row'; row.dataset.option = key;
        const label = document.createElement('label'); label.htmlFor = `appearance-${key}`; label.textContent = option.label;
        const input = document.createElement(option.type === 'choice' || option.type === 'color' ? 'select' : 'input');
        input.id = label.htmlFor; input.name = key;
        if (option.type === 'choice') for (const choice of (key === 'outfit' ? Object.keys(TOPS) : option.choices)) {
          const item = document.createElement('option'); item.value = choice; item.textContent = key === 'outfit' ? TOPS[choice].label : key === 'pantsFit' ? ({ fitted: 'Tights', loose: 'Trousers' }[choice]) : key === 'armor' ? ARMOR_LABELS[choice] : pretty(choice); input.append(item);
        } else if (option.type === 'color') {
          for (const [name, color] of Object.entries(COLOR_PALETTES[key])) {
            const item = document.createElement('option'); item.value = color; item.textContent = pretty(name); input.append(item);
          }
        } else {
          input.type = option.type;
          if (option.type === 'range') Object.assign(input, { min: option.min, max: option.max, step: option.step });
        }
        input.value = key === 'outfit' ? Object.keys(TOPS).find(id => { const top = TOPS[id]; return top.outfit === appearance.outfit && (top.outfit !== 'tunic' || (top.tunicSleeves === appearance.tunicSleeves && top.tunicBelt === appearance.tunicBelt)); }) : appearance[key];
        const value = document.createElement('output'); value.htmlFor = input.id;
        if (option.type === 'range') value.textContent = Number(input.value).toFixed(2);
        const help = document.createElement('small'); help.id = `${input.id}-help`; help.textContent = HELP[key] + (key.endsWith('Weight') ? ' 1.00 is the balanced proportion.' : ''); input.setAttribute('aria-describedby', help.id);
        row.append(label, input); if (option.type === 'range') row.append(value); row.append(help);
        listen(input, 'input', () => { if (option.type === 'range') value.textContent = Number(input.value).toFixed(2); });
        listen(input, 'change', () => {
          appearance = createAppearance(key === 'outfit' ? TOPS[input.value] : { [key]: option.type === 'range' ? Number(input.value) : input.value }, appearance);
          row.querySelectorAll('.creator-palette button').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.color === input.value)));
          rebuild();
        });
        if (option.type === 'color') {
          const palette = document.createElement('div'); palette.className = 'creator-palette';
          for (const [name, color] of Object.entries(COLOR_PALETTES[key])) {
            const swatch = document.createElement('button'); swatch.type = 'button'; swatch.title = pretty(name);
            swatch.setAttribute('aria-label', `${option.label}: ${name}`); swatch.style.backgroundColor = color;
            swatch.dataset.color = color; swatch.setAttribute('aria-pressed', String(color === appearance[key]));
            listen(swatch, 'click', () => { input.value = color; input.dispatchEvent(new Event('change')); }); palette.append(swatch);
          }
          row.append(palette);
        }
        section.append(row);
      }
      find('.appearance-fields').append(section);
    }
    function card(id, title, detail, type, name, checked, change) {
      const label = document.createElement('label'); label.className = 'creator-card';
      const input = document.createElement('input'); Object.assign(input, { type, name, value: id, checked });
      const text = document.createElement('span'), heading = document.createElement('strong'), description = document.createElement('small');
      heading.textContent = title; description.textContent = detail; text.append(heading, description); label.append(input, text);
      listen(input, 'change', () => change(input.checked)); return label;
    }
    function loadout() {
      const spec = CLASSES[characterClass];
      find('.loadout-options').hidden = false;
      find('.loadout-options legend').textContent = spec.spells ? 'Choose four spells' : spec.weapons ? 'Choose your weapons' : 'Choose your bow';
      find('.loadout-help').textContent = spec.spells ? 'Selection order sets your 1–4 slots. Uncheck and reselect to change the order.' : spec.weapons ? 'Sword + shield, or halberd alone. Select abilities with 1–4 or the scroll wheel.' : 'One bow and a dagger. Select abilities with number keys or the scroll wheel.';
      const container = find('.loadout-cards'); container.replaceChildren();
      for (const id of spec.spells ?? spec.weapons ?? spec.bows) {
        const [title, detail] = OPTIONS[id];
        const label = card(id, spec.spells && picks.includes(id) ? `${picks.indexOf(id) + 1}. ${title}` : title, detail, spec.bows ? 'radio' : 'checkbox', 'loadout', picks.includes(id), (checked) => {
          if (spec.bows) picks = [id];
          else if (!checked) picks = picks.filter((p) => p !== id);
          else if (id === 'halberd') picks = [id];
          else { if (spec.weapons) picks = picks.filter((p) => p !== 'halberd'); picks.push(id); }
          loadout(); validate();
        });
        if (spec.spells && picks.length === spec.slots && !picks.includes(id)) label.querySelector('input').disabled = true;
        container.append(label);
      }
    }
    for (const [id, [title, detail]] of Object.entries(CLASS_TEXT)) {
      find('.class-cards').append(card(id, title, detail, 'radio', 'characterClass', false, () => {
        characterClass = id; picks = []; loadout(); validate();
      }));
    }
    listen(window, 'keydown', (e) => {
      const key = e.key.toLowerCase();
      if (!['a', 'd', 'arrowleft', 'arrowright'].includes(key) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target.matches?.('select, textarea, input[type="color"], input[type="text"]')) return;
      if (key.startsWith('arrow') && e.target.matches?.('input, [role="tab"]')) return;
      held.add(key); e.preventDefault();
    });
    listen(window, 'keyup', (e) => held.delete(e.key.toLowerCase()));
    listen(window, 'blur', () => held.clear());
    screen.querySelectorAll('[data-turn]').forEach((button) => listen(button, 'click', () => { yaw += button.dataset.turn === 'left' ? -Math.PI / 6 : Math.PI / 6; }));
    function draw(now) {
      if (closed) return;
      const dt = Math.min((now - previous) / 1000, 0.1); previous = now;
      yaw += (((held.has('d') || held.has('arrowright')) ? 1 : 0) - ((held.has('a') || held.has('arrowleft')) ? 1 : 0)) * dt * 1.8;
      if (model) model.root.rotation.y = yaw;
      renderer.render(scene, camera); frameId = requestAnimationFrame(draw);
    }
    function cleanup() {
      closed = true; abort.abort(); clearTimeout(timer); cancelAnimationFrame(frameId); observer.disconnect();
      model?.dispose(); renderer.dispose(); renderer.forceContextLoss(); screen.remove();
    }
    listen(find('.creator-done'), 'click', () => {
      if (busy || selectionProblem(characterClass, picks)) return;
      const spec = CLASSES[characterClass];
      const result = { appearance: { ...appearance }, characterClass, spells: spec.spells ? [...picks] : [], weapons: spec.weapons ? [...picks] : [], bow: spec.bows ? picks[0] : null };
      find('.creator-done').disabled = true;
      find('.creator-validation').textContent = 'Entering the scene…';
      showSceneLoading();
      // Give the loading message a paint before the game builds the world.
      requestAnimationFrame(() => requestAnimationFrame(() => { cleanup(); resolve(result); }));
    });
    validate(); rebuild(); frameId = requestAnimationFrame(draw);
  });
}
