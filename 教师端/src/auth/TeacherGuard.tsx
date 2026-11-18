import type { ReactNode } from 'react';
import type { Teacher, TeacherApi, Workspace } from '../api/contracts';
import type { TeacherSession } from './teacherSession';
import { RequestState } from '../shared/read-only/RequestState';
import { useRead } from '../shared/read-only/useRead';

export function TeacherGuard({ session, api, children }: {
  session: TeacherSession;
  api: TeacherApi;
  children: (teacher: Teacher, workspaces: Workspace[]) => ReactNode;
}) {
  const request = useRead('teacher-session', async signal => {
    const teacher = await api.me(signal);
    if (teacher.role !== 'teacher') throw new Error('当前凭据无权进入教师端。');
    return { teacher, workspaces: await api.workspaces(signal) };
  });
  if (request.state.status !== 'ready') return (
    <main className="content">
      <h1>教师端</h1>
      {session.mode === 'mock' && <span className="demo-label">演示数据</span>}
      <RequestState {...request}>{() => null}</RequestState>
    </main>
  );
  const { teacher, workspaces } = request.state.data;
  if (!workspaces.length) return (
    <main className="content">
      {session.mode === 'mock' && <span className="demo-label">演示数据</span>}
      <p className="request-state">当前教师暂无获授权的工作区。</p>
    </main>
  );
  return <>{children(teacher, workspaces)}</>;
}
