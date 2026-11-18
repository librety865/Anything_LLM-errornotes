import { app, BrowserWindow, dialog, net, protocol, ipcMain, shell } from 'electron';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = resolve(root, 'dist-desktop');
const entry = 'zhixu://workbench/';
const portableRoot = resolve(root) === resolve(process.resourcesPath, 'app')
 ? dirname(process.execPath)
 : root;
const env = {};
for (const name of ['.env', '.env.local', '.env.desktop', '.env.desktop.local']) {
 const file = resolve(root, name);
 if (existsSync(file)) Object.assign(env, parseEnv(readFileSync(file, 'utf8')));
}
const portableConfig = resolve(portableRoot, '.env.local');
if (portableRoot !== root && existsSync(portableConfig)) {
 Object.assign(env, parseEnv(readFileSync(portableConfig, 'utf8')));
}
Object.assign(env, process.env);
const demo = env.VITE_USE_MOCK !== 'false';
function referencedDeveloperKey() {
 const filename = env.ZHIXU_ANYTHINGLLM_KEY_FILE?.trim();
 if (!filename) return '';
 try {
  const local = parseEnv(readFileSync(resolve(portableRoot, filename), 'utf8'));
  return local.VITE_ANYTHINGLLM_API_KEY?.trim() || '';
 } catch {
  return '';
 }
}

