import {it,expect,vi} from 'vitest';
import {parseText,parseProcessing} from './parsers';
import {chatPath} from './apiClient';
import {generate} from './mockService';
import {summarize} from './summary';
import {serial} from './service';
import {scopeKey,createSpace,read,write,get} from './localRepository';
const r=generate({examType:'高考',subject:'数学',module:'函数',questionType:'计算',difficulty:2,originalQuestion:'题',userAnswer:'答',referenceAnswer:'依据'},2);
it('uses full api prefix',()=>expect(chatPath('abc')).toBe('/api/v1/workspace/abc/chat'));
it('parses whole JSON and first balanced block, rejects malformed',()=>{expect(parseText('{"a":1}')).toEqual({a:1});expect(parseText('文字 ```json {"a":{"b":"}"}} ```')).toEqual({a:{b:'}'}});expect(()=>parseText('not JSON')).toThrow('未结构化');expect(()=>parseProcessing('{}',r,2)).toThrow('未结构化')});
it('rejects missing processing fields and enforces count',()=>{const value={...r,modelAnswer:'独立推导',breakpoint:{...r.breakpoint,rootCause:'知识缺口：公式'}};expect(parseProcessing(JSON.stringify(value),r,2).status).toBe('已加工');expect(()=>parseProcessing(JSON.stringify({...value,modelAnswer:undefined}),r,2)).toThrow('未结构化');expect(()=>parseProcessing(JSON.stringify(value),r,3)).toThrow();expect(parseProcessing('{"status":"待确认","pendingGap":"请补参考答案"}',r,2).status).toBe('待确认')});
it('serial progress continues after failure without concurrency',async()=>{let active=0,max=0;const progress:number[]=[];await serial([1,2,3],async n=>{active++;max=Math.max(max,active);await Promise.resolve();active--;if(n===2)throw Error('fail')},n=>progress.push(n));expect(max).toBe(1);expect(progress).toEqual([1,2,3])});
it('summary frequencies break ties with newest and exclude failures',()=>{const a={...r,id:'a',updatedAt:'2026-01-01',errorTags:['旧'],breakpoint:{...r.breakpoint,rootCause:'知识缺口：公式'}};const b={...a,id:'b',updatedAt:'2026-02-01',errorTags:['新'],breakpoint:{...a.breakpoint,rootCause:'审题缺口：条件'}};const summary=summarize([a,b,{...b,status:'加工失败'}]);expect(summary.concentratedBreakpoint).toBe('新');expect(summary.prioritySupplement).toBe('审题缺口');expect(summary.mergeSuggestions).toEqual(['a、b'])});
it('slug required; storage isolates both exam and slug',()=>{const map=new Map();vi.stubGlobal('localStorage',{getItem:(k:string)=>map.get(k)||null,setItem:(k:string,v:string)=>map.set(k,v)});expect(()=>createSpace('中考','中考','')).toThrow('slug');const a={examType:'高考' as const,slug:'one'},b={...a,slug:'two'};expect(scopeKey(a)).not.toBe(scopeKey(b));write(a,{records:[r],batches:[],meta:{}});expect(read(b).records).toEqual([]);expect(()=>get(b,r.id)).toThrow();expect(createSpace('中考','中考','zk').slug).toBe('zk')});

it('ignores reasoning braces before the final JSON',()=>{
 const answer={status:'待确认',pendingGap:'请补充定义域'};
 const raw=' <think>中间草稿 {status: unknown}，以及 '+JSON.stringify({status:'已加工'})+'</think>'+JSON.stringify(answer);
 expect(parseText(raw)).toEqual(answer);
 expect(()=>parseText('<think>尚未生成答案 {"status":"已加工"}</think>')).toThrow('解析失败');
});
