import { Link, useLocation } from 'react-router-dom';
import type { MistakeRecord } from '../shared/models/mistake';
import { ReadOnlyLabel } from '../shared/read-only/ReadOnlyLabel';
import { formatDate } from '../shared/read-only/date';

export function MistakeTable({ rows }: { rows: MistakeRecord[] }) {
  const location = useLocation();
  return <div className="table-scroll"><table>
    <caption>错题记录 <ReadOnlyLabel /></caption>
    <thead><tr><th>题目</th><th>学科／模块</th><th>题型</th><th>错因标签</th><th>难度</th><th>状态</th><th>更新时间</th></tr></thead>
    <tbody>{rows.map(row => <tr key={row.id}>
      <th scope="row" className="question-cell">
        <Link to={'/mistakes/' + encodeURIComponent(row.id)} state={{ returnTo: location.pathname + location.search }}>{row.originalQuestion}</Link>
        <details>
          <summary>查看加工摘要</summary>
          <p>断点归因　{row.breakpoint.rootCause || '暂无'}</p>
          <p>母题　{row.motherQuestion.point || '暂无'}</p>
          <p>变式题组　{row.variants.length ? row.variants.map(item => item.label + ' ' + item.stem).join('；') : '暂无'}</p>
          <p>解题模板　{row.solutionTemplate.join('；') || '暂无'}</p>
        </details>
      </th>
      <td>{row.subject || '未标注'}／{row.module || '未标注'}</td><td>{row.questionType || '未标注'}</td>
      <td>{row.errorTags.join('、') || '未标注'}</td><td>{row.difficulty} / 5</td>
      <td><span className="status-label" data-status={row.status}>{row.status}</span></td><td>{formatDate(row.updatedAt)}</td>
    </tr>)}</tbody>
  </table></div>;
}
