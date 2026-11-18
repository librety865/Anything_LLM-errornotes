import { prepareLibraryUpload } from './classroom-image-ocr.mjs';
import { prepareLegacyPowerPoint } from './classroom-ppt.mjs';
import { generateTeachingCards, readCollectedText } from './classroom-cards.mjs';
import { createClassroomLibrary, documentFileLimit, documentPath, libraryUpstreamError, readDocumentUpload } from './classroom-library.mjs';
import { createServer } from 'node:http';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { basename, dirname, resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import { spawn } from 'node:child_process';
import { parseEnv } from 'node:util';
import { openClassroomStore } from './classroom-store.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const portableDir = process.env.ZHIXU_CLASSROOM_PORTABLE_DIR;
function findProjectDir() {
  if (!portableDir) return root;
  const parentDir = dirname(portableDir);
  const siblingProject = basename(parentDir) === '桌面版'
    ? resolve(parentDir, '../教师端') : parentDir;
  return [siblingProject, parentDir].find(dir => existsSync(resolve(dir, 'classroom-store.mjs'))) ?? portableDir;
}
const projectDir = findProjectDir();
function settings(file) {
  return existsSync(file) ? parseEnv(readFileSync(file, 'utf8')) : {};
}

const modelEnv = {
  ...settings(resolve(projectDir, '../mistake-workbench/.env.local')),
  ...settings(resolve(projectDir, '.env.classroom.local')),
  ...(portableDir && portableDir !== projectDir ? settings(resolve(portableDir, '.env.classroom.local')) : {}),
  ...process.env,
};
function referencedModelKey() {
  const filename = modelEnv.CLASSROOM_ANYTHINGLLM_KEY_FILE?.trim();
  if (!filename) return '';
  try {
    const local = settings(resolve(projectDir, filename));
    return local.CLASSROOM_ANYTHINGLLM_API_KEY?.trim() || local.VITE_ANYTHINGLLM_API_KEY?.trim() || '';
  } catch {
    return '';
  }
}

const modelKey = modelEnv.CLASSROOM_ANYTHINGLLM_API_KEY?.trim()
  || modelEnv.VITE_ANYTHINGLLM_API_KEY?.trim()
  || referencedModelKey();
const modelAddress = modelEnv.CLASSROOM_ANYTHINGLLM_BASE_URL || modelEnv.VITE_ANYTHINGLLM_BASE_URL || 'http://127.0.0.1:3001';

function adminAddress(value) {
 try {
  const address = new URL(value);
  return ['http:', 'https:'].includes(address.protocol) && !address.username && !address.password ? address.origin + '/' : '';
 } catch { return ''; }
}
const adminUrl = adminAddress(modelAddress);

async function modelRequest(path, payload, timeout = 8000, libraryOptions) {
  if (!modelKey) fail(503, '教师电脑尚未配置 AnythingLLM Developer API Key');
  let response;
  const timeoutSignal = AbortSignal.timeout(timeout);
  try {
    const target = new URL(path, modelAddress);
    if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) {
      fail(503, '教师端 AnythingLLM 地址无效');
    }
    response = await fetch(target, {
      method: payload ? 'POST' : 'GET',
      headers: { Authorization: 'Bearer ' + modelKey, ...(payload ? { 'Content-Type': 'application/json' } : {}) },
      body: payload ? JSON.stringify(payload) : undefined,
      redirect: 'error',
      signal: timeoutSignal,
    });
  } catch (error) {
    if (error.status) throw error;
    if (libraryOptions) {
      if (timeoutSignal.aborted) fail(504, libraryOptions.search ? '检索超时，请重试' : '连接 AnythingLLM 超时，请稍后重试');
      if (libraryOptions.search) fail(502, '无法连接 AnythingLLM，请确认它已启动');
      fail(502, '无法连接 AnythingLLM，请确认它已启动后重试');
    }
    fail(502, '无法访问教师电脑的 AnythingLLM，请检查服务是否运行及连接地址');
  }
  if (libraryOptions) {
    if (response.status === 404 && libraryOptions.allowMissing) {
      await response.body?.cancel();
      return null;
    }
    let raw;
    try { raw = await response.text(); }
    catch (error) {
      if (timeoutSignal.aborted) fail(504, libraryOptions.search ? '检索超时，请重试' : '读取 AnythingLLM 响应超时，请重试');
      fail(502, '无法读取 AnythingLLM 响应，请重试');
    }
    if (!response.ok) libraryUpstreamError(response.status, raw, modelKey);
    try { return JSON.parse(raw.split(modelKey).join('[密钥已隐藏]')); }
    catch { fail(502, '无法读取 AnythingLLM 响应，请重试'); }
  }
  if (!response.ok) fail(502, '教师端 AnythingLLM 返回 HTTP ' + response.status);
  try { return await response.json(); }
  catch { fail(502, '教师端 AnythingLLM 响应无法读取'); }
}

