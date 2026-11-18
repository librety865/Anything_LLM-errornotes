import {MOCK,slugs} from './config';
import {exams,type Exam,type Workspace,type MistakeRecord as R,type Batch,type Axis} from './types';
export type Scope={examType:Exam;slug:string;workspace_id?:string};
export type Meta={error?:string;raw?:string;evidenceError?:string;count:2|3;axis:Axis|''};
type Store={records:R[];batches:Batch[];meta:Record<string,Meta>};
const prefix=`zhixu-${MOCK?'mock':'real'}-v2`;
export const scopeKey=(s:Scope)=>s.workspace_id?.startsWith("remote:")||s.workspace_id?.startsWith("local:")||s.workspace_id==="personal"?`${prefix}:workspace:${encodeURIComponent(s.workspace_id)}`:`${prefix}:${encodeURIComponent(s.examType)}:${encodeURIComponent(s.slug)}`;
export const cacheRecoveryEvent = 'zhixu-cache-recovery';
const recoveries = new Map<string, boolean>();

export function read(s: Scope): Store {
 const key = scopeKey(s);
 const raw = localStorage.getItem(key);
 if (raw === null) return {records:[],batches:[],meta:{}};
 try {
  const store = JSON.parse(raw);
  if (!Array.isArray(store?.records) || !Array.isArray(store?.batches)
    || !store.meta || typeof store.meta !== 'object' || Array.isArray(store.meta)) {
   throw Error('错题缓存结构无效');
  }
  recoveries.delete(key);
  return store;
 } catch {
  const backupKey = key + '.corrupt';
  let saved = false;
  try {
   if (localStorage.getItem(backupKey) !== raw) localStorage.setItem(backupKey, raw);
   saved = true;
  } catch { /* Keep the original cache if backup is unavailable. */ }
  if (recoveries.get(key) !== saved && typeof window !== 'undefined') {
   recoveries.set(key, saved);
   window.dispatchEvent(new CustomEvent(cacheRecoveryEvent, {detail: saved
    ? '当前错题缓存无法读取，原始内容已备份至 '+backupKey+'。'
    : '当前错题缓存无法读取，本地存储也无法保存备份。'}));
  }
  return {records:[],batches:[],meta:{}};
 }
}
export function write(s: Scope, db: Store) {
 const key = scopeKey(s);
 if (recoveries.get(key) === false) {
  read(s);
  if (recoveries.get(key) === false) throw Error('错题缓存尚未备份，原始内容已保留。');
 }
 localStorage.setItem(key, JSON.stringify(db));
 if (s.workspace_id && typeof window !== 'undefined') {
  window.dispatchEvent(new CustomEvent('zhixu-workspace-records-changed', { detail: s.workspace_id }));
 }
}
function legacySpaces():Workspace[]{return JSON.parse(localStorage.getItem(prefix+':spaces')||'null')||exams.filter(e=>e!=='中考'||slugs[e]).map(e=>({id:e,name:`${e}备考工作区`,examType:e,slug:slugs[e]||(MOCK?`mock-${e}`:'')}))}
export function createSpace(examType:Exam,name:string,slug:string){if(!(exams as readonly string[]).includes(examType))throw Error('考试类型无效');if(typeof slug!=='string'||!slug.trim())throw Error('slug 必填');const rows=legacySpaces();if(rows.some(w=>w.examType===examType))throw Error('该考试工作区已存在');const w={id:examType,name:(typeof name==='string'?name.trim():'')||`${examType}备考工作区`,examType,slug:slug.trim()};localStorage.setItem(prefix+':spaces',JSON.stringify([...rows,w]));return w}
export function scope(id:string):Scope{const w=spaces().find(w=>w.id===id);if(!w)throw Error('请先选择工作区');return {workspace_id:w.id,examType:w.examType,slug:w.slug||''}}
type CustomWorkspace = Workspace & {archived?: boolean};
const customSpacesKey = prefix + ':custom-spaces';

function customSpaces(): CustomWorkspace[] {
 return JSON.parse(localStorage.getItem(customSpacesKey) || '[]');
}

function workspaceName(name: string) {
 const clean = name.trim();
 if (!clean || clean.length > 50) throw Error('工作区名称须为 1–50 个字符');
 return clean;
}

export function createLocalWorkspace(name: string, slug: string): Workspace {
 const clean = workspaceName(name);
 if (!MOCK && (!slug || !spaces().some(workspace => workspace.slug === slug))) {
  throw Error('请选择一个已连接的 AnythingLLM 工作区');
 }
 return saveLocalWorkspace(clean, MOCK ? '' : slug);
}

export function createClassroomWorkspace(name: string): Workspace {
 return saveLocalWorkspace(workspaceName(name), '');
}

