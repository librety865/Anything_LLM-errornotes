import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, readFile, unlink, rmdir, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openClassroomStore } from './classroom-store.mjs';
import { createClassroomProgressSync } from '../mistake-workbench/src/classroom-mistake-index.mjs';
import { filterClassRecords } from './src/pages/class-insights.mjs';

test('teacher creates a class, student selects and joins, and teacher sees only allowed statistics', { timeout: 15000 }, async () => {
 const dir = await mkdtemp(join(tmpdir(), 'zhixu-classroom-'));
 const modelCalls = [];
 const model = createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  modelCalls.push({ url: req.url, body: raw ? JSON.parse(raw) : undefined, auth: req.headers.authorization });
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(req.method === 'GET'
   ? (req.url === '/api/v1/workspace/math'
     ? {workspace: {slug: 'math', chatMode: 'query', topN: 5}}
     : {workspaces: [{slug: 'math', name: '数学资料'}, {slug: 'english', name: '英语资料'}]})
   : { textResponse: '共享资料响应' }));
 });
 model.listen(0, '127.0.0.1');
 await once(model, 'listening');
 let child;
 async function start() {
  child = spawn(process.execPath, [fileURLToPath(new URL('./classroom-server.mjs', import.meta.url))], {
   env: { ...process.env, CLASSROOM_HOST: '127.0.0.1', CLASSROOM_PORT: '0', CLASSROOM_DATA_DIR: dir, CLASSROOM_ANYTHINGLLM_BASE_URL: 'http://127.0.0.1:' + model.address().port,
      CLASSROOM_ANYTHINGLLM_API_KEY: 'test-model-credential' },
   stdio: ['ignore', 'pipe', 'inherit'],
  });
  let logs = '';
  for await (const chunk of child.stdout) {
   logs += chunk;
   const address = logs.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
   const key = logs.match(/教师管理码（仅教师使用） ([a-f0-9]{48})/)?.[1];
   if (address && key) return { address, key };
  }
  throw Error('班级服务没有启动');
 }
 async function stop() {
  if (!child || child.exitCode !== null || child.signalCode) return;
  const exited = once(child, 'exit');
  child.kill();
  await exited;
 }
 try {
  let {address, key} = await start();
  async function duplicate(port) {
   const attempt = spawn(process.execPath, [fileURLToPath(new URL('./classroom-server.mjs', import.meta.url))], {
    env: { ...process.env, CLASSROOM_HOST: '127.0.0.1', CLASSROOM_PORT: port, CLASSROOM_DATA_DIR: dir },
    stdio: ['ignore', 'pipe', 'pipe'],
   });
   let output = '';
   for (const stream of [attempt.stdout, attempt.stderr]) stream.on('data', chunk => { output += chunk; });
   const [status] = await once(attempt, 'close');
   return { status, output };
  }

  const repeated = await duplicate(new URL(address).port);
  assert.equal(repeated.status, 0);
  assert.match(repeated.output, /班级服务已在运行/);
  assert.ok(repeated.output.includes('教师管理码（仅教师使用） ' + key));
  const conflict = await duplicate(String(model.address().port));
  assert.equal(conflict.status, 1);
  assert.ok(!conflict.output.includes(key));
  assert.match(conflict.output, /已被其他程序或旧版班级服务占用/);
  assert.doesNotMatch(conflict.output, /Unhandled 'error' event/);
  async function call(endpoint, token, body) {
   return fetch(address + '/api/classroom/' + endpoint, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? {Authorization: 'Bearer ' + token} : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
   });
  }
  assert.equal((await fetch(address + '/api/classroom/teacher/launch', {
   method: 'POST', headers: { Authorization: 'Bearer ' + key, Origin: 'http://other.test' },
  })).status, 403);
  assert.equal((await call('teacher/launch', null, {})).status, 401);
  const launch = await call('teacher/launch', key, {});
  const { code } = await launch.json();
  assert.notEqual(code, key);
  assert.equal((await fetch(address + '/api/classroom/teacher/auto-login', {
   method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://other.test' },
   body: JSON.stringify({ code }),
  })).status, 403);
  const login = await call('teacher/auto-login', null, { code });
  assert.equal(login.status, 200);
  assert.equal((await login.json()).teacherKey, key);
  assert.equal((await call('teacher/auto-login', null, { code })).status, 401);
  const created = await call('teacher/classes', key, {name:'数学一班'});
  assert.equal(created.status, 201);
  const classroom = await created.json();
  assert.equal((await call('teacher/invitation', null, {classId:classroom.id})).status, 401);
  const inviteResponse = await call('teacher/invitation', key, {classId:classroom.id});
  assert.equal(inviteResponse.status, 200);
  const { invitation } = await inviteResponse.json();
  assert.match(invitation, /^ZX1-/);
  assert.equal(classroom.invitation, invitation);
  const [listed] = await (await call('teacher/classes', key)).json();
  assert.equal(listed.invitation, invitation);
  const invite = JSON.parse(Buffer.from(invitation.slice(4), 'base64url').toString('utf8'));
  assert.deepEqual(invite, {classId:classroom.id, code:classroom.code, origins:[address]});
  const localResponse = await call('teacher/invitation', key, { classId: classroom.id, scope: 'local' });
  assert.equal(localResponse.status, 200);
  const { invitation: localInvitation } = await localResponse.json();
  assert.match(localInvitation, /^ZX1-/);
  const localInvite = JSON.parse(Buffer.from(localInvitation.slice(4), 'base64url').toString('utf8'));
  assert.deepEqual(localInvite, { classId: classroom.id, code: classroom.code, origins: [address] });
  assert.equal((await call('teacher/invitation', key, { classId: classroom.id, scope: 'invalid' })).status, 400);
  const choices = await (await fetch(localInvite.origins[0] + '/api/classroom/student/lookup', {
   method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({code:invite.code}),
  })).json();
  assert.deepEqual(choices, [{id:classroom.id, name:'数学一班'}]);
  assert.equal((await call('student/join', null, {code:classroom.code, classId:'other', name:'小李'})).status, 400);
  const input = {code:classroom.code, classId:classroom.id, name:'小李'};
  const member = await (await call('student/join', null, input)).json();
  assert.equal((await call('teacher/classes', member.token)).status, 401);
  assert.equal((await call('student/join', member.token, input)).status, 200);
  assert.equal((await call('student/chat', member.token, { message: '你好' })).status, 409);
  assert.equal((await call('teacher/shared-workspace', member.token, { classId: classroom.id, slug: 'math' })).status, 401);
  assert.equal((await call('teacher/shared-workspace', key, { classId: classroom.id, slug: 'missing' })).status, 404);
  assert.equal((await call('teacher/shared-workspace', key, { classId: classroom.id, slug: 'math' })).status, 200);
  const workspaceSettings = {classId: classroom.id, slug: 'math'};
  const settings = await call('teacher/workspace-settings', key, workspaceSettings);
  assert.equal(settings.status, 200);
  const workspaceConfig = await settings.json();
  assert.equal(workspaceConfig.topN, 5);
  assert.equal(Object.hasOwn(workspaceConfig, 'chatMode'), false);
  const rejectedSettings = await call('teacher/workspace-settings', key, {
   ...workspaceSettings, changes: {chatMode: 'query'},
  });
  assert.equal(rejectedSettings.status, 400);
  assert.equal((await call('student/chat', null, { message: '你好' })).status, 401);
  const peer = await (await call('student/join', null, { ...input, name: '小赵' })).json();
  for (const student of [member, peer]) {
   const chat = await call('student/chat', student.token, { message: '你好', slug: 'english', sessionId: 'override' });
   assert.equal(chat.status, 200);
   assert.deepEqual(await chat.json(), { textResponse: '共享资料响应' });
  }
  const calls = modelCalls.filter(request => request.body);
  assert.deepEqual(calls.map(request => request.url), ['/api/v1/workspace/math/chat', '/api/v1/workspace/math/chat']);
  assert.ok(calls.every(request => request.auth === 'Bearer test-model-credential'));
  assert.ok(calls.every(request => request.body.mode === 'chat'));
  assert.notEqual(calls[0].body.sessionId, calls[1].body.sessionId);
  assert.notEqual(calls[0].body.sessionId, 'override');
  const progress = {total:3, processed:1, pending:1, failed:1, processing:0};
  assert.equal((await call('student/progress', member.token, {...progress, processed:2, failed:0})).status, 200);
  assert.equal((await call('student/progress', null, progress)).status, 401);
  assert.equal((await call('student/progress', member.token, {...progress,total:9})).status, 400);
  const mistake = { id: 'm1', question: '求 x/2', subject: '数学', status: '已加工', difficulty: 3, userAnswer: '不可同步' };
  assert.equal((await call('student/progress', member.token, { ...progress, mistakes: [mistake] })).status, 200);
  assert.equal((await call('student/progress', member.token, {...progress, question:'不得保存'})).status, 200);

  const secondClassResponse = await call('teacher/classes', key, { name: '数学二班' });
  assert.equal(secondClassResponse.status, 201);
  const secondClass = await secondClassResponse.json();
  const secondInvite = { code: secondClass.code, classId: secondClass.id, name: '小赵' };
  assert.equal((await call('student/join', member.token, secondInvite)).status, 409);
  const newStudentResponse = await call('student/join', null, secondInvite);
  assert.equal(newStudentResponse.status, 201);
  const newStudent = await newStudentResponse.json();

  const notebooks = new Map([
    ['class-one', { ...peer, url: address }],
    ['class-two', { ...newStudent, url: address }],
  ]);
  const rows = new Map([
    ['class-one', [
      { id: 'same-id', workspace_id: 'class-one', originalQuestion: '一班学生错题', status: '已加工', difficulty: 2, userAnswer: '不共享' },
      { id: 'wrong-scope', workspace_id: 'private', originalQuestion: '不能跨工作区同步', status: '已加工' },
    ]],
    ['class-two', [{ id: 'same-id', workspace_id: 'class-two', originalQuestion: '二班学生错题', status: '待确认', difficulty: 4 }]],
    ['private', [{ id: 'private-id', originalQuestion: '个人错题', status: '已加工' }]],
  ]);
  let sendCount = 0;
  let failNext = true;
  const sync = createClassroomProgressSync({
    getMembership: notebook => notebooks.get(notebook) ?? null,
    readRecords: notebook => rows.get(notebook),
    sendProgress: async (joined, payload) => {
      if (failNext) { failNext = false; throw new Error('模拟断线'); }
      sendCount++;
      const response = await call('student/progress', joined.token, payload);
      assert.equal(response.status, 200);
      return response.json();
    },
  });
  await sync('private');
  assert.equal(sendCount, 0);
  await assert.rejects(sync('class-one'), /模拟断线/);
  await Promise.all([sync('class-one'), sync('class-one'), sync('class-two')]);
  assert.equal(sendCount, 2);

  rows.get('class-two')[0].status = '已加工';
  await sync('class-two');
  await sync('class-two');
  assert.equal(sendCount, 3);
  await stop();
  const restarted = await start();
  address = restarted.address;
  assert.equal(restarted.key, key);
  const [saved] = await (await call('teacher/classes', key)).json();
  assert.deepEqual(saved.sharedWorkspace, { slug: 'math', name: '数学资料' });
  assert.equal(saved.students.length, 2);
  const [student] = saved.students;
  assert.equal(student.name, '小李');
  assert.deepEqual(student.progress, progress);
  assert.ok(student.syncedAt);
  assert.equal(student.token, undefined);
  const insightsUrl = 'teacher/class-insights?classId=' + classroom.id;
  assert.equal((await call(insightsUrl, member.token)).status, 401);
  assert.equal((await call('teacher/class-insights?classId=other', key)).status, 404);
  const insights = await (await call(insightsUrl, key)).json();
  assert.equal(insights.records[0].question, '求 x/2');
  assert.equal(insights.records[0].studentId, student.id);
  assert.equal(insights.records[0].userAnswer, undefined);
  assert.equal(insights.students[0].indexed, true);
  const other = await (await call('teacher/class-insights?classId=' + secondClass.id, key)).json();
  assert.equal(other.students.length, 1);
  assert.deepEqual(other.records.map(row => row.question), ['二班学生错题']);
  assert.equal(other.records[0].status, '已加工');
  assert.equal(other.students[0].progress.total, 1);
  assert.equal(other.students[0].progress.processed, 1);
  assert.deepEqual(insights.records.map(row => row.question), ['求 x/2', '一班学生错题']);
  assert.equal(insights.students[1].progress.total, 1);
  assert.equal(insights.students[1].name, other.students[0].name);
  const studentFilter = id => new URLSearchParams({ studentId: id });
  assert.deepEqual(filterClassRecords(insights.records, studentFilter(student.id)).map(row => row.question), ['求 x/2']);
  assert.deepEqual(filterClassRecords(insights.records, studentFilter(insights.students[1].id)).map(row => row.question), ['一班学生错题']);
  assert.deepEqual(filterClassRecords(insights.records, studentFilter(other.students[0].id)), []);
  assert.deepEqual(filterClassRecords(other.records, studentFilter(other.students[0].id)).map(row => row.question), ['二班学生错题']);
  const detail = { classId: classroom.id, studentId: student.id };
  assert.equal((await call('teacher/student-history', member.token, detail)).status, 401);
  assert.equal((await call('teacher/student-history', key, { ...detail, classId: 'other' })).status, 404);
  const { history } = await (await call('teacher/student-history', key, detail)).json();
  assert.equal(history.length, 1);
  assert.match(history[0].day, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(history[0].progress, progress);
 } finally {
  await stop();
  await new Promise(resolve => model.close(resolve));
  await unlink(join(dir, 'classrooms.json')).catch(error => { if (error.code !== 'ENOENT') throw error; });
  await unlink(join(dir, 'classrooms.json.tmp')).catch(error => { if (error.code !== 'ENOENT') throw error; });
  await rmdir(dir);
 }
});


