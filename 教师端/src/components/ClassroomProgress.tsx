import { useState } from 'react';
import { useRead } from '../shared/read-only/useRead';
import { RequestState } from '../shared/read-only/RequestState';

export type Progress = { total: number; processed: number; pending: number; failed: number; processing: number };
export type ClassroomStudent = { id: string; name: string; progress: Progress | null; syncedAt: string | null };
export type ProgressHistory = { history: { day: string; progress: Progress }[] };

const metrics = [
  ['total', '错题总数'],
  ['processed', '已加工'],
  ['pending', '待确认'],
  ['failed', '加工失败'],
  ['processing', '加工中'],
] as const;

const followUp = ({ progress }: ClassroomStudent) => Boolean(progress && (progress.pending > 0 || progress.failed > 0));
const syncTime = (value: string | null) => value ? new Date(value).toLocaleString('zh-CN') : '尚未同步';

function exportProgress(className: string, students: ClassroomStudent[]) {
  const rows = [
    ['学生', ...metrics.map(([, label]) => label), '最近同步'],
    ...students.map(student => [
      student.name, ...metrics.map(([key]) => String(student.progress?.[key] ?? '')),
      syncTime(student.syncedAt),
    ]),
  ];
  const csv = rows.map(row => row.map(value => {
    const safe = /^[\s\uFEFF]*[=+@-]|^[\t\r\n\uFEFF]/.test(value) ? "'" + value : value;
    return '"' + safe.replaceAll('"', '""') + '"';
  }).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = className.replace(/[<>:"/\\|?*]/g, '-') + '-学习进度.csv';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function StudentHistory({ student, load, close }: {
  student: ClassroomStudent;
  load: (id: string, signal: AbortSignal) => Promise<ProgressHistory>;
  close: () => void;
}) {
  const request = useRead(student.id + ':' + (student.syncedAt ?? ''), signal => load(student.id, signal));
  return <section className="panel filter-panel">
    <div className="page-heading"><h3>{student.name} · 学习进度</h3><button type="button" onClick={close}>关闭详情</button></div>
    <p>最近同步：{syncTime(student.syncedAt)}</p>
    {student.progress && <dl className="metrics">{metrics.map(([key, label]) =>
      <div className="metric" key={key}><dt>{label}</dt><dd>{student.progress?.[key]}</dd></div>
    )}</dl>}
    <h4>最近 30 个有同步记录的日期</h4>
    <RequestState {...request} isEmpty={data => data.history.length === 0} emptyText="暂无历史。学生下次同步时开始记录。">{data =>
      <div className="table-scroll"><table>
        <thead><tr><th>日期</th>{metrics.map(([, label]) => <th key={label}>{label}</th>)}</tr></thead>
        <tbody>{[...data.history].reverse().map(snapshot => <tr key={snapshot.day}>
          <td>{snapshot.day}</td>{metrics.map(([key]) => <td key={key}>{snapshot.progress[key]}</td>)}
        </tr>)}</tbody>
      </table></div>
    }</RequestState>
  </section>;
}

export function ClassroomProgress({ name, students, refresh, busy, loadHistory }: {
  name: string;
  students: ClassroomStudent[];
  refresh: () => void;
  busy: boolean;
  loadHistory: (id: string, signal: AbortSignal) => Promise<ProgressHistory>;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState('');
  const synced = students.filter(student => student.progress !== null);
  const followUpCount = students.filter(followUp).length;
  const counts = [
    ['班级人数', students.length],
    ['已同步', synced.length],
    ['待跟进学生', followUpCount],
    ['错题总数', synced.reduce((sum, student) => sum + (student.progress?.total ?? 0), 0)],
    ['已加工', synced.reduce((sum, student) => sum + (student.progress?.processed ?? 0), 0)],
  ] as const;
  const visible = students.filter(student =>
    student.name.toLowerCase().includes(query.trim().toLowerCase()) &&
    (filter === 'all' || (filter === 'follow-up' && followUp(student)) ||
      (filter === 'not-synced' && student.progress === null))
  );
  const selectedStudent = students.find(student => student.id === selected);

  return <section className="panel filter-panel">
    <h2>学习概况</h2>
    <dl className="metrics">{counts.map(([label, value]) =>
      <div className="panel metric" key={label}><dt>{label}</dt><dd>{value}</dd></div>
    )}</dl>
    <div className="filter-grid">
      <label>查找学生<input type="search" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <label>学习状态<select value={filter} onChange={event => setFilter(event.target.value)}>
        <option value="all">全部学生</option>
        <option value="follow-up">待跟进（有待确认或加工失败的错题）</option>
        <option value="not-synced">尚未同步</option>
      </select></label>
      <button type="button" disabled={busy} onClick={refresh}>刷新进度</button>
      <button type="button" disabled={!visible.length} onClick={() => exportProgress(name, visible)}>导出当前名单 CSV</button>
    </div>
    {visible.length === 0 ? <p>{students.length ? '没有符合筛选条件的学生。' : '学生加入并同步后，学习进度会显示在这里。'}</p> :
      <div className="table-scroll"><table>
        <thead><tr><th>学生</th>{metrics.map(([, label]) => <th key={label}>{label}</th>)}<th>最近同步</th></tr></thead>
        <tbody>{visible.map(student => <tr key={student.id}>
          <td><button type="button" onClick={() => setSelected(student.id)} aria-pressed={selected === student.id}>{student.name}</button></td>
          {metrics.map(([key]) => <td key={key}>{student.progress?.[key] ?? '—'}</td>)}
          <td>{syncTime(student.syncedAt)}</td>
        </tr>)}</tbody>
      </table></div>}
    {selectedStudent && <StudentHistory student={selectedStudent} load={loadHistory} close={() => setSelected('')} />}
  </section>;
}
