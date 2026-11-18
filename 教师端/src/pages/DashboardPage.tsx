import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { DistributionKey, Filters } from '../api/contracts';
import { usePreferences } from '../app/preferences';
import { useWorkspace } from '../app/WorkspaceProvider';
import { DistributionPie } from '../components/charts/DistributionPie';
import { MistakeFilters } from '../components/filters/MistakeFilters';
import { filterParams, invalidDateRange, mistakeSearchUrl } from '../components/filters/query';
import { MetricCards } from '../components/MetricCards';
import { ReadOnlyLabel } from '../shared/read-only/ReadOnlyLabel';
import { RequestState } from '../shared/read-only/RequestState';
import { useRead } from '../shared/read-only/useRead';

const charts: { key: DistributionKey; title: string }[] = [
  { key: 'errorTag', title: '错因标签分布' },
  { key: 'subject', title: '学科分布' },
  { key: 'difficulty', title: '难度分布' },
  { key: 'status', title: '状态分布' },
];

export function DashboardPage() {
  const { preferences } = usePreferences();
  const [filters, setFilters] = useState(preferences.dashboardFilters);
  return <>
    <header className="page-heading"><h1>数据看板</h1><ReadOnlyLabel /></header>
    <MistakeFilters filters={filters} onChange={setFilters} />
    {!invalidDateRange(filters) && <DashboardResults filters={filters} />}
  </>;
}

function DashboardResults({ filters }: { filters: Filters }) {
  const navigate = useNavigate();
  const { api, workspace } = useWorkspace();
  const { preferences } = usePreferences();
  const request = useRead(workspace.id + ':' + filterParams(filters), signal => api.dashboard(workspace.id, filters, signal));
  return <RequestState {...request}>{data => <>
    <MetricCards metrics={[
      { label: '班级数', value: data.classCount },
      { label: '学生数', value: data.studentCount },
      { label: '错题总数', value: data.mistakeCount },
      { label: '待确认数', value: data.pendingCount },
      { label: '已加工数', value: data.processedCount },
      { label: '平均难度', value: data.averageDifficulty === null ? '—' : data.averageDifficulty.toFixed(1) + ' / 5' },
    ]} />
    {data.mistakeCount === 0 && <p className="request-state">暂无符合条件的错题。</p>}
    <div className="charts">
      {charts.map(({ key, title }) => <DistributionPie key={key} title={title}
        rows={data.distributions[key]} showLabels={preferences.chartLabels}
        onSelect={value => navigate(mistakeSearchUrl({ ...filters, [key]: value }))} />)}
    </div>
  </>}</RequestState>;
}
