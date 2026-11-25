import {useEffect,useRef,useState} from 'react';
import {BookOpen,Check,Pause,Play,Square,Timer,Settings2} from 'lucide-react';
import {api,message,type Paper,type Mark,type Rect} from './api';
import {type AgendaItem,type Project,today} from './Agenda';
import {Modal} from './ui';
import './companion.css';

export type ResearchSource={taskId?:string;paperId:string;page:number;markId:string;markRevision:number;quote:string;rects:Rect[]};
export type Focus={id:string;taskId:string;taskRevision:number;title:string;plannedSeconds:number;elapsedSeconds:number;state:'running'|'paused'|'review'|'interrupted'|'finished';revision:number;result:string;note:string;startedAt:string};
type Snapshot={recent:Paper|null;tasks:AgendaItem[];focus:Focus|null;history:Focus[]};
export type WorkspaceAction={id:string;action:'open-paper'|'open-task'|'open-home'|'open-settings'|'open-planner'|'prepare-exit';body:{id?:string}};
export type IslandStatus={installed:boolean;host?:{attached:boolean;visible:boolean};enabled:boolean;keepRunning:boolean;running:boolean;ready:boolean;error:string;pid:number|null;version:string};
const uid=()=>crypto.randomUUID().replaceAll('-','');
export function ResearchTask({paper,mark,source:provided,close,report}:{paper:Paper;mark?:Mark;source?:ResearchSource;close:()=>void;report:(text:string)=>void}){
 const source=provided||{paperId:paper.id,page:mark!.page,markId:mark!.id,markRevision:mark!.revision||1,quote:mark!.quote||mark!.content||mark!.comment||'',rects:mark!.rects};
 const [title,setTitle]=useState((mark?.comment||'').split('\n')[0].slice(0,180)),[detail,setDetail]=useState(''),[day,setDay]=useState(today),[projects,setProjects]=useState<Project[]>([]),[project,setProject]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const id=useRef(uid()),prior=useRef('');
 useEffect(()=>{void api<Project[]>('/projects').then(setProjects).catch(e=>setError(message(e)))},[]);
 async function save(){
  if(busy)return;setBusy(true);setError('');
  const payload={title:title.trim(),detail,day,projectId:project,source};const serialized=JSON.stringify(payload);
  if(prior.current&&prior.current!==serialized)id.current=uid();prior.current=serialized;
  try{await api('/research/tasks','POST',{id:id.current,...payload});window.dispatchEvent(new Event('workspace-data-changed'));report('研究任务已保存，可在小岛或任务日程中继续');close()}
  catch(e){setError(message(e))}finally{setBusy(false)}
 }
 return <Modal guardDraft title="创建研究任务" close={()=>{if(!busy)close()}}>
  <form className="form" onSubmit={e=>{e.preventDefault();void save()}}>
   <div className="research-source"><BookOpen size={16}/><div><strong>{paper.title}</strong><small>第 {source.page} 页{source.markId?' · 已保存的批注':''}</small></div></div>
   {source.quote&&<blockquote className="research-quote">{source.quote.slice(0,700)}</blockquote>}
   <label>接下来要做什么<input aria-label="研究任务标题" autoFocus required maxLength={250} value={title} onChange={e=>setTitle(e.target.value)} placeholder="例如：核对这里的实验设置"/></label>
   <label>补充说明<textarea rows={2} maxLength={3600} value={detail} onChange={e=>setDetail(e.target.value)}/></label>
   <div className="form-row"><label>计划日期<input type="date" value={day} onChange={e=>setDay(e.target.value)}/></label>
   <label>关联项目<select value={project} onChange={e=>setProject(e.target.value)}><option value="">暂不关联</option>{projects.filter(p=>p.status!=='archived').map(p=><option key={p.id} value={p.id}>{p.title}</option>)}</select></label></div>
   {error&&<p className="error" role="alert">{error}</p>}
   <div className="form-actions"><button className="primary" disabled={busy||!title.trim()}>{busy?'正在保存…':'保存研究任务'}</button></div>
  </form>
 </Modal>
}
export function CompanionSettings(){
 const [state,setState]=useState<IslandStatus>(),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const saving=useRef(false);
 const load=()=>window.desktop.islandStatus().then(value=>{if(!saving.current)setState(value)}).catch(e=>setError(message(e)));
 useEffect(()=>{void load();const timer=setInterval(()=>void load(),2000);return()=>clearInterval(timer)},[]);
 async function save(next:{enabled:boolean;keepRunning:boolean}){const previous=state;saving.current=true;setBusy(true);setError('');setState(value=>value?{...value,...next}:value);try{setState(await window.desktop.islandSettings(next))}catch(e){setState(previous);setError(message(e))}finally{saving.current=false;setBusy(false)}}
 return <section className="companion-settings" aria-label="桌面小岛设置"><h3>桌面小岛</h3>
  <p className="quiet-text">从桌面查看重要日期、勾选今日待办，也可继续阅读与专注。小岛沿用 Daozai 原有主题。</p>
  {state&&!state.installed&&<p>未安装桌面小岛。重新运行安装包并勾选该组件即可补装。</p>}
  {state?.installed&&<><label className="check-line"><input type="checkbox" checked={state.enabled} disabled={busy} onChange={e=>void save({...state,enabled:e.target.checked})}/>启用桌面小岛</label>
   <label className="check-line"><input type="checkbox" checked={state.keepRunning} disabled={busy||!state.enabled} onChange={e=>void save({...state,keepRunning:e.target.checked})}/>关闭工作台窗口后保留小岛</label>
   <div className="companion-status"><span role="status">{busy?'正在应用设置…':state.error||(!state.enabled?'已关闭':state.ready?'小岛已连接':state.running?'小岛正在启动…':'小岛未启动')}</span>
    <button className="secondary" disabled={busy||!state.installed} onClick={()=>void window.desktop.islandAppearance().catch(e=>setError(message(e)))}>全部小岛设置<Settings2 size={14}/></button>
    {state.enabled&&<button className="secondary" disabled={busy} onClick={async()=>{setBusy(true);setError('');try{setState(await window.desktop.islandRestart())}catch(e){setError(message(e))}finally{setBusy(false)}}}>重新启动小岛</button>}
   </div><small className="quiet-text">完整退出请使用系统托盘中的“退出 ResearchDesk”。小岛随主程序统一交付。</small></>}
  {error&&<p className="error" role="alert">{error}</p>}
 </section>
}
function mmss(seconds:number){const s=Math.max(0,seconds);return String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0')}
export function FocusDesk({openTask,report}:{openTask:(id:string)=>void;report:(text:string)=>void}){
 const [data,setData]=useState<Snapshot>(),[error,setError]=useState(''),[busy,setBusy]=useState(false),[task,setTask]=useState(''),[minutes,setMinutes]=useState(25),[note,setNote]=useState('');
 const pending=useRef<{key:string;id:string}|null>(null);
 async function load(){try{setData(await api<Snapshot>('/companion'));setError('')}catch(e){setError(message(e))}}
 useEffect(()=>{void load();const timer=setInterval(()=>void load(),2000);return()=>clearInterval(timer)},[]);
 async function command(action:string,result=''){
  if(busy||!data)return;setBusy(true);setError('');
  const f=data.focus,a=data.tasks.find(a=>a.id===task)||data.tasks[0];
  const body=f?{action,id:f.id,revision:f.revision,result,note}:{action:'start',id:uid(),taskId:a?.id,taskRevision:a?.revision,minutes};
  // Preserve the exact request on network retry, including a newly allocated session ID.
  const key=JSON.stringify(f?body:{action:'start',taskId:a?.id,taskRevision:a?.revision,minutes});
  let payload:Record<string,unknown>;
  if(pending.current?.key===key)payload=JSON.parse(pending.current.id);
  else{payload={...body,requestId:uid()};pending.current={key,id:JSON.stringify(payload)}}
  try{await api('/focus/command','POST',payload);pending.current=null;setNote('');await load();window.dispatchEvent(new Event('workspace-data-changed'));if(action==='finish')report('专注成果已保存')}
  catch(e){setError(message(e))}finally{setBusy(false)}
 }
 const f=data?.focus;
 return <section className="focus-desk" aria-label="任务专注"><div className="section-heading"><h2><Timer size={17}/>任务专注</h2>{f&&<span className="focus-state">{{running:'正在专注',paused:'已暂停',review:'待确认成果',interrupted:'上次专注已中断',finished:'已结束'}[f.state]}</span>}</div>
  {!f&&<div className="focus-idle-clock" aria-label="专注时长">{mmss(minutes*60)}</div>}
  {f?<><button className="focus-task-link" onClick={()=>openTask(f.taskId)}>{f.title}</button><div className="focus-clock" aria-live="off">{mmss(f.plannedSeconds-f.elapsedSeconds)}</div>
   {f.state==='interrupted'&&<p className="quiet-text">软件关闭或系统休眠期间未计时。可继续，或结束并确认本次成果。</p>}
   <div className="study-actions">
    {f.state==='running'?<button className="secondary" disabled={busy} onClick={()=>void command('pause')}><Pause size={15}/>暂停</button>:
     ['paused','interrupted'].includes(f.state)&&<button className="secondary" disabled={busy} onClick={()=>void command('resume')}><Play size={15}/>继续计时</button>}
    {f.state!=='review'&&<button className="secondary" disabled={busy} onClick={()=>void command('stop')}><Square size={14}/>结束并确认</button>}
   </div>
   {f.state==='review'&&<div className="focus-review"><label>本次成果（可选）<textarea aria-label="本次专注成果" rows={2} maxLength={2000} value={note} onChange={e=>setNote(e.target.value)} placeholder="例如：已核对方法部分，下一步检查实验数据"/></label>
    <div className="study-actions"><button className="primary" disabled={busy} onClick={()=>void command('finish','done')}><Check size={15}/>任务已完成</button>
     <button className="secondary" disabled={busy} onClick={()=>void command('finish','continue')}>稍后继续</button></div></div>}
  </>:data?.tasks.length?<form className="focus-start" onSubmit={e=>{e.preventDefault();void command('start')}}>
   <label>这次推进什么<select aria-label="专注任务" value={task||data.tasks[0].id} onChange={e=>setTask(e.target.value)}>{data.tasks.map(a=><option key={a.id} value={a.id}>{a.title}</option>)}</select></label>
   <label>分钟<input aria-label="专注分钟" type="number" min={1} max={180} value={minutes} onChange={e=>setMinutes(Number(e.target.value))}/></label>
   <button className="secondary" disabled={busy}><Play size={15}/>开始专注</button></form>:<p className="quiet-text">先记下一项任务，或从论文批注创建研究任务。</p>}
  {error&&<p className="error" role="alert">{error}<button className="quiet" onClick={()=>void load()}>刷新状态</button></p>}
  {!!data?.history.length&&<details className="focus-history"><summary>最近专注</summary>{data.history.map(h=><div key={h.id}><strong>{h.title}</strong><small>{new Date(h.startedAt).toLocaleString()} · {Math.floor(h.elapsedSeconds/60)} 分钟 · {h.result==='done'?'已完成':'稍后继续'}</small>{h.note&&<p>{h.note}</p>}</div>)}</details>}
 </section>
}