async function modelWorkspaces() {
  const result = await modelRequest('/api/v1/workspaces');
  if (!Array.isArray(result?.workspaces)) fail(502, '无法读取 AnythingLLM 工作区列表');
  return result.workspaces.filter(item => item && typeof item.slug === 'string' && typeof item.name === 'string')
    .map(({ slug, name }) => ({ slug, name }));
}

const library = createClassroomLibrary({ modelRequest, key: modelKey, address: modelAddress });
const libraryRoutes = new Map([
  ['teacher/documents', 'GET'],
  ['teacher/documents/accepted-file-types', 'GET'],
  ['teacher/documents/upload', 'POST'],
  ['teacher/documents/mount', 'POST'],
  ['teacher/documents/pin', 'POST'],
  ['teacher/documents/preview', 'POST'],
  ['teacher/documents/cards', 'POST'],
  ['teacher/documents/cards/mount', 'POST'],
]);

const modelHost = adminUrl ? new URL(adminUrl).hostname : '';
const documentsDirectory = modelEnv.CLASSROOM_ANYTHINGLLM_DOCUMENTS_DIR?.trim()
  || (['127.0.0.1', 'localhost', '[::1]'].includes(modelHost) && process.env.APPDATA
    ? resolve(process.env.APPDATA, 'anythingllm-desktop', 'storage', 'documents') : '');
let generatingCards = false;
const activeChats = new Set();
const studentSearchAt = new Map();
 
const store = openClassroomStore(projectDir, { directory: modelEnv.CLASSROOM_DATA_DIR });
const dist = resolve(root, 'dist');
let port = Number(modelEnv.CLASSROOM_PORT || 5180);
const host = process.env.CLASSROOM_HOST || '0.0.0.0';
const token = () => randomBytes(24).toString('hex');
let data = store.data;

function save(next) {
  store.save(next);
  data = next;
}
const classroomApiVersion = 4;
const instanceId = createHash('sha256').update('zhixu-classroom:' + data.teacherKey).digest('hex');

function reply(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}
function fail(status, message) {
  throw Object.assign(new Error(message), { status });
}
function field(value, label, limit) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > limit) fail(400, label + '无效');
  return value.trim();
}
async function body(req, limit = 8192) {
  if (!req.headers['content-type']?.startsWith('application/json')) fail(415, '需要 JSON 请求');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) fail(413, '请求过大');
    chunks.push(chunk);
  }
  const content = Buffer.concat(chunks).toString('utf8');
  try {
    const value = JSON.parse(content);
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  } catch {}
  fail(400, '请求格式错误');
}

function classroomInvitation(classroom, localOnly = false) {
  const bound = server.address();
  if (localOnly) {
    const loopback = {
      '0.0.0.0': '127.0.0.1', '127.0.0.1': '127.0.0.1', '::': '[::1]', '::1': '[::1]',
    }[bound.address];
    if (!loopback) fail(400, '班级服务未监听本机回环地址，请改用局域网邀请码。');
    return encodeInvitation(classroom, ['http://' + loopback + ':' + bound.port]);
  }
  const addresses = bound.address === '0.0.0.0' || bound.address === '::'
    ? Object.values(networkInterfaces()).flat()
      .filter(item => item?.family === 'IPv4' && !item.internal)
      .map(item => item.address)
    : [bound.address];
  const origins = [...new Set(addresses)].slice(0, 11).map(address =>
    new URL('http://' + (address.includes(':') ? '[' + address + ']' : address) + ':' + bound.port).origin
  );
  if (bound.address === '0.0.0.0') origins.push(new URL('http://127.0.0.1:' + bound.port).origin);
  return encodeInvitation(classroom, origins);
}

