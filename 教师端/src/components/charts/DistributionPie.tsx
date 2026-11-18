import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import type { Bucket } from '../../api/contracts';
import { ReadOnlyLabel } from '../../shared/read-only/ReadOnlyLabel';

const colors = ['#315dc8', '#078474', '#b36621', '#8256b4', '#d05c6f', '#346d87', '#626e84'];
const percent = (count: number, total: number) => (count / total).toLocaleString('zh-CN', { style: 'percent', maximumFractionDigits: 1 });

export function DistributionPie({ title, rows, showLabels, onSelect }: {
  title: string; rows: Bucket[]; showLabels: boolean; onSelect: (value: string) => void;
}) {
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  const data = rows.map((row, index) => ({ ...row, color: colors[index % colors.length] }));
  const visible = data.filter(row => row.count > 0);
  return (
    <section className="panel chart-panel" aria-label={title}>
      <h2>{title} <ReadOnlyLabel /></h2>
      {total === 0 ? <p className="request-state">暂无分布数据。</p> : <>
        <div className="chart-frame">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={visible} dataKey="count" nameKey="label" innerRadius="46%" outerRadius="77%"
                label={showLabels ? ({ percent: share }) => typeof share === 'number' && share >= 0.075 ? percent(share, 1) : '' : false}
                labelLine={false} cursor="pointer" isAnimationActive={false}
                onClick={(_, index) => { const bucket = visible[index]; if (bucket) onSelect(bucket.value); }}>
                {visible.map(row => <Cell key={row.value} fill={row.color} stroke="white" strokeWidth={2} />)}
              </Pie>
              <Tooltip formatter={(value, name) => [Number(value) + '（' + percent(Number(value), total) + '）', name]} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <ul className="chart-legend" aria-label={title + '下钻选项'}>
          {data.map(row => <li key={row.value}>
            <button type="button" onClick={() => onSelect(row.value)} disabled={row.count === 0}>
              <span className="legend-dot" style={{ background: row.color }} aria-hidden="true" />
              <span>{row.label}</span><strong>{row.count}</strong>
            </button>
          </li>)}
        </ul>
      </>}
    </section>
  );
}
