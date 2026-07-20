import { app, BrowserWindow, shell } from 'electron';
import path from 'node:path';
import { autoCancelStaleOpenBills, backupDatabase, getDb } from './db';
import { restoreSession } from './auth';
import { registerIpc } from './ipc';
import { startCloudScheduler, cloudEnabled, pullAndMerge } from './sync';
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
  // Restore the last signed-in user so the app reopens into their session
  // (persistent login) rather than the login screen every launch.
  restoreSession(getDb());
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

  // One-shot merge-pull a little after boot: additively bring down any cloud
  // rows this PC is missing (imported old history, other devices) so the app
  // shows the full shared dataset. Never deletes local rows; runs once per
  // launch to keep read egress low.
  if (cloudEnabled()) {
    setTimeout(() => {
      pullAndMerge()
        .then((r) => {
          if (r.ok) {
            const added = Object.values(r.counts ?? {}).reduce((s, n) => s + n, 0);
            if (added > 0) console.log(`Cloud merge-pull added ${added} row(s).`);
          } else {
            console.error('Cloud merge-pull failed:', r.error);
          }
        })
        .catch((e) => console.error('Cloud merge-pull error:', e));
    }, 12000);
  }

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
