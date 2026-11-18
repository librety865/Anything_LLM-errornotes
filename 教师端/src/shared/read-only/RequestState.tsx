import type { ReactNode } from 'react';
import type { ReadState } from './useRead';

export function RequestState<T>({ state, retry, isEmpty, emptyText = '暂无符合条件的数据。', children }: {
  state: ReadState<T>;
  retry: () => void;
  isEmpty?: (data: T) => boolean;
  emptyText?: string;
  children: (data: T) => ReactNode;
}) {
  if (state.status === 'loading') return <p className="request-state" role="status">正在加载…</p>;
  if (state.status === 'error') return (
    <div className="request-state request-error" role="alert">
      <p>{state.message}</p>
      <button className="button" type="button" onClick={retry}>重试查询</button>
    </div>
  );
  if (isEmpty?.(state.data)) return <p className="request-state" role="status">{emptyText}</p>;
  return <>{children(state.data)}</>;
}
