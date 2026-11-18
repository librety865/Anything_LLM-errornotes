import { randomBytes, randomUUID } from 'node:crypto';
import { basename } from 'node:path';

export const documentFileLimit = 20 * 1024 * 1024;
const multipartLimit = documentFileLimit + 32 * 1024;
const fileTooLarge = '单文件上限 20MB，请拆分或压缩';

function fail(status, message) {
  throw Object.assign(new Error(message), { status });
}

export async function readDocumentUpload(req) {
  const type = req.headers['content-type'];
  if (!/^multipart\/form-data\s*;/i.test(type || '')) fail(415, '请选择一个文件后重新上传');
  if (Number(req.headers['content-length']) > multipartLimit) {
    req.resume();
    fail(413, fileTooLarge);
  }
  const chunks = [];
  let length = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    length += chunk.length;
    if (length > multipartLimit) {
      req.resume();
      fail(413, fileTooLarge);
    }
    chunks.push(chunk);
  }
  let form;
  try {
    form = await new Response(Buffer.concat(chunks, length), { headers: { 'Content-Type': type } }).formData();
  } catch {
    fail(400, '上传格式无效，请重新选择文件');
  }
  const file = form.get('file');
  if (!(file instanceof Blob) || !file.size) fail(400, '请选择一个非空文件');
  if (file.size > documentFileLimit) fail(413, fileTooLarge);
  return {
    file,
    classId: form.get('classId'),
    description: form.get('description'),
    docSource: form.get('docSource'),
  };
}

export function libraryUpstreamError(status, raw, key) {
  const clean = (key ? raw.split(key).join('[密钥已隐藏]') : raw).trim();
  if (status === 500 && /processing API is not online|fetch failed/i.test(clean)) {
    fail(502, '资料解析服务未就绪，请稍后重试');
  }
  if (status >= 500) fail(502, 'AnythingLLM 返回错误：' + clean.slice(0, 200));
  fail(502, 'AnythingLLM 未接受请求（HTTP ' + status + '）：' + clean.slice(0, 200));
}

const folder = 'custom-documents';
const text = value => typeof value === 'string' ? value : '';
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const workspacePath = slug => '/api/v1/workspace/' + encodeURIComponent(slug);

export function documentPath(value) {
  if (typeof value !== 'string' || !/^custom-documents\/[^/\\\u0000-\u001f]+\.json$/i.test(value)) {
    fail(400, '资料路径无效，请刷新列表后重试');
  }
  return value;
}

function normalizeDocument(item, location) {
  return {
    location,
    name: text(item.name) || basename(location),
    title: text(item.title),
    description: text(item.description),
    docSource: text(item.docSource),
    wordCount: count(item.wordCount),
    token_count_estimate: count(item.token_count_estimate),
  };
}

