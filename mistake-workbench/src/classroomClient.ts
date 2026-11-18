import { MOCK } from './config';
import { chat, type ImageAttachment } from './apiClient';
import type { Scope } from './localRepository';

declare global {
 interface Window {
  zhixuClassroom?: (url: string, endpoint: string, body: unknown, token?: string) => Promise<{
   ok: boolean; data: { error?: string } | null;
  }>;
 }
}

export type Classroom = { id: string; name: string };
export type Membership = Classroom & { url: string; token: string };
export const keyFor = (workspace: string) => 'zhixu-classroom:' + (MOCK ? 'mock:' : 'real:') + workspace;

export function membership(workspace?: string): Membership | null {
  if (!workspace || typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem(keyFor(workspace));
  return raw ? JSON.parse(raw) : null;
}

export async function post<T>(url: string, endpoint: string, body: unknown, token?: string): Promise<T> {
  if (window.zhixuClassroom) {
    const { ok, data } = await window.zhixuClassroom(url, endpoint, body, token);
    if (!ok || !data) throw new Error(data?.error || '班级服务响应异常');
    return data as T;
  }
  const response = await fetch(url + '/api/classroom/student/' + endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(endpoint === 'chat' ? 135000 : 8000),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new Error(data?.error || '班级服务响应异常');
  return data as T;
}

export function decodeInvitation(invitation: string): { classId: string; code: string; origins: string[] } {
  try {
    const value = invitation.trim();
    if (!/^ZX1-[A-Za-z0-9_-]+$/.test(value) || value.length > 2048) throw Error();
    const data = JSON.parse(atob(value.slice(4).replace(/-/g, '+').replace(/_/g, '/')));
    if (!/^[0-9a-f-]{36}$/i.test(data.classId) || !/^[0-9a-f]{16}$/i.test(data.code)
      || !Array.isArray(data.origins) || !data.origins.length || data.origins.length > 12) throw Error();
    const origins = data.origins.map((address: unknown) => {
      if (typeof address !== 'string') throw Error();
      const url = new URL(address);
      if (!['http:', 'https:'].includes(url.protocol) || url.origin !== address) throw Error();
      return url.origin;
    });
    return { classId: data.classId, code: data.code, origins: [...new Set<string>(origins)] };
  } catch {
    throw Error('请粘贴老师发来的完整班级邀请。旧班级码可请老师重新生成邀请。');
  }
}

export async function workspaceChat(scope: Scope, message: string, attachments: ImageAttachment[] = []) {
  const joined = membership(scope.workspace_id);
  if (!joined) return chat(scope.slug, message, attachments);
  const result = await post<{ textResponse?: string }>(joined.url, 'chat', { message, attachments }, joined.token);
  if (typeof result.textResponse !== 'string') throw Error('班级工作区没有返回有效的模型响应');
  return result.textResponse;
}
