import {createSpace,spaces} from './localRepository';
import {exams,type MistakeRecord as R,type Input,type Exam,type Axis,type Batch,type Workspace,type Feedback} from './types';
const KEY='zhixu-mock-v1';
const empty = {breakpoint:{location:'',rootCause:'',nextAction:''},motherQuestion:{point:'',conditionToRequirement:'',entryJudgment:'',failureCondition:''},variants:[],solutionTemplate:[],errorTags:[]};
const now=()=>new Date().toISOString();
export function generate(input:Input,count:2|3,id:string=crypto.randomUUID()):R {
 const base:R={...input,...structuredClone(empty),id,status:'待确认',createdAt:now(),updatedAt:now()};
 if(!input.referenceAnswer?.trim()&&!input.gradingResult?.trim())return {...base,pendingGap:'请补充参考答案，作为本题的判定依据。'};
 // Mock deliberately avoids diagnosing arbitrary submitted answers.
 return {...base,status:'已加工',errorTags:['模拟示例 · 待人工核对'],breakpoint:{location:'示例：条件到结论的推导环节（非真实诊断）',rootCause:'模拟流程不判断真实错因，请接入后端后核对',nextAction:'逐项对照给定判定依据'},motherQuestion:{point:input.module||'待标注考点',conditionToRequirement:'整理题干条件 → 明确求解目标（模拟模板）',entryJudgment:'先识别条件与目标的关系',failureCondition:'条件不足或依据不可靠时停止推导'},variants:Array.from({length:count},(_,i)=>({id:`${id}-v${i+1}`,label:`V${i+1}` as 'V1'|'V2'|'V3',dimension:(['数值','关键条件','提问方向'] as const)[i],stem:`模拟练习 ${i+1}：${input.originalQuestion}\n请${['标出已知数值并重新作答','列出关键条件后重新作答','写出题目目标并说明入口判断'][i]}。`,feedback:{changePoint:['聚焦数值检查','聚焦条件检查','聚焦目标识别'][i],standardProcess:`对照判定依据：${input.referenceAnswer||input.gradingResult}。本段为流程模拟，不是自动生成的标准答案。`,scoringPoints:'模拟：条件提取、方法选择、结果核对；实际评分需后端提供。',firstCommonError:'模拟示例：跳过条件检查。'}})),solutionTemplate:['提取已知条件','明确求解目标','选择适用方法','执行推导计算','核对判定依据']};
}
function seed():R[]{return [
 ['高考','数学','二次函数','解答题','已知 f(x)=x²−4x+3，求最小值。','最小值为 3','最小值为 −1，在 x=2 时取得。',2],
 ['高考','数学','集合','选择题','A={1,2,3}，B={2,3,4}，求 A∩B。','{1,4}','{2,3}',3],
 ['高考','物理','运动学','计算题','物体由静止开始加速，求 5 秒后的速度。','10 m/s','',2],
 ['考研','数学','导数','计算题','求 f(x)=x ln x 的导数。','ln x','ln x+1（x>0）',3],
 ['考研','英语','阅读理解','选择题','阅读材料未提供，请判断作者态度。','支持','',2],
 ['考公','行政职业能力测验','资料分析','计算题','某指标由 100 增至 120，求增长率。','120%','20%',2],
 ['考公','行政职业能力测验','数量关系','选择题','某工程由甲乙合作完成，求所需时间（效率未提供）。','6 天','',3],
 ].map((a,i)=>generate({examType:a[0] as Exam,subject:String(a[1]),module:String(a[2]),questionType:String(a[3]),originalQuestion:String(a[4]),userAnswer:String(a[5]),referenceAnswer:String(a[6]),difficulty:3},a[7] as 2|3,`demo-${i+1}`));}
