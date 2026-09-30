// The start menu, shown when the game opens: start the game, see the
// controls, or close the game. Resolves when the player chooses to start.
export function showStartMenu() {
  return new Promise((resolve) => {
    const screen = document.createElement('main');
    screen.id = 'start-menu';
    screen.innerHTML = `<div class="start-parchment">
      <div class="loading-sigil" aria-hidden="true">✦</div>
      <p class="loading-eyebrow">A JOURNEY THROUGH THE FOREST</p>
      <h1>${document.title}</h1>
      <nav class="start-buttons" aria-label="Start menu">
        <button type="button" class="menu-button start-game">Start game</button>
        <button type="button" class="menu-button show-controls">Controls</button>
        <button type="button" class="menu-button quiet close-game">Close game</button>
      </nav>
    </div>`;
    document.body.append(screen);
    const start = screen.querySelector('.start-game');
    start.focus();
    start.addEventListener('click', () => { screen.remove(); resolve(); });
    screen.querySelector('.show-controls').addEventListener('click', () => showControls(screen));
    screen.querySelector('.close-game').addEventListener('click', closeGame);
  });
}

// The controls, on a parchment page over the menu, with a way back.
const CONTROLS = [
  ['Moving', [
    ['W A S D or arrow keys', 'Walk (the way the camera faces)'],
    ['Caps Lock', 'Run while it’s on, walk while it’s off'],
    ['Right click', 'Jump'],
    ['Mouse', 'Look around'],
    ['Hold Shift + mouse', 'Swing the camera round you, to look at yourself or behind you'],
    ['Esc', 'Release the mouse (click the game to take it back)'],
  ]],
  ['Fighting', [
    ['1 – 4 or scroll wheel', 'Choose a spell or ability'],
    ['Left click', 'Cast it or attack (hold it to keep a shield raised)'],
    ['Crosshair', 'Aim bows and aimed spells; a crossbow reloads while you stand still'],
  ]],
  ['Your party', [
    ['Z', 'Tell your companions to follow you, or to stay'],
  ]],
];

function showControls(menu) {
  const page = document.createElement('section');
  page.id = 'controls-menu';
  page.setAttribute('aria-labelledby', 'controls-title');
  page.innerHTML = `<div class="start-parchment controls-parchment">
    <h1 id="controls-title">Controls</h1>
    ${CONTROLS.map(([group, rows]) => `<h2>${group}</h2><dl>${rows.map(([keys, what]) => `<dt>${keys}</dt><dd>${what}</dd>`).join('')}</dl>`).join('')}
    <button type="button" class="menu-button back">Back</button>
  </div>`;
  menu.append(page);
  const back = page.querySelector('.back');
  back.focus();
  back.addEventListener('click', () => { page.remove(); menu.querySelector('.show-controls').focus(); });
}

// Closes the game window (and so the game).
export function closeGame() {
  if (window.electronWindow?.quitGame) window.electronWindow.quitGame();
  else window.close();
}
