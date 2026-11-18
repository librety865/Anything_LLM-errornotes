import {cacheRecoveryEvent} from './localRepository';
import {batchLimit} from './service';
import { WorkspaceModelSettings } from './WorkspaceModelSettings';
import { developerRequest, workspaceSettings } from './apiClient';
import {ClassroomSettings, useClassroomSync} from './ClassroomSettings';
import {membership} from './classroomClient';
import {MigrationSettings} from './MigrationSettings';
import {ImageIntake} from './ImageIntake';
import {initialWorkspace, renameWorkspace, createLocalWorkspace, archivedWorkspaces, setWorkspaceArchived} from './localRepository';
import {ConnectionSettings} from './ConnectionSettings';
import {MOCK,configurationError,sourceLabel} from './config';
import React,{useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter,Routes,Route,useNavigate,useParams,useLocation,NavLink} from 'react-router-dom';
import {BookOpen,LayoutList,Plus,Settings as SettingsIcon,Menu,Search,ArrowUpRight,Users,UserRound} from 'lucide-react';
import {api} from './api';
import {exams,type Exam,type Input,type MistakeRecord as R,type Preferences,type Axis,type Batch,type Workspace} from './types';
import {MistakeDetail,Status,download,recordText,type OpenFeedback} from './records';
import './styles.css';
function stored<T>(key:string,fallback:T):T{try{return JSON.parse(localStorage.getItem(key)||'null')||fallback;}catch{return fallback;}}
function VariantCountSelector({value,onChange}:{value:2|3;onChange:(n:2|3)=>void}){return <label>整批变式数量<select value={value} onChange={e=>onChange(Number(e.target.value) as 2|3)}><option value={2}>2 道 · V1 / V2</option><option value={3}>3 道 · V1 / V2 / V3</option></select></label>}
function AxisSelector({value,onChange}:{value:Axis|'';onChange:(s:Axis|'')=>void}){return <label>分类轴（必选）<select value={value} onChange={e=>onChange(e.target.value as Axis|'')}><option value="">请选择分类轴</option><option value="知识点">按知识点分类</option><option value="错误点">按错误点分类</option></select></label>}
function notebookGroups(workspaces: Workspace[]) {
 const groups: { kind: 'public' | 'personal'; label: string; items: Workspace[] }[] = [
  {kind: 'public', label: '公共工作区', items: []},
  {kind: 'personal', label: '个人工作区', items: []},
 ];
 for (const workspace of workspaces) groups[membership(workspace.id) ? 0 : 1].items.push(workspace);
 return groups;
}

