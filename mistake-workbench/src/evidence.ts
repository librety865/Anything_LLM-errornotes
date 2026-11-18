import {vectorSearch} from './apiClient';
import {MOCK} from './config';
import {membership,post} from './classroomClient';
import type {MistakeRecord as R,Evidence} from './types';

// 召回条数与相似度下限：宁宽勿窄，让模型自己筛掉无关条目。
export const evidenceTopN=5;
export const evidenceFloor=0.45;

// 用「学科 + 模块 + 题干 + 学生作答」检索：学生的错误答案本身就是最有效的错因线索。
export function evidenceQuery(r:Pick<R,'subject'|'module'|'questionType'|'originalQuestion'|'userAnswer'>){
 return [r.subject,r.module,r.questionType,r.originalQuestion,r.userAnswer?('学生作答：'+r.userAnswer):'', '典型错因']
  .filter(Boolean).join(' ').slice(0,600);
}

const metadataHeader=/^<document_metadata>[\s\S]*?<\/document_metadata>\s*/i;
export function cleanSnippet(text:string){
 return text.replace(metadataHeader,'').split('\n')
  .filter(line=>line.trim()&&!line.startsWith('来源：')&&!line.startsWith('适用：'))
  .join('\n').trim();
}

export async function retrieveEvidence(
 scope: {slug:string; workspace_id?:string},
 record: Pick<R,'subject'|'module'|'questionType'|'originalQuestion'|'userAnswer'>,
): Promise<{items:Evidence[]; error:string}> {
 if (MOCK) return {items:[], error:''};
 try {
  const joined = membership(scope.workspace_id);
  if (!joined && !scope.slug.trim()) return {items:[], error:''};

  const query = evidenceQuery(record);
  const hits = joined
   ? (await post<{results:Evidence[]}>(joined.url, 'knowledge-search', {
      query:[...query].slice(0,200).join(''), topN:evidenceTopN, scoreThreshold:evidenceFloor,
     }, joined.token)).results
   : await vectorSearch(scope.slug, query, evidenceTopN);
  if (!Array.isArray(hits)) throw Error('班级服务返回的依据格式无效，请联系教师');
  const seen = new Set<string>();
  const items = hits
   .filter(hit => hit && typeof hit.text === 'string' && Number.isFinite(hit.score) && hit.score >= evidenceFloor)
   .map(hit => ({
    id:hit.id, text:cleanSnippet(hit.text), score:hit.score,
    title:hit.title || '教研资料', source:hit.source || '',
   }))
   .filter(hit => {
    if (!hit.text) return false;
    const key = (hit.source || hit.title) + '|' + hit.text.slice(0,48);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
   })
   .slice(0, joined ? evidenceTopN : 4);
  return {items, error:''};
 } catch (error) {
  const reason = error instanceof Error ? error.message : '无法读取教研资料，请检查服务后重试';
  return {items:[], error:'检索失败：' + reason};
 }
}
