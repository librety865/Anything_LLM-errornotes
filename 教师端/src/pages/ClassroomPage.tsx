import { classroomSessionKey as sessionKey, teacherRequest } from '../api/classroomTeacherApi';
import { WorkspaceModelSettings } from '../components/WorkspaceModelSettings';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import { ClassroomProgress, type ClassroomStudent, type ProgressHistory } from '../components/ClassroomProgress';
type SharedWorkspace = { slug: string; name: string };
type Classroom = {
  sharedWorkspace?: SharedWorkspace;
  id: string; name: string; invitation?: string;
  students: ClassroomStudent[];
};

async function classroomRequest(key: string): Promise<Classroom[]> {
  const data = await teacherRequest<Classroom[]>(key, 'classes');
  if (!Array.isArray(data)) throw new Error('班级服务响应异常');
  return data;
}

function readTeacherKey(input: string) {
  const value = input.trim();
  const match = /^(?:教师管理码（仅教师使用）\s+)?([a-f0-9]{48})$/i.exec(value);
  if (!match) throw new Error('请复制启动窗口中的教师管理码。班级邀请只用于学生入班。');
  return match[1].toLowerCase();
}

function ClassInvitation({ classroom, teacherKey }: { classroom: Classroom; teacherKey: string }) {
  const { id, invitation: listedInvitation } = classroom;
  const [fetchedInvitation, setFetchedInvitation] = useState('');
  const [loadError, setLoadError] = useState('');
  const [copyStatus, setCopyStatus] = useState('');
  const [localInvitation, setLocalInvitation] = useState('');
  const [loadingLocal, setLoadingLocal] = useState(false);
  const [localError, setLocalError] = useState('');
  const onTeacherComputer = ['127.0.0.1', 'localhost', '[::1]'].includes(window.location.hostname);
  const [attempt, setAttempt] = useState(0);
  const invitation = listedInvitation || fetchedInvitation;

  useEffect(() => {
    if (listedInvitation) return;
    let active = true;
    setLoadError('');
    teacherRequest<{ invitation?: string }>(teacherKey, 'invitation', { classId: id })
      .then(result => {
        if (typeof result.invitation !== 'string' || !result.invitation.startsWith('ZX1-')) {
          throw new Error('邀请码响应格式不正确。');
        }
        if (active) setFetchedInvitation(result.invitation);
      })
      .catch(error => { if (active) setLoadError(error instanceof Error ? error.message : String(error)); });
    return () => { active = false; };
  }, [id, listedInvitation, teacherKey, attempt]);

  return <>
    <h2>邀请学生</h2>
    <p>学生可以先加入班级，课程资料可稍后配置。</p>
    {invitation ? <>
      <label>局域网邀请码<input readOnly value={invitation}
        onFocus={event => event.currentTarget.select()} /></label>
      <button type="button" onClick={async () => {
        try {
          await navigator.clipboard.writeText(invitation);
          setCopyStatus('邀请码已复制，发给学生即可。');
        } catch {
          setCopyStatus('请点击邀请码输入框，然后按 Ctrl+C 复制。');
        }
      }}>复制邀请码</button>
    </> : loadError ? <>
      <p role="alert">无法获取邀请码。{loadError}</p>
      <button type="button" onClick={() => setAttempt(count => count + 1)}>重新获取邀请码</button>
    </> : <p role="status">正在获取班级邀请码…</p>}
    {onTeacherComputer && <>
      <p>学生端也在这台电脑运行时，请使用本机邀请码。</p>
      <button type="button" disabled={loadingLocal} onClick={async () => {
        setLoadingLocal(true);
        setLocalError('');
        try {
          const result = await teacherRequest<{ invitation: string }>(teacherKey, 'invitation', { classId: id, scope: 'local' });
          if (typeof result.invitation !== 'string' || !result.invitation.startsWith('ZX1-')) {
            throw new Error('本机邀请码格式不正确。');
          }
          setLocalInvitation(result.invitation);
        } catch (error) {
          setLocalError(error instanceof Error ? error.message : '无法获取本机邀请码。');
        } finally {
          setLoadingLocal(false);
        }
      }}>{loadingLocal ? '正在获取…' : '获取本机邀请码'}</button>
      {localError && <p role="alert">{localError}</p>}
      {localInvitation && <>
        <label>本机邀请码<input readOnly value={localInvitation}
          onFocus={event => event.currentTarget.select()} /></label>
        <button type="button" onClick={async () => {
          try {
            await navigator.clipboard.writeText(localInvitation);
            setCopyStatus('本机邀请码已复制，请粘贴到同一台电脑的学生端。');
          } catch {
            setCopyStatus('请点击本机邀请码输入框，再按 Ctrl+C。');
          }
        }}>复制本机邀请码</button>
      </>}
    </>}
    {copyStatus && <p role="status">{copyStatus}</p>}
  </>;
}


