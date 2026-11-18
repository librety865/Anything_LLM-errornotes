import {configurationError,desktop} from './config';
export const chatPath=(slug:string)=>`/api/v1/workspace/${encodeURIComponent(slug)}/chat`;
export async function developerRequest(path:string,body?:unknown,timeout=20000):Promise<any>{
 if(configurationError||!(desktop?.configured ?? Boolean(import.meta.env.VITE_ANYTHINGLLM_API_KEY?.trim())))throw Error('请在 .env.local 填写 AnythingLLM Developer API Key 并重启前端');
 if(!path.startsWith('/api/v1/'))throw Error('不支持的 Developer API 路径');
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeout);
 try{const res=await fetch(path,{method:body===undefined?'GET':'POST',headers:{...(!desktop?{Authorization:'Bearer '+import.meta.env.VITE_ANYTHINGLLM_API_KEY}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal:controller.signal});
 if(res.headers.get('X-Zhixu-Proxy-Error')==='1')throw Error('前端代理无法连接 AnythingLLM：请保持桌面版运行，并确认 API 地址和端口。');
 const raw=await res.text();let data:any;try{data=JSON.parse(raw)}catch{}
 if(!res.ok){
  const detail=typeof data?.error==='string'?data.error:typeof data?.message==='string'?data.message:raw;
  const safeDetail=detail.split(import.meta.env.VITE_ANYTHINGLLM_API_KEY||'__no_key__').join('[密钥已隐藏]');
  throw Error('AnythingLLM 请求失败：HTTP '+res.status+'\n'+(safeDetail||'服务未返回错误详情')+'\n请求路径：'+path);
 }
 if(!data)throw Error('接口返回非 JSON：'+raw);
 if(data?.error||data?.type==='abort')throw Error(data.error||'AnythingLLM 中止请求');return data;
 }catch(e){if(controller.signal.aborted)throw Error('请求超时，请确认 AnythingLLM 正在运行');if(e instanceof TypeError)throw Error('无法连接，请检查桌面版、代理地址与网络');throw e;}finally{clearTimeout(timer)}
}
export async function chat(slug:string,message:string,attachments:ImageAttachment[]=[]){if(!slug.trim())throw Error('当前工作区未配置 AnythingLLM slug');const data=await developerRequest(chatPath(slug),{message,mode:'chat',attachments,sessionId:'zhixu-'+crypto.randomUUID()},120000);if(typeof data?.textResponse!=='string')throw Error('响应缺少 textResponse');return data.textResponse as string;}
export interface EvidenceHit {id:string;text:string;score:number;title:string;source:string}
export async function vectorSearch(slug:string,query:string,topN=5):Promise<EvidenceHit[]>{
 if(!slug.trim())throw Error('当前工作区未配置 AnythingLLM slug');
 const data=await developerRequest('/api/v1/workspace/'+encodeURIComponent(slug)+'/vector-search',{query,topN});
 const rows=Array.isArray(data?.results)?data.results:[];
 return rows.filter((row:any)=>row&&typeof row.text==='string'&&row.text.trim()).map((row:any)=>({
  id:typeof row.id==='string'?row.id:crypto.randomUUID(),
  text:row.text as string,
  score:typeof row.score==='number'?row.score:0,
  title:typeof row.metadata?.title==='string'&&row.metadata.title!=='.txt'?row.metadata.title:'教研资料',
  source:typeof row.metadata?.description==='string'&&row.metadata.description.trim()?row.metadata.description
   :typeof row.metadata?.docSource==='string'?row.metadata.docSource:'',
 }));
}
export interface RemoteWorkspace {name:string;slug:string}
export async function listRemoteWorkspaces():Promise<RemoteWorkspace[]>{const data=await developerRequest('/api/v1/workspaces');if(!Array.isArray(data?.workspaces)||!data.workspaces.every((w:any)=>typeof w?.name==='string'&&typeof w?.slug==='string'&&w.slug.trim()))throw Error('工作区响应格式不兼容，请查看当前实例 /api/docs');return data.workspaces.map((w:any)=>({name:w.name,slug:w.slug}));}

export interface ImageAttachment {name:string;mime:string;contentString:string}

export async function workspaceSettings(request: typeof developerRequest, slug: string, changes?: Record<string, unknown>) {
 const path = '/api/v1/workspace/' + encodeURIComponent(slug);
 const data = await request(changes ? path + '/update' : path, changes);
 const workspace = Array.isArray(data.workspace) ? data.workspace.find((item: { slug: string }) => item.slug === slug) : data.workspace;
 if (!workspace || workspace.slug !== slug || data.message) throw Error('AnythingLLM 未返回有效的工作区配置。');
 if (changes) return workspace as Record<string, unknown>;
 const catalog = await request('/api/v1/workspaces').catch(() => null);
 const availableModels = (Array.isArray(catalog?.workspaces) ? catalog.workspaces : [])
  .filter((item: any) => typeof item?.chatProvider === 'string' && typeof item.chatModel === 'string')
  .map((item: any) => ({ provider: item.chatProvider, model: item.chatModel }));
 let adminUrl = desktop?.adminUrl || '';
 if (!desktop) {
  try {
   const address = new URL(import.meta.env.VITE_ANYTHINGLLM_BASE_URL || 'http://127.0.0.1:3001');
   if (['http:', 'https:'].includes(address.protocol) && !address.username && !address.password) adminUrl = address.origin + '/';
  } catch { /* The workspace editor remains available. */ }
 }
 return { ...workspace, availableModels, adminUrl } as Record<string, unknown>;
}
