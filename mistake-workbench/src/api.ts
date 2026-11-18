import {service} from './service';
import * as repo from './localRepository';
import type {Exam,Input,Axis} from './types';
export {generate,mockRequest} from './mockService';
let current:string='personal';
let revision=0;
const progress=()=>{const captured=revision;return (n:number,total:number)=>{if(captured===revision)window.dispatchEvent(new CustomEvent('zhixu-progress',{detail:'第 '+n+' / '+total+' 题 · 加工中'}));}};
export const api={setExam:(e:Exam)=>{if(current!==e)revision++;current=e;repo.selectWorkspace(e)},capture:()=>{const captured=revision;return ()=>captured===revision},workspaces:async()=>repo.spaces(),createWorkspace:async(e:Exam,name:string,slug:string)=>repo.createSpace(e,name,slug),list:(f:Record<string,string>)=>service.list(repo.scope(current),Object.fromEntries(Object.entries(f).filter(([k])=>k!=="examType"))),detail:(id:string)=>service.detail(repo.scope(current),id),create:(items:Input[],count:2|3,axis:Axis|''='',onStarted?:(id:string)=>void)=>service.create(repo.scope(current),items,count,axis,progress(),onStarted),process:(ids:string[],axis:Axis,count:2|3,onStarted?:(id:string)=>void)=>service.process(repo.scope(current),ids,axis,count,progress(),onStarted),feedback:(id:string,v:string)=>service.feedback(repo.scope(current),id,v),batch:(id:string)=>service.batch(repo.scope(current),id),retry:(id:string,referenceAnswer?:string,originalQuestion?:string)=>service.retry(repo.scope(current),id,referenceAnswer,originalQuestion),metadata:(id:string)=>repo.read(repo.scope(current)).meta[id]};
