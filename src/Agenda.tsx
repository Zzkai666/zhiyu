import { ArrowLeft, ArrowRight, BookOpen, CalendarDays, Check, Plus } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { api, message, type Paper } from './api';
import { Empty, Modal } from './ui';

export type Project = { id:string; title:string; description:string; status:'active'|'done'|'archived'; area:string; deadline:string; revision:number };
export type AgendaItem = {
  id:string; kind:'task'|'event'; title:string; detail:string; day:string; start:string; end:string;
  important:boolean; milestone:''|'exam'|'deadline'|'other'; repeat:'none'|'daily'|'weekly'; repeatDays:number; repeatUntil:string; paused:boolean;
  deadline:string; projectId:string; paperId:string; paperPage:number; done:boolean; deleted:boolean; revision:number;
};

export const freshAgenda: AgendaItem = { important:false,milestone:'',repeat:'none',repeatDays:0,repeatUntil:'',paused:false,id:'',kind:'task',title:'',detail:'',day:'',start:'',end:'',deadline:'',projectId:'',paperId:'',paperPage:0,done:false,deleted:false,revision:0 };

function localISO(d: Date) {
  return [String(d.getFullYear()).padStart(4,'0'),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
}
export function today() { return localISO(new Date()); }
function plusDays(day:string, offset:number) {
  const date = new Date(day + 'T12:00:00');
  date.setDate(date.getDate() + offset);
  return localISO(date);
}
function projectList(projects:Project[], id:string) { return projects.filter(p => p.status !== 'archived' || p.id === id); }

async function persist(a:AgendaItem) {
  return api<AgendaItem>('/agenda' + (a.id ? '/' + a.id : ''),a.id ? 'PATCH' : 'POST',a);
}

export function AgendaEditor({ initial, items, projects, papers, save, close }: {
  initial:AgendaItem; items:AgendaItem[]; projects:Project[]; papers:Paper[]; save:(a:AgendaItem)=>void; close:()=>void;
}) {
  const [item,setItem] = useState(initial);
  const [error,setError] = useState('');
  const [pending,setPending] = useState(false);
  const overlaps = item.kind === 'event' && item.start && item.end ?
    items.filter(a => !a.deleted && a.id !== item.id && a.kind === 'event' && a.day === item.day && a.start < item.end && item.start < a.end) : [];
  async function submit(deleted = item.deleted) {
    setPending(true); setError('');
    try { save(await persist({ ...item, deleted })); }
    catch (e) { setError(message(e)); }
    finally { setPending(false); }
  }
  function cancel() {
    if (!pending && (JSON.stringify(item) === JSON.stringify(initial) || window.confirm('放弃未保存的修改？'))) close();
  }
  return <Modal title={item.id ? '编辑任务或日程' : '新建任务或日程'} close={cancel}>
    <form className="form" onSubmit={e => { e.preventDefault(); void submit(); }}>
      <div className="form-row">
        <label>类型<select value={item.kind} onChange={e => setItem(e.target.value === 'event' ? { ...item,kind:'event',day:item.day || today(),start:'09:00',end:'10:00' } : { ...item,kind:'task',start:'',end:'' })}>
          <option value="task">任务</option><option value="event">固定日程</option></select></label>
        <label>计划日期<input type="date" required={item.kind==='event'} value={item.day} onChange={e => setItem({ ...item,day:e.target.value })}/></label>
      </div>
      <label>标题<input required value={item.title} onChange={e => setItem({ ...item,title:e.target.value })}/></label>
      {item.kind === 'event' && <div className="form-row">
        <label>开始时间<input type="time" required value={item.start} onChange={e => setItem({ ...item,start:e.target.value })}/></label>
        <label>结束时间<input type="time" required value={item.end} onChange={e => setItem({ ...item,end:e.target.value })}/></label>
      </div>}
      {overlaps.length > 0 && <p className="error">与以下日程有重叠。{overlaps.map(a => a.title).join('、')}</p>}
      <div className="form-row"><label>截止日期<input type="date" value={item.deadline} onChange={e => setItem({ ...item,deadline:e.target.value })}/></label>
        <label>关联项目<select value={item.projectId} onChange={e => setItem({ ...item,projectId:e.target.value })}><option value="">无</option>
          {projectList(projects,item.projectId).map(p => <option key={p.id} value={p.id}>{p.title}</option>)}</select></label></div>
      <div className="form-row"><label>关联文献<select value={item.paperId} onChange={e => setItem({ ...item,paperId:e.target.value,paperPage:e.target.value ? 1 : 0 })}>
        <option value="">无</option>{papers.filter(p => !p.deleted || p.id === item.paperId).map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
      </select></label>
      {item.paperId && <label>来源页码<input type="number" min="1" required value={item.paperPage || ''} onChange={e => setItem({ ...item,paperPage:Number(e.target.value) })}/></label>}</div>
      <label>说明<textarea rows={3} value={item.detail} onChange={e => setItem({ ...item,detail:e.target.value })}/></label>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="form-actions">
        {item.id && <button type="button" className="quiet" disabled={pending} onClick={() => { if (item.deleted || window.confirm('移入任务回收站？')) void submit(!item.deleted); }}>{item.deleted ? '恢复' : '移入回收站'}</button>}
        <button type="submit" className="primary" disabled={pending}>保存安排</button>
      </div>
    </form>
  </Modal>;
}

export function QuickTask({day,save}:{day:string;save:(a:AgendaItem)=>void}){
  const [title,setTitle]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const previous=useRef<AgendaItem|undefined>(undefined);
  return <form className="quick-task" onSubmit={async e=>{
    e.preventDefault();
    const value=title.trim();if(!value||busy)return;
    const draft=previous.current?.title===value&&previous.current.day===day?previous.current:
      {...freshAgenda,id:crypto.randomUUID().replaceAll('-',''),title:value,day};
    previous.current=draft;
    setBusy(true);setError('');
    try{save(await api<AgendaItem>('/agenda','POST',draft));setTitle('');previous.current=undefined}
    catch(err){setError(message(err))}
    finally{setBusy(false)}
  }}>
    <input aria-label="快速添加任务" placeholder={day?'写下任务，按回车添加':'记一项待安排任务'} value={title}
      maxLength={250} disabled={busy} onChange={e=>setTitle(e.target.value)}/>
    <button type="submit" className="secondary" disabled={busy||!title.trim()}><Plus size={15}/>{busy?'保存中…':'添加任务'}</button>
    {error&&<p className="error" role="alert">{error}</p>}
  </form>;
}

type RowsProps = { rows:AgendaItem[]; projects:Project[]; edit:(a:AgendaItem)=>void; save:(a:AgendaItem)=>void; source:(id:string,page:number)=>void; report:(s:string)=>void };
export function AgendaRows({ rows, projects, edit, save, source, report }: RowsProps) {
  const [saving,setSaving] = useState('');
  async function toggle(item:AgendaItem) {
    setSaving(item.id);
    try { save(await persist({ ...item,done:!item.done })); }
    catch (e) { report(message(e)); }
    finally { setSaving(''); }
  }
  return <div className="agenda-list">{rows.map(a => <div className="agenda-row" key={a.id}>
    <button className="icon task-toggle" disabled={a.deleted || saving === a.id} aria-label={a.done ? '重开 ' + a.title : '完成 ' + a.title} aria-pressed={a.done} onClick={() => void toggle(a)}>{a.done ? <Check size={16}/> : a.kind==='event' ? <CalendarDays size={16}/> : <span/>}</button>
    <button className="agenda-title" onClick={() => edit(a)}><strong>{a.title}</strong><small>{[a.day,a.start && a.start + '–' + a.end,
      a.deadline && '截止 ' + a.deadline,projects.find(p => p.id===a.projectId)?.title].filter(Boolean).join(' / ') || (a.kind === 'task' ? '待安排任务' : '固定日程')}</small></button>
    {a.paperId && <button className="quiet" onClick={() => source(a.paperId,a.paperPage)}><BookOpen size={15}/>原文第 {a.paperPage} 页</button>}
  </div>)}</div>;
}

export function Planner({ rows, projects, edit, save, source, report }: RowsProps) {
  const [view,setView] = useState('day');
  const [date,setDate] = useState(today);
  const [query,setQuery] = useState('');
  const [completion,setCompletion]=useState('all');
  function move(direction:number){
    if(view==='month'){
      const target=new Date(date+'T12:00:00');target.setDate(1);target.setMonth(target.getMonth()+direction);setDate(localISO(target));
    }else setDate(plusDays(date,direction*(view==='week'?7:1)));
  }
  const timeView=['day','week','month'].includes(view);
  const selected = useMemo(() => {
    const dateObject = new Date(date + 'T12:00:00');
    const monday = plusDays(date, -((dateObject.getDay()+6)%7));
    const end = plusDays(monday,6);
    return rows.filter(a => a.deleted === (view === 'trash') &&
      (view==='trash'||completion==='all'||a.done===(completion==='done')) && (!query || (a.title + ' ' + a.detail).toLowerCase().includes(query.trim().toLowerCase())) &&
      (view === 'day' ? a.day === date : view === 'week' ? a.day >= monday && a.day <= end : view === 'month' ? a.day.startsWith(date.slice(0,7)) : view === 'unscheduled' ? a.day === '' :
        view==='overdue'?!a.done&&Boolean(a.deadline)&&a.deadline<today():true));
  }, [rows,view,date,query,completion]);
  const byDay=new Map<string,AgendaItem[]>();
  if(view==='week'||view==='month')for(const item of selected){
    const group=byDay.get(item.day);
    if(group)group.push(item);else byDay.set(item.day,[item]);
  }
  const grouped=Array.from(byDay);
  return <div className="workspace-page">
    <header className="page-heading"><div><p className="section-label">工作台</p><h1>任务日程</h1><p>查看安排、完成任务，或从安排回到论文原页。</p></div>
      <button className="primary" onClick={() => edit({ ...freshAgenda,day:['day','week','month'].includes(view) ? date : '' })}><Plus size={17}/>新建安排</button></header>
    <div className="library-bar"><div className="segmented">
      {[['day','日'],['week','周'],['month','月'],['all','列表'],['unscheduled','待安排'],['overdue','已逾期'],['trash','回收站']].map(([id,title]) => <button key={id} aria-pressed={view===id} onClick={() => setView(id)}>{title}</button>)}
    </div><div className="agenda-search"><input aria-label="搜索安排" placeholder="搜索安排" value={query} onChange={e => setQuery(e.target.value)}/>
    {view!=='trash'&&view!=='overdue'&&<select aria-label="完成状态" value={completion} onChange={e=>setCompletion(e.target.value)}>
      <option value="all">全部状态</option><option value="open">待完成</option><option value="done">已完成</option>
    </select>}</div></div>
    {timeView && <div className="agenda-date">
      <button className="icon" aria-label={view==='week'?'上一周':view==='month'?'上个月':'前一天'} onClick={() => move(-1)}><ArrowLeft size={16}/></button>
      <input type="date" aria-label="查看日期" value={date} onChange={e => { if(e.target.value) setDate(e.target.value); }}/>
      <button className="icon" aria-label={view==='week'?'下一周':view==='month'?'下个月':'后一天'} onClick={() => move(1)}><ArrowRight size={16}/></button>
      <button className="quiet" onClick={() => setDate(today())}>今天</button>
    </div>}
    {view!=='trash'&&view!=='overdue'&&<QuickTask day={timeView?date:''} save={save}/>}
    {grouped.length?grouped.map(([day,items])=><section className="agenda-group" key={day}>
      <h2><time dateTime={day}>{day} · {new Date(day+'T12:00:00').toLocaleDateString('zh-CN',{weekday:'short'})}</time></h2>
      <AgendaRows rows={items} projects={projects} edit={edit} save={save} source={source} report={report}/>
    </section>):selected.length ? <AgendaRows rows={selected} projects={projects} edit={edit} save={save} source={source} report={report}/> :
      <Empty title={view==='overdue'?'没有逾期任务':'此处没有安排'} detail={view==='overdue'?undefined:'可以新建一项任务或固定日程。'}/>} 
  </div>;
}