test('migrates existing classroom data without changing IDs and reuses it from another project folder', async () => {
 const base = await mkdtemp(join(tmpdir(), 'zhixu-classroom-migration-'));
 const oldRoot = join(base, 'old');
 const legacyDir = join(oldRoot, '.classroom-data');
 const legacyFile = join(legacyDir, 'classrooms.json');
 const data = {
  teacherKey: 'a'.repeat(48),
  classes: [{ id: 'class-a', code: '0123456789ABCDEF', sharedWorkspace: { slug: 'math', name: '资料' } }],
  students: [{ id: 'student-a', classId: 'class-a', token: 'student-token', progress: { total: 3 } }],
 };
 let newFile;
 try {
  await mkdir(legacyDir, { recursive: true });
  await writeFile(legacyFile, JSON.stringify(data));
  const opened = openClassroomStore(oldRoot, { profileRoot: base });
  newFile = opened.file;
  assert.deepEqual(opened.data, data);
  opened.save({ ...data, students: [...data.students, { id: 'student-b', classId: 'class-a' }] });
  const reopened = openClassroomStore(join(base, 'copied-project'), { profileRoot: base });
  assert.equal(reopened.file, opened.file);
  assert.equal(reopened.data.teacherKey, data.teacherKey);
  assert.deepEqual(reopened.data.classes, data.classes);
  assert.equal(reopened.data.students.length, 2);
  assert.deepEqual(JSON.parse(await readFile(legacyFile, 'utf8')), data);

  await writeFile(newFile, 'broken data');
  assert.throws(() => openClassroomStore(oldRoot, { profileRoot: base }), /原文件已保留/);
  assert.equal(await readFile(newFile, 'utf8'), 'broken data');
 } finally {
  if (newFile) {
   await unlink(newFile);
   await rmdir(join(base, 'Zhixu', 'Classroom'));
   await rmdir(join(base, 'Zhixu'));
  }
  await unlink(legacyFile);
  await rmdir(legacyDir);
  await rmdir(oldRoot);
  await rmdir(base);
 }
});

