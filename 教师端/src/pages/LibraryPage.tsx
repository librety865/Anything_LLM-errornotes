import { useEffect, useRef, useState, type DragEvent } from 'react';
import { Link } from 'react-router-dom';
import { LibrarySearch } from './LibrarySearch';
import { classroomSessionKey, libraryRequest, teacherRequest, uploadTeacherDocument } from '../api/classroomTeacherApi';

type Classroom = { id: string; name: string; sharedWorkspace?: { name: string; slug: string } };
type Document = {
  location: string;
  name: string;
  title: string;
  description: string;
  docSource: string;
  wordCount: number | null;
};
type Library = { documents: Document[]; mounted: string[]; pinned: string[]; vectorCount: number | null };
type Upload = {
  id: string;
  file: File;
  description: string;
  docSource: string;
  status: '待确认上传' | '上传中' | '解析中' | '已入库' | '失败';
  error?: string;
};
type CardImport = {
  documents: Document[];
  skipped: { reason: string; source: string }[];
  uncertain: { item: string; reason: string }[];
  failures: { title: string; reason: string }[];
};
type Operation = { action: 'mount' | 'pin' | 'preview'; document: Document; value: boolean };

const fileLimit = 20 * 1024 * 1024;
const title = (document: Document) => document.description || document.title || document.name;
const message = (error: unknown) => error instanceof Error ? error.message : '操作失败，请重试';
const shortName = (name: string) => name.replace(/\.[^.]+$/, '');
const normalize = (value: string) => value.trim().normalize('NFKC').toLowerCase();

function fileError(file: File) {
  if (!file.size) return '文件为空，请换一份文件';
  if (file.size > fileLimit) return '单文件上限 20 MB，请拆分或压缩';
  return '';
}

