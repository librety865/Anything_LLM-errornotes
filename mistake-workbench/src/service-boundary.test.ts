import {beforeEach,it,expect,vi} from 'vitest';
import {service} from './service';
import {generate,mockRequest} from './mockService';
import * as repo from './localRepository';
const scope={examType:'高考' as const,slug:'test-scope'};
beforeEach(()=>{const data=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(key:string)=>data.get(key)||null,setItem:(key:string,value:string)=>data.set(key,value)});});
it('service list/detail strip feedback already present in stored records',async()=>{
 const record=generate({examType:'高考',subject:'数学',module:'函数',questionType:'解答',difficulty:2,originalQuestion:'题',userAnswer:'答',referenceAnswer:'依据'},2);
 expect(record.variants[0].feedback).toBeDefined();
 repo.write(scope,{records:[record],batches:[],meta:{}});
 const rows=await service.list(scope,{examType:'高考'});
 const detail=await service.detail(scope,record.id);
 expect(rows).toHaveLength(1);
 for(const value of [...rows,detail])for(const variant of value.variants)expect(variant).not.toHaveProperty('feedback');
 expect(repo.get(scope,record.id).variants[0].feedback).toBeDefined();
});
it('legacy workspace route shares slug validation and repository',async()=>{
 await expect(mockRequest('/api/workspaces','POST',{examType:'中考',name:'中考'})).rejects.toThrow('slug 必填');
 await expect(mockRequest('/api/workspaces','POST',{examType:'其他',name:'其他',slug:'x'})).rejects.toThrow('考试类型无效');
 const missing=(['高考','中考','考研','考公'] as const).find(e=>!repo.spaces().some(w=>w.examType===e));
 if(missing){const workspace=await mockRequest('/api/workspaces','POST',{examType:missing,name:'测试',slug:' test-slug '});expect(workspace.slug).toBe('test-slug');expect(repo.spaces()).toContainEqual(workspace);await expect(mockRequest('/api/workspaces','POST',{examType:missing,name:'重复',slug:'other'})).rejects.toThrow('已存在');}
 expect(await mockRequest('/api/workspaces')).toEqual(repo.spaces());
});

it('does not retain a processing lock when the initial record read fails', async () => {
 const record = generate({examType:'高考', subject:'数学', module:'函数', questionType:'解答',
  difficulty:2, originalQuestion:'求最值', userAnswer:'', referenceAnswer:'最小值为 -1'}, 2);
 await expect(service.retry(scope, record.id)).rejects.toThrow('记录不属于');
 repo.write(scope, {records:[record], batches:[], meta:{}});
 await expect(service.retry(scope, record.id)).resolves.toMatchObject({status:'已加工'});
});

it('preserves corrupt cache text and returns an empty repository', () => {
 const key = repo.scopeKey(scope);
 localStorage.setItem(key, '{broken');
 expect(repo.read(scope)).toEqual({records:[], batches:[], meta:{}});
 expect(localStorage.getItem(key + '.corrupt')).toBe('{broken');
 expect(localStorage.getItem(key)).toBe('{broken');
});
