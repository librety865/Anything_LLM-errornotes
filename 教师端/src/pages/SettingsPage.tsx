import { useState } from 'react';
import { usePreferences } from '../app/preferences';
import { useWorkspace } from '../app/WorkspaceProvider';
import { MistakeFilters } from '../components/filters/MistakeFilters';
import { invalidDateRange } from '../components/filters/query';
import { ReadOnlyLabel } from '../shared/read-only/ReadOnlyLabel';

export function SettingsPage() {
  const { preferences, save } = usePreferences();
  const { workspace, workspaces, selectWorkspace } = useWorkspace();
  const [draft, setDraft] = useState(preferences);
  const [message, setMessage] = useState<{ text: string; error?: boolean }>();
  return <>
    <header className="page-heading"><h1>偏好设置</h1></header>
    <section className="panel detail-panel">
      <h2>工作区 <ReadOnlyLabel /></h2>
      <ul className="workspace-list">
        {workspaces.map(item => <li key={item.id}>
          <span>{item.name}</span>
          {item.id === workspace.id ? <span className="workspace-hint">当前工作区</span>
            : <button className="button" type="button" onClick={() => selectWorkspace(item.id)}
                aria-label={"切换工作区：" + item.name}>切换工作区</button>}
        </li>)}
      </ul>
    </section>
    <form onSubmit={event => {
      event.preventDefault();
      if (invalidDateRange(draft.dashboardFilters)) return;
      const saved = save(draft);
      setMessage(saved ? { text: '已保存教师偏好。' } : { text: '浏览器未能保存偏好。', error: true });
    }}>
      <h2 className="section-heading">默认看板筛选</h2>
      <p className="settings-note">偏好按教师和工作区保存。当前工作区为{workspace.name}。</p>
      <MistakeFilters filters={draft.dashboardFilters} onChange={dashboardFilters => {
        setDraft({ ...draft, dashboardFilters });
        setMessage(undefined);
      }} />
      <section className="panel settings-panel">
        <h2>图表与只读提示</h2>
        <label className="check-label"><input type="checkbox" checked={draft.chartLabels} onChange={event => {
          setDraft({ ...draft, chartLabels: event.target.checked });
          setMessage(undefined);
        }} /> 在饼图上显示占比标签</label>
        <label>只读提示样式<select value={draft.readOnlyStyle} onChange={event => {
          setDraft({ ...draft, readOnlyStyle: event.target.value === 'prominent' ? 'prominent' : 'compact' });
          setMessage(undefined);
        }}>
          <option value="compact">简洁</option><option value="prominent">醒目</option>
        </select></label>
        <button className="button primary" type="submit" disabled={invalidDateRange(draft.dashboardFilters)}>保存教师偏好</button>
        {message && <p role={message.error ? 'alert' : 'status'}>{message.text}</p>}
      </section>
    </form>
  </>;
}
