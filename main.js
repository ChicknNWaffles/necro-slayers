// Electron main process: creates the app window and loads the game page.
const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const path = require('path');

// Capture the mouse for the game. Browsers only allow pointer lock after a
// click; running the request as a user gesture lets the game capture the
// mouse as soon as it opens, without one.
ipcMain.on('capture-mouse', (event) => {
  event.sender
    .executeJavaScript('document.querySelector("canvas")?.requestPointerLock()', true)
    .catch(() => {}); // can fail if the window isn't focused yet; the game retries
});

// Close the game (from its menus).
ipcMain.on('quit-game', () => app.quit());

function createWindow() {
  const win = new BrowserWindow({
    title: 'Necro Slayers',
    icon: path.join(__dirname, 'assets', 'icon.png'), // (a sword and shield -- see assets/icon.svg)
    width: 1280,
    height: 720,
    fullscreen: true,
    backgroundColor: '#ffffff',
    autoHideMenuBar: true, // (a game has no menu bar -- see below)
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.removeMenu();
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
}

// No "File, Edit, View, Window..." menu bar: this is a game, not a utility.
// (Removing the application menu stops Electron adding its default one to
// every window.)
Menu.setApplicationMenu(null);

app.whenReady().then(() => {
  createWindow();

  // macOS: re-create a window when the dock icon is clicked and none are open.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Quit when all windows are closed (except on macOS).
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
