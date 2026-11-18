import { NavLink } from 'react-router-dom';
import { useState, type ReactNode } from 'react';
import type { DemoTeacherId, TeacherSession } from '../auth/teacherSession';
import { useWorkspace } from './WorkspaceProvider';

export function TeacherLayout({ session, onDemoTeacher, children }: {
  session: TeacherSession;
  onDemoTeacher: (id: DemoTeacherId) => void;
  children: ReactNode;
}) {
  const { teacher, workspace, workspaces, selectWorkspace } = useWorkspace();
  return (
    <div className="app-shell">
      <TeacherSidebar />
      <div className="main-shell">
        <header className="topbar">
          <div className="workspace-control">
            <label>当前工作区
              <select value={workspace.id} onChange={event => selectWorkspace(event.target.value)}>
                {workspaces.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            <span className="workspace-hint">工作区之间数据独立</span>
          </div>
          {session.mode === 'mock' ? (
            <div className="demo-tools">
              <span className="demo-label">演示数据</span>
              <label>演示教师
                <select value={session.teacherId} onChange={event => onDemoTeacher(event.target.value as DemoTeacherId)}>
                  <option value="demo-teacher-lin">林</option><option value="demo-teacher-zhou">周</option>
                </select>
              </label>
            </div>
          ) : <span>{teacher.displayName}</span>}
        </header>
        <main id="main-content" className="content" tabIndex={-1}>{children}</main>
      </div>
    </div>
  );
}

export function TeacherSidebar() {
  return <>
    <a className="skip-link" href="#main-content" onClick={event => {
      event.preventDefault();
      document.getElementById('main-content')?.focus();
    }}>跳转到主要内容</a>
    <aside className="sidebar">
      <NavLink to="/classroom" className="brand">
        <span className="brand-mark" aria-hidden="true">错</span>
        <span>智能错题整理系统<small>教师端</small></span>
      </NavLink>
      <nav aria-label="教师端主导航">
        <NavLink to="/classroom">我的班级</NavLink>
        <NavLink to="/library">资料库</NavLink>
        <NavLink to="/dashboard" end>班级看板</NavLink>
        <NavLink to="/mistakes">错题检索</NavLink>
        <NavLink to="/settings">偏好设置</NavLink>
      </nav>
    </aside>
  </>;
}

declare global {
  interface Window {
    zhixuTeacherDesktop?: { configureDeveloperKey(): Promise<void> };
  }
}

export function ClassroomLayout({ children }: { children: ReactNode }) {
  const [configuring, setConfiguring] = useState(false);
  const [configError, setConfigError] = useState(false);
  return <div className="app-shell">
    <TeacherSidebar />
    <div className="main-shell">
      <header className="topbar">
        <strong>教师端</strong>
        {window.zhixuTeacherDesktop && <button type="button" disabled={configuring} onClick={async () => {
          setConfiguring(true);
          setConfigError(false);
          try { await window.zhixuTeacherDesktop?.configureDeveloperKey(); }
          catch { setConfigError(true); }
          finally { setConfiguring(false); }
        }}>配置 AnythingLLM Key</button>}
      </header>
      {configError && <p role="alert">无法打开 Key 配置，请重新打开教师端后重试。</p>}
      <main id="main-content" className="content" tabIndex={-1}>{children}</main>
    </div>
  </div>;
}