test('serves all five additional teacher asset types over HTTP', { timeout: 15000 }, async () => {
 const directory = await mkdtemp(join(tmpdir(), 'zhixu-classroom-static-'));
 const dist = join(directory, 'dist');
 const expected = {
  mjs: 'text/javascript',
  svg: 'image/svg+xml',
  png: 'image/png',
  woff2: 'font/woff2',
  json: 'application/json',
 };
 let child;
 try {
  await mkdir(dist);
  for (const name of ['classroom-server.mjs', 'classroom-store.mjs', 'classroom-library.mjs', 'classroom-cards.mjs', 'classroom-image-ocr.mjs', 'classroom-ppt.mjs']) {
   await copyFile(new URL('./' + name, import.meta.url), join(directory, name));
  }
  for (const extension of Object.keys(expected)) {
   await writeFile(join(dist, 'probe.' + extension), '');
  }
  child = spawn(process.execPath, [join(directory, 'classroom-server.mjs')], {
   env: {...process.env, CLASSROOM_HOST: '127.0.0.1', CLASSROOM_PORT: '0',
    CLASSROOM_DATA_DIR: join(directory, 'classroom-data')},
   stdio: ['ignore', 'pipe', 'inherit'],
  });
  let address;
  let output = '';
  for await (const chunk of child.stdout.iterator({destroyOnReturn: false})) {
   output += chunk;
   address = output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
   if (address) break;
  }
  assert.ok(address, '班级服务应成功启动');
  for (const [extension, contentType] of Object.entries(expected)) {
   const response = await fetch(address + '/probe.' + extension, {signal: AbortSignal.timeout(2000)});
   assert.equal(response.status, 200, extension);
   assert.equal(response.headers.get('content-type'), contentType, extension);
   await response.arrayBuffer();
  }
 } finally {
  if (child && child.exitCode === null && child.signalCode === null) {
   const exited = once(child, 'exit');
   child.kill();
   await exited;
  }
  await rm(directory, {recursive: true, force: true});
 }
});

