import { createElement } from 'react';
import { renderMathText } from '../../math-display.mjs';
import { useState } from 'react';
import { useWorkspace } from '../../app/WorkspaceProvider';
import type { Variant } from '../../shared/models/mistake';
import { ReadOnlyLabel } from '../../shared/read-only/ReadOnlyLabel';
import { RequestState } from '../../shared/read-only/RequestState';
import { useRead } from '../../shared/read-only/useRead';

export function VariantFeedbackPanel({ mistakeId, variant }: { mistakeId: string; variant: Variant }) {
  const [expanded, setExpanded] = useState(false);
  const regionId = 'feedback-' + variant.id;
  return <article className="variant">
    <h3>{variant.label} <ReadOnlyLabel /></h3>
    <p className="question-text">{renderMathText(createElement,variant.stem)}</p>
    <button className="button" type="button" onClick={() => setExpanded(value => !value)}
      aria-expanded={expanded} aria-controls={regionId}>{expanded ? '收起反馈' : '查看反馈'}</button>
    <div id={regionId} hidden={!expanded}>
      {expanded && <FeedbackRead mistakeId={mistakeId} variantId={variant.id} />}
    </div>
  </article>;
}

function FeedbackRead({ mistakeId, variantId }: { mistakeId: string; variantId: string }) {
  const { api, workspace } = useWorkspace();
  const request = useRead(JSON.stringify([workspace.id, mistakeId, variantId]),
    signal => api.feedback(workspace.id, mistakeId, variantId, signal));
  return <section className="feedback" aria-label="变式反馈">
    <h4>变式反馈 <ReadOnlyLabel /></h4>
    <RequestState {...request}>{result => result.availability === 'not_generated'
      ? <p className="request-state">学生端尚未展开反馈，教师端不可触发生成</p>
      : <dl className="detail-fields">
          <div><dt>变化点</dt><dd>{renderMathText(createElement,result.feedback.changePoint)}</dd></div>
          <div><dt>标准过程</dt><dd>{renderMathText(createElement,result.feedback.standardProcess)}</dd></div>
          <div><dt>评分点</dt><dd>{renderMathText(createElement,result.feedback.scoringPoints)}</dd></div>
          <div><dt>最常见第一错误</dt><dd>{renderMathText(createElement,result.feedback.firstCommonError)}</dd></div>
        </dl>
    }</RequestState>
  </section>;
}
