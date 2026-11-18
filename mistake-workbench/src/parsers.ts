import type {Feedback,MistakeRecord as R} from './types';
export function parseText(raw:string):any {
 // Some reasoning models prefix the final answer with a <think> block.
 const answer=raw.trim().replace(/^(?:<think\b[^>]*>[\s\S]*?<\/think>\s*)+/i,'');
 try{return JSON.parse(answer)}catch{}
 const start=answer.indexOf('{');
 let depth=0,quoted=false,escaped=false;
 if(start>=0)for(let i=start;i<answer.length;i++){
  const c=answer[i];
  if(quoted){
   if(escaped)escaped=false;
   else if(c==='\\')escaped=true;
   else if(c==='"')quoted=false;
   continue;
  }
  if(c==='"')quoted=true;
  else if(c==='{')depth++;
  else if(c==='}'&&--depth===0){
   try{return JSON.parse(answer.slice(start,i+1))}catch{break}
  }
 }
 throw Error('未结构化：解析失败，请查看原文');
}
const text=(v:unknown)=>typeof v==='string'&&v.trim().length>0;
export const missingReferenceHint='请补充这道题的参考答案（正确结果或标准解法）。';
export function confirmationHint(record:Pick<R,'referenceAnswer'|'pendingGap'>){

 const gap=record.pendingGap?.trim();
 if(!gap||/只询问一个最关键缺口/.test(gap))return '请补充完整题目条件或图示说明。';
 return gap.split(/[\n；;]|(?<=[。！？!?])/u).find(part=>part.trim())?.trim()||'请补充完整题目条件或图示说明。';
}
function extractedInput(record:R, data:{originalQuestion?:unknown;userAnswer?:unknown;referenceAnswer?:unknown}):R {
 if(!record.entryText)return record;
 const sources=[record.entryText,record.clarification||''];
 const copy=(value:unknown)=>typeof value==='string'&&value.trim()&&sources.some(source=>source.includes(value.trim()))
  ? value.trim() : undefined;
 return {...record,
  originalQuestion:copy(data.originalQuestion)||record.originalQuestion,
  userAnswer:record.userAnswer||copy(data.userAnswer)||'',
  referenceAnswer:record.referenceAnswer||copy(data.referenceAnswer),
 };
}
export function parseProcessing(raw:string,r:R,count:2|3):R{const d=parseText(raw);const fail=()=>{throw Error('未结构化：缺少或无效的必填字段，请查看原文')};if(!d||typeof d!=='object')return fail();if(d.status==='待确认'){if(!text(d.pendingGap))return fail();return {...extractedInput(r,d),status:'待确认',pendingGap:confirmationHint({...r,pendingGap:d.pendingGap})};}if(d.status!=='已加工'||!text(d.modelAnswer))return fail();if(!['subject','module','questionType'].every(k=>text(d[k]))||!Number.isInteger(d.difficulty)||d.difficulty<1||d.difficulty>5||!Array.isArray(d.errorTags)||!d.errorTags.length||!d.errorTags.every(text))return fail();if(!['location','rootCause','nextAction'].every(k=>text(d.breakpoint?.[k]))||!['point','conditionToRequirement','entryJudgment','failureCondition'].every(k=>text(d.motherQuestion?.[k])))return fail();if(!/^(知识缺口|思维缺口|程序缺口|审题缺口)[：:]/.test(d.breakpoint.rootCause))return fail();if(!Array.isArray(d.variants)||d.variants.length!==count||!d.variants.every((v:any,i:number)=>v.label===`V${i+1}`&&text(v.stem)&&['数值','关键条件','提问方向'].includes(v.dimension)))return fail();if(!Array.isArray(d.solutionTemplate)||!d.solutionTemplate.length||d.solutionTemplate.length>6||!d.solutionTemplate.every(text))return fail();return {...extractedInput(r,d),status:'已加工',modelAnswer:typeof d.modelAnswer==='string'?d.modelAnswer:undefined,subject:d.subject,module:d.module,questionType:d.questionType,difficulty:d.difficulty,errorTags:d.errorTags,breakpoint:d.breakpoint,motherQuestion:d.motherQuestion,solutionTemplate:d.solutionTemplate,variants:d.variants.map((v:any,i:number)=>({id:`${r.id}-v${i+1}`,label:v.label,dimension:v.dimension,stem:v.stem}))};}
export function parseFeedback(raw:string):Feedback{let d:any;try{d=parseText(raw);}catch{throw Error('反馈未结构化：无法解析 JSON，请重试。原始响应：\n'+(raw.length?raw:'(空响应)'));}if(!d||!['changePoint','standardProcess','scoringPoints','firstCommonError'].every(k=>text(d[k])))throw Error('反馈未结构化：缺少或无效的必填字段，请重试。原始响应：\n'+raw);return {changePoint:d.changePoint,standardProcess:d.standardProcess,scoringPoints:d.scoringPoints,firstCommonError:d.firstCommonError};}
