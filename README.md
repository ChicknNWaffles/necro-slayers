# Vibecode 3D Game

A 3D game built with HTML, CSS and JavaScript, run locally as an Electron app.
Made for an AI class assignment; every prompt used is recorded in `prompt_log.txt`.

## Requirements

- [Node.js](https://nodejs.org/) (LTS) with npm

## Run it

```
npm install
npm start
```

## Controls

| Action        | Keys           |
| ------------- | -------------- |
| Move forward  | `W` / `↑`      |
| Move back     | `S` / `↓`      |
| Move left     | `A` / `←`      |
| Move right    | `D` / `→`      |
| Jump          | Right click    |
| Turn / look up and down | Mouse (captured when the game opens) |
| Release the mouse | `Esc` (click the game to capture it again) |
| Orbit camera around the player | Hold `Shift` + move the mouse |

Movement is relative to the direction the camera faces. Letter keys work
regardless of Shift or Caps Lock. Releasing Shift swings the camera back
behind the player.

## Layout

- `main.js` – Electron main process (creates the window)
- `preload.js` – preload script (bridge between Electron and the page; will handle loading save files)
- `src/` – the game itself
  - `index.html` – the game page
  - `style.css` – styles
  - `game.js` – main game script (state, rules, input, game loop)
  - `renderer.js` – 3D renderer only (draws the scene)
- `prompt_log.txt` – log of AI prompts used to build this project
