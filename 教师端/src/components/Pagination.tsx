import type { Pagination as PaginationState } from '../api/contracts';

export function Pagination({ total, page, pageSize, onPage }: PaginationState & { total: number; onPage: (page: number) => void }) {
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  if (lastPage === 1 && page === 1) return <p className="table-note">共 {total} 条</p>;
  return (
    <nav className="pagination" aria-label="分页">
      <span>共 {total} 条 · 第 {page} / {lastPage} 页</span>
      <button className="button" type="button" disabled={page <= 1} onClick={() => onPage(Math.min(page - 1, lastPage))}>上一页</button>
      <button className="button" type="button" disabled={page >= lastPage} onClick={() => onPage(page + 1)}>下一页</button>
    </nav>
  );
}
