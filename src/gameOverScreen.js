// The game over screen, shown when the player dies: a parchment card over the
// darkened scene, saying so, with buttons back to the start menu (starting
// the game over) and to close the game.
import { closeGame } from './startMenu.js';

export function showGameOver({ onRestart = () => location.reload() } = {}) {
  if (document.querySelector('#game-over')) return;
  const screen = document.createElement('section');
  screen.id = 'game-over';
  screen.setAttribute('role', 'alertdialog');
  screen.setAttribute('aria-labelledby', 'game-over-title');
  screen.innerHTML = `<div class="game-over-parchment"><div class="game-over-sigil" aria-hidden="true">✝</div>
    <p class="loading-eyebrow">YOUR JOURNEY ENDS HERE</p>
    <h1 id="game-over-title">You died</h1>
    <p class="game-over-message">You fell in the clearing, and the forest has grown quiet.</p>
    <div class="start-buttons">
      <button type="button" class="menu-button back-to-menu">Back to the start menu</button>
      <button type="button" class="menu-button quiet close-game">Close game</button>
    </div></div>`;
  document.body.append(screen);
  const back = screen.querySelector('.back-to-menu');
  back.addEventListener('click', onRestart);
  screen.querySelector('.close-game').addEventListener('click', closeGame);
  back.focus();
}
