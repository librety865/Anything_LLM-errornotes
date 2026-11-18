import { createElement } from 'react';
import { renderMathText } from './math-display.mjs';
import {loadOriginal} from './imageStore';
import {sourceLabel} from './config';
import {useState,useEffect,useRef} from 'react';
import {api} from './api';
import {confirmationHint} from './parsers';
import type {MistakeRecord as R,Feedback,Evidence} from './types';
export type OpenFeedback=Record<string,Feedback>;
export function recordText(r:R,open:OpenFeedback={}){return [`# 错题加工记录（${sourceLabel}）`,`学科：${r.subject}｜模块：${r.module}｜题型：${r.questionType}｜难度：${r.difficulty}`,`状态：${r.status}`,`原题：${r.originalQuestion}`,`用户作答：${r.userAnswer}`,`参考答案：${r.referenceAnswer||'未提供'}`,`AI 推导答案（请核对）：${r.modelAnswer||'尚未生成'}`,`批改结果：${r.gradingResult||'未提供'}`,r.status!=='已加工'?(r.status==='待确认'?confirmationHint(r):r.status):[`错因标签：${r.errorTags.join('、')}`,`断点归因：本题错在${r.breakpoint.location}，根本原因是${r.breakpoint.rootCause}，下次只改一个动作：${r.breakpoint.nextAction}。`,`母题：${Object.values(r.motherQuestion).join('；')}`,...r.variants.map(v=>`${v.label}：${v.stem}${open[v.id]?'\n反馈：'+Object.values(open[v.id]).join('\n'):''}`),`解题模板：\n${r.solutionTemplate.map((s,i)=>`${i+1}. ${s}`).join('\n')}`].join('\n\n')].join('\n\n');}
export function download(text:string,name:string){const url=URL.createObjectURL(new Blob([text],{type:'text/markdown;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export function Status({value}:{value:R['status']}){return <span className={`status ${value==='加工失败'?'pending':value==='待确认'?'pending':value==='加工中'?'processing':'done'}`}>{value}{value==='加工失败'?' ⚠':''}</span>}
export function FeedbackPanel({feedback:f,error,retry,busy=false}:{feedback?:Feedback;error?:string;retry?:()=>void;busy?:boolean}){if(error)return <div className="feedback" role="alert"><pre className="whitespace-pre-wrap break-words" style={{overflowWrap:"anywhere"}}>{error}</pre><button disabled={busy} onClick={retry}>重试反馈</button></div>;if(!f)return null;return <div className="feedback">{[['变化点',f.changePoint],['标准过程',f.standardProcess],['评分点',f.scoringPoints],['最常见第一错误',f.firstCommonError]].map(([k,v])=><div key={k}><strong>{k}</strong><p>{renderMathText(createElement,v)}</p></div>)}</div>}
export function VariantList({record:r,open,toggle,busy,errors}:{record:R;open:OpenFeedback;errors:Record<string,string>;toggle:(id:string)=>void;busy:string}){return <div className="space-y-3">{r.variants.map(v=><article className="variant" key={v.id}><div className="flex justify-between items-center gap-4"><span className="variant-label">{v.label}</span><button disabled={!!busy} onClick={()=>toggle(v.id)}>{busy===v.id?'加载反馈…':open[v.id]?'收起反馈':'展开反馈'}</button></div><p className="whitespace-pre-wrap my-4">{renderMathText(createElement,v.stem)}</p>{errors[v.id]&&<FeedbackPanel error={errors[v.id]} busy={!!busy} retry={()=>toggle(v.id)}/>} {open[v.id]&&<FeedbackPanel feedback={open[v.id]}/>}</article>)}</div>}
export function EvidenceSection({items,error}:{items?:Evidence[];error?:string}){
 if(!items?.length)return <section><h3>05 / 诊断依据 <small>AnythingLLM 知识库检索</small></h3><div className="notice">{error
  ? '依据检索失败：'+error.replace(/^检索失败：/,'')+'，可稍后重试'
  : '本次未检索到可比对的教研资料，诊断为通用教学经验。'}</div></section>;
 return <section><h3>05 / 诊断依据 <small>AnythingLLM 知识库检索 · 命中 {items.length} 条</small></h3><div className="evidence-list">{items.map((item,index)=><article className="evidence" key={item.id}><header><strong>依据 {index+1} · {item.source||item.title}</strong><span>{Math.round(item.score*100)}%</span></header><div className="evidence-bar"><i style={{width:Math.max(6,Math.round(item.score*100))+'%'}}/></div><p>{renderMathText(createElement,item.text.length>340?item.text.slice(0,340)+'…':item.text)}</p></article>)}</div></section>;
}
export function MistakeDetail({record:r,onOpen}:{record:R;onOpen?:(id:string,open:OpenFeedback)=>void}){
 const [open,setOpen]=useState<OpenFeedback>({}),[busy,setBusy]=useState(''),[message,setMessage]=useState(''),[errors,setErrors]=useState<Record<string,string>>({});
 const [answer,setAnswer]=useState('');
 const active=useRef(true);useEffect(()=>{active.current=true;return()=>{active.current=false}},[]);
 const feedbackLock=useRef(false);
 const feedbackEpoch=useRef(0);
 useEffect(()=>()=>{feedbackEpoch.current++;},[]);
 async function toggle(id:string){
  if(!active.current||feedbackLock.current||busy)return;
  setErrors(prev=>({...prev,[id]:''}));setMessage('');
  if(open[id]){const next={...open};delete next[id];setOpen(next);onOpen?.(r.id,next);return;}
  feedbackLock.current=true;
  const epoch=feedbackEpoch.current;
  const stillCurrent=api.capture();
  const canUpdate=()=>active.current&&feedbackEpoch.current===epoch&&stillCurrent();
  setBusy(id);
  try{
   const f=await api.feedback(r.id,id);
   if(!canUpdate())return;
   const next={...open,[id]:f};setOpen(next);onOpen?.(r.id,next);
  }catch(e){if(canUpdate())setErrors(prev=>({...prev,[id]:String(e)}));}
  finally{feedbackLock.current=false;if(canUpdate())setBusy('');}
 }
 return <article className="panel detail">{r.images?.map(img=><button key={img.id} onClick={async()=>{try{const blob=await loadOriginal(img.originalImageId);const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=img.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){if(active.current)setMessage(String(e));}}}>下载原图：{img.name}</button>)}<div className="flex justify-between gap-4 items-center"><div><span className="eyebrow">加工记录 / {r.id.slice(0,12)}</span><h2>{r.module||'未标注模块'}</h2></div><Status value={r.status}/></div><div className="input-grid">{[['原题',r.originalQuestion],['补充信息',r.clarification||''],['用户作答',r.userAnswer],['参考答案',r.referenceAnswer||'未提供'],['AI 推导答案（请核对）',r.modelAnswer||'尚未生成'],['批改结果',r.gradingResult||'未提供']].map(([k,v])=><section key={k}><h3>{k}</h3><p className="whitespace-pre-wrap">{renderMathText(createElement,v)}</p></section>)}</div><div className="metadata">{[['学科',r.subject||'未标注'],['模块',r.module||'未标注'],['题型',r.questionType||'未标注'],['难度',`${r.difficulty} / 5`],['错因标签',r.errorTags.join('、')||'待确认']].map(([k,v])=><div key={k}><small>{k}</small><p>{renderMathText(createElement,v)}</p></div>)}</div>
 {r.status==='加工失败'?<div className="notice"><h3>加工失败 ⚠</h3><p>{api.metadata(r.id)?.error}</p><pre className="whitespace-pre-wrap">{api.metadata(r.id)?.raw||'未收到 textResponse'}</pre><button disabled={busy==='retry'} onClick={async()=>{setBusy('retry');try{await api.retry(r.id)}catch(e){setMessage(String(e))}finally{if(active.current)setBusy('')}}}>重试加工</button></div>:r.status!=='已加工'?<div className="notice"><h3>{r.status==='待确认'?'待确认 · 只补一个关键缺口':'正在加工，请稍候'}</h3><p>{r.status==='待确认'?(r.clarificationUsed?'本题已补充一次，现有信息仍不足以可靠求解。':confirmationHint(r)):r.pendingGap}</p>{r.status==='待确认'&&!r.clarificationUsed&&<div className="space-y-2"><label>补充上方缺失的一项<textarea value={answer} onChange={e=>setAnswer(e.target.value)} placeholder="补充缺少的题干、条件或图示说明" disabled={!!busy}/></label><button disabled={!!busy||!answer.trim()} onClick={async()=>{setBusy('retry');setMessage('');try{await api.retry(r.id,undefined,answer)}catch(e){if(active.current)setMessage(String(e))}finally{if(active.current)setBusy('')}}}>{busy?'加工中…':'补充题目并重新加工'}</button></div>}<p>断点归因 / 母题 / 变式题组 / 解题模板：{r.status==='待确认'?'待确认后生成':'加工中'}</p></div>:<><section><h3>01 / 断点归因</h3><div className="notice blue">本题错在 <strong>{r.breakpoint.location}</strong>，根本原因是 {r.breakpoint.rootCause}，下次只改一个动作：<strong>{r.breakpoint.nextAction}</strong>。</div></section><section><h3>02 / 母题</h3><div className="input-grid">{[['考点',r.motherQuestion.point],['条件 → 要求',r.motherQuestion.conditionToRequirement],['入口判断',r.motherQuestion.entryJudgment],['方法失效条件',r.motherQuestion.failureCondition]].map(([k,v])=><div key={k}><small>{k}</small><p>{renderMathText(createElement,v)}</p></div>)}</div></section><section><h3>03 / 变式题组 <small>先独立作答，再展开反馈</small></h3><VariantList record={r} open={open} toggle={toggle} busy={busy} errors={errors}/></section><section><h3>04 / 解题模板</h3><ol className="steps">{r.solutionTemplate.slice(0,6).map((s,i)=><li key={i}><span>{i+1}</span>{renderMathText(createElement,s)}</li>)}</ol></section><EvidenceSection items={r.evidence} error={r.evidenceError}/></>}
 {r.status!=='已加工'&&r.evidenceError&&<EvidenceSection error={r.evidenceError}/>}
 <footer className="actions"><button onClick={async()=>{try{await navigator.clipboard.writeText(recordText(r,open));setMessage('已复制加工记录');}catch{setMessage('剪贴板不可用，请使用导出。');}}}>复制加工记录</button><button onClick={()=>{download(recordText(r,open),`错题-${r.id}.md`);setMessage('已导出');}}>导出</button><small>仅附带当前展开的反馈</small></footer>{message&&<p role="status">{message}</p>}</article>
}
