// Yield long startup stages so their status can be painted before work begins.
export function nextPaint() {
  return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
}

export function showSceneLoading() {
  if (document.querySelector('#scene-loading')) return;
  const screen = document.createElement('section');
  screen.id = 'scene-loading';
  screen.setAttribute('aria-label', 'Loading the game');
  screen.innerHTML = `<div class="loading-parchment"><div class="loading-sigil" aria-hidden="true">✦</div>
    <p class="loading-eyebrow">THE ROAD AWAITS</p><h1>Preparing your adventure</h1>
    <p class="loading-message" role="status">Gathering your companions…</p>
    <progress max="100" value="0" aria-label="Loading the scene"></progress>
    <p class="loading-tip">Every adventure begins with a single step.</p></div>`;
  document.body.append(screen);
}

export async function sceneLoadingStep(message, percent) {
  showSceneLoading();
  const screen = document.querySelector('#scene-loading');
  screen.querySelector('.loading-message').textContent = message;
  screen.querySelector('progress').value = percent;
  await nextPaint();
}

export function hideSceneLoading() { document.querySelector('#scene-loading')?.remove(); }
