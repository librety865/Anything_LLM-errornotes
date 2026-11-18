import {service} from './service';
import {beforeEach,it,expect,vi} from 'vitest';
vi.mock('./config',()=>({desktop:undefined,MOCK:false,configurationError:'',slugs:{}}));
import {connectWorkspace,scope,write,read,get} from './localRepository';
import {parseFeedback,parseProcessing} from './parsers';
import {developerRequest,chat} from './apiClient';
import {generate} from './mockService';
beforeEach(()=>{const data=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(k:string)=>data.get(k)||null,setItem:(k:string,v:string)=>data.set(k,v)});vi.stubEnv('VITE_ANYTHINGLLM_API_KEY','test-only');});
it('custom workspaces need no exam and isolate records',()=>{const a=connectWorkspace('代数','algebra'),b=connectWorkspace('阅读','reading');expect(a.examType).toBe('');const sa=scope(a.id),sb=scope(b.id);const r=generate({examType:'',subject:'数学',module:'函数',questionType:'计算',difficulty:3,originalQuestion:'求值',userAnswer:'',referenceAnswer:'1'},2);write(sa,{records:[{...r,workspace_id:a.id}],batches:[],meta:{}});expect(read(sb).records).toEqual([]);expect(()=>get(sb,r.id)).toThrow();expect(connectWorkspace('代数','algebra').id).toBe(a.id);});
it('accepts independently solved results without an exam or reference answer',()=>{const r=generate({examType:'',subject:'数学',module:'函数',questionType:'计算',difficulty:3,originalQuestion:'求值',userAnswer:'',referenceAnswer:'1'},2);const result={...r,modelAnswer:'推导得到1',breakpoint:{...r.breakpoint,rootCause:'知识缺口：示例'}};expect(parseProcessing(JSON.stringify(result),{...r,referenceAnswer:''},2).modelAnswer).toBe('推导得到1');});
it('preserves malformed feedback and empty response diagnostics',()=>{expect(()=>parseFeedback('原始非JSON')).toThrow('原始非JSON');expect(()=>parseFeedback('')).toThrow('空响应');expect(()=>parseFeedback('{"changePoint":"x"}')).toThrow('{"changePoint":"x"}');});
it('surfaces server 500 details instead of discarding the body',async()=>{vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:false,status:500,headers:new Headers(),text:async()=>JSON.stringify({error:'provider rejected request'})}));await expect(developerRequest('/api/v1/workspace/a/chat',{})).rejects.toThrow('provider rejected request');});
it('passes documented image attachments and isolates independent chat sessions',async()=>{const fetcher=vi.fn().mockResolvedValue({ok:true,status:200,headers:new Headers(),text:async()=>JSON.stringify({textResponse:'ok'})});vi.stubGlobal('fetch',fetcher);const image={name:'photo.jpg',mime:'image/jpeg',contentString:'data:image/jpeg;base64,example'};await chat('study','识别',[image]);await chat('study','反馈');const a=JSON.parse(fetcher.mock.calls[0][1].body),b=JSON.parse(fetcher.mock.calls[1][1].body);expect(a.attachments).toEqual([image]);expect(a.sessionId).not.toBe(b.sessionId);});

it('preserves failed model output and clears stale answers, then retries the same record', async () => {
 const workspace = connectWorkspace('代数', 'algebra');
 const current = scope(workspace.id);
 const record = {
  ...generate({examType:'', subject:'数学', module:'函数', questionType:'计算',
   difficulty:3, originalQuestion:'求最小值', userAnswer:'3', referenceAnswer:'-1'}, 2),
  workspace_id:workspace.id, modelAnswer:'上次答案',
  evidence:[{id:'old', title:'旧依据', text:'旧内容', score:0.9, source:'旧来源'}],
 };
 write(current, {records:[record], batches:[], meta:{}});
 const missingAnswer = JSON.stringify({...record, modelAnswer:undefined});
 let modelText = missingAnswer;
 vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(
  url.endsWith('/vector-search') ? {results:[]} : {textResponse:modelText},
 )));
 const failed = await service.retry(current, record.id);
 expect(failed.status).toBe('加工失败');
 expect(failed.modelAnswer).toBeUndefined();
 expect(failed.evidence).toBeUndefined();
 expect(read(current).meta[record.id].raw).toBe(missingAnswer);

 modelText = JSON.stringify({...record, modelAnswer:'新推导',
  breakpoint:{...record.breakpoint, rootCause:'审题缺口：核对条件'}});
 const recovered = await service.retry(current, record.id);
 expect(recovered).toMatchObject({id:record.id, status:'已加工', modelAnswer:'新推导', evidence:[]});
 expect(read(current).meta[record.id].raw).toBeUndefined();
});
