import {useEffect,useRef,useState} from 'react';
import {MOCK,configurationError} from './config';
import {listRemoteWorkspaces,type RemoteWorkspace} from './apiClient';
import {connectWorkspace} from './localRepository';
export function ConnectionSettings({onBound}:{onBound:()=>void}){
 const [rows,setRows]=useState<RemoteWorkspace[]>([]),[slug,setSlug]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const active=useRef(true);useEffect(()=>{active.current=true;return()=>{active.current=false}},[]);
 async function load(){setBusy(true);setMessage('');try{const ws=await listRemoteWorkspaces();if(active.current){setRows(ws);setSlug('');setMessage(ws.length?'请选择工作区。无需绑定考试类型。':'没有工作区，请先在 AnythingLLM 创建。');}}catch(e){if(active.current)setMessage(String(e));}finally{if(active.current)setBusy(false)}}
 return <section className="panel settings"><h2>AnythingLLM 工作区</h2><p>连接已有工作区后，从顶部切换。图片识别需要该工作区配置支持图片的模型。</p>{MOCK&&<p className="notice">当前为演示模式，不能识别图片。请在本机配置真实连接后重启。</p>}{configurationError&&<p role="alert">{configurationError}</p>}<button disabled={MOCK||!!configurationError||busy} onClick={load}>{busy?'读取中…':'读取工作区'}</button><label>工作区<select value={slug} onChange={e=>setSlug(e.target.value)}><option value="">请选择</option>{rows.map(w=><option key={w.slug} value={w.slug}>{w.name}</option>)}</select></label><button disabled={busy||!slug||MOCK} onClick={()=>{try{const selected=rows.find(w=>w.slug===slug);if(!selected)throw Error('请重新读取');connectWorkspace(selected.name,selected.slug);onBound();setMessage('已连接，请从顶部切换至该工作区。');}catch(e){setMessage(String(e))}}}>连接工作区</button>{message&&<pre role="status" className="whitespace-pre-wrap break-words">{message}</pre>}</section>
}
