import {describe,it,expect,vi,beforeAll} from 'vitest';
import {generate,mockRequest} from './api';
import {recordText} from './records';
import type {Input} from './types';
const input:Input={examType:'高考',subject:'数学',module:'函数',questionType:'解答题',difficulty:3,originalQuestion:'求最小值',userAnswer:'3',referenceAnswer:'-1'};
beforeAll(()=>{const map=new Map();vi.stubGlobal('localStorage',{getItem:(k:string)=>map.get(k)||null,setItem:(k:string,v:string)=>map.set(k,v)});});
describe('核心业务规则',()=>{
 it('无判定依据只展示一个缺口，不生成归因',()=>{const r=generate({...input,referenceAnswer:''},2);expect(r.status).toBe('待确认');expect(r.pendingGap).toBeTruthy();expect(r.breakpoint.location).toBe('');expect(r.variants).toHaveLength(0)});
 it('两道变式不生成 V3，三道生成 V3',()=>{expect(generate(input,2).variants.map(v=>v.label)).toEqual(['V1','V2']);expect(generate(input,3).variants[2].label).toBe('V3')});
 it('复制与导出只包含当前展开反馈',()=>{const r=generate(input,2);const v=r.variants[0];expect(recordText(r,{})).not.toContain(v.feedback!.scoringPoints);expect(recordText(r,{[v.id]:v.feedback!})).toContain(v.feedback!.scoringPoints);expect(recordText(r,{})).not.toContain(v.feedback!.scoringPoints)});
 it('列表隔离考试且不传回反馈',async()=>{const rows=await mockRequest('/api/mistakes?examType=高考');expect(rows.length).toBeGreaterThan(0);expect(rows.every((r:any)=>r.examType==='高考')).toBe(true);expect(rows.flatMap((r:any)=>r.variants).every((v:any)=>!v.feedback)).toBe(true)});
 it('拒绝缺少必填项和分类轴的提交',async()=>{await expect(mockRequest('/api/mistakes','POST',{items:[{...input,userAnswer:' '}]})).rejects.toThrow('原题和用户作答不能为空');await expect(mockRequest('/api/mistakes/batch-process','POST',{ids:['demo-1']})).rejects.toThrow('请选择分类轴')});
 it('支持标签、状态和关键词筛选',async()=>{const rows=await mockRequest('/api/mistakes?examType=高考&status=待确认&keyword=加速');expect(rows).toHaveLength(1);expect(rows[0].status).toBe('待确认')});
 it('禁止跨考试批量整理',async()=>{await expect(mockRequest('/api/mistakes/batch-process','POST',{ids:['demo-1','demo-4'],classificationAxis:'知识点',variantCount:2})).rejects.toThrow('请选择同一工作区')});
});