test('teacher uploads, mounts and previews library documents with class authorization', { timeout: 20000 }, async () => {
 const directory = await mkdtemp(join(tmpdir(), 'zhixu-library-'));
 const key = 'test-library-private-api-key';
 const location = 'custom-documents/quadratic.json';
 const documents = [];
 const mounted = new Map();
 const calls = [];
 let uploadError = '';
 let fileTypesMissing = false;
 let child;
 const model = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  const req = new Request(url, {
   method: request.method, headers: request.headers,
   ...(request.method === 'POST' ? {body: request, duplex: 'half'} : {}),
  });
  const send = (data, status = 200) => {
   response.writeHead(status, {'Content-Type': 'application/json'});
   response.end(JSON.stringify(data));
  };
  const pathname = url.pathname;
  calls.push({pathname, authorization: req.headers.get('authorization')});
  if (pathname === '/api/v1/workspaces') return send({workspaces: [{slug:'math', name:'数学资料'}]});
  if (pathname === '/api/v1/workspace/math') {
   return send({workspace: [{slug:'math', documents:[...mounted].map(([docpath, pinned]) => ({docpath, pinned}))}]});
  }
  if (pathname === '/api/v1/documents') {
   calls.at(-1).query = url.search;
   return send({documents});
  }
  if (pathname === '/api/v1/system/vector-count') return send({vectorCount: mounted.size * 3});
  if (pathname === '/api/v1/document/accepted-file-types') {
   if (fileTypesMissing) return send({error:'Not Found'}, 404);
   return send({acceptedFileTypes: ['.md', 'text/markdown']});
  }
  if (pathname === '/api/v1/document/upload') {
   const form = await req.formData();
   calls.at(-1).upload = {
    metadata: JSON.parse(form.get('metadata')),
    fields: [...form.keys()],
    file: await form.get('file').text(),
   };
   if (uploadError) return send({error: uploadError}, 500);
   const metadata = calls.at(-1).upload.metadata;
   const doc = {name:metadata.description === '顶点纵坐标规则' ? 'card.json' : 'quadratic.json', ...metadata, wordCount:224};
   documents.push(doc);
   return send({success:true, documents:[{...doc, location:'custom-documents/' + doc.name}]});
  }
  if (pathname.endsWith('/chat')) {
   const payload = await req.json();
   calls.at(-1).payload = payload;
   const markdown = '标题：顶点纵坐标规则\n关键词：二次函数、最小值、误用常数项\n结论/定义：'
    + '二次函数开口向上时，顶点纵坐标就是最小值。先求对称轴坐标，再代入函数求得顶点纵坐标。'
    + '常数项是横坐标为零时的函数值，只有对称轴经过原点时才等于最小值。';
   return send({textResponse: JSON.stringify({cards:[
    {filename:'顶点纵坐标规则.md',title:'顶点纵坐标规则',type:'concept',markdown},
   ],skipped:[],uncertain:[]})});
  }
  if (pathname.endsWith('/update-embeddings')) {
   const {adds, deletes} = await req.json();
   calls.at(-1).payload = {adds, deletes};
   adds.forEach(path => mounted.set(path, false));
   deletes.forEach(path => mounted.delete(path));
   return send({success:true});
  }
  if (pathname.endsWith('/update-pin')) {
   const {docPath, pinStatus} = await req.json();
   mounted.set(docPath, pinStatus);
   return send({success:true});
  }
  if (pathname.endsWith('/vector-search')) {
   calls.at(-1).payload = await req.json();
   return send({results: [{text:'顶点纵坐标'.repeat(40)}]});
  }
  send({error:'unexpected path'}, 404);
 });
 try {
  const documentsRoot = join(directory, 'documents');
  await mkdir(join(documentsRoot, 'custom-documents'), {recursive:true});
  await writeFile(join(documentsRoot, 'custom-documents', 'quadratic.json'), JSON.stringify({
   pageContent:'资料正文：开口向上的二次函数，顶点纵坐标为最小值。',
  }));
  const credentialFile = join(directory, 'model.env');
  await writeFile(credentialFile, 'VITE_ANYTHINGLLM_API_KEY=' + key + '\n');
  model.listen(0, '127.0.0.1');
  await once(model, 'listening');
  const { data } = openClassroomStore(directory, { directory });
  child = spawn(process.execPath, [fileURLToPath(new URL('./classroom-server.mjs', import.meta.url))], {
   env: {...process.env, CLASSROOM_HOST:'127.0.0.1', CLASSROOM_PORT:'0', CLASSROOM_DATA_DIR:directory,
    CLASSROOM_ANYTHINGLLM_BASE_URL:'http://127.0.0.1:' + model.address().port,
    CLASSROOM_ANYTHINGLLM_API_KEY:'', VITE_ANYTHINGLLM_API_KEY:'', CLASSROOM_ANYTHINGLLM_KEY_FILE:credentialFile, CLASSROOM_ANYTHINGLLM_DOCUMENTS_DIR:documentsRoot},
   stdio:['ignore', 'pipe', 'inherit'],
  });
  let address;
  let output = '';
  for await (const chunk of child.stdout.iterator({destroyOnReturn: false})) {
   output += chunk;
   address = output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
   if (address) break;
  }
  assert.ok(address);
  function request(endpoint, input, teacherKey = data.teacherKey) {
   const form = input instanceof FormData;
   return fetch(address + '/api/classroom/teacher/' + endpoint, {
    method: input === undefined ? 'GET' : 'POST',
    headers: {Authorization:'Bearer ' + teacherKey, ...(form ? {} : {'Content-Type':'application/json'})},
    body: input === undefined || form ? input : JSON.stringify(input),
    signal: AbortSignal.timeout(5000),
   });
  }
  const classroom = await request('classes', {name:'高中数学'}).then(result => result.json());
  const classId = classroom.id;
  const listing = 'documents?classId=' + classId;
  assert.equal((await request('documents?classId=not-ours')).status, 404);
  assert.equal((await request(listing, undefined, 'other-key')).status, 401);
  for (const endpoint of [listing, 'documents/mount', 'documents/pin']) {
   const input = endpoint === listing ? undefined : {classId, docPath:location, mounted:true, pinStatus:true};
   assert.equal((await request(endpoint, input)).status, 400);
  }
  assert.equal((await request('shared-workspace', {classId, slug:'math'})).status, 200);
  const types = await request('documents/accepted-file-types').then(result => result.json());
  assert.ok(types.types.includes('.md') && types.types.includes('text/markdown'));
  fileTypesMissing = true;
  const fallback = await request('documents/accepted-file-types');
  assert.equal(fallback.status, 200);
  const fallbackTypes = (await fallback.json()).types;
  assert.ok(fallbackTypes.includes('.pdf') && fallbackTypes.includes('.docx'));
  if (process.platform === 'win32') assert.ok(fallbackTypes.includes('.jpg') && fallbackTypes.includes('.ppt'));
  fileTypesMissing = false;

  const form = (size = 0) => {
   const upload = new FormData();
   upload.append('file', new Blob([size ? new Uint8Array(size) : '# 顶点'], {type:'text/markdown'}), '二次函数.md');
   upload.append('classId', classId);
   upload.append('description', '二次函数与最值');
   upload.append('docSource', '数学手册');
   return upload;
  };
  const oversized = await request('documents/upload', form(21 * 1024 * 1024));
  assert.equal(oversized.status, 413);
  assert.match((await oversized.json()).error, /单文件上限 20MB/);

  const uploaded = await request('documents/upload', form());
  assert.equal(uploaded.status, 201);
  assert.equal((await uploaded.json()).document.description, '二次函数与最值');
  const recorded = calls.find(call => call.upload).upload;
  assert.deepEqual(recorded.fields, ['file', 'metadata']);
  assert.equal(recorded.file, '# 顶点');
  assert.match(recorded.metadata.title, /^doc-[a-f0-9]{8}$/);
  assert.equal(recorded.metadata.description, '二次函数与最值');
  assert.equal(recorded.metadata.docSource, '数学手册');
  assert.equal(calls.some(call => call.pathname.endsWith('/update-embeddings')), false);

  const first = await request(listing).then(result => result.json());
  assert.equal(first.documents[0].location, location);
  assert.deepEqual(first.mounted, []);
  assert.equal(first.vectorCount, 0);
  assert.equal(calls.find(call => call.pathname === '/api/v1/documents').query, '?folder=custom-documents&limit=all');
  const target = {classId, docPath:location, slug:'forged'};
  assert.deepEqual(await request('documents/mount', {...target, mounted:true}).then(result => result.json()),
   {mounted:[location], pinned:[]});
  assert.deepEqual((await request('documents/pin', {...target, pinStatus:true}).then(result => result.json())).pinned, [location]);
  assert.deepEqual((await request('documents/pin', {...target, pinStatus:false}).then(result => result.json())).pinned, []);
  const preview = await request('documents/preview', target).then(result => result.json());
  assert.equal(preview.snippets[0].length, 120);
  assert.deepEqual(calls.find(call => call.pathname.endsWith('/vector-search')).payload,
   {query:'二次函数与最值', topN:10, scoreThreshold:0.45});
  assert.deepEqual((await request('documents/mount', {...target, mounted:false}).then(result => result.json())).mounted, []);
  assert.deepEqual(calls.filter(call => call.pathname.endsWith('/update-embeddings')).map(call => call.payload),
   [{adds:[location], deletes:[]}, {adds:[], deletes:[location]}]);
  assert.equal(documents.length, 1);
  const generated = await request('documents/cards', {classId, docPath:location, subject:'高中数学'});
  assert.equal(generated.status, 200);
  const cardReport = await generated.json();
  assert.deepEqual(cardReport.documents.map(card=>card.description), ['顶点纵坐标规则']);
  assert.deepEqual(cardReport.failures, []);
  const cardPrompt = calls.find(call=>call.pathname.endsWith('/chat')).payload.message;
  assert.match(cardPrompt, /教研资料卡片编辑器/);
  assert.match(cardPrompt, /资料正文：开口向上的二次函数/);
  assert.equal(mounted.size, 0);
  const attached = await request('documents/cards/mount', {classId, docPaths:cardReport.documents.map(card=>card.location)});
  assert.deepEqual((await attached.json()).mounted, ['custom-documents/card.json']);
  assert.ok(calls.every(call => call.authorization === 'Bearer ' + key && !call.pathname.includes('forged')));

  uploadError = 'processing API is not online';
  const offlineCollector = await request('documents/upload', form());
  assert.equal(offlineCollector.status, 502);
  assert.match((await offlineCollector.json()).error, /资料解析服务未就绪/);
  uploadError = 'upstream failure ' + key;
  const brokenResponse = await request('documents/upload', form());
  assert.equal(brokenResponse.status, 502);
  const error = (await brokenResponse.json()).error;
  assert.match(error, /AnythingLLM 返回错误.*密钥已隐藏/);
  assert.ok(!error.includes(key));
  await new Promise(resolve => model.close(resolve));
  const offline = await request('documents/upload', form());
  assert.equal(offline.status, 502);
  assert.match((await offline.json()).error, /无法连接 AnythingLLM/);
 } finally {
  if (child && child.exitCode === null && child.signalCode === null) {
   const exited = once(child, 'exit');
   child.kill();
   await exited;
  }
  if (model.listening) await new Promise(resolve => model.close(resolve));
  await rm(directory, {recursive: true, force: true});
 }
});

