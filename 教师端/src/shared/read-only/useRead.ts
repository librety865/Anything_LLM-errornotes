import { useEffect, useRef, useState } from 'react';

export type ReadState<T> =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: T };

export function useRead<T>(key: string, load: (signal: AbortSignal) => Promise<T>) {
  const loader = useRef(load);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; attempt: number; state: ReadState<T> }>();
  useEffect(() => { loader.current = load; });
  useEffect(() => {
    const controller = new AbortController();
    const complete = (state: ReadState<T>) => {
      if (!controller.signal.aborted) setResult({ key, attempt, state });
    };
    loader.current(controller.signal).then(
      data => complete({ status: 'ready', data }),
      error => complete({ status: 'error', message: error instanceof Error ? error.message : '请求失败，请重试。' }),
    );
    return () => controller.abort();
  }, [key, attempt]);
  const state: ReadState<T> = result?.key === key && result.attempt === attempt ? result.state : { status: 'loading' };
  return { state, retry: () => setAttempt(previous => previous + 1) };
}
