import {loadOriginal,compress} from './imageStore';
import {MOCK} from './config';
import {generate,mockRequest} from './mockService';
import {membership, workspaceChat} from './classroomClient';
import {parseProcessing,parseFeedback,missingReferenceHint} from './parsers';
import {retrieveEvidence} from './evidence';
import {buildMistakeProcessingPrompt,buildVariantFeedbackPrompt} from './prompts';
import {summarize} from './summary';
import * as repo from './localRepository';
import type {Input,MistakeRecord as R,Axis,Batch,Exam} from './types';
export const cleared={errorTags:[],breakpoint:{location:'',rootCause:'',nextAction:''},motherQuestion:{point:'',conditionToRequirement:'',entryJudgment:'',failureCondition:''},variants:[],solutionTemplate:[],pendingGap:undefined,modelAnswer:undefined,evidence:undefined,evidenceError:undefined};
export const stripFeedback=(record:R):R=>({...record,variants:record.variants.map(({feedback,...variant})=>variant)});
const inflight=new Set<string>();
const queued=new Set<string>();
async function initialize(s:repo.Scope){if(MOCK&&s.examType&&!localStorage.getItem(repo.scopeKey(s))){const rows=await mockRequest(`/api/mistakes?examType=${encodeURIComponent(s.examType)}`);repo.write(s,{records:rows,batches:[],meta:{}})}}
function put(s: repo.Scope, record: R, meta?: repo.Meta) {
 const db = repo.read(s);
 db.records = [record, ...db.records.filter(item => item.id !== record.id)];
 if (meta) db.meta[record.id] = meta;
 repo.write(s, db);
}
export async function processOne(s: repo.Scope, id: string, count: 2 | 3, axis: Axis | '') {
 const key = repo.scopeKey(s) + id;
 if (inflight.has(key)) throw Error('记录正在加工');
 inflight.add(key);
 let record: R | undefined;
 let raw = '';
 let evidenceError: string | undefined;
 try {
  record = {...repo.get(s, id), ...structuredClone(cleared), status:'加工中', updatedAt:new Date().toISOString()};
  put(s, record, {count, axis});
  if (MOCK && !membership(s.workspace_id)) {
   await new Promise(resolve => setTimeout(resolve, 500));
   record = {...generate(record, count, id), createdAt:record.createdAt};
  } else {
   const attachments = await Promise.all((record.images || []).map(async image => ({
    name:image.name, mime:'image/jpeg', contentString:await compress(await loadOriginal(image.originalImageId)),
   })));
   const {items, error} = await retrieveEvidence(s, record);
   evidenceError = error || undefined;
   raw = await workspaceChat(s, buildMistakeProcessingPrompt(record, count, axis, items), attachments);
   record = {...parseProcessing(raw, record, count), evidence:items, evidenceError};
  }
  record.updatedAt = new Date().toISOString();
  put(s, record, {count, axis, evidenceError});
 } catch (error) {
  if (!record) throw error;
  record = {...record, ...structuredClone(cleared), status:'加工失败', updatedAt:new Date().toISOString(), evidenceError};
  put(s, record, {count, axis, error:String(error), raw, evidenceError});
 } finally {
  inflight.delete(key);
 }
 return stripFeedback(record);
}
export async function serial<T>(items:T[],run:(item:T)=>Promise<unknown>,progress:(n:number,total:number)=>void){for(let i=0;i<items.length;i++){progress(i+1,items.length);try{await run(items[i])}catch{/* individual task owns its visible failure */}}}
export const batchLimit = 10;
type BatchStarted = (id: string) => void;