async function withKnowledgeSearch(run, upstream) {
 const directory = await mkdtemp(join(tmpdir(), 'zhixu-knowledge-search-'));
 const modelKey = 'test-search-upstream-credential';
 const teacherKey = 'a'.repeat(48);
 const studentToken = 'b'.repeat(48);
 const unboundToken = 'c'.repeat(48);
 const calls = [];
 let child;
 const model = createServer(async (req, res) => {
  let raw = '';
  for await (const part of req) raw += part;
  calls.push({path:req.url, auth:req.headers.authorization, body:JSON.parse(raw)});
  const { status = 200, data } = upstream(calls.at(-1));
  res.writeHead(status, {'Content-Type':'application/json'});
  res.end(JSON.stringify(data));
 });
 try {
  await writeFile(join(directory, 'classrooms.json'), JSON.stringify({
   teacherKey,
   classes:[{id:'bound', name:'高一', sharedWorkspace:{slug:'course', name:'数学'}}, {id:'unbound', name:'高二'}],
   students:[{id:'student', classId:'bound', token:studentToken}, {id:'other', classId:'unbound', token:unboundToken}],
  }));
  model.listen(0, '127.0.0.1');
  await once(model, 'listening');
  child = spawn(process.execPath, [fileURLToPath(new URL('./classroom-server.mjs', import.meta.url))], {
   env:{...process.env, CLASSROOM_HOST:'127.0.0.1', CLASSROOM_PORT:'0', CLASSROOM_DATA_DIR:directory,
    CLASSROOM_ANYTHINGLLM_BASE_URL:'http://127.0.0.1:'+model.address().port, CLASSROOM_ANYTHINGLLM_API_KEY:modelKey},
   stdio:['ignore', 'pipe', 'inherit'],
  });
  let address;
  let output = '';
  for await (const part of child.stdout.iterator({destroyOnReturn:false})) {
   output += part;
   address = output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
   if (address) break;
  }
  assert.ok(address);
  const request = (type, payload, token) => fetch(address+'/api/classroom/'+type+'/knowledge-search', {
   method:'POST', headers:{'Content-Type':'application/json', ...(token ? {Authorization:'Bearer '+token} : {})},
   body:JSON.stringify(payload), signal:AbortSignal.timeout(5000),
  });
  await run({request, teacherKey, studentToken, unboundToken, calls, modelKey});
 } finally {
  if (child && child.exitCode === null && child.signalCode === null) {
   const exited = once(child, 'exit');
   child.kill();
   await exited;
  }
  if (model.listening) await new Promise(resolve => model.close(resolve));
  await rm(directory, {recursive:true, force:true});
 }
}

