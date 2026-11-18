import {useState} from 'react';
import {MOCK} from './config';
import {exportBackup, inspectBackup, restoreBackup} from './migration';

export function MigrationSettings() {
 const [backup, setBackup] = useState<Awaited<ReturnType<typeof inspectBackup>>>();
 const [busy, setBusy] = useState(false);
 const [message, setMessage] = useState('');
 const modeMismatch = backup && backup.mode !== (MOCK ? 'demo' : 'real');

 async function run(action: () => Promise<void>) {
  setBusy(true);
  setMessage('');
  try { await action(); }
  catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  finally { setBusy(false); }
 }

 return <section className="panel settings">
  <h2>数据迁移</h2>
  <p>在旧地址导出备份，再在新地址恢复。备份包含本地错题、批次、工作区、偏好和原图。</p>
  <button disabled={busy} onClick={() => void run(async () => {
   await exportBackup();
   setMessage('备份已生成，请在浏览器的下载记录中查看。');
  })}>导出备份</button>
  <label>选择备份文件<input type="file" accept=".json,application/json" disabled={busy} onChange={event => {
   const file = event.target.files?.[0];
   event.target.value = '';
   setBackup(undefined);
   if (file) void run(async () => setBackup(await inspectBackup(file)));
  }}/></label>
  {backup && <div className="notice">
   <p>已读取备份，包含 {backup.images.size} 张原图。恢复会替换当前地址的知序数据。如果这里已有错题，请先导出当前备份。</p>
   {modeMismatch && <p>备份是在{backup.mode === 'real' ? '真实' : '演示'}模式导出的。恢复后需要使用相同模式查看那一套错题。</p>}
   <button disabled={busy} onClick={() => void run(async () => {
    await restoreBackup(backup);
    location.reload();
   })}>确认覆盖并恢复</button>
   <button disabled={busy} onClick={() => setBackup(undefined)}>取消</button>
  </div>}
  {busy && <p role="status">正在处理备份，请保持页面打开。</p>}
  {message && <p role="status">{message}</p>}
 </section>;
}
