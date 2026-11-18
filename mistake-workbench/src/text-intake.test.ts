import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { generate } from './mockService';
import { parseProcessing } from './parsers';
import { buildMistakeProcessingPrompt } from './prompts';
import { service } from './service';
import * as repo from './localRepository';

vi.mock('./config', () => ({MOCK:false, desktop:undefined, configurationError:'', slugs:{}}));
const input={examType:'',subject:'数学',module:'函数',questionType:'解答',difficulty:3 as const,
 originalQuestion:'求最小值',userAnswer:'',entryText:'求最小值\n我的作答：3'};
const record=generate({...input,referenceAnswer:'供测试生成完整结构'},2);
beforeEach(()=>{
 const storage=new Map<string,string>();
 vi.stubGlobal('localStorage',{getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>storage.set(key,value)});
 vi.stubEnv('VITE_ANYTHINGLLM_API_KEY','test-only');
});
afterEach(()=>vi.unstubAllGlobals());

it('accepts only verbatim student input fields and preserves the required processing fields', ()=>{
 const result=parseProcessing(JSON.stringify({...record,status:'已加工', modelAnswer:'AI 推导：最小值为 -1',
  originalQuestion:'求最小值',userAnswer:'3',referenceAnswer:'-1',
  breakpoint:{...record.breakpoint,rootCause:'程序缺口：核对顶点纵坐标'},
 }),{...record,...input,referenceAnswer:undefined},2);
 expect(result.userAnswer).toBe('3');
 expect(result.referenceAnswer).toBeUndefined();
 expect(result.modelAnswer).toContain('AI 推导');
});

it('limits each record to one clarification and keeps the supplement separate from the question', async()=>{
 const scope={examType:'',slug:'test-math'};
 repo.write(scope,{records:[{...record,...input,status:'待确认'}],batches:[],meta:{}});
 const fetcher=vi.fn(async (path:string)=>Response.json(path.endsWith('/vector-search')
  ? {results:[]}
  : {textResponse:'{"status":"待确认","pendingGap":"请补充函数表达式。并补充定义域。"}'}));
 vi.stubGlobal('fetch',fetcher);
 const updated=await service.retry(scope,record.id,undefined,'定义域为所有实数');
 expect(updated).toMatchObject({status:'待确认',originalQuestion:'求最小值',clarification:'定义域为所有实数',
  clarificationUsed:true,pendingGap:'请补充函数表达式。'});
 expect(buildMistakeProcessingPrompt(updated,2,'')).toContain('"clarificationUsed":true');
 await expect(service.retry(scope,record.id,undefined,'补充另一项')).rejects.toThrow('已补充一次');
 expect(fetcher.mock.calls.filter(([path])=>path.endsWith('/chat'))).toHaveLength(1);
});
