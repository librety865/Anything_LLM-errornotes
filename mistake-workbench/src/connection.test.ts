import {beforeEach,it,expect,vi} from 'vitest';
vi.mock('./config',()=>({desktop:undefined,MOCK:false,configurationError:'',slugs:{高考:'',中考:'',考研:'',考公:''}}));
import {bindSpace,spaces,write,get} from './localRepository';
import {listRemoteWorkspaces} from './apiClient';
beforeEach(()=>{const storage=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(key:string)=>storage.get(key)||null,setItem:(key:string,value:string)=>storage.set(key,value)});});
it('binds empty exam configuration and forbids reusing a slug',()=>{bindSpace('高考','数学资料','gaokao');expect(spaces().find(w=>w.examType==='高考')?.slug).toBe('gaokao');expect(()=>bindSpace('考研','其他','gaokao')).toThrow('其他考试');});
it('does not replace a scope containing batch data',()=>{bindSpace('高考','资料','old');write({examType:'高考',slug:'old'},{records:[],batches:[{id:'b',ids:[],examType:'高考',source:'batch-create',summary:{concentratedBreakpoint:'',prioritySupplement:'',mergeSuggestions:[]}}],meta:{}});expect(()=>bindSpace('高考','资料','new')).toThrow('已有记录');});
it('reads official workspaces response through api prefix',async()=>{vi.stubEnv('VITE_ANYTHINGLLM_API_KEY','test-only');const fetcher=vi.fn().mockResolvedValue({ok:true,headers:new Headers(),text:async()=>JSON.stringify({workspaces:[{name:'资料',slug:'study'}]})});vi.stubGlobal('fetch',fetcher);try{expect(await listRemoteWorkspaces()).toEqual([{name:'资料',slug:'study'}]);expect(fetcher.mock.calls[0][0]).toBe('/api/v1/workspaces');expect(fetcher.mock.calls[0][1].method).toBe('GET');}finally{vi.unstubAllEnvs();vi.unstubAllGlobals();}});

it('first binding preserves a failed submission and its original ID',()=>{
 const record={id:'failed-before-binding',examType:'高考' as const,subject:'数学',module:'函数',questionType:'计算',difficulty:2 as const,originalQuestion:'原题',userAnswer:'作答',status:'加工失败' as const,errorTags:[],breakpoint:{location:'',rootCause:'',nextAction:''},motherQuestion:{point:'',conditionToRequirement:'',entryJudgment:'',failureCondition:''},variants:[],solutionTemplate:[],createdAt:'2026-01-01',updatedAt:'2026-01-01'};
 write({examType:'高考',slug:''},{records:[record],batches:[],meta:{[record.id]:{count:3,axis:'知识点',error:'缺少 slug'}}});
 bindSpace('高考','真实工作区','real-workspace');
 expect(get({examType:'高考',slug:'real-workspace'},record.id)).toEqual(record);
 expect(()=>bindSpace('高考','另一个','different')).toThrow('不可更换绑定');
});
