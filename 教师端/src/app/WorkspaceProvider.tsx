import { createContext, useContext, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Teacher, TeacherApi, Workspace } from '../api/contracts';
import { PreferencesContext, ReadOnlyStyleContext, readPreferences, type Preferences } from './preferences';

type WorkspaceContextValue = {
  workspace: Workspace;
  workspaces: Workspace[];
  teacher: Teacher;
  api: TeacherApi;
  selectWorkspace: (id: string) => void;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error('缺少教师工作区。');
  return context;
}

export function WorkspaceProvider({ teacher, api, workspaces, mode, children }: {
  teacher: Teacher;
  api: TeacherApi;
  workspaces: Workspace[];
  mode: 'mock' | 'http';
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const storageKey = 'mistake-teacher:' + mode + ':' + teacher.id;
  const [selectedId, setSelectedId] = useState(() => {
    try { return localStorage.getItem(storageKey + ':workspace') ?? ''; }
    catch { return ''; }
  });
  const workspace = workspaces.find(item => item.id === selectedId) ?? workspaces[0];

  function selectWorkspace(id: string) {
    if (!workspaces.some(item => item.id === id)) return;
    try { localStorage.setItem(storageKey + ':workspace', id); }
    catch { /* The in-memory workspace still changes. */ }
    setSelectedId(id);
    navigate('/');
  }

  if (!workspace) return <p className="request-state">当前教师暂无获授权的工作区。</p>;

  return (
    <WorkspaceContext.Provider value={{ teacher, api, workspace, workspaces, selectWorkspace }}>
      <WorkspacePreferences key={workspace.id} storageKey={storageKey + ':preferences:' + workspace.id}>
        {children}
      </WorkspacePreferences>
    </WorkspaceContext.Provider>
  );
}

function WorkspacePreferences({ storageKey, children }: { storageKey: string; children: ReactNode }) {
  const [preferences, setPreferences] = useState(() => readPreferences(storageKey));
  function save(value: Preferences) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(value));
      setPreferences(value);
      return true;
    } catch {
      return false;
    }
  }
  return (
    <PreferencesContext.Provider value={{ preferences, save }}>
      <ReadOnlyStyleContext.Provider value={preferences.readOnlyStyle}>{children}</ReadOnlyStyleContext.Provider>
    </PreferencesContext.Provider>
  );
}
