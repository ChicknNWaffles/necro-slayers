// The game over screen, shown when the player dies: a parchment card over the
// darkened scene, saying so, with a button to try again (which starts over,
// from character creation).
export function showGameOver({ onRetry = () => location.reload() } = {}) {
  if (document.querySelector('#game-over')) return;
  const screen = document.createElement('section');
  screen.id = 'game-over';
  screen.setAttribute('role', 'alertdialog');
  screen.setAttribute('aria-labelledby', 'game-over-title');
  screen.innerHTML = `<div class="game-over-parchment"><div class="game-over-sigil" aria-hidden="true">✝</div>
    <p class="loading-eyebrow">YOUR JOURNEY ENDS HERE</p>
    <h1 id="game-over-title">You died</h1>
    <p class="game-over-message">You fell in the clearing, and the forest has grown quiet.</p>
    <button type="button" class="game-over-retry">Try again</button></div>`;
  document.body.append(screen);
  const retry = screen.querySelector('.game-over-retry');
  retry.addEventListener('click', onRetry);
  retry.focus();
}
