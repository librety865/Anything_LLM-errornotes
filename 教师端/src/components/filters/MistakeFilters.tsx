import type { Filters, Option } from '../../api/contracts';
import { mistakeStatuses } from '../../shared/models/mistake';
import { useWorkspace } from '../../app/WorkspaceProvider';
import { ReadOnlyLabel } from '../../shared/read-only/ReadOnlyLabel';
import { useRead } from '../../shared/read-only/useRead';
import { invalidDateRange } from './query';

export function FilterSelect({ label, options, value = '', onChange }: {
  label: string; options: Option[]; value?: string; onChange: (value: string) => void;
}) {
  const hasMissingSelection = value && !options.some(option => option.value === value);
  return (
    <label>{label}
      <select value={value} onChange={event => onChange(event.target.value)}>
        <option value="">全部</option>
        {hasMissingSelection && <option value={value}>当前筛选项</option>}
        {options.map(option => <option value={option.value} key={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

const difficultyOptions = [1, 2, 3, 4, 5].map(value => ({ value: String(value), label: value + ' 级' }));
const statusOptions = mistakeStatuses.map(value => ({ value, label: value }));

export function MistakeFilters({ filters, onChange, fixedStudent = false }: {
  filters: Filters; onChange: (filters: Filters) => void; fixedStudent?: boolean;
}) {
  const { api, workspace } = useWorkspace();
  const classId = fixedStudent ? undefined : filters.classId;
  const options = useRead(workspace.id + ':' + (classId ?? ''), signal => api.filterOptions(workspace.id, { classId }, signal));
  const values = options.state.status === 'ready' ? options.state.data : undefined;
  function change(key: keyof Filters, value: string) {
    const updated = { ...filters, [key]: value || undefined };
    if (key === 'classId') delete updated.studentId;
    onChange(updated);
  }
  return (
    <section className="panel filter-panel" aria-label="错题筛选">
      <div className="filter-grid">
        <label>当前工作区<input value={workspace.name} readOnly /></label>
        {!fixedStudent && <>
          <FilterSelect label="班级" value={filters.classId} options={values?.classId ?? []} onChange={value => change('classId', value)} />
          <FilterSelect label="学生" value={filters.studentId} options={values?.studentId ?? []} onChange={value => change('studentId', value)} />
        </>}
        <FilterSelect label="学科" value={filters.subject} options={values?.subject ?? []} onChange={value => change('subject', value)} />
        <FilterSelect label="模块" value={filters.module} options={values?.module ?? []} onChange={value => change('module', value)} />
        <FilterSelect label="题型" value={filters.questionType} options={values?.questionType ?? []} onChange={value => change('questionType', value)} />
        <FilterSelect label="错因标签" value={filters.errorTag} options={values?.errorTag ?? []} onChange={value => change('errorTag', value)} />
        <FilterSelect label="难度" value={filters.difficulty} options={difficultyOptions} onChange={value => change('difficulty', value)} />
        <FilterSelect label="状态" value={filters.status} options={statusOptions} onChange={value => change('status', value)} />
        <label>新增起始日期<input type="date" value={filters.from ?? ''} onChange={event => change('from', event.target.value)} /></label>
        <label>新增截止日期<input type="date" value={filters.to ?? ''} onChange={event => change('to', event.target.value)} /></label>
        <label>错题搜索<input type="search" placeholder="搜索题面或错因" value={filters.keyword ?? ''} onChange={event => change('keyword', event.target.value)} /></label>
      </div>
      <div className="filter-actions">
        <span className="mr-auto"><ReadOnlyLabel /></span>
        {options.state.status === 'loading' && <span role="status">正在加载筛选选项…</span>}
        {options.state.status === 'error' && <span role="alert">{options.state.message} <button className="button" type="button" onClick={options.retry}>重试选项</button></span>}
        {invalidDateRange(filters) && <span role="alert">截止日期应晚于或等于起始日期。</span>}
        <button className="button" type="button" onClick={() => onChange({})}>清除筛选</button>
      </div>
    </section>
  );
}
