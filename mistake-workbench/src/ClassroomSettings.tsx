import { createClassroomProgressSync } from './classroom-mistake-index.mjs';
import { useEffect, useState } from 'react';
import { MOCK } from './config';
import { archivedWorkspaces, createClassroomWorkspace, read, scope, spaces } from './localRepository';
import type { Workspace } from './types';

import { decodeInvitation, keyFor, membership, post, type Classroom, type Membership } from './classroomClient';

const sync = createClassroomProgressSync({
  getMembership: membership,
  readRecords: workspace => read(scope(workspace)).records,
  sendProgress: (joined, payload) => post<{ syncedAt: string }>(joined.url, 'progress', payload, joined.token),
  mock: MOCK,
});

export function useClassroomSync(workspace: string) {
  const [joinedWorkspace, setJoinedWorkspace] = useState<string>();
  useEffect(() => {
    function update(id: string) {
      void sync(id).catch(() => { /* retry on the next tick */ });
    }
    function tick() {
      setJoinedWorkspace(membership(workspace) ? workspace : undefined);
      for (const item of spaces()) update(item.id);
    }
    function onRecordsChanged(event: Event) {
      const id = (event as CustomEvent<string>).detail;
      if (id) update(id);
    }
    tick();
    const timer = window.setInterval(tick, 10000);
    window.addEventListener('online', tick);
    window.addEventListener('zhixu-classroom-joined', tick);
    window.addEventListener('zhixu-workspace-records-changed', onRecordsChanged);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('online', tick);
      window.removeEventListener('zhixu-classroom-joined', tick);
      window.removeEventListener('zhixu-workspace-records-changed', onRecordsChanged);
    };
  }, [workspace]);
  return joinedWorkspace === workspace;
}

const newNotebook = '__new_notebook__';

export function ClassroomSettings({ workspace, workspaces, onWorkspacesChange, onOpen }: {
  workspace: string;
  workspaces: Workspace[];
  onWorkspacesChange: () => void;
  onOpen: (id: string) => void;
}) {
  const [selected, setSelected] = useState(() => membership(workspace) ? workspace : '');
  const [notebookName, setNotebookName] = useState('');
  const creating = selected === newNotebook;
  const target = workspaces.find(item => item.id === selected);
  const joined = target ? membership(target.id) : null;
  const [invite, setInvite] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setMessage('');
    try { await action(); }
    catch (err) { setMessage('操作失败：' + String(err)); }
    finally { setBusy(false); }
  }

  return <section id="join-classroom" className="panel settings">
    <h2>加入班级</h2>
    <p>选择要加入班级的错题本。只有所选错题本的学习统计和错题检索信息会同步给教师。</p>
    <label>加入班级使用的错题本<select value={selected} disabled={busy} onChange={event => {
      setSelected(event.target.value);
      setMessage('');
    }}>
      <option value="">请选择错题本</option>
      {workspaces.map(item => <option key={item.id} value={item.id}>{item.name}{membership(item.id) ? ' · 已加入班级' : ''}</option>)}
      <option value={newNotebook}>新建班级错题本</option>
    </select></label>
    <p>教师可以检索班级错题的题目摘要、学科和状态。个人错题本不参与同步。使用班级共享模型时，文字及图片会经班级服务发送给 AnythingLLM。</p>
    {joined ? <>
      <p>已加入 <strong>{joined.name}</strong> · 加工、识别及反馈使用教师配置的共享工作区。</p>
      <p>班级错题的统计和检索信息会自动同步到教师端。</p>
      {selected !== workspace && <button type="button" disabled={busy} onClick={() => onOpen(selected)}>打开此错题本</button>}
    </> : <>
      <form onSubmit={event => {
        event.preventDefault();
        void run(async () => {
          if (!creating && (!target || membership(target.id))) throw Error('请选择尚未加入班级的错题本。');
          if (creating && !notebookName.trim()) throw Error('请填写班级错题本名称。');
          const { classId, code, origins } = decodeInvitation(invite);
          const existing = [...spaces(), ...archivedWorkspaces()].find(item => membership(item.id)?.id === classId);
          if (existing) throw Error('你已经用「' + existing.name + '」加入该班级，请使用原错题本。');
          let url: string;
          try {
            url = await Promise.any(origins.map(async address => {
              const classes = await post<Classroom[]>(address, 'lookup', { code });
              if (!Array.isArray(classes) || !classes.some(item => item.id === classId)) throw Error('班级不匹配');
              return address;
            }));
          } catch {
            throw Error('邀请无法连接到班级。请确认你和教师在同一可互访的网络，或请教师重新发送邀请。');
          }
          const result = await post<Omit<Membership, 'url'>>(url, 'join', { code, name, classId });
          const value = { ...result, url };
          const targetId = creating ? createClassroomWorkspace(notebookName).id : selected;
          localStorage.setItem(keyFor(targetId), JSON.stringify(value));
          setSelected(targetId);
          onWorkspacesChange();
          window.dispatchEvent(new Event('zhixu-classroom-joined'));
          setMessage('已加入班级，学习统计将自动同步。');
        });
      }}>
        {creating && <label>新班级错题本名称<input value={notebookName} maxLength={50} disabled={busy}
          onChange={event => setNotebookName(event.target.value)} /></label>}
        <label>班级邀请<input placeholder="粘贴老师发来的邀请" value={invite} maxLength={2048}
          onChange={event => setInvite(event.target.value)} disabled={busy} /></label>
        <label>学生姓名<input value={name} maxLength={40} onChange={event => setName(event.target.value)} disabled={busy} /></label>
        <button disabled={busy || (!target && !creating) || (creating && !notebookName.trim()) || !invite.trim() || !name.trim()}>{busy ? '正在加入…' : '加入班级'}</button>
      </form>
    </>}
    {message && <p role="status">{message}</p>}
  </section>;
}