type DB={records:R[];batches:Batch[];workspaces:Workspace[]};
let memory:DB|undefined;
function db():DB {if(memory)return memory;try{const raw=localStorage.getItem(KEY);if(raw)return memory=JSON.parse(raw);}catch{/* reset corrupt demo storage */}return memory={records:seed(),batches:[],workspaces:exams.filter(e=>e!=='中考').map(examType=>({id:examType,name:`${examType}备考工作区`,examType}))};}
function save(){localStorage.setItem(KEY,JSON.stringify(db()));}
const strip=(r:R):R=>({...r,variants:r.variants.map(({feedback,...v})=>v)});
const pause=()=>new Promise(r=>setTimeout(r,500));
function settle(){let changed=false;db().records=db().records.map(r=>{if(r.status==='加工中'&&Date.now()-Date.parse(r.updatedAt)>1200){changed=true;return {...generate(r,r.variants.length===3?3:2,r.id),createdAt:r.createdAt};}return r;});if(changed)save();}
export async function mockRequest(path:string,method='GET',body?:any):Promise<any>{
 await pause();settle();const url=new URL(path,'http://mock.local');const p=url.pathname;
 if(p==='/api/workspaces'&&method==='POST')return createSpace(body?.examType,body?.name,body?.slug);
 if(p==='/api/workspaces')return structuredClone(spaces());
 if(p==='/api/mistakes'&&method==='GET'){return db().records.filter(r=>Array.from(url.searchParams).every(([k,v])=>!v||(k==='keyword'?`${r.originalQuestion} ${r.errorTags.join(' ')}`.toLowerCase().includes(v.toLowerCase()):k==='errorTag'?r.errorTags.includes(v):String(r[k as keyof R])===v))).map(strip);}
 if(p==='/api/mistakes'&&method==='POST'){
  const inputs:Input[]=body.items||[body];if(!inputs.length||inputs.some(i=>!i.originalQuestion.trim()||!i.userAnswer.trim()))throw Error('原题和用户作答不能为空');
  if(new Set(inputs.map(i=>i.examType)).size!==1)throw Error('不同考试类型不可混放');
  const records=inputs.map(i=>{const r=generate(i,body.variantCount||2);return {...r,status:'加工中' as const};});db().records.unshift(...records);
  const batch=makeBatch(records,'batch-create');save();return {records:records.map(strip),batchId:batch.id};
 }
 if(p==='/api/mistakes/batch-process'){
  if(!['知识点','错误点'].includes(body.classificationAxis))throw Error('请选择分类轴');
  const records:R[]=body.ids.map((id:string)=>db().records.find(r=>r.id===id));
  if(!records.length||records.some(r=>!r)||new Set(records.map(r=>r.examType)).size!==1)throw Error('请选择同一工作区的有效记录');
  if(records.some(r=>r.status==='加工中'))throw Error('请等待当前加工完成');
  for(const r of records){Object.assign(r,generate(r,body.variantCount,r.id),{createdAt:r.createdAt});}
  const batch=makeBatch(records,'batch-process',body.classificationAxis);save();return {batchId:batch.id};
 }
 const feedback=p.match(/^\/api\/mistakes\/([^/]+)\/variants\/([^/]+)\/feedback$/);
 if(feedback){const r=db().records.find(r=>r.id===feedback[1]);const f=r?.status==='已加工'?r.variants.find(v=>v.id===feedback[2])?.feedback:undefined;if(!f)throw Error('当前反馈不可用');return structuredClone(f);}
 if(p.startsWith('/api/mistakes/')){const r=db().records.find(r=>r.id===p.split('/')[3]);if(!r)throw Error('记录不存在');return strip(r);}
 if(p.startsWith('/api/batch-summary/')){const b=db().batches.find(b=>b.id===p.split('/')[3]);if(!b)throw Error('批次不存在');return structuredClone(b);}
 throw Error('未实现的 API');
}
function makeBatch(records:R[],source:Batch['source'],axis?:Axis){const b:Batch={id:crypto.randomUUID(),ids:records.map(r=>r.id),examType:records[0].examType,source,summary:{concentratedBreakpoint:'模拟结果不推断真实共性；请核对逐道记录。',prioritySupplement:records.some(r=>!r.referenceAnswer&&!r.gradingResult)?'优先补充待确认记录的参考答案。':'优先核对条件提取与判定依据。',mergeSuggestions:[]}};
 if(axis){const groups=new Map<string,string[]>();records.filter(r=>r.status==='已加工').forEach(r=>{const key=axis==='知识点'?`${r.subject} / ${r.module}`:r.errorTags.join('、');groups.set(key,[...(groups.get(key)||[]),r.id]);});b.summary.mergeSuggestions=[...groups].filter(([,ids])=>ids.length>1).map(([key,ids])=>`按${axis}「${key}」建议核对后合并：${ids.join('、')}`);}db().batches.push(b);return b;}