export function WorkspaceSwitcher({exam, onChange, onJoin}: {
 exam: Exam; onChange: (id: Exam) => void; onJoin: () => void;
}) {
 const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
 const lastSelected = useRef<Partial<Record<'public' | 'personal', Exam>>>({});
 useEffect(() => {
  let active = true;
  function refresh() {
   void api.workspaces().then(rows => { if (active) setWorkspaces(rows); }).catch(() => {});
  }
  refresh();
  window.addEventListener('zhixu-workspaces-changed', refresh);
  return () => {
   active = false;
   window.removeEventListener('zhixu-workspaces-changed', refresh);
  };
 }, [exam]);

 const groups = notebookGroups(workspaces);
 const activeKind = membership(exam) ? 'public' : 'personal';
 const current = groups.find(group => group.kind === activeKind);
 const activeNotebook = current?.items.find(item => item.id === exam);
 useEffect(() => { lastSelected.current[activeKind] = exam; }, [activeKind, exam]);

 return <nav className="notebook-switcher" aria-label="错题工作区">
  <div className="notebook-switcher-options">
   {groups.map(group => {
    const Icon = group.kind === 'public' ? Users : UserRound;
    const isActive = activeKind === group.kind;
    return <button key={group.kind} className="notebook-switcher-option" type="button"
     aria-pressed={isActive} onClick={() => {
      const next = group.items.find(item => item.id === lastSelected.current[group.kind]) ?? group.items[0];
      if (next && next.id !== exam) onChange(next.id);
      else if (!next && group.kind === 'public') onJoin();
     }}>
     <Icon size={21} aria-hidden="true"/>
     <span><strong>{group.label}</strong><small>{group.kind === 'personal'
      ? '个人错题 · 仅本机保存'
      : group.items.length ? '班级错题 · 自动同步' : '尚未加入班级 · 点此加入'}</small></span>
    </button>;
   })}
  </div>
  {activeNotebook && <div className="notebook-switcher-current">
   {current && current.items.length > 1 ? <label>当前错题本
    <select value={exam} onChange={event => onChange(event.target.value)}>
     {current.items.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
    </select>
   </label> : <span>当前错题本：<strong>{activeNotebook.name}</strong></span>}
  </div>}
 </nav>;
}
function App(){const [exam,setExam]=useState<Exam>(initialWorkspace()),[prefs,setPrefs]=useState<Preferences>(stored('zhixu-prefs',{variantCount:2,classificationAxis:''})),[drawer,setDrawer]=useState(false);const navigate=useNavigate();const location=useLocation();api.setExam(exam);
 const classroomEnabled = useClassroomSync(exam);
 function change(e:Exam){api.setExam(e);setExam(e);navigate('/');setDrawer(false);}
 function goToJoin() {
  if (location.pathname === '/settings') document.getElementById('join-classroom')?.scrollIntoView({block:'start'});
  else navigate('/settings#join-classroom');
 }
 useEffect(() => {
  if (location.pathname === '/settings' && location.hash === '#join-classroom') {
   document.getElementById('join-classroom')?.scrollIntoView({block:'start'});
  }
 }, [location.pathname, location.hash]);
 return <div className="app"><aside className={drawer?'sidebar open':'sidebar'}><div className="brand"><BookOpen/><strong>知序<span>智能错题整理系统</span></strong></div><div className="nav-caption">学习工作台</div><nav>{[[ '/',LayoutList,'错题记录'],['/new',Plus,'录入错题'],['/settings',SettingsIcon,'偏好设置']].map(([path,Icon,title])=>{const I=Icon as typeof Plus;return <NavLink end key={String(path)} to={String(path)} onClick={()=>setDrawer(false)}><I size={19}/>{String(title)}</NavLink>})}</nav><div className="sidebar-note"><span className="live-dot"/> {sourceLabel}<p>让每一次错误，<br/>成为下一次的解题线索。</p></div></aside>{drawer&&<button className="backdrop" aria-label="关闭导航" onClick={()=>setDrawer(false)}/>}
 <div className="main-shell"><header className="topbar"><button className="mobile-menu" aria-label="打开导航" onClick={()=>setDrawer(!drawer)}><Menu/></button><span className="mock-badge">{classroomEnabled ? '班级错题本 · 自动同步' : '个人错题本 · 仅本机保存'}</span></header><WorkspaceSwitcher exam={exam} onChange={change} onJoin={goToJoin}/><main key={exam}>{!classroomEnabled&&configurationError&&<p role="alert" className="notice">{configurationError}</p>}<CacheNotice/><ProgressNotice/><div className="breadcrumb">工作台 <span>/</span> {classroomEnabled ? '班级错题本' : '个人错题本'} <span>/</span> {location.pathname==='/new'?'录入错题':location.pathname==='/settings'?'偏好设置':'错题记录'}</div><Routes><Route path="/" element={<MistakeList exam={exam} prefs={prefs}/>}/><Route path="/new" element={<MistakeForm exam={exam} prefs={prefs}/>}/><Route path="/mistakes/:id" element={<DetailPage exam={exam}/>}/><Route path="/batches/:id" element={<BatchResultPage exam={exam}/>}/><Route path="/settings" element={<Settings exam={exam} prefs={prefs} onChange={p=>{setPrefs(p);localStorage.setItem('zhixu-prefs',JSON.stringify(p));}} switchExam={change}/>}/><Route path="*" element={<p>页面不存在。</p>}/></Routes></main></div></div>}
function Heading({title,sub,children}:{title:string;sub:string;children?:React.ReactNode}){return <div className="page-heading"><div><h1>{title}</h1><p>{sub}</p></div>{children}</div>}
export function MistakeList({exam,prefs}:{exam:Exam;prefs:Preferences}){const [records,setRecords]=useState<R[]>([]),[all,setAll]=useState<R[]>([]),[filters,setFilters]=useState<Record<string,string>>({}),[selected,setSelected]=useState<string[]>([]),[dialog,setDialog]=useState(false),[axis,setAxis]=useState<Axis|''>(prefs.classificationAxis),[count,setCount]=useState<2|3>(prefs.variantCount),[busy,setBusy]=useState(false),[error,setError]=useState(''),[loading,setLoading]=useState(true);const navigate=useNavigate();
 useEffect(()=>{let alive=true;async function load(){try{const [a,b]=await Promise.all([api.list({examType:exam,...filters}),api.list({examType:exam})]);if(alive){setRecords(a);setAll(b);setError('');setLoading(false);}}catch(e){if(alive){setError(String(e));setLoading(false);}}}load();const t=setInterval(load,2500);return()=>{alive=false;clearInterval(t)}},[exam,filters]);
 function filter(k:string,v:string){setFilters({...filters,[k]:v});setSelected([]);}
 return <><Heading title={membership(exam) ? '班级错题本' : '个人错题本'} sub={membership(exam) ? '新录入的错题保存在本错题本，学习统计自动同步给教师。' : '只显示当前个人错题本的记录。'}><button className="primary" onClick={()=>navigate('/new')}><Plus size={17}/>录入错题</button></Heading><div className="stats">{[['全部记录',all.length,'当前工作区'],['已加工',all.filter(r=>r.status==='已加工').length,'归纳 · 练习 · 核对'],['待确认',all.filter(r=>r.status==='待确认').length,'补一个关键缺口'],['加工中',all.filter(r=>r.status==='加工中').length,'逐道生成加工记录']].map(([label,note,sub])=><div className="panel stat" key={label}><span>{label}</span><strong>{note}<small>道</small></strong><p>{sub}</p></div>)}</div><section className="panel list-panel"><div className="list-title"><h2>全部错题 <small>{records.length} 条记录</small></h2><span className="muted">仅显示当前工作区数据</span></div><div className="filters"><div className="search"><Search size={18}/><input aria-label="搜索错题" placeholder="搜索题目内容、错因标签…" value={filters.keyword||''} onChange={e=>filter('keyword',e.target.value)}/></div>{[['subject','学科'],['module','模块'],['questionType','题型'],['errorTag','错因标签'],['difficulty','难度'],['status','状态']].map(([key,label])=><select aria-label={label} key={key} value={filters[key]||''} onChange={e=>filter(key,e.target.value)}><option value="">全部{label}</option>{(key==='status'?['待确认','加工中','已加工','加工失败']:key==='difficulty'?['1','2','3','4','5']:Array.from(new Set(all.flatMap(r=>key==='errorTag'?r.errorTags:[String(r[key as keyof R]||'')]))).filter(Boolean)).map(v=><option key={v}>{v}</option>)}</select>)}<button onClick={()=>{setFilters({});setSelected([])}}>重置</button></div><div className="batch-toolbar"><label className="check-label"><input type="checkbox" aria-label="全选当前结果" checked={records.length>0&&records.every(r=>selected.includes(r.id))} onChange={e=>setSelected(e.target.checked?records.map(r=>r.id):[])}/>已选 {selected.length} 道</label><button disabled={!selected.length} onClick={()=>{setAxis(prefs.classificationAxis);setCount(prefs.variantCount);setDialog(true)}}>批量整理 <ArrowUpRight size={15}/></button></div>{error&&<p role="alert" className="notice">{error}</p>}{loading?<p className="empty">正在加载记录…</p>:records.length===0?<div className="empty">暂无符合条件的错题。可以重置筛选或录入一道新题。</div>:<div className="table-wrap"><table><thead><tr><th></th><th>题目 / 学科模块</th><th>题型</th><th>错因标签</th><th>难度</th><th>状态</th><th>更新时间</th><th></th></tr></thead><tbody>{records.map(r=><tr key={r.id}><td><input aria-label={`选择 ${r.originalQuestion}`} type="checkbox" checked={selected.includes(r.id)} onChange={e=>setSelected(e.target.checked?[...selected,r.id]:selected.filter(id=>id!==r.id))}/></td><td><button className="question-link" onClick={()=>navigate(`/mistakes/${r.id}`)}>{r.originalQuestion}</button><p className="muted mt-2">{r.subject||'未标注学科'} <span className="divider">/</span> {r.module||'未标注模块'}</p></td><td>{r.questionType||'未标注'}</td><td>{r.errorTags.length?r.errorTags.map(t=><span className="tag" key={t}>{t}</span>):<span className="muted">待确认后生成</span>}</td><td><span className="difficulty">{'●'.repeat(r.difficulty)}<span>{'●'.repeat(5-r.difficulty)}</span></span></td><td><Status value={r.status}/></td><td className="muted">{new Date(r.updatedAt).toLocaleDateString('zh-CN')}</td><td><button aria-label="查看详情" onClick={()=>navigate(`/mistakes/${r.id}`)}>↗</button></td></tr>)}</tbody></table></div>}<div className="list-bottom">共 {records.length} 条 · 数据保存在当前浏览器 <span>{sourceLabel}</span></div></section>
 {dialog&&<div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-label="批量整理"><h2>批量整理 {selected.length} 道错题</h2><p>明确分类轴，再生成统一数量的变式题。每批最多 {batchLimit} 道。</p>{selected.length>batchLimit&&<p role="alert">请减少选择的题目。</p>}<AxisSelector value={axis} onChange={setAxis}/><VariantCountSelector value={count} onChange={setCount}/>{!axis&&<p className="warning">请选择分类轴后再提交。</p>}<div className="actions"><button disabled={busy} onClick={()=>setDialog(false)}>取消</button><button className="primary" disabled={!axis||busy||selected.length>batchLimit} onClick={async()=>{setBusy(true);try{const stillCurrent=api.capture();await api.process(selected,axis as Axis,count,id=>{if(stillCurrent())navigate(`/batches/${id}`,{state:{source:'batch-process'}})})}catch(e){setError(String(e));setDialog(false)}finally{setBusy(false)}}}>{busy?'正在整理…':'提交批量整理'}</button></div></section></div>}</>}
export function MistakeForm({prefs}:{exam:Exam; prefs:Preferences}) {
 const [mode,setMode]=useState<'text'|'image'|'handwriting'>('text');
 const [count,setCount]=useState(prefs.variantCount);
 const [entries,setEntries]=useState(['']);
 const [imageBusy,setImageBusy]=useState(false);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const navigate=useNavigate();

 async function store(items: Input[]) {
  const stillCurrent=api.capture();
  const result=await api.create(items,count,prefs.classificationAxis,id=>{
   if(items.length>1&&stillCurrent())navigate('/batches/'+id,{state:{source:'batch-create'}});
  });
  if(items.length===1&&stillCurrent())navigate('/mistakes/'+result.records[0].id);
  return result;
 }

 async function submit(event:React.FormEvent) {
  event.preventDefault();
  if(busy||imageBusy||entries.some(value=>!value.trim()))return;
  setBusy(true);
  setError('');
  try {
   await store(entries.map(value=>({
    examType:'',subject:'',module:'',questionType:'',difficulty:3,
    originalQuestion:value.trim(),userAnswer:'',entryText:value.trim(),
   })));
  } catch(failure) {
   setError(String(failure));
  } finally {
   setBusy(false);
  }
 }

 return <>
  <Heading title="录入错题" sub="直接粘贴题目，作答和参考答案可一起输入。"/>
  <div className="notebook-switcher-options mb-5" role="group" aria-label="选择录入方式">
   {([['text','文字录入'],['image','图片上传'],['handwriting','手写录入']] as const).map(([value,label])=>
    <button key={value} className="notebook-switcher-option" type="button"
      aria-pressed={mode===value} disabled={busy||imageBusy} onClick={()=>setMode(value)}><strong>{label}</strong></button>
   )}
  </div>
  <div className="panel mb-5"><fieldset disabled={busy||imageBusy}>
   <VariantCountSelector value={count} onChange={setCount}/>
  </fieldset></div>
  {mode==='text'?<form className="panel form-panel" onSubmit={submit}>
   <fieldset disabled={busy}>
    {entries.map((value,index)=><div className="mb-5" key={index}>
     <label>{entries.length>1?'第 '+(index+1)+' 道错题':'题目、作答和参考答案'}
      <textarea required rows={6} value={value}
       placeholder={'例如：求 f(x)=x²−4x+3 的最小值。\n我的作答：3'}
       onChange={event=>setEntries(items=>items.map((item,i)=>i===index?event.target.value:item))}/>
     </label>
     {entries.length>1&&<button type="button" onClick={()=>setEntries(items=>items.filter((_,i)=>i!==index))}>移除本题</button>}
    </div>)}
    <div className="actions">
     <button type="button" disabled={entries.length>=batchLimit} onClick={()=>setEntries(items=>[...items,''])}>添加一道</button>
     <button type="submit" className="primary" disabled={entries.some(value=>!value.trim())}>
      {busy?'加工中…':'提交加工'}
     </button>
    </div>
   </fieldset>
  </form>:<ImageIntake key={mode} handwriting={mode==='handwriting'} disabled={busy}
   onBusyChange={setImageBusy} onUpload={store}/>}
  {error&&<p role="alert" className="notice">{error}</p>}
 </>;
}
function DetailPage({exam}:{exam:Exam}){const {id}=useParams();const [record,setRecord]=useState<R>(),[error,setError]=useState('');useEffect(()=>{let active=true;const load=()=>api.detail(id!).then(r=>{if(active){setRecord(r);setError('')}}).catch(e=>active&&setError(String(e)));load();const t=setInterval(load,2200);return()=>{active=false;clearInterval(t)}},[id,exam]);return <><Heading title="错题详情" sub="从原始作答到解题模板，保留完整加工记录。"/>{error?<p role="alert">{error}</p>:record?<MistakeDetail key={`${record.id}-${record.status}`} record={record}/>:<p>正在加载…</p>}</>}
export function BatchSummary({batch}:{batch:Batch}){return <section className="panel summary"><h2>本批共性摘要 · 本地规则汇总</h2><p>最集中断点：{batch.summary.concentratedBreakpoint}</p><p>优先补哪一类：{batch.summary.prioritySupplement}</p><p>建议合并哪几道：{batch.summary.mergeSuggestions.length?`见下方 ${batch.summary.mergeSuggestions.length} 组建议`:'暂无可靠合并建议'}</p><h3>合并为同一母题 · 建议列表</h3>{batch.summary.mergeSuggestions.map(s=><p key={s}>{s}</p>)}<small>仅供核对，不会自动合并记录。</small></section>}
function BatchResultPage({exam}:{exam:Exam}){const {id}=useParams();const location=useLocation();const [batch,setBatch]=useState<Batch>(),[records,setRecords]=useState<R[]>([]),[error,setError]=useState(''),[open,setOpen]=useState<Record<string,OpenFeedback>>({});useEffect(()=>{let active=true;async function load(){try{const b=await api.batch(id!);const rows=await Promise.all(b.ids.map(api.detail));if(active){setBatch(b);setRecords(rows);setError('');}}catch(e){if(active)setError(String(e))}}const refresh=(event:Event)=>{if((event as CustomEvent<string>).detail===exam)void load()};
window.addEventListener('zhixu-workspace-records-changed',refresh);
void load();
const timer=setInterval(load,2500);
return()=>{active=false;clearInterval(timer);window.removeEventListener('zhixu-workspace-records-changed',refresh)};
},[id,exam]);const source=location.state?.source||batch?.source;const processing=records.findIndex(r=>r.status==='加工中');const completed=records.filter(r=>r.status!=='加工中').length;return <><Heading title={source==='batch-create'?'批量录入结果':'批量整理结果'} sub="逐道核对加工记录，再查看本批共性。"><button disabled={!batch||!!error} onClick={()=>download(records.map(r=>recordText(r,open[r.id])).join('\n\n---\n\n')+`\n\n# 本批共性摘要\n${batch!.summary.concentratedBreakpoint}\n${batch!.summary.prioritySupplement}\n${batch!.summary.mergeSuggestions.join('；')||'暂无合并建议'}`,`批次-${id}.md`)}>导出本批结果</button></Heading>{error?<p role="alert">{error}</p>:!batch?<p>正在加载批次…</p>:<><p role="status">{processing>=0?`第 ${processing+1} / ${records.length} 题 · 加工中`:`已完成 ${completed} / ${records.length} 题`}</p><p className="muted mb-4">仅导出当前已展开的反馈</p>{records.map(r=><MistakeDetail key={`${r.id}-${r.status}`} record={r} onOpen={(rid,f)=>setOpen(prev=>({...prev,[rid]:f}))}/>)}<BatchSummary batch={batch}/></>}</>}
function WorkspaceNameEditor({workspace,onSaved}:{workspace:Workspace;onSaved:()=>void}){
 const [editing,setEditing]=useState(false),[name,setName]=useState(workspace.name),[error,setError]=useState('');
 if(!editing)return <div><strong>{workspace.name}</strong><button onClick={()=>{setName(workspace.name);setError('');setEditing(true)}}>改名</button></div>;
 return <form onSubmit={e=>{e.preventDefault();try{renameWorkspace(workspace.id,name);setEditing(false);onSaved()}catch(err){setError(String(err))}}}><label>工作区名称<input autoFocus maxLength={50} value={name} onChange={e=>setName(e.target.value)}/></label><button type="submit" disabled={!name.trim()}>保存名称</button><button type="button" onClick={()=>setEditing(false)}>取消</button>{error&&<p role="alert">{error}</p>}</form>;
}
export function Settings({exam, prefs, onChange, switchExam}: {
 exam: Exam; prefs: Preferences; onChange: (p: Preferences) => void; switchExam: (id: string) => void;
}) {
 const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
 const [archived, setArchived] = useState<Workspace[]>([]);
 const [name, setName] = useState('');
 const [slug, setSlug] = useState('');
 const [message, setMessage] = useState('');

 function refresh() {
  api.workspaces().then(setWorkspaces).catch(error => setMessage(String(error)));
  try { setArchived(archivedWorkspaces()); }
  catch (error) { setMessage(String(error)); }
 }

 useEffect(refresh, []);

 function updateWorkspaces(action?: () => void) {
  setMessage('');
  try {
   action?.();
   refresh();
   window.dispatchEvent(new Event('zhixu-workspaces-changed'));
  } catch (error) { setMessage(String(error)); }
 }

 const activeModelWorkspace = workspaces.find(workspace => workspace.id === exam);
 const sharedModel = membership(exam);
 const connections = new Map<string, string>();
 for (const workspace of workspaces) {
  if (workspace.slug && !workspace.id.startsWith('local:')) {
   connections.set(workspace.slug, workspace.name);
  }
 }

 return <>
  <Heading title="偏好设置" sub="设置整理习惯，让每次录入更专注。"/>
  <ClassroomSettings workspace={exam} workspaces={workspaces} onWorkspacesChange={() => updateWorkspaces()} onOpen={switchExam}/>
  <MigrationSettings/>
  <ConnectionSettings onBound={() => updateWorkspaces()}/>
  {sharedModel ? <section className="panel settings"><h2>AnythingLLM 模型</h2><p>班级「{sharedModel.name}」的模型由教师设置。切换到个人错题本可管理自己的模型。</p></section>
   : !MOCK && !configurationError && activeModelWorkspace?.slug ? <WorkspaceModelSettings
      key={activeModelWorkspace.slug} workspaceName={activeModelWorkspace.name}
      load={() => workspaceSettings(developerRequest, activeModelWorkspace.slug!)}
      save={changes => workspaceSettings(developerRequest, activeModelWorkspace.slug!, changes)}/>
    : <section className="panel settings"><h2>AnythingLLM 模型</h2><p>先配置并连接自己的 AnythingLLM 工作区，再切换到该工作区选择模型。</p></section>}
  <section className="panel settings">
   <h2>加工偏好</h2>
   <VariantCountSelector value={prefs.variantCount} onChange={n => onChange({...prefs, variantCount: n})}/>
   <AxisSelector value={prefs.classificationAxis} onChange={axis => onChange({...prefs, classificationAxis: axis})}/>
  </section>
  <section className="panel settings">
   <h2>错题本</h2>
   <p>个人错题本使用你自己连接的 AnythingLLM 工作区。个人错题和统计不会通过班级服务同步。</p>
   <form onSubmit={event => {
    event.preventDefault();
    updateWorkspaces(() => {
     if (!MOCK && (configurationError || !connections.has(slug))) {
      throw Error('请先配置并连接你自己的 AnythingLLM 工作区。');
     }
     createLocalWorkspace(name, slug);
     setName('');
    });
   }}>
    <label>{MOCK ? '演示错题本名称' : '个人错题本名称'}<input value={name} maxLength={50} onChange={event => setName(event.target.value)}/></label>
    {!MOCK && <label>用于加工的 AnythingLLM 工作区<select value={slug} onChange={event => setSlug(event.target.value)}>
     <option value="">请选择</option>
     {[...connections].map(([id, label]) => <option key={id} value={id}>{label}</option>)}
    </select></label>}
    {MOCK && <p>配置并启用你自己的 AnythingLLM 后，可在这里新建个人错题本。</p>}
    {!MOCK && (configurationError || connections.size === 0) && <p>请先在上方配置并连接你自己的 AnythingLLM 工作区。</p>}
    <button type="submit" disabled={!name.trim() || (!MOCK && (!!configurationError || !connections.has(slug)))}>
     {MOCK ? '新建演示错题本' : '新建个人错题本'}
    </button>
   </form>
   <p>各工作区分别保存错题。自定义工作区归档后可以恢复。</p>
   {notebookGroups(workspaces).map(group => <section key={group.label}>
    <h3>{group.label}</h3>
    {group.items.length === 0 && <p className="muted">暂无{group.label}。</p>}
    {group.items.map(workspace => <div className="workspace-row" key={workspace.id}>
    <WorkspaceNameEditor workspace={workspace} onSaved={() => updateWorkspaces()}/>
    {membership(workspace.id) && <small>班级错题本 · {membership(workspace.id)?.name}</small>}
    <button disabled={workspace.id === exam} onClick={() => switchExam(workspace.id)}>
     {workspace.id === exam ? '当前工作区' : '切换工作区'}
    </button>
    {workspace.id.startsWith('local:') && <button disabled={workspace.id === exam}
     title={workspace.id === exam ? '请先切换到其他工作区' : undefined}
     onClick={() => updateWorkspaces(() => setWorkspaceArchived(workspace.id, true))}>归档</button>}
    </div>)}
   </section>)}
   {archived.length > 0 && <details><summary>已归档工作区（{archived.length}）</summary>
    {archived.map(workspace => <div className="workspace-row" key={workspace.id}>
     <strong>{workspace.name}</strong>
     <button onClick={() => updateWorkspaces(() => setWorkspaceArchived(workspace.id, false))}>恢复工作区</button>
    </div>)}
   </details>}
   {message && <p role="alert">{message}</p>}
  </section>
 </>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><BrowserRouter><App/></BrowserRouter></React.StrictMode>);

function CacheNotice(){
 const [message,setMessage]=useState('');
 useEffect(()=>{
  const show=(event:Event)=>setMessage((event as CustomEvent<string>).detail);
  window.addEventListener(cacheRecoveryEvent,show);
  return ()=>window.removeEventListener(cacheRecoveryEvent,show);
 },[]);
 return message?<p role="alert" className="notice">{message}</p>:null;
}
function ProgressNotice(){const [text,setText]=useState('');useEffect(()=>{const fn=(e:Event)=>setText((e as CustomEvent).detail);window.addEventListener('zhixu-progress',fn);return()=>window.removeEventListener('zhixu-progress',fn)},[]);const location=useLocation();useEffect(()=>setText(''),[location.pathname]);return text&&!location.pathname.startsWith('/batches/')?<p role="status">{text}</p>:null}
