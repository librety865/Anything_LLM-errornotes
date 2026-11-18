import {MOCK} from './config';
import {spaces} from './localRepository';
import {readBackupImages, replaceBackupImages} from './imageStore';

const format = 'zhixu-workbench-backup';
const dataKey = /^zhixu-(?:prefs|exam|mock-v1|(?:mock|real)-v2:(?:spaces|custom-spaces|workspace-names|current-workspace|[^:]+:[^:]*))$/;
type Backup = {
 format: typeof format;
 version: 1;
 mode: 'demo' | 'real';
 entries: [string, string][];
 images: [string, string][];
};

function readEntries(): [string, string][] {
 const entries: [string, string][] = [];
 for (let index = 0; index < localStorage.length; index++) {
  const key = localStorage.key(index);
  if (key && dataKey.test(key)) {
   const value = localStorage.getItem(key);
   if (value !== null) entries.push([key, value]);
  }
 }
 return entries;
}

function encodeImage(image: Blob): Promise<string> {
 return new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(Error('无法读取备份图片'));
  reader.readAsDataURL(image);
 });
}

export async function exportBackup() {
 const mode = MOCK ? 'demo' : 'real';
 const entries = new Map(readEntries());
 const legacyKey = `zhixu-${MOCK ? 'mock' : 'real'}-v2:spaces`;
 if (!entries.has(legacyKey)) {
  entries.set(legacyKey, JSON.stringify(spaces().filter(workspace => workspace.examType)));
 }
 const images: Backup['images'] = [];
 for (const [id, blob] of await readBackupImages()) images.push([id, await encodeImage(blob)]);
 const backup: Backup = {format, version: 1, mode, entries: [...entries], images};
 const url = URL.createObjectURL(new Blob([JSON.stringify(backup)], {type:'application/json'}));
 const link = document.createElement('a');
 link.href = url;
 link.download = '知序数据备份-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
 link.click();
 setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function isPair(value: unknown): value is [string, string] {
 return Array.isArray(value) && value.length === 2 && value.every(item => typeof item === 'string');
}

function isObject(value: unknown): value is Record<string, unknown> {
 return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function inspectBackup(file: File) {
 const data: unknown = JSON.parse(await file.text());
 if (!isObject(data) || data.format !== format || data.version !== 1 ||
     (data.mode !== 'real' && data.mode !== 'demo') ||
     !Array.isArray(data.entries) || !data.entries.every(isPair) ||
     !Array.isArray(data.images) || !data.images.every(isPair)) {
  throw Error('请选择由知序导出的数据备份文件');
 }
 const entries = new Map<string, string>();
 for (const [key, value] of data.entries) {
  if (!dataKey.test(key) || entries.has(key)) throw Error('备份包含无效或重复的存储项');
  if (key.endsWith(':current-workspace')) {
   if (!value.trim()) throw Error('备份中的工作区无效');
  } else {
   const parsed: unknown = JSON.parse(value);
   if (key.endsWith(':spaces') || key.endsWith(':custom-spaces')) {
    if (!Array.isArray(parsed) || !parsed.every(row => isObject(row) &&
       typeof row.id === 'string' && typeof row.name === 'string' && typeof row.examType === 'string' &&
       (row.slug === undefined || typeof row.slug === 'string'))) throw Error('备份中的工作区列表无效');
   } else if (key === 'zhixu-exam') {
    if (typeof parsed !== 'string') throw Error('备份中的旧工作区无效');
   } else {
    if (!isObject(parsed)) throw Error('备份数据结构无效');
    if (/^zhixu-(?:real|mock)-v2:[^:]+:/.test(key) || key === 'zhixu-mock-v1') {
     if (!Array.isArray(parsed.records) || !Array.isArray(parsed.batches)) throw Error('备份中的错题库结构无效');
    }
   }
  }
  entries.set(key, value);
 }
 const images = new Map<string, Blob>();
 for (const [id, encoded] of data.images) {
  const match = /^data:(image\/[a-z0-9.+-]+|application\/octet-stream);base64,([A-Za-z0-9+/=]*)$/i.exec(encoded);
  if (!id || images.has(id) || !match) throw Error('备份中的原图格式无效');
  const bytes = Uint8Array.from(atob(match[2]), character => character.charCodeAt(0));
  images.set(id, new Blob([bytes], {type: match[1]}));
 }
 return {entries, images, mode:data.mode};
}

function writeEntries(entries: Map<string, string>) {
 for (const [key] of readEntries()) if (!entries.has(key)) localStorage.removeItem(key);
 for (const [key, value] of entries) localStorage.setItem(key, value);
}

export async function restoreBackup(backup: Awaited<ReturnType<typeof inspectBackup>>) {
 const previous = new Map(readEntries());
 try {
  writeEntries(backup.entries);
  await replaceBackupImages([...backup.images]);
 } catch (error) {
  writeEntries(previous);
  throw error;
 }
}
