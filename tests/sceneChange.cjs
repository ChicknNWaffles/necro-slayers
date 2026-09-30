// Walks down a path into a new clearing, checking that the next clearing's
// enemies were built in the background, the change is quick, and a loading
// screen covers it when they aren't ready yet. Run with Electron.
const { app, BrowserWindow } = require('electron');
const path = require('path'), fs = require('fs'), assert = require('assert/strict');
const output = path.resolve(__dirname, '../out/scene-review');
fs.mkdirSync(output, { recursive: true });
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1280, height: 800, webPreferences: { offscreen: true, backgroundThrottling: false } });
  const errors = [];
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 2 && !/Security|GPU stall|Automatic fallback/.test(message)) errors.push(message); });
  const run = (source) => win.webContents.executeJavaScript(source);
  const wait = async (source, timeout = 240000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) { if (await run(source)) return; await new Promise((r) => setTimeout(r, 100)); }
    throw new Error('Timed out: ' + source + '\n' + errors.join('\n'));
  };
  const capture = async (name) => fs.writeFileSync(path.join(output, name + '.png'), (await win.webContents.capturePage()).toPNG());
  // Puts the player well down a path (as if they'd walked there).
  const walkDownPath = () => run(`{ const g = window.gameDebug, p = g.clearing.paths[1].points; Object.assign(g.player.position, { x: p[p.length - 4].x, z: p[p.length - 4].z }); }`);
  const enemies = () => run(`window.gameDebug.NPCS.filter((n) => n.role === 'enemy').length`);
  try {
    await win.loadFile(path.resolve(__dirname, '../src/index.html'), { query: { debug: '1' } });
    await wait(`document.querySelector('.creator-render-status')?.textContent === 'Preview ready'`);
    await run(`document.querySelector('input[name="characterClass"][value="mage"]').click()`);
    for (const spell of ['fireball', 'vineTrap', 'powerShove', 'wallOfEarth']) await run(`document.querySelector('input[name="loadout"][value="${spell}"]').click()`);
    await run(`document.querySelector('.creator-done').click()`);
    await wait(`Boolean(window.gameDebug) && !document.querySelector('#scene-loading') && Boolean(document.querySelector('#hud'))`);
    // (Standing about for a while: the test's player mustn't be killed meanwhile.)
    await run(`Object.assign(window.gameDebug.player, { health: 1e9, maxHealth: 1e9 }); true`);
    const firstEnemies = await enemies();
    assert(firstEnemies >= 5 && firstEnemies <= 8, 'Between 5 and 8 enemies: ' + firstEnemies);

    // The next clearing's enemies are built in the background, meanwhile.
    const started = Date.now();
    await wait(`window.gameDebug.nextScene.built === window.gameDebug.nextScene.enemies.length`);
    console.log(`Background build of ${await run('window.gameDebug.nextScene.enemies.length')} enemies: ${Date.now() - started} ms`);
    const oldTrees = await run(`JSON.stringify(window.gameDebug.clearing.trees.slice(0, 3))`);

    // Evalyn has fallen: she's left behind.
    await run(`{ const e = window.gameDebug.NPCS.find((n) => n.name === 'Evalyn'); e.health = 0; e.dead = true; true }`);
    assert.equal(await run(`document.querySelectorAll('#hud .member').length`), 3, 'Three in the party to start with');

    // Down the path: a quick change, with no loading screen.
    const before = Date.now();
    await walkDownPath();
    await wait(`window.gameDebug.changingScene`, 5000);
    let sawLoading = false;
    while (await run('window.gameDebug.changingScene')) { sawLoading ||= await run(`Boolean(document.querySelector('#scene-loading'))`); await new Promise((r) => setTimeout(r, 50)); }
    const took = Date.now() - before;
    console.log(`Scene change with enemies ready: ${took} ms (loading screen: ${sawLoading})`);
    assert(!sawLoading, 'No loading screen when the enemies are ready');
    assert(took < 4000, 'Quick scene change: ' + took);
    assert.notEqual(await run(`JSON.stringify(window.gameDebug.clearing.trees.slice(0, 3))`), oldTrees, 'A new clearing');
    const secondEnemies = await enemies();
    assert(secondEnemies >= 5 && secondEnemies <= 8, 'New enemies: ' + secondEnemies);
    assert(await run(`window.gameDebug.NPCS.filter((n) => n.role === 'enemy').every((n) => !n.dead && n.health === n.maxHealth)`), 'Fresh enemies');
    assert(await run(`{ const g = window.gameDebug; g.clearing.isWalkable(g.player.position.x, g.player.position.z) }`), 'Arrived somewhere walkable');
    assert.equal(await run(`window.gameDebug.NPCS.some((n) => n.name === 'Evalyn')`), false, 'The dead stay behind');
    assert.equal(await run(`document.querySelectorAll('#hud .member').length`), 2, 'Their health bar goes too');
    assert(await run(`{ const g = window.gameDebug; g.NPCS.filter((n) => n.follows).every((n) => Math.hypot(n.position.x - g.player.position.x, n.position.z - g.player.position.z) < 2.5) }`), 'The party arrives together');
    await new Promise((r) => setTimeout(r, 800));
    await capture('arrived');

    // Straight off again, before the next enemies can be ready: a loading screen.
    await walkDownPath();
    await wait(`Boolean(document.querySelector('#scene-loading'))`, 8000);
    await capture('loading');
    assert.equal(await enemies(), 0, 'While loading, the party is out of the old clearing and not yet in the new one');
    await wait(`!window.gameDebug.changingScene`);
    assert.equal(await run(`Boolean(document.querySelector('#scene-loading'))`), false, 'Loading screen gone afterwards');
    const thirdEnemies = await enemies();
    assert(thirdEnemies >= 5 && thirdEnemies <= 8, 'Third clearing enemies: ' + thirdEnemies);
    assert.deepEqual(errors, [], 'No errors or warnings');
    console.log('PASS: paths lead to new clearings with new enemies, built in the background; a loading screen covers it when they are not ready yet');
    app.exit(0);
  } catch (error) { console.error(error.stack); console.error(errors.join('\n')); app.exit(1); }
});