const key = env.VITE_ANYTHINGLLM_API_KEY?.trim() || referencedDeveloperKey();
function adminAddress(value) {
 try {
  const address = new URL(value);
  return ['http:', 'https:'].includes(address.protocol) && !address.username && !address.password ? address.origin + '/' : '';
 } catch { return ''; }
}
const adminUrl = adminAddress(env.VITE_ANYTHINGLLM_BASE_URL || 'http://127.0.0.1:3001');
const desktopSettings = {
 adminUrl,
 demo,
 configured: Boolean(key),
 slugs: {
  高考: env.VITE_WORKSPACE_SLUG_GAOKAO || '',
  中考: env.VITE_WORKSPACE_SLUG_ZHONGKAO || '',
  考研: env.VITE_WORKSPACE_SLUG_KAOYAN || '',
  考公: env.VITE_WORKSPACE_SLUG_KAOGONG || '',
 },
};
app.setName('知序错题本');
protocol.registerSchemesAsPrivileged([
 { scheme: 'zhixu', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

function json(error, status) {
 return Response.json({ error }, { status });
}

async function proxy(request, url) {
 const listing = request.method === 'GET' && url.pathname === '/api/v1/workspaces';
 const chat = request.method === 'POST' && /^\/api\/v1\/workspace\/[^/]+\/chat$/.test(url.pathname);
 const settings = request.method === 'GET' && /^\/api\/v1\/workspace\/[^/]+$/.test(url.pathname);
 const update = request.method === 'POST' && /^\/api\/v1\/workspace\/[^/]+\/update$/.test(url.pathname);
 const search = request.method === 'POST' && /^\/api\/v1\/workspace\/[^/]+\/vector-search$/.test(url.pathname);
 if (!listing && !chat && !settings && !update && !search) return json('未知的 AnythingLLM 接口', 404);
 if (demo || !key) return json('请先在本机配置 AnythingLLM Developer API Key，再重启桌面版。', 503);
 try {
  const target = new URL(env.VITE_ANYTHINGLLM_BASE_URL || 'http://127.0.0.1:3001');
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) {
   return json('AnythingLLM 地址配置无效。', 503);
  }
  target.pathname = url.pathname;
  target.search = '';
  const upstream = await fetch(target, {
   method: request.method,
   headers: { Authorization: 'Bearer ' + key, ...(chat || update || search ? { 'Content-Type': 'application/json' } : {}) },
   body: chat || update || search ? await request.text() : undefined,
   redirect: 'error',
   signal: AbortSignal.any([request.signal, AbortSignal.timeout(120000)]),
  });
  const body = (await upstream.text()).split(key).join('[密钥已隐藏]');
  return new Response([204, 205, 304].includes(upstream.status) ? null : body, {
   status: upstream.status,
   headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
 } catch {
  return json('无法连接 AnythingLLM。请确认它已运行，以及本机配置中的地址和端口正确。', 502);
 }
}

async function handle(request) {
 const url = new URL(request.url);
 if (url.hostname !== 'workbench') return json('未知的应用地址', 404);
 if (url.pathname.startsWith('/api/')) return proxy(request, url);
 if (request.method !== 'GET') return json('不支持该请求', 405);
 const pathname = decodeURIComponent(url.pathname);
 const file = resolve(dist, pathname.startsWith('/assets/') ? '.' + pathname : 'index.html');
 const subpath = relative(dist, file);
 if (subpath.startsWith('..') || isAbsolute(subpath)) return json('无效的资源路径', 403);
 return net.fetch(pathToFileURL(file).href);
}

let window;
async function start() {
 if (!existsSync(resolve(dist, 'index.html'))) throw Error('便携包缺少页面文件，请重新构建。');
 protocol.handle('zhixu', handle);

 ipcMain.handle('zhixu:classroom', async (event, address, endpoint, body, token) => {
  if (!event.senderFrame?.url.startsWith(entry) || !['lookup', 'join', 'progress', 'chat', 'knowledge-search'].includes(endpoint)) {
   throw Error('不支持的班级请求');
  }
  const destination = new URL(address);
  if (!['http:', 'https:'].includes(destination.protocol) || destination.username || destination.password) {
   throw Error('班级服务地址无效');
  }
  const timeoutSignal = AbortSignal.timeout(endpoint === 'chat' ? 135000 : 8000);
  try {
   const response = await fetch(destination.origin + '/api/classroom/student/' + endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: JSON.stringify(body),
    redirect: 'error',
    signal: timeoutSignal,
   });
   return { ok: response.ok, data: await response.json() };
  } catch {
   if (endpoint === 'knowledge-search' && timeoutSignal.aborted) {
    return { ok: false, data: { error: '班级检索超时，请稍后重试' } };
   }
   throw Error('无法访问班级服务，请核对服务地址并确认教师电脑可访问');
  }
 });

 window = new BrowserWindow({
  width: 1280,
  height: 840,
  title: '知序错题本',
  autoHideMenuBar: true,
  webPreferences: {
   preload: resolve(root, 'desktop/preload.cjs'),
   additionalArguments: ['--zhixu-settings=' + JSON.stringify(desktopSettings)],
   contextIsolation: true,
   sandbox: true,
   nodeIntegration: false,
  },
 });
 window.webContents.setWindowOpenHandler(({ url }) => {
  if (adminUrl && url === adminUrl) void shell.openExternal(url).catch(() => {});
  return { action: 'deny' };
 });
 window.webContents.on('will-navigate', (event, url) => {
  if (!url.startsWith(entry)) event.preventDefault();
 });
 await window.loadURL(entry);
 const executable = env.ZHIXU_ANYTHINGLLM_EXE;
 if (!demo && executable && isAbsolute(executable) && executable.toLowerCase().endsWith('.exe')) {
  const child = spawn(executable, [], { cwd: dirname(executable), detached: true, stdio: 'ignore' });
  child.on('error', () => dialog.showErrorBox('无法启动 AnythingLLM', '请检查 ZHIXU_ANYTHINGLLM_EXE，或手动打开 AnythingLLM。'));
  child.unref();
 }
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
 app.on('second-instance', () => {
  if (window?.isMinimized()) window.restore();
  window?.focus();
 });
 app.on('window-all-closed', () => app.quit());
 app.whenReady().then(start).catch(error => {
  dialog.showErrorBox('知序桌面版无法启动', error.message);
  app.quit();
 });
}
