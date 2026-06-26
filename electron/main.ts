import { app, BrowserWindow, shell } from 'electron';
import path from 'node:path';
import { autoCancelStaleOpenBills, backupDatabase, getDb } from './db';
import { registerIpc } from './ipc';
import { startCloudScheduler } from './sync';
import { registerUpdater, checkForUpdatesOnLaunch } from './updater';

const isDev = !!process.env.VITE_DEV_SERVER_URL;
let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: '#fafaf9',
    title: 'Girr Kathiyawadi Tables',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.setMenuBarVisibility(false);

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // In-app updates: forward autoUpdater events to this window + register IPC.
  registerUpdater(() => mainWindow);
}

app.whenReady().then(() => {
  // Initialize DB before any IPC handler runs.
  getDb();
  registerIpc();
  createWindow();

  // End-of-day cleanup: cancel bills left open from previous days, now and
  // hourly (so an always-on machine clears them after midnight too).
  autoCancelStaleOpenBills(getDb());
  setInterval(() => autoCancelStaleOpenBills(getDb()), 60 * 60 * 1000);

  // Local safety backup of the SQLite file — at launch and once a day.
  backupDatabase().catch((e) => console.error('DB backup failed:', e));
  setInterval(() => backupDatabase().catch((e) => console.error('DB backup failed:', e)), 24 * 60 * 60 * 1000);

  // Background cloud backup: pushes any pending bills/pre-orders on a heartbeat
  // (and shortly after each mutation) when cloud sync is enabled in Settings.
  startCloudScheduler();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  if (!isDev) {
    checkForUpdatesOnLaunch();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
