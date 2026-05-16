const { app, BrowserWindow, Notification, ipcMain, shell } = require('electron');
const path = require('path');
const http = require('http');
const { fork } = require('child_process');

const DESKTOP_PORT = process.env.FFR_DESKTOP_PORT || '3152';
let serverProcess = null;
let mainWindow = null;

function appRoot() {
  return app.isPackaged ? app.getAppPath() : path.join(__dirname, '..');
}

function serverEntry() {
  return path.join(appRoot(), 'server', 'index.js');
}

function waitForServer(url, timeoutMs = 30000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() - started > timeoutMs) {
          reject(new Error(`FFR OS server did not start within ${timeoutMs}ms`));
        } else {
          setTimeout(check, 350);
        }
      });
      req.setTimeout(1000, () => {
        req.destroy();
        setTimeout(check, 350);
      });
    };
    check();
  });
}

function startServer() {
  const userData = app.getPath('userData');
  const env = {
    ...process.env,
    PORT: DESKTOP_PORT,
    FFR_DESKTOP: '1',
    DATABASE_PATH: process.env.DATABASE_PATH || path.join(userData, 'maintenance.db'),
    BUSINESS_MEMORY_ROOT: process.env.BUSINESS_MEMORY_ROOT || path.join(userData, 'business-memory'),
    GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI || `http://127.0.0.1:${DESKTOP_PORT}/api/email/accounts/gmail/callback`,
    GOOGLE_CALENDAR_REDIRECT_URI: process.env.GOOGLE_CALENDAR_REDIRECT_URI || `http://127.0.0.1:${DESKTOP_PORT}/api/calendar/google/callback`
  };

  serverProcess = fork(serverEntry(), [], {
    cwd: appRoot(),
    env,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc']
  });

  serverProcess.stdout?.on('data', chunk => console.log(`[server] ${chunk.toString().trim()}`));
  serverProcess.stderr?.on('data', chunk => console.error(`[server] ${chunk.toString().trim()}`));
  serverProcess.on('exit', code => console.log(`[server] exited with code ${code}`));
}

async function createWindow() {
  startServer();
  const startUrl = `http://127.0.0.1:${DESKTOP_PORT}`;
  await waitForServer(startUrl);

  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1080,
    minHeight: 720,
    title: 'FFR Property OS',
    backgroundColor: '#050510',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  await mainWindow.loadURL(startUrl);
}

ipcMain.handle('desktop:notify', async (_event, payload = {}) => {
  if (!Notification.isSupported()) return { supported: false };
  const notification = new Notification({
    title: payload.title || 'FFR Property OS',
    body: payload.body || ''
  });
  notification.show();
  return { supported: true };
});

ipcMain.handle('desktop:open-external', async (_event, url) => {
  if (!url) return { opened: false };
  await shell.openExternal(url);
  return { opened: true };
});

app.whenReady().then(createWindow);

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('before-quit', () => {
  if (serverProcess && !serverProcess.killed) serverProcess.kill();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
