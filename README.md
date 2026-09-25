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

## Layout

- `main.js` – Electron main process (creates the window)
- `preload.js` – preload script (bridge between Electron and the page)
- `src/index.html` – the game page
- `src/style.css` – styles
- `src/renderer.js` – game code
- `prompt_log.txt` – log of AI prompts used to build this project