function encodeInvitation(classroom, origins) {
  const payload = { classId: classroom.id, code: classroom.code, origins };
  return 'ZX1-' + Buffer.from(JSON.stringify(payload)).toString('base64url');
}

const localLogins = new Map();

function issueLocalLogin() {
  const now = Date.now();
  for (const [code, expires] of localLogins) if (expires <= now) localLogins.delete(code);
  if (localLogins.size >= 50) localLogins.delete(localLogins.keys().next().value);
  const code = token();
  localLogins.set(code, now + 120000);
  return code;
}

function requireLocalRequest(req) {
  const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
  const host = req.headers.host || '';
  const validHost = /^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i.test(host);
  if (!local || !validHost || (req.headers.origin && req.headers.origin !== 'http://' + host)) {
    fail(403, '只能在教师电脑本机自动登录');
  }
}

async function route(req, res) {
  const { pathname, searchParams } = new URL(req.url, 'http://localhost');
  if (pathname === '/api/classroom/health' && req.method === 'GET') {
    const address = req.socket.remoteAddress;
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address)) {
      return reply(res, 404, { error: '接口不存在' });
    }
    return reply(res, 200, { instanceId, apiVersion: classroomApiVersion });
  }
  if (!pathname.startsWith('/api/classroom/')) {
    if (req.method !== 'GET') return reply(res, 405, { error: '不支持该请求' });
    const file = resolve(dist, '.' + (pathname === '/' ? '/index.html' : decodeURIComponent(pathname)));
    if (!file.startsWith(dist + sep)) return reply(res, 403, { error: '无权访问' });
    let content;
    try { content = readFileSync(file); } catch { return reply(res, 404, { error: '未找到页面，请先构建教师端' }); }
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
    res.writeHead(200, { 'Content-Type': contentTypes[extname(file)] || 'application/octet-stream' });
    if (pathname === '/' || pathname === '/index.html') {
      return res.end(content.toString('utf8').replace('</head>', "<script>if (!location.hash) location.replace('#/classroom')</script></head>"));
    }
    return res.end(content);
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  const credential = req.headers.authorization?.replace(/^Bearer /, '');
  const endpoint = pathname.slice('/api/classroom/'.length);

  if (endpoint === 'teacher/knowledge-search' || endpoint === 'student/knowledge-search') {
    const teacherSearch = endpoint === 'teacher/knowledge-search';
    if (!credential || (teacherSearch && credential !== data.teacherKey)) {
      fail(401, '请重新登录后再检索');
    }
    const student = teacherSearch ? undefined : data.students.find(item => item.token === credential);
    if (!teacherSearch && !student) fail(404, '班级不存在');
    if (req.method !== 'POST') fail(405, '不支持该请求');
    const input = await body(req);
    const classroom = data.classes.find(item => item.id === (teacherSearch ? input.classId : student.classId));
    if (!classroom) fail(404, '班级不存在');
    const slug = classroom.sharedWorkspace?.slug;
    if (!slug) fail(400, '请先为班级保存共享工作区');

    const query = typeof input.query === 'string' ? input.query.trim() : '';
    if (!query) fail(400, '请输入搜索关键词');
    if ([...query].length > 200) fail(400, '搜索关键词最多 200 字');
    const topN = Number.isInteger(input.topN) && input.topN >= 1 && input.topN <= 10 ? input.topN : 5;
    if (student) {
      const now = Date.now();
      if (now - (studentSearchAt.get(student.id) ?? -Infinity) < 5000) fail(429, '操作太快，请稍后再试');
      studentSearchAt.set(student.id, now);
    }
    return reply(res, 200, { slug, ...await library.search(slug, query, topN) });
  }

  if (libraryRoutes.has(endpoint)) {
    if (credential !== data.teacherKey) fail(401, '教师管理码不正确，请重新登录');
    if (req.method !== libraryRoutes.get(endpoint)) fail(405, '不支持该请求');
    if (endpoint === 'teacher/documents/accepted-file-types') {
      return reply(res, 200, { types: await library.acceptedFileTypes() });
    }

    const input = req.method === 'GET' ? { classId: searchParams.get('classId') }
      : endpoint === 'teacher/documents/upload' ? await readDocumentUpload(req)
      : await body(req, endpoint === 'teacher/documents/cards' ? 262144 : 8192);
    const classroom = data.classes.find(item => item.id === input.classId);
    if (!classroom) fail(404, '班级不存在');
    const slug = classroom.sharedWorkspace?.slug;
    if (!slug) fail(400, '请先为班级保存共享工作区');

    if (endpoint === 'teacher/documents/upload') {
      const { file } = input;
      const description = field(input.description || file.name, '资料名称', 240);
      const docSource = typeof input.docSource === 'string' && !input.docSource.trim() ? ''
        : field(input.docSource ?? '教师上传', '资料来源', 240);
      const bytes = await file.arrayBuffer();
      const prepared = /\.ppt$/i.test(file.name)
        ? prepareLegacyPowerPoint(bytes, file.name, documentFileLimit)
        : await prepareLibraryUpload(bytes, file.name, file.type);
      const document = await library.uploadDocument(prepared.buffer, prepared.filename, prepared.mime, {
        description, docSource,
      });
      return reply(res, 201, { document });
    }
    if (endpoint === 'teacher/documents') {
      const [documents, workspace, vectorCount] = await Promise.all([
        library.listDocuments(), library.workspaceDocuments(slug), library.vectorCount().catch(() => null),
      ]);
      return reply(res, 200, { documents, ...workspace, vectorCount });
    }

    if (endpoint === 'teacher/documents/cards') {
      if (generatingCards) fail(429, '正在生成另一份资料卡，请稍后再试');
      generatingCards = true;
      try {
        const documents = await library.listDocuments();
        const subject = typeof input.subject === 'string' ? input.subject.trim().slice(0, 100) : '';
        let content;
        let sourceName;
        let existingCards = documents;
        if (input.docPath !== undefined) {
          const file = documentPath(input.docPath);
          const document = documents.find(item => item.location === file);
          if (!document) fail(404, '资料不存在，请刷新列表');
          content = await readCollectedText(documentsDirectory, file);
          existingCards = documents.filter(item => item.location !== file);
          sourceName = (document.description || document.title || document.name).slice(0, 240);
        } else {
          content = field(input.content, '资料正文', 60000);
          sourceName = field(input.sourceName, '资料名称', 240);
        }
        return reply(res, 200, await generateTeachingCards({library, slug, subject, sourceName, content, documents:existingCards}));
      } finally {
        generatingCards = false;
      }
    }

    if (endpoint === 'teacher/documents/cards/mount') {
      if (!Array.isArray(input.docPaths) || !input.docPaths.length || input.docPaths.length > 60) {
        fail(400, '请选择 1–60 张资料卡');
      }
      const paths = [...new Set(input.docPaths.map(documentPath))];
      const available = new Set((await library.listDocuments()).map(item => item.location));
      if (paths.some(file => !available.has(file))) fail(404, '有资料卡已不存在，请刷新列表');
      return reply(res, 200, await library.updateEmbeddings(slug, paths, [], 120000));
    }
    const docPath = documentPath(input.docPath);
    if (endpoint === 'teacher/documents/mount') {
      if (typeof input.mounted !== 'boolean') fail(400, '请选择挂载或移除后重试');
      const adds = input.mounted ? [docPath] : [];
      const deletes = input.mounted ? [] : [docPath];
      return reply(res, 200, await library.updateEmbeddings(slug, adds, deletes));
    }
    const workspace = await library.workspaceDocuments(slug);
    if (!workspace.mounted.includes(docPath)) fail(400, '请先将该资料挂到本班');
    if (endpoint === 'teacher/documents/pin') {
      if (typeof input.pinStatus !== 'boolean') fail(400, '请选择置顶或取消置顶后重试');
      return reply(res, 200, await library.updatePin(slug, docPath, input.pinStatus));
    }
    const documents = await library.listDocuments();
    const document = documents.find(item => item.location === docPath);
    if (!document) fail(404, '资料不存在，请刷新列表后重试');
    const query = (document.description || document.title || document.name).slice(0, 240);
    return reply(res, 200, { snippets: await library.preview(slug, query) });
  }


  if (endpoint === 'teacher/launch' && req.method === 'POST') {
    requireLocalRequest(req);
    if (credential !== data.teacherKey) fail(401, '教师管理码不正确');
    return reply(res, 200, { code: issueLocalLogin() });
  }
  if (endpoint === 'teacher/auto-login' && req.method === 'POST') {
    requireLocalRequest(req);
    const { code } = await body(req);
    const deadline = localLogins.get(code);
    localLogins.delete(code);
    if (!deadline || deadline <= Date.now()) fail(401, '自动登录链接已用过或过期，请重新双击启动脚本');
    return reply(res, 200, { teacherKey: data.teacherKey });
  }

  if (endpoint === 'teacher/invitation' && req.method === 'POST') {
    if (credential !== data.teacherKey) fail(401, '教师管理码不正确');
    const { classId, scope } = await body(req);
    if (scope !== undefined && scope !== 'local') fail(400, '邀请码范围无效');
    const classroom = data.classes.find(item => item.id === classId);
    if (!classroom) fail(404, '班级不存在');
    return reply(res, 200, { invitation: classroomInvitation(classroom, scope === 'local') });
  }

  if (endpoint === 'teacher/class-insights' && req.method === 'GET') {
    if (credential !== data.teacherKey) fail(401, '教师管理码不正确');
    const classId = searchParams.get('classId');
    const classroom = data.classes.find(item => item.id === classId);
    if (!classroom) fail(404, '班级不存在');
    const members = data.students.filter(student => student.classId === classroom.id);
    return reply(res, 200, {
      classId: classroom.id,
      students: members.map(({ id, name, progress, syncedAt, mistakeIndex }) => ({
        id, name, progress, syncedAt, indexed: Array.isArray(mistakeIndex),
      })),
      records: members.flatMap(student => (student.mistakeIndex || []).map(record => ({
        ...record, studentId: student.id, studentName: student.name,
      }))),
    });
  }

  if (endpoint === 'teacher/student-history' && req.method === 'POST') {
    if (credential !== data.teacherKey) fail(401, '教师管理码不正确');
    const { classId, studentId } = await body(req);
    const student = data.students.find(item => item.id === studentId && item.classId === classId);
    if (!student) fail(404, '这个班级中没有该学生');
    return reply(res, 200, { history: student.history || [] });
  }

  if (endpoint === 'teacher/classes') {
    if (credential !== data.teacherKey) fail(401, '教师管理码不正确');
    if (req.method === 'GET') {
      return reply(res, 200, data.classes.map(classroom => ({
        ...classroom,
        invitation: classroomInvitation(classroom),
        students: data.students.filter(student => student.classId === classroom.id)
          .map(({ id, name, progress, syncedAt }) => ({ id, name, progress, syncedAt })),
      })));
    }
    if (req.method === 'POST') {
      const { name } = await body(req);
      const classroom = { id: randomUUID(), name: field(name, '班级名称', 50), code: randomBytes(8).toString('hex').toUpperCase() };
      save({ ...data, classes: [...data.classes, classroom] });
      return reply(res, 201, { ...classroom, invitation: classroomInvitation(classroom) });
    }
  }

  if (endpoint === 'teacher/workspace-settings' && req.method === 'POST') {
    if (credential !== data.teacherKey) fail(401, '教师管理码不正确');
    const input = await body(req, 65536);
    const classroom = data.classes.find(item => item.id === input.classId);
    if (!classroom?.sharedWorkspace?.slug) fail(400, '请先为班级保存共享工作区。');
    if (input.slug !== classroom.sharedWorkspace.slug) fail(409, '班级共享工作区已切换，请刷新后重试。');
    const path = '/api/v1/workspace/' + encodeURIComponent(classroom.sharedWorkspace.slug);
    const fields = ['chatProvider', 'chatModel', 'openAiPrompt', 'queryRefusalResponse', 'openAiTemp',
      'openAiHistory', 'similarityThreshold', 'topN', 'vectorSearchMode', 'agentProvider', 'agentModel', 'router_id'];
    let updates;
    if (input.changes !== undefined) {
      if (!input.changes || typeof input.changes !== 'object' || Array.isArray(input.changes)) fail(400, '工作区配置格式无效。');
      const entries = Object.entries(input.changes);
      if (!entries.length || entries.some(([name, value]) => !fields.includes(name) ||
        (value !== null && typeof value !== 'string' && !Number.isFinite(value)))) fail(400, '包含不支持的设置。');
      updates = Object.fromEntries(entries);
    }
    const result = await modelRequest(updates ? path + '/update' : path, updates);
    const workspace = Array.isArray(result?.workspace)
      ? result.workspace.find(item => item?.slug === classroom.sharedWorkspace.slug) : result?.workspace;
    if (!workspace || workspace.slug !== classroom.sharedWorkspace.slug || result.message) {
      fail(502, 'AnythingLLM 未返回有效的工作区配置。');
    }
    const safe = Object.fromEntries(fields.map(name => [name, typeof workspace[name] === 'string'
      ? workspace[name].split(modelKey).join('[密钥已隐藏]') : workspace[name]]));
    if (!updates) {
      safe.adminUrl = adminUrl;
      const catalog = await modelRequest('/api/v1/workspaces').catch(() => null);
      safe.availableModels = (Array.isArray(catalog?.workspaces) ? catalog.workspaces : [])
        .filter(item => typeof item?.chatProvider === 'string' && typeof item.chatModel === 'string')
        .map(item => ({ provider: item.chatProvider.split(modelKey).join('[密钥已隐藏]'), model: item.chatModel.split(modelKey).join('[密钥已隐藏]') }));
    }
    return reply(res, 200, safe);
  }

  if (endpoint === 'teacher/model-workspaces' || endpoint === 'teacher/shared-workspace') {
    if (credential !== data.teacherKey) fail(401, '教师管理码不正确');
    if (endpoint === 'teacher/model-workspaces' && req.method === 'GET') {
      return reply(res, 200, await modelWorkspaces());
    }
    if (endpoint === 'teacher/shared-workspace' && req.method === 'POST') {
      const input = await body(req);
      const slug = field(input.slug, '工作区', 200);
      const selected = (await modelWorkspaces()).find(workspace => workspace.slug === slug);
      if (!selected) fail(404, '所选工作区不存在，请刷新列表');
      if (!data.classes.some(classroom => classroom.id === input.classId)) fail(404, '班级不存在');
      save({ ...data, classes: data.classes.map(classroom => classroom.id === input.classId
        ? { ...classroom, sharedWorkspace: selected } : classroom) });
      return reply(res, 200, selected);
    }
    fail(405, '不支持该请求');
  }

  if (endpoint === 'student/chat' && req.method === 'POST') {
    const student = data.students.find(item => item.token === credential);
    if (!student) fail(401, '班级身份无效');
    const classroom = data.classes.find(item => item.id === student.classId);
    if (!classroom?.sharedWorkspace) fail(409, '本班尚未配置共享 AnythingLLM 工作区，请联系教师');
    if (activeChats.has(student.id)) fail(429, '已有一条请求正在处理，请稍后重试');
    activeChats.add(student.id);
    try {
      const input = await body(req, 32 * 1024 * 1024);
      const message = field(input.message, '消息', 100000);
      if (/^@agent\b/i.test(message)) fail(400, '班级工作区只接受学习问答');
      const images = input.attachments ?? [];
      if (!Array.isArray(images) || images.length > 6 || images.some(image => !image ||
          typeof image.name !== 'string' || image.name.length > 255 ||
          !['image/jpeg', 'image/png', 'image/webp'].includes(image.mime) ||
          typeof image.contentString !== 'string' || image.contentString.length > 5 * 1024 * 1024 ||
          !image.contentString.startsWith('data:' + image.mime + ';base64,'))) {
        fail(400, '图片附件无效或超出限制');
      }
      const result = await modelRequest('/api/v1/workspace/' + encodeURIComponent(classroom.sharedWorkspace.slug) + '/chat', {
        message, mode: 'chat', sessionId: 'zhixu-classroom-' + randomUUID(),
        attachments: images.map(({ name, mime, contentString }) => ({ name, mime, contentString })),
      }, 120000);
      if (result?.type === 'abort' || result?.error || typeof result?.textResponse !== 'string') {
        fail(502, '教师端 AnythingLLM 没有返回有效结果，请检查该工作区的模型设置');
      }
      return reply(res, 200, { textResponse: result.textResponse.split(modelKey).join('[密钥已隐藏]') });
    } finally {
      activeChats.delete(student.id);
    }
  }

  if (endpoint === 'student/lookup' || endpoint === 'student/join') {
    if (req.method !== 'POST') fail(405, '不支持该请求');
    const input = await body(req);
    const classroom = data.classes.find(item => item.code === field(input.code, '班级码', 16).toUpperCase());
    if (!classroom) fail(404, '未找到班级，请核对班级码');
    const info = { id: classroom.id, name: classroom.name };
    if (endpoint.endsWith('/lookup')) return reply(res, 200, [info]);
    if (input.classId !== classroom.id) fail(400, '班级选择已失效，请重新查找');
    const name = field(input.name, '学生姓名', 40);
    const existing = data.students.find(student => student.token === credential);
    if (existing) {
      if (existing.classId !== classroom.id) fail(409, '此学习档案已加入其他班级');
      return reply(res, 200, { ...info, token: existing.token });
    }
    const student = { id: randomUUID(), classId: classroom.id, name, token: token(), progress: null, syncedAt: null };
    save({ ...data, students: [...data.students, student] });
    return reply(res, 201, { ...info, token: student.token });
  }

  if (endpoint === 'student/progress' && req.method === 'POST') {
    const input = await body(req, 2 * 1024 * 1024);
    const student = data.students.find(item => item.token === credential);
    if (!student) fail(401, '班级身份无效');
    const keys = ['total', 'processed', 'pending', 'failed', 'processing'];
    const progress = Object.fromEntries(keys.map(key => [key, input[key]]));
    if (keys.some(key => !Number.isSafeInteger(progress[key]) || progress[key] < 0 || progress[key] > 1000000)
      || progress.total !== progress.processed + progress.pending + progress.failed + progress.processing) fail(400, '学习统计无效');
    let mistakeIndex;
    if (input.mistakes !== undefined) {
      if (!Array.isArray(input.mistakes) || input.mistakes.length > 500 || input.mistakes.length > progress.total) {
        fail(400, '班级错题索引无效');
      }
      const statuses = ['待确认', '加工中', '已加工', '加工失败'];
      const clean = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
      const ids = new Set();
      mistakeIndex = input.mistakes.map(record => {
        if (!record || typeof record !== 'object' || typeof record.id !== 'string'
          || !record.id || record.id.length > 120 || ids.has(record.id) || !statuses.includes(record.status)) {
          fail(400, '班级错题记录无效');
        }
        ids.add(record.id);
        return {
          id: record.id,
          question: clean(record.question, 600),
          subject: clean(record.subject, 80),
          module: clean(record.module, 100),
          questionType: clean(record.questionType, 80),
          status: record.status,
          difficulty: Number.isInteger(record.difficulty) && record.difficulty >= 1 && record.difficulty <= 5 ? record.difficulty : null,
          errorTags: [...new Set((Array.isArray(record.errorTags) ? record.errorTags : [])
            .slice(0, 12).map(tag => clean(tag, 50)).filter(Boolean))],
          updatedAt: typeof record.updatedAt === 'string' && Number.isFinite(Date.parse(record.updatedAt))
            ? new Date(record.updatedAt).toISOString() : null,
        };
      });
    }
    const syncedAt = new Date().toISOString();
    const day = new Date(Date.parse(syncedAt) + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const history = [...(student.history || []).filter(snapshot => snapshot.day !== day), { day, progress }].slice(-30);
    save({ ...data, students: data.students.map(item => item === student
      ? { ...student, progress, syncedAt, history, ...(mistakeIndex === undefined ? {} : { mistakeIndex }) } : item) });
    return reply(res, 200, { syncedAt });
  }
  reply(res, 404, { error: '接口不存在' });
}

const server = createServer((req, res) => {
  route(req, res).catch(error => {
    if (!error.status) console.error(error);
    if (!res.headersSent) reply(res, error.status || 500, { error: error.status ? error.message : '班级服务暂时不可用' });
    else res.end();
  });
});
function openTeacherPage(address, code) {
  if (!process.argv.includes('--open') || process.platform !== 'win32') return;
  const clipboard = spawn('clip.exe', [], { stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true });
  clipboard.on('error', () => {});
  clipboard.stdin.on('error', () => {});
  clipboard.stdin.end(data.teacherKey);
  clipboard.on('exit', status => {
    if (status === 0) console.log('已复制教师管理码，必要时可直接粘贴。');
  });
  const page = address + '/#/classroom' + (code ? '?login=' + code : '');
  const command = "Start-Process -FilePath '" + page.replaceAll("'", "''") + "' -ErrorAction Stop";
  const browser = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    stdio: 'ignore', windowsHide: true,
  });
  function fallback() {
    const alternative = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', page], {
      stdio: 'ignore', windowsHide: true,
    });
    alternative.on('error', error => console.error('无法自动打开教师端页面：' + error.message));
    alternative.on('exit', status => {
      if (status !== 0) console.error('无法自动打开教师端页面，Windows 浏览器启动失败。');
    });
  }
  browser.on('error', fallback);
  browser.on('exit', status => { if (status !== 0) fallback(); });
}