export function createClassroomLibrary({ modelRequest, key, address }) {
  const hideKey = value => key ? value.split(key).join('[密钥已隐藏]') : value;
  const request = (path, body, allowMissing = false) => modelRequest(path, body, 20000, { allowMissing });

  async function uploadDocument(buffer, filename, mime, metadata, timeout = 120000) {
    if (!key) fail(503, '请先在教师端配置 AnythingLLM Developer API Key，再重启');
    const target = new URL('/api/v1/document/upload', address);
    if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) {
      fail(503, 'AnythingLLM 地址无效，请检查教师端配置');
    }
    const body = new FormData();
    body.append('file', new Blob([buffer], { type: mime }), basename(filename));
    body.append('metadata', JSON.stringify({ ...metadata, title: 'doc-' + randomBytes(4).toString('hex') }));
    let response;
    let raw;
    try {
      response = await fetch(target, { method: 'POST', body,
        headers: { Authorization: 'Bearer ' + key }, redirect: 'error', signal: AbortSignal.timeout(timeout) });
      raw = await response.text();
    } catch (error) {
      if (error.name === 'TimeoutError') fail(504, '上传处理超时，请先刷新资料列表，再决定是否重试');
      fail(502, '无法连接 AnythingLLM，请确认它已启动后重试');
    }
    if (!response.ok) libraryUpstreamError(response.status, raw, key);
    let result;
    try { result = JSON.parse(hideKey(raw)); }
    catch { fail(502, '无法读取 AnythingLLM 的上传结果，请刷新列表后重试'); }
    const item = result?.documents?.[0];
    if (result?.success !== true || !item?.location) {
      fail(502, 'AnythingLLM 未确认入库，请刷新列表后重试：' + text(result?.error).slice(0, 200));
    }
    const doc = normalizeDocument(item, documentPath(item.location));
    return { ...doc, description: doc.description || metadata.description, docSource: doc.docSource || metadata.docSource };
  }

  async function listDocuments() {
    const result = await request('/api/v1/documents?folder=custom-documents&limit=all', undefined, true);
    if (result === null) return [];
    if (!Array.isArray(result?.documents)) fail(502, '资料列表格式异常，请检查 AnythingLLM 后重试');
    return result.documents.filter(item => item?.type !== 'folder' && typeof item?.name === 'string' && /^[^/\\\u0000-\u001f]+\.json$/i.test(item.name))
      .map(item => normalizeDocument(item, folder + '/' + item.name));
  }

  async function workspaceDocuments(slug) {
    const result = await request(workspacePath(slug));
    const workspaces = result?.workspace;
    const workspace = Array.isArray(workspaces)
      ? workspaces.find(item => item?.slug === slug) ?? (workspaces.length === 1 && !workspaces[0]?.slug ? workspaces[0] : null)
      : null;
    if (!Array.isArray(workspace?.documents)) fail(502, '共享工作区资料无法读取，请确认工作区仍存在');
    const documents = workspace.documents.filter(item => typeof item?.docpath === 'string');
    return {
      mounted: [...new Set(documents.map(item => item.docpath))],
      pinned: [...new Set(documents.filter(item => item.pinned === true).map(item => item.docpath))],
    };
  }

  async function updateEmbeddings(slug, adds, deletes, timeout = 20000) {
    const result = await modelRequest(workspacePath(slug) + '/update-embeddings', { adds, deletes }, timeout, {});
    if (result?.success === false || result?.error) fail(502, '资料挂载更新失败，请检查资料解析与检索服务后重试');
    return workspaceDocuments(slug);
  }

  async function updatePin(slug, docPath, pinStatus) {
    const result = await request(workspacePath(slug) + '/update-pin', { docPath, pinStatus });
    if (result?.success === false || result?.error) fail(502, '资料置顶更新失败，请刷新列表后重试');
    return workspaceDocuments(slug);
  }

  async function vectorCount() {
    return count((await request('/api/v1/system/vector-count'))?.vectorCount);
  }

  async function acceptedFileTypes() {
    const result = await request('/api/v1/document/accepted-file-types', undefined, true);
    const localFormats = ['.ppt'];
    if (process.platform === 'win32') localFormats.push('.jpg', '.jpeg', '.png', '.bmp', '.tif', '.tiff');
    if (result === null) return ['.txt', '.md', '.pdf', '.docx', '.pptx', ...localFormats];
    const entries = new Set();
    function collect(value) {
      if (typeof value === 'string') {
        if (/^(?:\.[a-z0-9_-]+|[a-z][a-z0-9.+-]*\/[a-z0-9.+*-]+)$/i.test(value)) entries.add(value.toLowerCase());
      } else if (Array.isArray(value)) {
        value.forEach(collect);
      } else if (value && typeof value === 'object') {
        Object.entries(value).forEach(([name, item]) => { collect(name); collect(item); });
      }
    }
    collect(result);
    if (!entries.size) fail(502, '无法读取支持的文件类型，请确认 AnythingLLM 已启动后重试');
    return [...new Set([...entries, ...localFormats])];
  }

  async function search(slug, query, topN = 5, scoreThreshold = 0.45) {
    const result = await modelRequest(workspacePath(slug) + '/vector-search',
      { query, topN, scoreThreshold }, 15000, { search: true });
    if (!Array.isArray(result?.results)) fail(502, '无法读取检索结果，请检查 AnythingLLM 后重试');
    const results = result.results.filter(item => typeof item?.text === 'string' && item.text.trim())
      .slice(0, topN).map(item => {
        const score = typeof item.score === 'string' || typeof item.score === 'number' ? Number(item.score) : 0;
        const title = text(item.metadata?.title).trim();
        return {
          id: text(item.id).trim() || randomUUID(),
          score: Number.isFinite(score) ? Math.round(score * 1000) / 1000 : 0,
          title,
          source: text(item.metadata?.description).trim() || text(item.metadata?.docSource).trim(),
          text: item.text.trim().slice(0, 1000),
        };
      });
    return { results };
  }

  async function preview(slug, query) {
    const result = await request(workspacePath(slug) + '/vector-search', { query, topN: 10, scoreThreshold: 0.45 });
    if (!Array.isArray(result?.results)) fail(502, '无法读取资料片段，请确认资料已挂载后重试');
    return result.results.filter(item => typeof item?.text === 'string' && item.text.trim())
      .slice(0, 10).map(item => item.text.trim().slice(0, 120));
  }

  async function requestCardModel(slug, prompt, timeout) {
    const result = await modelRequest(workspacePath(slug) + '/chat', {
      message:prompt, mode:'chat', attachments:[],
      sessionId:'zhixu-card-' + randomUUID(),
    }, timeout, {});
    return result?.textResponse;
  }

  return { uploadDocument, listDocuments, workspaceDocuments, updateEmbeddings, updatePin, vectorCount,
    acceptedFileTypes, preview, search, requestCardModel };
}