async function batch(
 s: repo.Scope, ids: string[], count: 2 | 3, axis: Axis | '', source: Batch['source'],
 progress: (n: number, total: number) => void, onStarted?: BatchStarted,
) {
 const keys = ids.map(id => repo.scopeKey(s) + id);
 if (keys.some(key => inflight.has(key) || queued.has(key))) throw Error('所选记录已有加工任务');
 const b: Batch = {
  id:crypto.randomUUID(), ids, examType:s.examType, workspace_id:s.workspace_id,
  source, summary:summarize([]),
 };
 const db = repo.read(s);
 const selected = new Set(ids);
 const updatedAt = new Date().toISOString();
 db.records = db.records.map(record => selected.has(record.id)
  ? {...record, ...structuredClone(cleared), status:'加工中', updatedAt}
  : record);
 db.batches.push(b);
 keys.forEach(key => queued.add(key));
 try {
  repo.write(s, db);
  onStarted?.(b.id);
  await serial(ids, id => processOne(s, id, count, axis), progress);
 } finally {
  keys.forEach(key => queued.delete(key));
 }
 const rows = await Promise.all(ids.map(id => service.detail(s, id)));
 const finished = repo.read(s);
 finished.batches = finished.batches.map(item => item.id === b.id
  ? {...item, summary:summarize(rows)}
  : item);
 repo.write(s, finished);
 return {records:rows, batchId:b.id};
}
export const service={
 async list(s:repo.Scope,filters:Record<string,string>){await initialize(s);return repo.read(s).records.filter(r=>(!r.workspace_id||r.workspace_id===s.workspace_id)&&Object.entries(filters).every(([k,v])=>!v||(k==='keyword'?`${r.originalQuestion} ${r.errorTags.join(' ')}`.includes(v):k==='errorTag'?r.errorTags.includes(v):String(r[k as keyof R])===v))).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).map(stripFeedback)},
 async detail(s:repo.Scope,id:string){await initialize(s);let r=repo.get(s,id);if(r.status==='加工中'&&!inflight.has(repo.scopeKey(s)+id)&&!queued.has(repo.scopeKey(s)+id)){r={...r,...structuredClone(cleared),status:'加工失败'};put(s,r);const db=repo.read(s);db.meta[id]={count:db.meta[id]?.count||2,axis:db.meta[id]?.axis||'',error:'请求已中断，请重试'};repo.write(s,db)}return stripFeedback(r)},
 async create(s:repo.Scope,items:Input[],count:2|3,axis:Axis|'',progress:(n:number,total:number)=>void,onStarted?:BatchStarted){if(items.length>batchLimit)throw Error('每批最多提交 '+batchLimit+' 道错题');if(!MOCK&&!s.slug.trim()&&!membership(s.workspace_id))throw Error('请先在偏好设置中连接 AnythingLLM 工作区，再提交错题。');if(!items.length||items.some(i=>!i.originalQuestion.trim()))throw Error('原题、作答或工作区不正确');const rows=items.map(i=>({...i,examType:'',workspace_id:s.workspace_id,...structuredClone(cleared),id:crypto.randomUUID(),status:'加工中' as const,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}));rows.forEach(r=>put(s,r));return batch(s,rows.map(r=>r.id),count,axis,'batch-create',progress,onStarted)},
 async process(s:repo.Scope,ids:string[],axis:Axis,count:2|3,progress:(n:number,total:number)=>void,onStarted?:BatchStarted){if(ids.length>batchLimit)throw Error('每批最多整理 '+batchLimit+' 道错题');if(!['知识点','错误点'].includes(axis)||!ids.length)throw Error('请选择分类轴和记录');ids.forEach(id=>repo.get(s,id));return batch(s,ids,count,axis,'batch-process',progress,onStarted)},
 async feedback(s:repo.Scope,id:string,variantId:string){const r=repo.get(s,id);if(r.status!=='已加工')throw Error('该记录不可请求反馈');if(MOCK&&!membership(s.workspace_id)){const v=r.variants.find(v=>v.id===variantId);if(!v)throw Error('变式不存在');return {changePoint:'模拟：条件检查',standardProcess:r.referenceAnswer||'模拟过程',scoringPoints:'模拟：核对条件与结论',firstCommonError:'模拟：遗漏条件'};}return parseFeedback(await workspaceChat(s,buildVariantFeedbackPrompt(r,variantId,repo.read(s).meta[id]?.count||(r.variants.length===3?3:2),repo.read(s).meta[id]?.axis||'')))},
 async batch(s:repo.Scope,id:string){const b=repo.read(s).batches.find(b=>b.id===id&&(!b.workspace_id||b.workspace_id===s.workspace_id));if(!b)throw Error('批次不属于当前考试类型与 slug');return {...b,summary:summarize(b.ids.map(id=>repo.get(s,id)))}},
 async retry(s:repo.Scope,id:string,referenceAnswer?:string,originalQuestion?:string){
  if(originalQuestion!==undefined||referenceAnswer!==undefined){
   const record=repo.get(s,id);
   const supplement=originalQuestion?.trim();
   const reference=referenceAnswer?.trim();
   if(record.status!=='待确认'||(!supplement&&!reference))throw Error('请补充记录中提示的关键信息');
   if(record.clarificationUsed)throw Error('此题已补充一次，请核对原始资料');
   put(s,{...record,clarification:supplement,clarificationUsed:true,
    referenceAnswer:reference||record.referenceAnswer,updatedAt:new Date().toISOString()});
  }
  const meta=repo.read(s).meta[id];
  return processOne(s,id,meta?.count||2,meta?.axis||'');
 }
};
