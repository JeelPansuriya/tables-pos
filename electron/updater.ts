import { app, ipcMain, BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';

/**
 * In-app auto-update (GitHub Releases provider — configured in package.json
 * `build.publish`). Visible to every signed-in user (manager + admin): the
 * header pill checks for updates, shows download progress, and offers a
 * "Restart to update" action once a new version is downloaded.
 *
 * Flow: autoDownload is on, so when a newer release exists it downloads in the
 * background and we emit `update:event` frames to the renderer. The renderer
 * triggers `update:install` (quitAndInstall) when the user clicks restart.
 *
 * In development there is no published feed, so `checkForUpdates` rejects — we
 * swallow that and report it as a normal "couldn't check" state.
 */
let wired = false;

export function registerUpdater(getWindow: () => BrowserWindow | null) {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  const send = (payload: unknown) => {
    const w = getWindow();
    if (w && !w.isDestroyed()) w.webContents.send('update:event', payload);
  };

  if (wired) return;
  wired = true;

  autoUpdater.on('checking-for-update', () => send({ type: 'checking' }));
  autoUpdater.on('update-available', (info) => send({ type: 'available', version: info?.version }));
  autoUpdater.on('update-not-available', () => send({ type: 'none' }));
  autoUpdater.on('error', (err) =>
    send({ type: 'error', message: String((err as any)?.message ?? err) })
  );
  autoUpdater.on('download-progress', (p) =>
    send({ type: 'progress', percent: Math.round(p?.percent ?? 0) })
  );
  autoUpdater.on('update-downloaded', (info) => send({ type: 'downloaded', version: info?.version }));

  ipcMain.handle('update:status', () => ({ ok: true, version: app.getVersion() }));

  ipcMain.handle('update:check', async () => {
    try {
      const r = await autoUpdater.checkForUpdates();
      return { ok: true, version: app.getVersion(), updateVersion: r?.updateInfo?.version ?? null };
    } catch (e: any) {
      return { ok: false, error: String(e?.message ?? e), version: app.getVersion() };
    }
  });

  ipcMain.handle('update:install', () => {
    // Defer so the IPC reply is sent before the app starts quitting.
    setImmediate(() => autoUpdater.quitAndInstall());
    return { ok: true };
  });
}

/** Silent check shortly after launch (production only). */
export function checkForUpdatesOnLaunch() {
  autoUpdater.checkForUpdates().catch(() => {
    /* no published feed / offline — ignore */
  });
}