const desktopParent = process.parentPort;
function showTeacherPage(address, code, reused = false) {
  if (desktopParent) {
    desktopParent.postMessage({ type: 'classroom-ready', address, code, reused, adminUrl });
    return;
  }
  console.log('教师管理码（仅教师使用） ' + data.teacherKey);
  openTeacherPage(address, code);
}

server.on('error', async error => {
  if (error.code !== 'EADDRINUSE') {
    const message = '班级服务启动失败：' + error.message;
    console.error(message);
    desktopParent?.postMessage({ type: 'classroom-error', message });
    process.exitCode = 1;
    return;
  }
  const localAddress = host === '::' || host === '::1' ? 'http://[::1]:' + port : 'http://127.0.0.1:' + port;
  let running;
  try {
    const response = await fetch(localAddress + '/api/classroom/health', {
      signal: AbortSignal.timeout(1500), redirect: 'error',
    });
    running = response.ok ? await response.json() : null;
    if (running?.instanceId === instanceId && running.apiVersion === classroomApiVersion) {
      console.log('班级服务已在运行，打开 ' + localAddress + '/#/classroom');
      let code;
      if (desktopParent || process.argv.includes('--open')) {
        try {
          const launch = await fetch(localAddress + '/api/classroom/teacher/launch', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + data.teacherKey },
            signal: AbortSignal.timeout(1500), redirect: 'error',
          });
          if (launch.ok) code = (await launch.json()).code;
        } catch {}
      }
      if (desktopParent && !code) {
        desktopParent.postMessage({ type: 'classroom-error', message: '无法自动登录已有班级服务，请重启原有服务后再打开桌面版。' });
        return;
      }
      showTeacherPage(localAddress, code, true);
      console.log('请保留原来的服务窗口。若要重启，请在原窗口按 Ctrl+C，再运行启动脚本。');
      return;
    }
  } catch {}
  if (desktopParent && !modelEnv.CLASSROOM_PORT && port !== 0) {
    port = 0;
    server.listen(port, host);
    return;
  }
  const message = running?.instanceId === instanceId
    ? '端口 ' + port + ' 上的班级服务版本不兼容，请为副本设置不同的 CLASSROOM_PORT。'
    : '端口 ' + port + ' 已被其他程序或旧版班级服务占用。';
  console.error(message);
  desktopParent?.postMessage({ type: 'classroom-error', message });
  console.error('请在原来的班级服务窗口按 Ctrl+C，或关闭占用端口的程序，再重新启动。');
  console.error('如需另用端口，请在教师端 .env.classroom.local 设置 CLASSROOM_PORT；学生也须改用新的服务地址。');
  process.exitCode = 1;
});
server.once('listening', () => {
  const { port: listeningPort } = server.address();
  const localAddress = (host === '::' || host === '::1' ? 'http://[::1]:' : 'http://127.0.0.1:') + listeningPort;
  console.log('教师端 ' + localAddress + '/#/classroom');
  console.log('班级数据文件 ' + store.file);
  const code = desktopParent || process.argv.includes('--open') ? issueLocalLogin() : undefined;
  showTeacherPage(localAddress, code);
});
server.listen(port, host);