export function ClassroomPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [loginCode] = useState(() => new URLSearchParams(location.search).get('login'));
  const [savedKey] = useState(() => sessionStorage.getItem(sessionKey));
  const [restoring, setRestoring] = useState(Boolean(loginCode || savedKey));
  const [copyMessage, setCopyMessage] = useState('');
  const [credential, setCredential] = useState('');
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [classes, setClasses] = useState<Classroom[]>([]);
  const classRevision = useRef(0);
  const [createdName, setCreatedName] = useState('');
  const [selected, setSelected] = useState(() => localStorage.getItem('zhixu.teacher.currentClass') || '');
  const [workspaces, setWorkspaces] = useState<SharedWorkspace[]>([]);
  const [chosenSlug, setChosenSlug] = useState('');
  const [modelMessage, setModelMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  function enter(teacherKey: string, rows: Classroom[]) {
    sessionStorage.setItem(sessionKey, teacherKey);
    setClasses(rows);
    setKey(teacherKey);
    setCredential('');
  }

  useEffect(() => {
    if (!loginCode && !savedKey) return;
    let active = true;
    async function restore() {
      try {
        const teacherKey = loginCode
          ? (await teacherRequest<{ teacherKey: string }>('', 'auto-login', { code: loginCode })).teacherKey
          : savedKey!;
        const rows = await classroomRequest(teacherKey);
        if (active) enter(teacherKey, rows);
      } catch (err) {
        if (active) {
          sessionStorage.removeItem(sessionKey);
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (active) setRestoring(false);
      }
    }
    void restore();
    return () => { active = false; };
  }, [loginCode, savedKey]);

  useEffect(() => {
    if (new URLSearchParams(location.search).has('login')) navigate('/classroom', { replace: true });
  }, [location.search, navigate]);

  const refresh = useCallback(async (currentKey: string) => {
    const revision = ++classRevision.current;
    try {
      const rows = await classroomRequest(currentKey);
      if (revision === classRevision.current) {
        setClasses(rows);
        setError('');
      }
    } catch (err) {
      if (revision === classRevision.current) setError(String(err));
    }
  }, []);

  useEffect(() => {
    if (!key || busy) return;
    const timer = window.setInterval(() => void refresh(key), 10000);
    return () => window.clearInterval(timer);
  }, [key, busy, refresh]);

  const current = classes.find(item => item.id === selected) || classes[0];
  const currentId = current?.id;
  useEffect(() => {
    if (currentId) localStorage.setItem('zhixu.teacher.currentClass', currentId);
  }, [currentId]);

  return <>
    <header className="page-heading"><h1>我的班级 · 学习进度</h1><Link to="/dashboard">查看班级看板</Link></header>
    {restoring ? <p role="status">正在打开班级数据面板…</p> : !key ? <form className="panel filter-panel" onSubmit={async event => {
      event.preventDefault();
      setBusy(true);
      setError('');
      try {
        const teacherKey = readTeacherKey(credential);
        const rows = await classroomRequest(teacherKey);
        enter(teacherKey, rows);
      } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
      finally { setBusy(false); }
    }}>
      <label>教师管理码<input type="password" value={credential} onChange={event => setCredential(event.target.value)} /></label>
      <p>可复制启动窗口里「教师管理码（仅教师使用）」这一整行并粘贴。</p>
      <button disabled={busy || !credential.trim()}>进入班级管理</button>
    </form> : <>
      <button type="button" onClick={async () => {
        try { await navigator.clipboard.writeText(key); setCopyMessage('教师管理码已复制。'); }
        catch { setCopyMessage('无法访问剪贴板，可以从启动窗口复制。'); }
      }}>复制教师管理码</button>
      {copyMessage && <p role="status">{copyMessage}</p>}
      <button type="button" onClick={() => {
        classRevision.current++;
        sessionStorage.removeItem(sessionKey);
        setKey('');
        setCreatedName('');
        setClasses([]);
        setCopyMessage('');
        setError('');
      }}>退出教师登录</button>
      <form className="panel filter-panel" onSubmit={async event => {
        event.preventDefault();
        setBusy(true);
        setError('');
        try {
          const created = await teacherRequest<Omit<Classroom, 'students'>>(key, 'classes', { name: name.trim() });
          classRevision.current++;
          setClasses(rows => rows.some(row => row.id === created.id) ? rows : [...rows, { ...created, students: [] }]);
          setSelected(created.id);
          setCreatedName(created.name);
          setName('');
          setChosenSlug('');
          setModelMessage('');
        }
        catch (err) { setError(String(err)); }
        finally { setBusy(false); }
      }}>
        <label>新班级名称<input maxLength={50} value={name} onChange={event => setName(event.target.value)} /></label>
        <button disabled={busy || !name.trim()}>创建班级</button>
      </form>
      <section className="panel table-panel">
        {current ? <>
          <h2>班级列表（{classes.length}）</h2>
          <div className="classroom-choices" role="group" aria-label="选择班级">
            {classes.map(item => <button type="button" className="button" key={item.id}
              aria-pressed={item.id === current.id} onClick={() => {
                setSelected(item.id);
                setChosenSlug('');
                setModelMessage('');
              }}>
              <strong>{item.name}</strong><small>{item.students.length} 名学生</small>
            </button>)}
          </div>
          {createdName && <p role="status">已创建「{createdName}」，可在上方切换班级。</p>}
          <ClassroomProgress key={current.id} name={current.name} students={current.students} busy={busy}
            refresh={() => void refresh(key)}
            loadHistory={(studentId, signal) => teacherRequest<ProgressHistory>(key, 'student-history', { classId: current.id, studentId }, signal)} />
          <details>
            <summary>班级设置与邀请</summary>
            <ClassInvitation key={current.id} classroom={current} teacherKey={key} />
            <h2>共享工作区</h2>
            <p>{current.sharedWorkspace ? '当前资料库：' + current.sharedWorkspace.name
              : '尚未配置。打开教师电脑上的 AnythingLLM，读取并选择本班的资料工作区。'}</p>
            <div className="filter-grid">
              <button type="button" disabled={busy} onClick={async () => {
                setBusy(true);
                setModelMessage('');
                try {
                  const rows = await teacherRequest<SharedWorkspace[]>(key, 'model-workspaces');
                  setWorkspaces(rows);
                  setChosenSlug(current.sharedWorkspace?.slug || (rows.length === 1 ? rows[0].slug : ''));
                  if (!rows.length) setModelMessage('请先在 AnythingLLM 创建工作区。');
                } catch (err) { setModelMessage(String(err)); }
                finally { setBusy(false); }
              }}>读取 AnythingLLM 工作区</button>
              {workspaces.length > 0 && <>
                <label>选择共享工作区<select value={chosenSlug} onChange={event => setChosenSlug(event.target.value)} disabled={busy}>
                  <option value="">请选择</option>
                  {workspaces.map(workspace => <option key={workspace.slug} value={workspace.slug}>{workspace.name}</option>)}
                </select></label>
                <button type="button" disabled={busy || !chosenSlug} onClick={async () => {
                  setBusy(true);
                  setModelMessage('');
                  try {
                    const sharedWorkspace = await teacherRequest<SharedWorkspace>(key, 'shared-workspace', { classId: current.id, slug: chosenSlug });
                    setClasses(rows => rows.map(row => row.id === current.id ? { ...row, sharedWorkspace } : row));
                    setModelMessage('已保存，班级成员下一次使用时将连接此工作区。');
                  } catch (err) { setModelMessage(String(err)); }
                  finally { setBusy(false); }
                }}>保存为本班共享工作区</button>
              </>}
            </div>
            {modelMessage && <p role="status">{modelMessage}</p>}
            {current.sharedWorkspace && <WorkspaceModelSettings key={current.id + ':' + current.sharedWorkspace.slug}
              workspaceName={current.sharedWorkspace.name}
              load={() => teacherRequest<Record<string, unknown>>(key, 'workspace-settings',
                { classId: current.id, slug: current.sharedWorkspace?.slug })}
              save={changes => teacherRequest<Record<string, unknown>>(key, 'workspace-settings',
                { classId: current.id, slug: current.sharedWorkspace?.slug, changes })} />}
          </details>
        </> : <p>创建一个班级后，再邀请学生加入。</p>}
      </section>
    </>}
    {error && <p role="alert">{error}</p>}
  </>;
}
