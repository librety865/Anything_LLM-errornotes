import { createElement } from 'react';
import { renderMathText } from '../../math-display.mjs';
import type { MistakeRecord } from '../models/mistake';
import { formatDate } from './date';
import { ReadOnlyLabel } from './ReadOnlyLabel';

// Presentation structure adapted from sibling mistake-workbench/src/records.tsx.
function Fields({ items }: { items: [string, string | undefined][] }) {
  return <dl className="detail-fields">{items.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{renderMathText(createElement,value || '未提供')}</dd></div>)}</dl>;
}

export function OriginalInput({ record }: { record: MistakeRecord }) {
  return <section className="panel detail-panel">
    <h2>原始输入 <ReadOnlyLabel /></h2>
    <Fields items={[
      ['原题', record.originalQuestion], ['学生作答', record.userAnswer], ['参考答案', record.referenceAnswer],
      ['批改结果', record.gradingResult], ['已有模型推导答案', record.modelAnswer],
    ]} />
    {record.images?.length ? <ul className="attachments">{record.images.map(image => <li key={image.id}>
      <a href={image.viewUrl} target="_blank" rel="noreferrer">查看原图 · {image.name}</a>
    </li>)}</ul> : null}
  </section>;
}

export function ProcessingFields({ record }: { record: MistakeRecord }) {
  const legacyExam: [string, string][] = record.examType?.trim() ? [['历史考试类型', record.examType]] : [];
  return <section className="panel detail-panel">
    <h2>加工字段 <ReadOnlyLabel /></h2>
    <Fields items={[
      ...legacyExam, ['学科', record.subject], ['模块', record.module], ['题型', record.questionType],
      ['难度', record.difficulty + ' / 5'], ['状态', record.status], ['错因标签', record.errorTags.join('、') || '未标注'],
      ['更新时间', formatDate(record.updatedAt)],
    ]} />
    {record.pendingGap && <p className="request-state">{record.pendingGap}</p>}
  </section>;
}

export function AnalysisSections({ record }: { record: MistakeRecord }) {
  const { breakpoint, motherQuestion, solutionTemplate } = record;
  if (record.status !== '已加工') return <section className="panel detail-panel">
    <h2>加工结果 <ReadOnlyLabel /></h2><p>当前状态为「{record.status}」，暂无断点归因、母题、变式题组和解题模板。</p>
  </section>;
  return <>
    <section className="panel detail-panel">
      <h2>断点归因 <ReadOnlyLabel /></h2>
      <Fields items={[['错误位置', breakpoint.location], ['根本原因', breakpoint.rootCause], ['下一次改进动作', breakpoint.nextAction]]} />
    </section>
    <section className="panel detail-panel">
      <h2>母题 <ReadOnlyLabel /></h2>
      <Fields items={[
        ['考点', motherQuestion.point], ['条件 → 要求', motherQuestion.conditionToRequirement],
        ['入口判断', motherQuestion.entryJudgment], ['方法失效条件', motherQuestion.failureCondition],
      ]} />
    </section>
    <section className="panel detail-panel">
      <h2>解题模板 <ReadOnlyLabel /></h2>
      {solutionTemplate.length ? <ol className="template">{solutionTemplate.map((step, index) => <li key={index}>{renderMathText(createElement,step)}</li>)}</ol>
        : <p>暂无解题模板。</p>}
    </section>
  </>;
}
