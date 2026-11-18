import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { keyFor } from './classroomClient';
import { retrieveEvidence } from './evidence';
import { generate } from './mockService';
import { processOne } from './service';
import * as repo from './localRepository';

vi.mock('./config', () => ({ MOCK:false, desktop:undefined, configurationError:'', slugs:{} }));

const scope = { workspace_id:'local:class', examType:'', slug:'personal-slug' };
const record = generate({
 examType:'', subject:'数学', module:'二次函数', questionType:'解答', difficulty:3,
 originalQuestion:'求二次函数最小值', userAnswer:'3', referenceAnswer:'-1',
}, 2);
const hit = { id:'e1', score:0.834, title:'说明', source:'数学手册', text:'来源：数学手册\n核对顶点纵坐标' };

beforeEach(() => {
 const storage = new Map([[keyFor(scope.workspace_id), JSON.stringify({
  id:'class', name:'高一', url:'http://127.0.0.1:5180', token:'student-token',
 })]]);
 vi.stubGlobal('localStorage', {
  getItem:(key:string) => storage.get(key) ?? null,
  setItem:(key:string, value:string) => storage.set(key, value),
 });
});
afterEach(() => vi.unstubAllGlobals());

it('requests class evidence through the desktop bridge and maps the hit', async () => {
 const bridge = vi.fn().mockResolvedValue({ok:true, data:{results:[hit]}});
 vi.stubGlobal('window', {zhixuClassroom:bridge});
 const result = await retrieveEvidence(scope, record);
 expect(bridge).toHaveBeenCalledWith('http://127.0.0.1:5180', 'knowledge-search', {
  query:expect.stringContaining('求二次函数最小值'), topN:5, scoreThreshold:0.45,
 }, 'student-token');
 expect(result).toEqual({items:[{...hit, text:'核对顶点纵坐标'}], error:''});
});

it('returns a readable search error separately from an empty response', async () => {
 const bridge = vi.fn()
  .mockResolvedValueOnce({ok:false, data:{error:'无法连接 AnythingLLM，请确认它已启动'}})
  .mockResolvedValueOnce({ok:true, data:{results:[]}});
 vi.stubGlobal('window', {zhixuClassroom:bridge});
 await expect(retrieveEvidence(scope, record)).resolves.toMatchObject({
  items:[], error:'检索失败：无法连接 AnythingLLM，请确认它已启动',
 });
 await expect(retrieveEvidence(scope, record)).resolves.toEqual({items:[], error:''});
});

it('continues processing after a search error, then clears the prior metadata on retry', async () => {
 const valid = JSON.stringify({...record, modelAnswer:'最小值是 -1',
  breakpoint:{...record.breakpoint, rootCause:'思维缺口：应核对顶点纵坐标'}});
 let step = 0;
 const bridge = vi.fn(async (_url, endpoint) => {
  if (endpoint === 'knowledge-search') {
   expect(repo.read(scope).meta[record.id].evidenceError).toBeUndefined();
   step++;
   return step < 3
    ? {ok:false, data:{error:'检索服务暂时不可用'}}
    : {ok:true, data:{results:[hit]}};
  }
  return {ok:true, data:{textResponse:step === 2 ? '无效加工结果' : valid}};
 });
 const browser = new EventTarget();
 vi.stubGlobal('window', Object.assign(browser, {zhixuClassroom:bridge}));
 repo.write(scope, {records:[{...record, workspace_id:scope.workspace_id}], batches:[], meta:{}});
 const first = await processOne(scope, record.id, 2, '');
 expect(first.status).toBe('已加工');
 expect(first.evidence).toEqual([]);
 expect(repo.read(scope).meta[record.id].evidenceError).toContain('检索服务暂时不可用');
 const failed = await processOne(scope, record.id, 2, '');
 expect(failed.status).toBe('加工失败');
 expect(repo.read(scope).meta[record.id].evidenceError).toContain('检索服务暂时不可用');
 const recovered = await processOne(scope, record.id, 2, '');
 expect(recovered.evidence).toHaveLength(1);
 expect(recovered.evidenceError).toBeUndefined();
 expect(repo.read(scope).meta[record.id].evidenceError).toBeUndefined();
});
