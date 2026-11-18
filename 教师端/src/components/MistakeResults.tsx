import type { MistakeRecord } from '../shared/models/mistake';
import type { Page, Pagination as PaginationState } from '../api/contracts';
import { RequestState } from '../shared/read-only/RequestState';
import { useRead } from '../shared/read-only/useRead';
import { MistakeTable } from './MistakeTable';
import { Pagination } from './Pagination';

export function MistakeResults({ requestKey, load, pagination, setPage }: {
  requestKey: string;
  load: (signal: AbortSignal) => Promise<Page<MistakeRecord>>;
  pagination: PaginationState;
  setPage: (value: number) => void;
}) {
  const request = useRead(requestKey, load);
  return <section className="panel table-panel">
    <RequestState {...request}>{data => <>
      {data.items.length ? <MistakeTable rows={data.items} /> : <p className="request-state">当前页暂无符合条件的错题。</p>}
      <Pagination {...pagination} total={data.total} onPage={setPage} />
    </>}</RequestState>
  </section>;
}
