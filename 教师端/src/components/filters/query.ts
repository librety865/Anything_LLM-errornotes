import { useSearchParams } from 'react-router-dom';
import { filterKeys, type Filters } from '../../api/contracts';

export function readFilters(params: URLSearchParams): Filters {
  const filters: Filters = {};
  for (const key of filterKeys) {
    const value = params.get(key);
    if (value) filters[key] = value;
  }
  return filters;
}

export function filterParams(filters: Filters) {
  const params = new URLSearchParams();
  for (const key of filterKeys) {
    const value = filters[key];
    if (value) params.set(key, value);
  }
  return params;
}

export function mistakeSearchUrl(filters: Filters) {
  const query = filterParams(filters).toString();
  return '/mistakes' + (query ? '?' + query : '');
}

export function useListQuery() {
  const [params, setParams] = useSearchParams();
  const filters = readFilters(params);
  const rawPage = Number(params.get('page') ?? '1');
  const page = Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  return {
    filters,
    setFilters: (value: Filters) => setParams(filterParams(value), { replace: true }),
    pagination: { page, pageSize: 8 },
    setPage: (value: number) => {
      const next = filterParams(filters);
      if (value > 1) next.set('page', String(value));
      setParams(next);
    },
  };
}

export function invalidDateRange({ from, to }: Filters) {
  return Boolean(from && to && from > to);
}
