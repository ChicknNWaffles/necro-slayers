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

The game opens with character creation. Use the Body, Face, Hair, and Clothing
tabs to customize appearance, hold **A / D** or **Left / Right arrows**
to rotate the preview, then open **Class & abilities**. Clerics and mages choose
four spells; fighters choose sword and shield or a halberd; archers choose one
bow and receive a dagger. **Done — enter the game** unlocks when the selection
is complete. The mouse is captured after entering the scene.

All colors use named preset swatches. Weight changes both width and front-to-back
fullness, including clothing. Five sliders below Weight adjust relative fullness
in the chest/upper back, belly/waist, hips/seat, arms, and legs (1.00 is neutral). An animated bar marks preview updates, and a
parchment loading screen tracks scene preparation before gameplay begins.

| Action        | Keys           |
| ------------- | -------------- |
| Move forward  | `W` / `↑`      |
| Move back     | `S` / `↓`      |
| Move left     | `A` / `←`      |
| Move right    | `D` / `→`      |
| Jump          | Right click    |
| Run           | Turn on `Caps Lock` (turn it off to walk) |
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
  - `characterCreator.js` / `characterCreator.css` – appearance preview and class selection before gameplay
  - `characterClasses.js` – class and weapon choices shared by the creator and game
  - `index.html` – the game page
  - `style.css` – styles
  - `game.js` – main game script (state, rules, input, game loop)
  - `renderer.js` – 3D renderer only (draws the scene)
  - `characterAppearance.js` – the customizable appearance options (data only; used by a future character creator and save files)
  - `characterModel.js` – builds the 3D character from an appearance (part of the renderer)
  - `characterAnimation.js` – procedural walk and run cycles (part of the renderer)
  - `footModel.js` – the stylized feet, blended into the legs (part of the renderer)
  - `headModel.js` – the sculpted head (jaw, eyes and eyelids, nose, lips, ears; part of the renderer)
  - `handModel.js` – the detailed hands (fingers, palm pads, palm lines, nails; part of the renderer)
  - `sculptedSurface.js` – tools for sculpting the body in code (base shapes plus muscles, bones and hollows, melted into one mesh)
- `prompt_log.txt` – log of AI prompts used to build this project

The Clothing tab includes Robes: a smooth split-front robe with a wide sash and wrist-length flowing sleeves.

Top lists short and long sleeved tunics separately, each available with or without a belt, alongside Dress and Robes.

The Hair tab mixes any hairstyle (bob, short, long, ponytail, twintails, braid, man bun) with any bangs (straight, side-swept, fringe, cowlick blowout, or none). Armour can be leather, chainmail (a sleeveless mail shirt worn over everything), or metal plate (chest plate, pauldrons and thigh plates).