test('knowledge search checks role, class and query before upstream access', {timeout:15000}, () =>
 withKnowledgeSearch(async ({request, teacherKey, unboundToken, calls}) => {
  assert.equal((await request('teacher', {classId:'bound', query:'顶点'})).status, 401);
  assert.equal((await request('student', {query:'顶点'})).status, 401);
  assert.equal((await request('teacher', {classId:'missing', query:'顶点'}, teacherKey)).status, 404);
  assert.equal((await request('student', {query:'顶点'}, 'unknown')).status, 404);
  assert.equal((await request('teacher', {classId:'unbound', query:'顶点'}, teacherKey)).status, 400);
  assert.equal((await request('student', {query:'顶点'}, unboundToken)).status, 400);
  const empty = await request('teacher', {classId:'bound', query:'  '}, teacherKey);
  assert.equal(empty.status, 400);
  assert.equal((await empty.json()).error, '请输入搜索关键词');
  assert.equal((await request('teacher', {classId:'bound', query:'中'.repeat(201)}, teacherKey)).status, 400);
  assert.equal(calls.length, 0);
 }, () => ({data:{results:[]}})));

test('teacher knowledge search trims queries, maps results and omits raw metadata', {timeout:15000}, () =>
 withKnowledgeSearch(async ({request, teacherKey, calls, modelKey}) => {
  const response = await request('teacher', {classId:'bound', query:' 顶点 ', topN:2, slug:'forged', scoreThreshold:0}, teacherKey);
  assert.equal(response.status, 200);
  const {slug, results} = await response.json();
  assert.equal(slug, 'course');
  assert.deepEqual(results, [
   {id:'a', score:0.834, title:'函数', source:'函数手册', text:'顶'.repeat(1000)},
   {id:'b', score:0.761, title:'资料', source:'教研组', text:'说明'},
  ]);
  assert.deepEqual(calls, [{path:'/api/v1/workspace/course/vector-search', auth:'Bearer '+modelKey,
   body:{query:'顶点', topN:2, scoreThreshold:0.45}}]);
 }, () => ({data:{results:[
  {id:'a', score:'0.8344', text:'顶'.repeat(1001), distance:0.1, metadata:{title:'函数', description:'函数手册', docSource:'备用'}},
  {id:'empty', score:0.9, text:'   '},
  {id:'b', score:0.7614, text:' 说明 ', metadata:{title:'资料', docSource:'教研组'}},
 ]}})));

