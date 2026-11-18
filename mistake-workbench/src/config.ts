import type {Exam} from './types';
declare global {
 interface Window {
  zhixuDesktop?: { demo: boolean; configured: boolean; adminUrl?: string; slugs: Record<Exam, string> };
 }
}

export const desktop = typeof window === 'undefined' ? undefined : window.zhixuDesktop;
export const MOCK = desktop?.demo ?? (import.meta.env.VITE_USE_MOCK !== 'false');
export const sourceLabel=MOCK?'Mock 演示':'AnythingLLM 返回 · 本地缓存';
export const configurationError=!MOCK&&!(desktop?.configured ?? Boolean(import.meta.env.VITE_ANYTHINGLLM_API_KEY))?'请先在 .env.local 填写 Key，然后重启。':'';
export const slugs:Record<Exam,string>=desktop?.slugs ?? {'高考':import.meta.env.VITE_WORKSPACE_SLUG_GAOKAO||'','中考':import.meta.env.VITE_WORKSPACE_SLUG_ZHONGKAO||'','考研':import.meta.env.VITE_WORKSPACE_SLUG_KAOYAN||'','考公':import.meta.env.VITE_WORKSPACE_SLUG_KAOGONG||''};
