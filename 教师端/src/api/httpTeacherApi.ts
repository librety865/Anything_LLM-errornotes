import type { Filters, Pagination, TeacherApi } from './contracts';

const segment = encodeURIComponent;

export function createHttpTeacherApi(teacherToken: string): TeacherApi {
  async function get<T>(path: string, signal: AbortSignal, query: Record<string, string | number | undefined> = {}): Promise<T> {
    if (!teacherToken) throw new Error('教师服务尚未接入教师会话。');
    const params = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== '') params.set(key, String(value));
    });
    const response = await fetch('/api/teacher' + path + (params.size ? '?' + params : ''), {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + teacherToken, Accept: 'application/json' },
      credentials: 'omit',
      signal,
    });
    if (response.status === 401) throw new Error('教师会话已失效。');
    if (response.status === 403 || response.status === 404) throw new Error('记录不存在或无权访问。');
    if (!response.ok) throw new Error('教师数据读取失败，请重试。');
    return response.json() as Promise<T>;
  }

  function listQuery(workspaceId: string, filters: Filters, pagination: Pagination) {
    return { workspaceId, ...filters, ...pagination };
  }

  return {
    me: signal => get('/me', signal),
    workspaces: signal => get('/workspaces', signal),
    dashboard: (workspaceId, filters, signal) => get('/dashboard', signal, { ...filters, workspaceId }),
    filterOptions: (workspaceId, filters, signal) => get('/filter-options', signal, { ...filters, workspaceId }),
    classes: (w, filters, page, signal) => get('/classes', signal, listQuery(w, filters, page)),
    classDetail: (workspaceId, id, signal) => get('/classes/' + segment(id), signal, { workspaceId }),
    students: (w, id, keyword, page, signal) => get('/classes/' + segment(id) + '/students', signal, listQuery(w, { keyword }, page)),
    student: (workspaceId, classId, id, signal) => get('/students/' + segment(id), signal, { workspaceId, classId }),
    studentMistakes: (w, classId, id, filters, page, signal) =>
      get('/students/' + segment(id) + '/mistakes', signal, listQuery(w, { ...filters, classId }, page)),
    mistakes: (w, filters, page, signal) => get('/mistakes', signal, listQuery(w, filters, page)),
    mistake: (workspaceId, id, signal) => get('/mistakes/' + segment(id), signal, { workspaceId }),
    feedback: (workspaceId, id, variantId, signal) =>
      get('/mistakes/' + segment(id) + '/variants/' + segment(variantId) + '/feedback', signal, { workspaceId }),
  };
}
