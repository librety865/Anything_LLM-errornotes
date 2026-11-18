export const classroomSessionKey = 'zhixu.teacher.session';

export async function teacherRequest<T>(key: string, endpoint: string, payload?: object, signal?: AbortSignal, timeoutMs = 8000): Promise<T> {
  if (!['http:', 'https:'].includes(window.location.protocol)) {
    throw new Error('请双击「启动班级服务.cmd」，登录时使用启动窗口显示的网址。');
  }
  let response: Response;
  const timeout = AbortSignal.timeout(timeoutMs);
  try {
    response = await fetch('/api/classroom/teacher/' + endpoint, {
      method: payload === undefined ? 'GET' : 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: payload === undefined ? undefined : JSON.stringify(payload),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    if (timeout.aborted) throw new Error('请求超时。请检查 AnythingLLM 是否能读取工作区，再重试。');
    throw new Error(window.zhixuTeacherDesktop
      ? '无法连接本机班级服务，请退出并重新打开教师端桌面版。'
      : '无法连接班级服务，请通过启动班级服务脚本重新打开教师端。');
  }
  const data = await response.json().catch(() => null);
  if (!data) throw new Error('当前页面未连接班级服务。请用「启动班级服务.cmd」打开正确的教师端网址。');
  if (response.status === 401) throw new Error('教师管理码不正确。请重新复制当前班级服务窗口显示的管理码。');
  if (!response.ok) throw new Error(data.error || '班级服务暂时不可用');
  return data as T;
}

export function libraryRequest<T>(key: string, endpoint: string, payload?: object, signal?: AbortSignal) {
  return teacherRequest<T>(key, endpoint, payload, signal, 25000);
}

export function uploadTeacherDocument<T>(
  key: string, form: FormData, signal: AbortSignal, onUploaded: () => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    const abort = () => request.abort();
    request.open('POST', '/api/classroom/teacher/documents/upload');
    request.setRequestHeader('Authorization', 'Bearer ' + key);
    request.timeout = 180000;
    request.responseType = 'json';
    request.upload.addEventListener('load', onUploaded);
    request.addEventListener('load', () => {
      if (request.status >= 200 && request.status < 300 && request.response) resolve(request.response as T);
      else reject(new Error(request.response?.error || '上传失败，请确认班级服务已启动后重试'));
    });
    request.addEventListener('error', () => reject(new Error('无法连接班级服务，请重新打开教师端后重试')));
    request.addEventListener('timeout', () => reject(new Error('上传处理超时，请先刷新资料列表，再决定是否重试')));
    request.addEventListener('abort', () => reject(new Error('上传已取消，请刷新列表后查看结果')));
    request.addEventListener('loadend', () => signal.removeEventListener('abort', abort));
    if (signal.aborted) {
      reject(new Error('上传已取消'));
      return;
    }
    signal.addEventListener('abort', abort, { once: true });
    request.send(form);
  });
}
