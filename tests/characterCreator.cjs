// Integration checks against the real startup page. Run with Electron.
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const assert = require('assert/strict');
const output = path.resolve(__dirname, '../out/creator-review');
fs.mkdirSync(output, { recursive: true });
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1280, height: 800, webPreferences: { offscreen: true, backgroundThrottling: false } });
  const errors = [];
  win.webContents.on('console-message', (_event, level, message) => { if (level === 3) errors.push(message); });
  const run = (source) => win.webContents.executeJavaScript(source);
  const wait = async (source, timeout = 180000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) { if (await run(source)) return; await new Promise((resolve) => setTimeout(resolve, 150)); }
    throw new Error('Timed out: ' + source + '\n' + errors.join('\n'));
  };
  const click = (selector) => run(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const disabled = () => run(`document.querySelector('.creator-done').disabled`);
  const chooseClass = (id) => click(`input[name="characterClass"][value="${id}"]`);
  const pick = (id) => click(`input[name="loadout"][value="${id}"]`);
  const capture = async (name) => {
    await run(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
    const image = await win.webContents.capturePage(); fs.writeFileSync(path.join(output, name + '.png'), image.toPNG());
  };
  try {
    await win.loadFile(path.resolve(__dirname, '../src/index.html'));
    await wait(`document.querySelector('.creator-render-status')?.textContent === 'Preview ready'`);
    await run(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
    assert(await disabled(), 'Done must initially be disabled');
    assert.equal(await run(`document.querySelectorAll('input[type="color"]').length`), 0, 'All colors use presets');
    assert.equal(await run(`document.querySelectorAll('.creator-palette').length`), 7, 'Every color has swatches');
    assert.equal(await run(`document.querySelectorAll('[data-option]').length`), 25, 'Every appearance control must exist');
    assert.equal(await run(`document.querySelector('#hud') !== null`), false, 'No game HUD before finishing');
    assert.equal(await run(`document.pointerLockElement !== null`), false, 'Creator must not capture mouse');
    await capture('appearance');
    assert.equal(await run(`document.querySelectorAll('[role="tab"]').length`), 4);
    for (const name of ['Face', 'Hair', 'Clothing', 'Body']) {
      await click('[data-category="'+name+'"]');
      assert.equal(await run(`Array.from(document.querySelectorAll('[data-category-panel]')).filter(n => !n.hidden).map(n => n.dataset.categoryPanel).join(',')`), name);
    }
    const arrowBefore = (await win.webContents.capturePage()).toPNG();
    await run(`window.dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowLeft'}))`);
    await new Promise(r=>setTimeout(r,450));
    await run(`window.dispatchEvent(new KeyboardEvent('keyup', {key:'ArrowLeft'}))`);
    assert(!arrowBefore.equals((await win.webContents.capturePage()).toPNG()), 'Left arrow rotates preview');
    await run(`window.dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowRight'}))`);
    await new Promise(r=>setTimeout(r,450));
    await run(`window.dispatchEvent(new KeyboardEvent('keyup', {key:'ArrowRight'}))`);
    const before = (await win.webContents.capturePage()).toPNG();
    await run(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'A' }))`);
    await new Promise((resolve) => setTimeout(resolve, 450));
    await run(`window.dispatchEvent(new KeyboardEvent('keyup', { key: 'A' }))`);
    assert(!before.equals((await win.webContents.capturePage()).toPNG()), 'A rotates the preview');
    await run(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'D' }))`);
    await new Promise((resolve) => setTimeout(resolve, 450));
    await run(`window.dispatchEvent(new KeyboardEvent('keyup', { key: 'D' }))`);
    await click('[data-category="Hair"]');
    await run(`const input = document.querySelector('#appearance-hairColor'); input.value = '#6e3226'; input.dispatchEvent(new Event('change'))`);
    assert(await run(`!document.querySelector('.preview-loading').hidden`), 'Preview change shows loading bar');
    await wait(`document.querySelector('.creator-render-status').textContent === 'Preview ready'`);
    assert(await run(`document.querySelector('.preview-loading').hidden`), 'Ready preview hides loading bar');
    assert.equal(await run(`document.querySelector('#appearance-hairColor').value`), '#6e3226');
    // Bangs are their own option: changing the hairstyle keeps the chosen bangs.
    await run(`{ const input = document.querySelector('#appearance-bangs'); input.value = 'sideSwept'; input.dispatchEvent(new Event('change')) }`);
    await wait(`document.querySelector('.creator-render-status').textContent === 'Preview ready'`);
    await run(`{ const input = document.querySelector('#appearance-hairStyle'); input.value = 'ponytail'; input.dispatchEvent(new Event('change')) }`);
    await wait(`document.querySelector('.creator-render-status').textContent === 'Preview ready'`);
    assert.equal(await run(`document.querySelector('#appearance-bangs').value`), 'sideSwept', 'Bangs mix with any hairstyle');
    await click('[data-category="Clothing"]');
    assert.equal(await run(`document.querySelectorAll('#appearance-tunicSleeves, #appearance-tunicBelt').length`), 0);
    assert.deepEqual(await run(`Array.from(document.querySelector('#appearance-outfit').options, n=>n.textContent)`), ['Short sleeved tunic','Short sleeved tunic with belt','Long sleeved tunic','Long sleeved tunic with belt','Dress','Robes']);
    await run(`const outfit = document.querySelector('#appearance-outfit'); outfit.value = 'robes'; outfit.dispatchEvent(new Event('change'))`);
    await wait(`document.querySelector('.creator-render-status').textContent === 'Preview ready'`);
    assert.equal(await run(`document.querySelector('#appearance-outfit').value`), 'robes');
    await capture('robes-creator');
    await click('[data-page="class"]');
    await chooseClass('fighter');
    const focusedBefore = (await win.webContents.capturePage()).toPNG();
    await run(`const radio = document.querySelector('input[value="fighter"]'); radio.focus(); radio.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true }))`);
    await new Promise((resolve) => setTimeout(resolve, 450));
    await run(`window.dispatchEvent(new KeyboardEvent('keyup', { key: 'd' }))`);
    assert(!focusedBefore.equals((await win.webContents.capturePage()).toPNG()), 'Rotation remains available after choosing a class');
    for (const [id, spells] of [
      ['cleric', ['smite', 'divineBlade', 'divineRestoration', 'shieldOfFaith']],
      ['mage', ['fireball', 'vineTrap', 'powerShove', 'wallOfEarth']],
    ]) {
      await chooseClass(id); assert(await disabled());
      assert.equal(await run(`document.querySelectorAll('input[name="loadout"]').length`), 6);
      for (const spell of spells.slice(0, 3)) await pick(spell);
      assert(await disabled(), 'Three spells cannot finish');
      await pick(spells[3]); assert(!(await disabled()), 'Four spells can finish');
      assert.equal(await run(`document.querySelectorAll('input[name="loadout"]:disabled').length`), 2);
      await pick(spells[3]); assert(await disabled(), 'Removing a spell disables Done');
    }
    assert.equal(await run(`document.querySelector('input[value="smite"]') !== null`), false, 'Old class options removed');
    await chooseClass('fighter'); await pick('sword'); assert(await disabled());
    await pick('shield'); assert(!(await disabled()));
    await pick('halberd'); assert(!(await disabled()));
    assert.deepEqual(await run(`Array.from(document.querySelectorAll('input[name="loadout"]:checked'), n => n.value)`), ['halberd']);
    await pick('sword'); assert(await disabled());
    await chooseClass('archer'); assert(await disabled());
    for (const bow of ['shortbow', 'longbow', 'crossbow']) { await pick(bow); assert(!(await disabled())); }
    await chooseClass('mage'); assert(await disabled(), 'Class changes clear prior loadout');
    for (const spell of ['fireball', 'vineTrap', 'leachBomb', 'burningGround']) await pick(spell);
    await click('[data-page="appearance"]');
    assert.equal(await run(`document.querySelector('#appearance-hairColor').value`), '#6e3226', 'Appearance survives page changes');
    await click('[data-page="class"]');
    await capture('class-selection');
    await click('.creator-done');
    await wait(`Boolean(document.querySelector('#scene-loading'))`);
    await capture('loading-screen');
    await wait(`!document.querySelector('#character-creator') && !document.querySelector('#scene-loading') && Boolean(document.querySelector('#hud'))`, 300000);
    await wait(`document.querySelector('.spell-bar')?.textContent.includes('Fireball')`);
    const hud = await run(`document.querySelector('.spell-bar').textContent`);
    for (const name of ['Fireball', 'Vine Trap', 'Leach Bomb', 'Burning Ground']) assert(hud.includes(name), 'Selected spell in gameplay: ' + name);
    assert.equal(await run(`document.querySelectorAll('body > canvas').length`), 1, 'Only the game canvas remains outside the HUD');
    await capture('gameplay');
    const meaningful = errors.filter((e) => !/WebGL: CONTEXT_LOST|GPU stall|Automatic fallback/.test(e));
    assert.deepEqual(meaningful, [], 'No runtime errors');
    console.log('PASS: appearance controls, preview rotation/editing, all class selection rules, class switching, and real gameplay handoff.');
    app.exit(0);
  } catch (error) { console.error(error.stack); console.error(errors.join('\n')); app.exit(1); }
});
