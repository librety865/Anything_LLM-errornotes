import type { ReactNode } from 'react';
import { ReadOnlyLabel } from '../shared/read-only/ReadOnlyLabel';

export function MetricCards({ metrics }: { metrics: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="metrics">
      {metrics.map(({ label, value }) => (
        <div className="panel metric" key={label}>
          <dt>{label} <ReadOnlyLabel /></dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
