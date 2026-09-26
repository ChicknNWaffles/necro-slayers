// Preload script: runs before the page loads, with contextIsolation enabled.
// Exposes the few Electron features the game needs to the page via contextBridge.
// (Save-file loading will be added here later.)
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronWindow', {
  // Ask the main process to capture the mouse for the game (see main.js).
  captureMouse: () => ipcRenderer.send('capture-mouse'),
});