export function LibraryPage() {
  const [key] = useState(() => sessionStorage.getItem(classroomSessionKey) || '');
  const [classes, setClasses] = useState<Classroom[]>([]);
  const [classId, setClassId] = useState('');
  const [library, setLibrary] = useState<Library>();
  const [source, setSource] = useState('');
  const [tab, setTab] = useState<'file'|'text'>('file');
  const [cardSubject, setCardSubject] = useState('');
  const [cardSource, setCardSource] = useState('');
  const [cardText, setCardText] = useState('');
  const [cardReport, setCardReport] = useState<CardImport>();
  const [cardError, setCardError] = useState('');
  const [cardOperation, setCardOperation] = useState('');
  const [filter, setFilter] = useState('');
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [revision, setRevision] = useState(0);
  const [pageError, setPageError] = useState('');
  const [operationError, setOperationError] = useState<{ operation: Operation; message: string }>();
  const [preview, setPreview] = useState<{ title: string; snippets: string[] }>();
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const activeWrite = useRef<AbortController>();
  const current = classes.find(item => item.id === classId);
  const bound = Boolean(current?.sharedWorkspace);

  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    setPageError('');
    libraryRequest<Classroom[]>(key, 'classes', undefined, controller.signal)
      .then(rows => {
        if (controller.signal.aborted) return;
        setClasses(rows);
        setClassId(id => rows.some(item => item.id === id) ? id : rows[0]?.id || '');
      })
      .catch(error => { if (!controller.signal.aborted) setPageError(message(error)); });
    return () => controller.abort();
  }, [key, revision]);

  useEffect(() => {
    if (!key || !classId || !bound) return;
    const controller = new AbortController();
    setPageError('');
    libraryRequest<Library>(key, 'documents?classId=' + encodeURIComponent(classId), undefined, controller.signal)
      .then(result => { if (!controller.signal.aborted) setLibrary(result); })
      .catch(error => { if (!controller.signal.aborted) setPageError(message(error)); });
    return () => controller.abort();
  }, [key, classId, bound, revision]);

  useEffect(() => () => activeWrite.current?.abort(), []);

  function refresh() {
    setRevision(value => value + 1);
  }

  function queue(files: File[]) {
    if (busy || !files.length) return;
    const queued = files.map((file): Upload => {
      const error = fileError(file);
      return {
        id: crypto.randomUUID(), file, description: shortName(file.name), docSource: source.trim() || '教师上传',
        status: error ? '失败' : '待确认上传', error,
      };
    });
    setUploads(items => [...items, ...queued]);
  }

  function onDragOver(event: DragEvent<HTMLLabelElement>) {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = busy ? 'none' : 'copy';
  }

  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    queue(Array.from(event.dataTransfer.files));
  }

  function setUpload(id: string, status: Upload['status'], error?: string) {
    setUploads(items => items.map(item => item.id === id ? { ...item, status, error } : item));
  }

  async function upload(items: Upload[]) {
    if (!items.length || !bound || activeWrite.current) return;
    if (!window.confirm('确认上传选中的 ' + items.length + ' 份资料？上传后可选择挂到本班。' + (library ? '' : ' 资料列表暂不可用，无法检查同名资料。'))) return;
    const controller = new AbortController();
    activeWrite.current = controller;
    setBusy(true);
    const catalog = [...(library?.documents ?? [])];
    try {
      for (const item of items) {
        if (controller.signal.aborted) break;
        const matchingNames = [item.file.name, item.description].map(normalize);
        const duplicate = catalog.some(document => [document.name, document.description].map(normalize)
          .some(value => value && matchingNames.includes(value)));
        if (duplicate && !window.confirm('已有同名资料，仍要再传一份吗？\n' + item.file.name)) {
          setUpload(item.id, '待确认上传');
          continue;
        }
        const form = new FormData();
        form.append('file', item.file);
        form.append('classId', classId);
        form.append('description', item.description);
        form.append('docSource', item.docSource);
        setUpload(item.id, '上传中');
        try {
          const { document } = await uploadTeacherDocument<{ document: Document }>(
            key, form, controller.signal, () => setUpload(item.id, '解析中'),
          );
          catalog.push(document);
          setUpload(item.id, '已入库');
          setLibrary(value => value && { ...value, documents: [...value.documents.filter(doc => doc.location !== document.location), document] });
        } catch (error) {
          if (!controller.signal.aborted) setUpload(item.id, '失败', message(error));
        }
      }
    } finally {
      if (!controller.signal.aborted) {
        activeWrite.current = undefined;
        setBusy(false);
        refresh();
      }
    }
  }

  async function runCards(action: 'generate'|'mount', document?: Document) {
    if (activeWrite.current || !bound) return;
    const question = action === 'mount'
      ? '确认把本次导入的资料卡挂到当前班级？'
      : '确认按内置规则生成资料卡并导入资料库？';
    if (!window.confirm(question)) return;
    const controller = new AbortController();
    activeWrite.current = controller;
    setBusy(true);
    setCardError('');
    setCardOperation(action === 'mount' ? '正在挂载本次资料卡…' : '正在生成并导入资料卡…');
    try {
      if (action === 'mount') {
        const docPaths = cardReport?.documents.map(item=>item.location) || [];
        await teacherRequest(key, 'documents/cards/mount', {classId, docPaths}, controller.signal, 140000);
        if (!controller.signal.aborted) setNotice('本次资料卡已挂到当前班级');
      } else {
        const data = document ? {docPath:document.location}
          : {sourceName:cardSource.trim(), content:cardText.trim()};
        const result = await teacherRequest<CardImport>(key, 'documents/cards',
          {classId, subject:cardSubject, ...data}, controller.signal, 315000);
        if (!controller.signal.aborted) setCardReport(result);
      }
      if (!controller.signal.aborted) refresh();
    } catch (error) {
      if (!controller.signal.aborted) setCardError(message(error));
    } finally {
      if (!controller.signal.aborted) {
        activeWrite.current = undefined;
        setBusy(false);
        setCardOperation('');
      }
    }
  }

  async function operate(operation: Operation) {
    if (activeWrite.current || !bound) return;
    const { action, document, value } = operation;
    const label = action === 'mount' ? value ? '挂到本班' : '从本班移除' : value ? '置顶' : '取消置顶';
    if (action !== 'preview' && !window.confirm('确认将「' + title(document) + '」' + label + '？')) return;
    const controller = new AbortController();
    activeWrite.current = controller;
    setBusy(true);
    setOperationError(undefined);
    setPreview(undefined);
    setNotice('');
    try {
      const target = { classId, docPath: document.location };
      if (action === 'preview') {
        const result = await libraryRequest<{ snippets: string[] }>(key, 'documents/preview', target, controller.signal);
        if (!controller.signal.aborted) setPreview({ title: title(document), snippets: result.snippets });
      } else {
        const changes = action === 'mount' ? { mounted: value } : { pinStatus: value };
        const result = await libraryRequest<Pick<Library, 'mounted' | 'pinned'>>(
          key, 'documents/' + action, { ...target, ...changes }, controller.signal,
        );
        if (!controller.signal.aborted) {
          setLibrary(previous => previous && { ...previous, ...result });
          setNotice(label + '成功');
          refresh();
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) setOperationError({ operation, message: message(error) });
    } finally {
      if (!controller.signal.aborted) {
        activeWrite.current = undefined;
        setBusy(false);
      }
    }
  }

  const keyword = normalize(filter);
  const rows = library?.documents.filter(item => normalize(title(item) + ' ' + item.docSource).includes(keyword)) || [];
  const waiting = uploads.filter(item => item.status === '待确认上传');
  return <>
    <h1>资料库</h1>
    {!key ? <p>请先在<Link to="/classroom">我的班级</Link>登录，再打开资料库。</p> : <>
      <section className="panel library-panel">
        <label>当前班级 <select value={classId} disabled={busy || !classes.length} onChange={event => {
          setClassId(event.target.value);
          setLibrary(undefined);
          setPreview(undefined);
          setNotice('');
          setOperationError(undefined);
          setCardReport(undefined);
          setCardError('');
        }}>
          {!classes.length && <option value="">暂无班级</option>}
          {classes.map(item => <option key={item.id} value={item.id}>
            {item.name}{item.sharedWorkspace ? '' : ' · 未绑定资料库'}
          </option>)}
        </select></label>
        {!classes.length && !pageError && <p>请先在<Link to="/classroom">我的班级</Link>创建班级。</p>}
        {current && !bound && <p role="status">请先在<Link to="/classroom">我的班级</Link>为本班保存共享工作区。</p>}
        {pageError && <p role="alert">{pageError} <button disabled={busy} onClick={refresh}>重试</button></p>}
      </section>

      <section className="panel library-panel">
        <h2>上传资料</h2>
        <div className="library-tabs" aria-label="入库方式">
          <button type="button" disabled={busy} aria-pressed={tab==='file'} onClick={()=>setTab('file')}>上传文件</button>
          <button type="button" disabled={busy} aria-pressed={tab==='text'} onClick={()=>setTab('text')}>粘贴文本</button>
        </div>
        <label>学科或学段（选填） <input value={cardSubject} maxLength={100} disabled={!bound||busy}
          placeholder="例如：高中数学" onChange={event=>setCardSubject(event.target.value)}/></label>
        {tab==='text'?<>
          <label>资料名称 <input value={cardSource} maxLength={240} disabled={!bound||busy}
            onChange={event=>setCardSource(event.target.value)}/></label>
          <label>资料文本 <textarea value={cardText} maxLength={60000} disabled={!bound||busy} rows={8}
            placeholder="粘贴讲义、文档提取文本或图片 OCR 结果" onChange={event=>setCardText(event.target.value)}/></label>
          <button type="button" disabled={!bound||busy||!cardText.trim()||!cardSource.trim()}
            onClick={()=>void runCards('generate')}>生成资料卡并入库</button>
        </>:<>
        <p>支持 JPG、PNG 等图片和 PowerPoint（.ppt、.pptx）。旧版 .ppt 会直接提取幻灯片文字。</p>
        <label>资料来源 <input value={source} maxLength={240} disabled={busy}
          placeholder="例如：高中数学错因诊断手册" onChange={event => setSource(event.target.value)} /></label>
        <label className="library-drop" onDragOver={onDragOver} onDrop={onDrop}>
          选择文件或拖到此处，单文件最多 20 MB
          <input type="file" multiple disabled={busy}
            onChange={event => { queue(Array.from(event.target.files || [])); event.target.value = ''; }} />
        </label>
        <button disabled={!bound || busy || !waiting.length} onClick={() => void upload(waiting)}>确认上传</button>
        {!!waiting.length && !bound && <p role="status">文件已加入队列。请先选择已绑定共享工作区的班级，再确认上传。</p>}
        {!!waiting.length && bound && !library && <p role="status">文件已选中。资料列表暂不可用，你仍可确认上传。</p>}
        {!!uploads.length && <ul className="library-uploads" aria-live="polite">{uploads.map(item => <li key={item.id}>
          <strong>{item.file.name}</strong>　{item.status}{item.error && <span role="alert"> · {item.error}</span>}
          {item.status === '失败' && <button disabled={busy || !bound || Boolean(fileError(item.file))}
            onClick={() => void upload([item])}>重试</button>}
          {['待确认上传', '失败'].includes(item.status) && <button disabled={busy}
            onClick={() => setUploads(list => list.filter(value => value.id !== item.id))}>移出队列</button>}
        </li>)}</ul>}
        </>}
        {cardOperation&&<p role="status">{cardOperation}</p>}
        {cardError&&<p role="alert">{cardError}</p>}
        {cardReport&&<section className="library-preview" aria-label="拆卡结果">
          <h3>资料卡导入结果</h3>
          <p>入库 {cardReport.documents.length} 张 · 跳过 {cardReport.skipped.length} 张 · 待核对 {cardReport.uncertain.length} 项 · 失败 {cardReport.failures.length} 张</p>
          {!!cardReport.documents.length&&<button type="button" disabled={busy||!bound}
            onClick={()=>void runCards('mount')}>将本次资料卡挂到本班</button>}
          {(cardReport.skipped.length+cardReport.uncertain.length+cardReport.failures.length)>0&&<details>
            <summary>查看未导入原因</summary>
            <ul>{[...cardReport.skipped.map(item=>[item.source,item.reason]),
              ...cardReport.uncertain.map(item=>[item.item,item.reason]),
              ...cardReport.failures.map(item=>[item.title,item.reason])].map(([label,reason],index)=>
              <li key={index}>{label||'资料卡'} · {reason}</li>)}</ul>
          </details>}
        </section>}
      </section>

      <LibrarySearch key={classId + ':' + (current?.sharedWorkspace?.slug || '')}
        teacherKey={key} classId={classId} workspaceName={current?.sharedWorkspace?.name} />

      <section className="panel library-panel">
        <div className="library-toolbar">
          <h2>资料列表</h2>
          <label>筛选 <input value={filter} onChange={event => setFilter(event.target.value)} placeholder="按标题或来源" /></label>
          <button disabled={busy} onClick={refresh}>刷新资料</button>
        </div>
        {operationError && <p role="alert">{operationError.message} <button disabled={busy}
          onClick={() => void operate(operationError.operation)}>重试</button></p>}
        {notice && <p role="status">{notice}</p>}
        {bound && !library && !pageError && <p role="status">正在读取资料…</p>}
        {library && !library.documents.length && <p>还没有资料，先上传一份</p>}
        {library && library.documents.length > 0 && !rows.length && <p>没有符合筛选条件的资料。</p>}
        {!!rows.length && <div className="library-table"><table>
          <thead><tr><th>标题</th><th>来源</th><th>字数</th><th>本班挂载</th><th>置顶</th><th>操作</th></tr></thead>
          <tbody>{rows.map(document => {
            const mounted = Boolean(library?.mounted.includes(document.location));
            const pinned = Boolean(library?.pinned.includes(document.location));
            return <tr key={document.location}>
              <td>{title(document)}</td><td>{document.docSource || '—'}</td><td>{document.wordCount ?? '未知'}</td>
              <td>{mounted ? '已挂载' : '未挂载'}</td><td>{pinned ? '已置顶' : '未置顶'}</td>
              <td><div className="library-actions">
                <button disabled={busy} onClick={() => void operate({ action: 'mount', document, value: !mounted })}>
                  {mounted ? '从本班移除' : '挂到本班'}
                </button>
                <button disabled={!mounted || busy} onClick={() => void operate({ action: 'pin', document, value: !pinned })}>
                  {pinned ? '取消置顶' : '置顶'}
                </button>
                <button disabled={!mounted || busy} onClick={() => void operate({ action: 'preview', document, value: false })}>预览分段</button>
                <button disabled={busy} onClick={()=>void runCards('generate', document)}>生成资料卡</button>
              </div></td>
            </tr>;
          })}</tbody>
        </table></div>}
        {preview && <section className="library-preview" aria-label="分段预览">
          <h3>{preview.title}</h3>
          <p>命中 {preview.snippets.length} 段（最多 10）</p>
          {preview.snippets.length ? <ol>{preview.snippets.map((snippet, i) => <li key={i}>{snippet}</li>)}</ol>
            : <p>本次未命中片段，请确认资料已挂载并完成处理。</p>}
          <button onClick={() => setPreview(undefined)}>关闭预览</button>
        </section>}
      </section>

      {library && <section className="panel library-panel" aria-label="资料状态">
        <p>文档数 {library.documents.length} · 已挂载数 {library.mounted.length} · 向量总数 {library.vectorCount ?? '未知'}</p>
        {!library.mounted.length && <p role="status">学生端暂时检索不到任何依据，请先上传并挂载资料。</p>}
      </section>}
    </>}
  </>;
}
