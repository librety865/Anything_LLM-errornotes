import { promptDeveloperKey, saveDeveloperKey } from './model-config.mjs';
import { app, BrowserWindow, dialog, ipcMain, shell, utilityProcess } from 'electron';
import { fileURLToPath } from 'node:url';
import { extname, resolve, sep } from 'node:path';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';

const title = '知序 · 教师端（副本）';
const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const serviceEntry = fileURLToPath(new URL('../classroom-server.mjs', import.meta.url));
const portableDir = resolve(projectRoot) === resolve(process.resourcesPath, 'app')
  ? resolve(process.resourcesPath, '..') : undefined;

let teacherWindow;
let serviceProcess;
let quitting = false;

function startClassroom() {
  const child = utilityProcess.fork(serviceEntry, [], {
    cwd: projectRoot,
    env: portableDir ? { ...process.env, ZHIXU_CLASSROOM_PORTABLE_DIR: portableDir } : process.env,
    serviceName: 'Zhixu Teacher Classroom',
  });
  serviceProcess = child;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => complete(new Error('等待班级服务启动超时，请查看启动窗口。')), 15000);
    function complete(error, ready) {
      clearTimeout(timeout);
      child.off('message', onMessage);
      child.off('exit', onExit);
      if (error) reject(error);
      else resolve(ready);
    }
    function onMessage(message) {
      if (message?.type === 'classroom-error') complete(new Error(message.message));
      if (message?.type === 'classroom-ready') complete(null, message);
    }
    function onExit(code) {
      complete(new Error('班级服务启动时退出（' + code + '），请查看启动窗口。'));
    }
    child.on('message', onMessage);
    child.once('exit', onExit);
  });
}

function serveDesktopPages(session, origin) {
  const dist = resolve(projectRoot, 'dist');
  const contentTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.css': 'text/css',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.woff2': 'font/woff2',
    '.json': 'application/json',
  };
  session.protocol.handle('http', async request => {
    const url = new URL(request.url);
    if (url.origin !== origin) return new Response(null, { status: 403 });
    if (url.pathname.startsWith('/api/')) {
      return session.fetch(request, { bypassCustomProtocolHandlers: true });
    }
    if (request.method !== 'GET') return new Response(null, { status: 405 });

    const pathname = decodeURIComponent(url.pathname);
    const file = pathname === '/' ? resolve(dist, 'index.html') : resolve(dist, '.' + pathname);
    const type = contentTypes[extname(file)];
    if (!file.startsWith(dist + sep) || !type) return new Response(null, { status: 404 });
    try {
      return new Response(await readFile(file), {
        headers: { 'Content-Type': type, 'Cache-Control': 'no-store' },
      });
    } catch {
      return new Response(null, { status: 404 });
    }
  });
}

async function openTeacherWindow() {
  const { address, code, reused, adminUrl } = await startClassroom();
  const entry = new URL('/#/classroom', address);
  if (entry.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(entry.hostname)) {
    throw new Error('班级服务返回了无效的本机地址。');
  }
  if (code) entry.hash = '/classroom?' + new URLSearchParams({ login: code });
  if (reused) {
    // The desktop owns only the short-lived probe, never the running service.
    serviceProcess.kill();
    serviceProcess = undefined;
  } else {
    serviceProcess.once('exit', () => {
      if (quitting) return;
      dialog.showErrorBox(title, '班级服务已经停止。请重新打开教师端桌面版。');
      app.quit();
    });
  }

  const window = new BrowserWindow({
    width: 1280, height: 850, minWidth: 740, minHeight: 520,
    show: false, title,
    webPreferences: {
      preload: resolve(projectRoot, 'desktop/preload.cjs'),
      sandbox: true, contextIsolation: true, nodeIntegration: false,
    },
  });
  teacherWindow = window;
  window.setMenuBarVisibility(false);
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (adminUrl && url === adminUrl) void shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });
  function blockOutside(event, target) {
    if (new URL(target).origin !== entry.origin) event.preventDefault();
  }
  window.webContents.on('will-navigate', blockOutside);
  window.webContents.on('will-redirect', blockOutside);
  window.on('closed', () => { teacherWindow = undefined; });
  let configuring = false;
  const configurationLifetime = new AbortController();
  ipcMain.handle('zhixu:configure-developer-key', async event => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame
      || new URL(event.senderFrame.url).origin !== entry.origin || configuring) return;
    configuring = true;
    try {
      const value = await promptDeveloperKey(configurationLifetime.signal);
      if (value === null || window.isDestroyed()) return;
      await saveDeveloperKey(resolve(portableDir ?? projectRoot, '.env.classroom.local'), value);
      if (reused) {
        await dialog.showMessageBox(window, {
          type: 'info',
          title: 'Key 已保存',
          message: '请先退出之前单独启动的班级服务，再重新打开教师端桌面版。',
        });
        return;
      }
      const choice = await dialog.showMessageBox(window, {
        type: 'info',
        title: 'Key 已保存',
        message: '重启教师端后启用新 Key。',
        buttons: ['立即重启', '稍后重启'],
        defaultId: 0,
        cancelId: 1,
      });
      if (choice.response === 0) {
        app.relaunch();
        app.quit();
      }
    } catch (error) {
      if (!window.isDestroyed()) await dialog.showMessageBox(window, {
        type: 'error', title: '配置 Key 失败',
        message: error instanceof Error ? error.message : '请重试',
      });
    } finally {
      configuring = false;
    }
  });
  window.once('closed', () => {
    configurationLifetime.abort();
    ipcMain.removeHandler('zhixu:configure-developer-key');
  });
  serveDesktopPages(window.webContents.session, entry.origin);
  await window.loadURL(entry.href);
  window.show();
}

if (!app.commandLine.hasSwitch('user-data-dir')) {
  const profile = app.getPath('userData') + ' Copy';
  mkdirSync(profile, { recursive: true });
  app.setPath('userData', profile);
}
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!teacherWindow) return;
    if (teacherWindow.isMinimized()) teacherWindow.restore();
    teacherWindow.focus();
  });
  app.on('before-quit', () => {
    quitting = true;
    serviceProcess?.kill();
  });
  app.on('window-all-closed', () => app.quit());
  app.whenReady().then(openTeacherWindow).catch(error => {
    if (!quitting) dialog.showErrorBox(title, error instanceof Error ? error.message : '教师端桌面版启动失败。');
    app.quit();
  });
}
