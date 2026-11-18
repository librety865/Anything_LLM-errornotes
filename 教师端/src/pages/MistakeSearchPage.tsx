import { useWorkspace } from '../app/WorkspaceProvider';
import { MistakeFilters } from '../components/filters/MistakeFilters';
import { filterParams, invalidDateRange, useListQuery } from '../components/filters/query';
import { MistakeResults } from '../components/MistakeResults';
import { ReadOnlyLabel } from '../shared/read-only/ReadOnlyLabel';

export function MistakeSearchPage() {
  const { api, workspace } = useWorkspace();
  const { filters, setFilters, pagination, setPage } = useListQuery();
  return <>
    <header className="page-heading"><h1>错题检索</h1><ReadOnlyLabel /></header>
    <MistakeFilters filters={filters} onChange={setFilters} />
    {!invalidDateRange(filters) && <MistakeResults pagination={pagination} setPage={setPage}
      requestKey={workspace.id + ':' + filterParams(filters) + ':' + pagination.page}
      load={signal => api.mistakes(workspace.id, filters, pagination, signal)} />}
  </>;
}