test('knowledge search separates empty results and sanitized upstream failures', {timeout:15000}, () =>
 withKnowledgeSearch(async ({request, teacherKey, modelKey, calls}) => {
  const empty = await request('teacher', {classId:'bound', query:'无命中', topN:11}, teacherKey);
  assert.equal(empty.status, 200);
  assert.deepEqual(await empty.json(), {slug:'course', results:[]});
  assert.equal(calls[0].body.topN, 5);
  const broken = await request('teacher', {classId:'bound', query:'故障'}, teacherKey);
  assert.equal(broken.status, 502);
  const error = (await broken.json()).error;
  assert.match(error, /AnythingLLM 返回错误.*密钥已隐藏/);
  assert.ok(!error.includes(modelKey));
 }, call => call.body.query === '故障'
  ? {status:500, data:{error:'上游运行失败 '+call.auth}}
  : {data:{results:[], message:'No embeddings found for this workspace.'}}));

test('student knowledge search uses membership workspace and rate limits a repeated request', {timeout:15000}, () =>
 withKnowledgeSearch(async ({request, studentToken, calls}) => {
  const input = {query:'顶点', topN:0, slug:'forged', classId:'unbound'};
  const first = await request('student', input, studentToken);
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), {slug:'course', results:[]});
  assert.equal(calls[0].path, '/api/v1/workspace/course/vector-search');
  assert.equal(calls[0].body.topN, 5);
  const second = await request('student', input, studentToken);
  assert.equal(second.status, 429);
  assert.equal((await second.json()).error, '操作太快，请稍后再试');
  assert.equal(calls.length, 1);
 }, () => ({data:{results:[]}})));