function saveLocalWorkspace(name: string, slug: string): Workspace {
 const workspace = {id: 'local:' + crypto.randomUUID(), name, examType: '', slug};
 localStorage.setItem(customSpacesKey, JSON.stringify([...customSpaces(), workspace]));
 return workspace;
}

export function archivedWorkspaces() {
 const names: Record<string, string> = JSON.parse(localStorage.getItem(prefix + ':workspace-names') || '{}');
 return customSpaces().filter(workspace => workspace.id.startsWith('local:') && workspace.archived)
  .map(workspace => ({...workspace, name: names[workspace.id] ?? workspace.name}));
}

export function setWorkspaceArchived(id: string, archived: boolean) {
 const rows = customSpaces();
 if (!id.startsWith('local:') || !rows.some(workspace => workspace.id === id)) {
  throw Error('自定义工作区不存在');
 }
 localStorage.setItem(customSpacesKey, JSON.stringify(rows.map(workspace =>
  workspace.id === id ? {...workspace, archived} : workspace
 )));
}

export function spaces():Workspace[]{
 const legacy=legacySpaces();
 const extra = customSpaces().filter(workspace => !workspace.archived);
 const names:Record<string,string>=JSON.parse(localStorage.getItem(prefix+':workspace-names')||'{}');
 return [...legacy,...extra,{id:'personal',name:MOCK?'个人工作区（演示）':'个人工作区（未连接）',examType:'',slug:''}].map(w=>({...w,name:Object.prototype.hasOwnProperty.call(names,w.id)?names[w.id]:w.name}));
}
export function connectWorkspace(name:string,slug:string){
 if(!slug.trim())throw Error('请选择工作区');
 const existing=spaces().find(w=>w.slug===slug);
 if(existing)return existing;
 const rows = customSpaces();
 const w={id:'remote:'+slug,name,slug,examType:''};
 localStorage.setItem(customSpacesKey, JSON.stringify([...rows, w]));return w;
}
export function initialWorkspace(){const saved=localStorage.getItem(prefix+':current-workspace');return spaces().some(w=>w.id===saved)?saved!: 'personal';}
export function selectWorkspace(id:string){scope(id);localStorage.setItem(prefix+':current-workspace',id);}

export function get(s:Scope,id:string){const r=read(s).records.find(r=>r.id===id&&(!r.workspace_id||r.workspace_id===s.workspace_id));if(!r)throw Error('记录不属于当前考试类型与 slug');return r}

// First binding can carry failed local submissions that never reached a remote workspace.
export function bindSpace(examType:Exam,name:string,slug:string){
 if(MOCK)throw Error('请先关闭 mock 再绑定真实工作区');
 slug=slug.trim();
 if(!(exams as readonly string[]).includes(examType)||!slug)throw Error('考试类型或 slug 无效');
 const rows=spaces();
 const existing=rows.find(w=>w.examType===examType);
 if(rows.some(w=>w.examType!==examType&&w.slug===slug))throw Error('该工作区已绑定其他考试，不可混放');
 let carry:Store|undefined;
 if(existing&&existing.slug!==slug){
  const saved=read({examType,slug:existing.slug||''});
  if(saved.records.length||saved.batches.length){
   if(existing.slug)throw Error('已有记录的工作区不可更换绑定，请先导出并另行处理数据');
   if(saved.records.some(r=>r.examType!==examType||r.status!=='加工失败')||saved.batches.some(b=>b.examType!==examType))throw Error('未绑定记录仍在加工或状态异常，请等待处理结束后再绑定');
   carry=saved;
  }
 }
 const workspace={id:existing?.id||examType,name,examType,slug};
 const destination={examType,slug};
 const destinationKey=scopeKey(destination);
 const previous=localStorage.getItem(destinationKey);
 if(carry){
  const target=read(destination);
  if(target.records.length||target.batches.length)throw Error('目标本地缓存已有数据，请先核对后再绑定');
  write(destination,carry);
 }
 try{localStorage.setItem(prefix+':spaces',JSON.stringify([...rows.filter(w=>w.examType!==examType),workspace]));}
 catch(error){if(carry){if(previous===null)localStorage.removeItem(destinationKey);else localStorage.setItem(destinationKey,previous);}throw error;}
 return workspace;
}

export function renameWorkspace(id:string,name:string){
 const clean = workspaceName(name);
 if(!spaces().some(w=>w.id===id))throw Error('工作区不存在，请刷新后重试');
 const names:Record<string,string>=JSON.parse(localStorage.getItem(prefix+':workspace-names')||'{}');
 localStorage.setItem(prefix+':workspace-names',JSON.stringify({...names,[id]:clean}));
}
