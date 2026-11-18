import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { libraryRequest } from '../api/classroomTeacherApi';

type Hit = { id: string; score: number; title: string; source: string; text: string };
type Props = { teacherKey: string; classId: string; workspaceName?: string };

function highlight(text: string, query: string) {
  const terms = [...new Set(query.match(/[\p{L}\p{N}]+/gu) || [])].sort((a, b) => b.length - a.length);
  if (!terms.length) return text;
  const pattern = new RegExp('(' + terms.join('|') + ')', 'giu');
  return text.split(pattern).map((part, index) => index % 2 ? <mark key={index}>{part}</mark> : part);
}

export function LibrarySearch({ teacherKey, classId, workspaceName }: Props) {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<{ query: string; hits: Hit[] }>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const timer = useRef<number>();
  const active = useRef<AbortController>();
  const enabled = Boolean(classId && workspaceName);

  function cancel() {
    window.clearTimeout(timer.current);
    active.current?.abort();
    active.current = undefined;
  }

  async function search(value: string) {
    cancel();
    if (!enabled || !value) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError('');
    try {
      const data = await libraryRequest<{ results: Hit[] }>(
        teacherKey, 'knowledge-search', { classId, query: value, topN: 5 }, controller.signal,
      );
      if (active.current === controller) setResult({ query: value, hits: data.results });
    } catch (failure) {
      if (active.current === controller) {
        setError(failure instanceof Error ? failure.message : '请检查班级服务后重试');
      }
    } finally {
      if (active.current === controller) {
        active.current = undefined;
        setBusy(false);
      }
    }
  }

  function change(value: string) {
    cancel();
    setQuery(value);
    setError('');
    setBusy(false);
    const next = value.trim();
    if (!next) {
      setResult(undefined);
      return;
    }
    timer.current = window.setTimeout(() => void search(next), 300);
  }

  function handleInputKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      void search(query.trim());
    }
    if (event.key === 'Escape') change('');
  }

  useEffect(() => {
    function focus(event: globalThis.KeyboardEvent) {
      if (!enabled || event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.target instanceof HTMLElement &&
        (event.target.isContentEditable || event.target.closest('input, textarea, select'))) return;
      event.preventDefault();
      input.current?.focus();
    }
    window.addEventListener('keydown', focus);
    return () => {
      window.removeEventListener('keydown', focus);
      cancel();
    };
  }, [enabled]);

  return <section className="panel library-panel" aria-label="搜索资料">
    <div className="library-toolbar">
      <label>搜索资料 <input ref={input} value={query} maxLength={200} disabled={!enabled}
        onChange={event => change(event.target.value)} onKeyDown={handleInputKey}
        placeholder="输入知识点，例如二次函数 顶点" /></label>
      <button type="button" disabled={!busy} onClick={() => { cancel(); setBusy(false); }}>停止</button>
    </div>
    {!enabled && <p>请先为班级保存共享工作区。</p>}
    {busy && <p role="status">正在检索资料…</p>}
    {error && <p role="alert">检索失败：{error} <button onClick={() => void search(query.trim())}>重试</button></p>}
    {result && <div className={error ? 'library-search-results is-stale' : 'library-search-results'}>
      {error && <p>以下为上次成功的检索结果。</p>}
      {!error || result.hits.length > 0
        ? <h3>命中 {result.hits.length} 条 · 阈值 0.45 · 工作区 {workspaceName}</h3>
        : null}
      {!result.hits.length && !error && <p>命中 0 条。换个更具体的知识点名，或先上传资料</p>}
      {result.hits.map((hit, index) => {
        const percent = Math.round(Math.min(1, Math.max(0, hit.score)) * 1000) / 10;
        const snippet = hit.text.slice(0, 340);
        return <article className="library-search-card" key={hit.id + ':' + index}>
          <h4>依据 {index + 1} · {hit.source || hit.title || '教研资料'}</h4>
          <label>相似度 {percent}% <progress value={percent} max={100} /></label>
          <p>{highlight(snippet, result.query)}</p>
        </article>;
      })}
    </div>}
  </section>;
}
