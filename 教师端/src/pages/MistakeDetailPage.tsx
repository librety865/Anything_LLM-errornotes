import { Link, useLocation, useParams } from 'react-router-dom';
import { useWorkspace } from '../app/WorkspaceProvider';
import { VariantFeedbackPanel } from '../components/feedback/VariantFeedbackPanel';
import { AnalysisSections, OriginalInput, ProcessingFields } from '../shared/read-only/MistakeSections';
import { ReadOnlyLabel } from '../shared/read-only/ReadOnlyLabel';
import { RequestState } from '../shared/read-only/RequestState';
import { useRead } from '../shared/read-only/useRead';

export function MistakeDetailPage() {
  const { mistakeId = '' } = useParams();
  const { state } = useLocation();
  const { api, workspace } = useWorkspace();
  const request = useRead(JSON.stringify([workspace.id, mistakeId]), signal => api.mistake(workspace.id, mistakeId, signal));
  const requestedReturn = state?.returnTo;
  const back = typeof requestedReturn === 'string' && /^\/(mistakes(\?|$)|classes\/)/.test(requestedReturn)
    ? requestedReturn : '/mistakes';
  return <>
    <Link className="back-link" to={back}>← 返回错题列表</Link>
    <header className="page-heading"><h1>错题详情</h1><ReadOnlyLabel /></header>
    <RequestState {...request}>{record => <>
      <OriginalInput record={record} />
      <ProcessingFields record={record} />
      <AnalysisSections record={record} />
      {record.status === '已加工' && <section className="panel detail-panel">
        <h2>变式题组 <ReadOnlyLabel /></h2>
        {record.variants.length
          ? record.variants.map(variant => <VariantFeedbackPanel mistakeId={record.id} variant={variant} key={record.id + ':' + variant.id} />)
          : <p>暂无变式题。</p>}
      </section>}
    </>}</RequestState>
  </>;
}
