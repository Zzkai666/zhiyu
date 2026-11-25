import {DeskArt,MonthNavigator} from './Journal';
import {useEffect,useRef,useState,type ReactNode} from 'react';
import {Check,Plus,CalendarDays,Repeat2,MoreHorizontal,ChevronLeft,ChevronRight,RotateCcw} from 'lucide-react';
import {api,message} from './api';
import {freshAgenda,today,type AgendaItem,type Project} from './Agenda';
import {Modal,Empty} from './ui';
import './planner.css';
export type PlannerItem=AgendaItem&{seriesId?:string;occurrenceDay?:string;occurrenceRevision:number;seriesRevision:number};
export type Board={day:string;important:PlannerItem[];today:PlannerItem[];overdue:PlannerItem[];later:PlannerItem[];unscheduled:PlannerItem[];skipped:PlannerItem[];series:AgendaItem[]};
const labels={exam:'考试',deadline:'截止',other:'重要日期'};
const id=()=>crypto.randomUUID().replaceAll('-','');
function utcDay(day:string){const [y,m,d]=day.split('-').map(Number);return Date.UTC(y,m-1,d)/86400000}
export function daysUntil(day:string,base=today()){return utcDay(day)-utcDay(base)}
function weekday(day:string){return new Date(day+'T12:00:00').toLocaleDateString('zh-CN',{weekday:'short'})}
function dateLabel(day:string){return new Date(day+'T12:00:00').toLocaleDateString('zh-CN',{year:'numeric',month:'long',day:'numeric'})}
function point(a:AgendaItem){return a.deadline||a.day}
function repeatLabel(a:AgendaItem){if(a.repeat==='daily')return'每天';if(a.repeat==='weekly')return a.repeatDays===31?'每个工作日':'每周'+['一','二','三','四','五','六','日'].filter((_,i)=>a.repeatDays&(1<<i)).join('、');return''}
function useLocalDay(){const [day,setDay]=useState(today);useEffect(()=>{const timer=setInterval(()=>setDay(today()),15000);return()=>clearInterval(timer)},[]);return day}
export function usePlanner(day:string){
 const [board,setBoard]=useState<Board>(),[error,setError]=useState('');const generation=useRef(0);
 async function reload(){const n=++generation.current;try{const data=await api<Board>('/planner?day='+day);if(n===generation.current){setBoard(data);setError('')}}catch(e){if(n===generation.current)setError(message(e))}}
 useEffect(()=>{setBoard(undefined);void reload();const change=()=>void reload();const off=window.desktop.onPlannerChanged(change);window.addEventListener('workspace-data-changed',change);const timer=setInterval(change,15000);return()=>{generation.current++;clearInterval(timer);off();window.removeEventListener('workspace-data-changed',change)}},[day]);
 return{board,error,reload};
}
export function PlannerEditor({initial,close,saved}:{initial:AgendaItem;close:()=>void;saved:(a:AgendaItem)=>void}){
 const original=useRef({...initial,repeat:initial.repeat||'none',repeatDays:initial.repeatDays||0,repeatUntil:initial.repeatUntil||'',paused:initial.paused||false,important:initial.important||!!initial.deadline,milestone:(initial.milestone||(initial.deadline?'deadline':'')) as AgendaItem['milestone'],day:initial.deadline||initial.day});
 const [a,setA]=useState(original.current),[busy,setBusy]=useState(false),[error,setError]=useState(''),[timed,setTimed]=useState(initial.kind==='event'||!!initial.start);
 const ticket=useRef(a.id||id()),wasSeries=original.current.repeat!=='none';
 const change=(patch:Partial<AgendaItem>)=>setA(v=>({...v,...patch}));
 const cancel=()=>{if(!busy&&(JSON.stringify(a)===JSON.stringify(original.current)||window.confirm('放弃未保存的事项修改？')))close()};
 async function submit(deleted=a.deleted){
  if(busy)return;setBusy(true);setError('');
  const body=Object.fromEntries(Object.keys(freshAgenda).map(key=>[key,a[key as keyof AgendaItem]])) as AgendaItem;body.id=ticket.current;body.deleted=deleted;
  if(a.important){body.repeat='none';body.repeatDays=0;body.repeatUntil='';body.paused=false;if(a.milestone==='deadline')body.deadline=a.day;else body.deadline='';body.kind='task';body.start=timed?a.start:'';body.end='';}
  else{body.milestone='';body.deadline='';body.kind=timed?'event':'task';if(!timed){body.start='';body.end=''}}
  if(body.repeat==='none'){body.repeatDays=0;body.repeatUntil='';body.paused=false;}
  try{const value=await api<AgendaItem>('/agenda'+(initial.id?'/'+initial.id:''),initial.id?'PATCH':'POST',body);saved(value);window.dispatchEvent(new Event('workspace-data-changed'));close()}
  catch(e){setError(message(e))}finally{setBusy(false)}
 }
 return <Modal className="planner-drawer" title={initial.id?'编辑事项':a.important?'记重要日期':'添加待办'} close={cancel}>
  <form className="form planner-editor" onSubmit={e=>{e.preventDefault();void submit()}}>
   {!wasSeries&&<div className="segmented" aria-label="事项性质"><button type="button" aria-pressed={!a.important} onClick={()=>change({important:false,milestone:'',deadline:''})}>日常待办</button><button type="button" aria-pressed={a.important} onClick={()=>change({important:true,milestone:(a.milestone||'exam') as AgendaItem['milestone'],repeat:'none',repeatDays:0,repeatUntil:'',paused:false})}>重要日期</button></div>}
   <label>事项<input aria-label="事项名称" required autoFocus maxLength={250} placeholder={a.important?'例如：高等数学期末考试':'例如：背单词、完成作业、晚上健身'} value={a.title} onChange={e=>change({title:e.target.value})}/></label>
   <div className="form-row">
    {a.important&&<label>类型<select aria-label="重要事项类型" value={a.milestone||'exam'} onChange={e=>change({milestone:e.target.value as AgendaItem['milestone']})}><option value="exam">考试</option><option value="deadline">截止</option><option value="other">其他重要日期</option></select></label>}
    <label>{a.important?(a.milestone==='deadline'?'截止日期':'日期'):'安排日期'}<input aria-label="事项日期" type="date" required={a.important||a.repeat!=='none'||timed} value={a.day} onChange={e=>change({day:e.target.value})}/></label>
   </div>
   <label className="check-line"><input type="checkbox" checked={timed} onChange={e=>{setTimed(e.target.checked);if(e.target.checked)change({start:a.start||'09:00',end:a.important?'':a.end||'10:00'});else change({start:'',end:''})}}/>设置具体时间</label>
   {timed&&<div className="form-row"><label>{a.important&&a.milestone==='deadline'?'截止时间':'开始时间'}<input type="time" aria-label="事项开始时间" required value={a.start} onChange={e=>change({start:e.target.value})}/></label>
    {!a.important&&<label>结束时间<input aria-label="事项结束时间" type="time" required value={a.end} onChange={e=>change({end:e.target.value})}/></label>}</div>}
   {!a.important&&<><label>重复<select aria-label="重复方式" value={a.repeat==='weekly'&&a.repeatDays===31?'workdays':a.repeat} onChange={e=>{
    const value=e.target.value;change({repeat:value==='workdays'?'weekly':value as AgendaItem['repeat'],repeatDays:value==='workdays'?31:value==='weekly'?(a.repeatDays===31?1:a.repeatDays||1):0,repeatUntil:value==='none'?'':a.repeatUntil,paused:value==='none'?false:a.paused});
   }}><option disabled={wasSeries} value="none">不重复</option><option value="daily">每天</option><option value="workdays">每个工作日</option><option value="weekly">每周指定日期</option></select></label>
    {a.repeat==='weekly'&&a.repeatDays!==31&&<fieldset className="repeat-week"><legend>每周哪几天</legend>{['一','二','三','四','五','六','日'].map((d,i)=><label key={i}><input aria-label={'周'+d} type="checkbox" checked={!!(a.repeatDays&(1<<i))} onChange={e=>change({repeatDays:e.target.checked?a.repeatDays|(1<<i):a.repeatDays&~(1<<i)})}/><span>{d}</span></label>)}</fieldset>}
    {a.repeat!=='none'&&<><label>重复结束日期（可选）<input type="date" value={a.repeatUntil} min={a.day} onChange={e=>change({repeatUntil:e.target.value})}/></label>
     {wasSeries&&<label className="check-line"><input type="checkbox" checked={a.paused} onChange={e=>change({paused:e.target.checked})}/>暂停后续重复</label>}
     <p className="quiet-text">每天独立勾选。没有操作过的往日重复任务不会累计成逾期；修改规则保留已经记录的日期。</p></>}
   </>}
   {a.important&&<p className="quiet-text">这项日期会持续显示在“重要日期”与小岛中，完成或删除后才移出。</p>}
   {!!initial.id&&!wasSeries&&<label className="check-line"><input aria-label="事项已完成" type="checkbox" checked={a.done} onChange={e=>change({done:e.target.checked})}/>此事项已完成</label>}
   <label>备注（可选）<textarea rows={2} maxLength={3600} value={a.detail} onChange={e=>change({detail:e.target.value})}/></label>
   {!!(a.paperId||a.projectId)&&<details className="planner-legacy"><summary>已有来源信息</summary><p>此项原有的文献或项目来源会继续保留。</p></details>}
   {error&&<p className="error" role="alert">{error}</p>}
   <div className="form-actions">{!!initial.id&&<button type="button" className="quiet" disabled={busy} onClick={()=>{if(a.deleted||window.confirm(wasSeries?'移入回收站并停止后续重复？已记录的日期会保留。':'将这项事项移入回收站？'))void submit(!a.deleted)}}>{a.deleted?'恢复事项':wasSeries?'删除重复安排':'移入回收站'}</button>}
    <button className="primary" disabled={busy||!a.title.trim()||a.repeat==='weekly'&&!a.repeatDays}>{busy?'正在保存…':'保存事项'}</button></div>
  </form>
 </Modal>
}
type Command=(a:PlannerItem,action:'complete'|'reopen'|'skip'|'restore'|'move',day?:string)=>Promise<void>;
export function usePlannerCommand(reload:()=>Promise<void>,report:(s:string)=>void){
 const [busy,setBusy]=useState(''),[error,setError]=useState('');const retry=useRef<{key:string;body:unknown}|null>(null);
 const run:Command=async(a,action,day='')=>{
  if(busy)return;setBusy(a.id);setError('');
  const input={id:a.id,seriesId:a.seriesId||'',day:a.occurrenceDay||day,revision:a.revision,seriesRevision:a.seriesRevision||0,action};
  const key=JSON.stringify(input);const payload=retry.current?.key===key?retry.current.body:{...input,requestId:id()};retry.current={key,body:payload};
  try{await api('/planner/action','POST',payload);retry.current=null;await reload();window.dispatchEvent(new Event('workspace-data-changed'));report(action==='complete'?'已完成，可在“已完成”中重新打开':action==='move'?'已移到今天':'事项已更新')}
  catch(e){setError(message(e));await reload()}finally{setBusy('')}
 };
 return{run,busy,error};
}
function TaskRows({items,command,busy,edit,move=false}:{items:PlannerItem[];command:Command;busy:string;edit:(a:PlannerItem)=>void;move?:boolean}){
 return <div className="planner-tasks">{items.map(a=><div className="planner-task" key={a.id} data-done={a.done}>
  <button className="planner-check" aria-label={(a.done?'重开 ':'完成 ')+a.title} aria-pressed={a.done} disabled={!!busy} onClick={()=>void command(a,a.done?'reopen':'complete')}><span>{a.done&&<Check size={14}/>}</span></button>
  <button className="planner-task-title" onClick={()=>edit(a)}><strong>{a.title}</strong><small>{[a.start&&(a.end?a.start+'–'+a.end:a.start),repeatLabel(a),move&&a.day].filter(Boolean).join(' · ')}</small></button>
  {a.repeat!=='none'&&a.repeat&&<Repeat2 size={14} className="planner-repeat-icon"/>}
  <details className="planner-menu"><summary aria-label={'更多操作 '+a.title}><MoreHorizontal size={18}/></summary><div role="menu">
   <button role="menuitem" onClick={()=>edit(a)}>{a.seriesId?'编辑重复规则':'编辑事项'}</button>
   {move&&!a.seriesId&&<button role="menuitem" disabled={!!busy} onClick={()=>void command(a,'move',today())}>移到今天</button>}
   <button role="menuitem" disabled={!!busy} onClick={()=>void command(a,'skip')}>{a.seriesId?'今天不做':'移入回收站'}</button>
  </div></details>
 </div>)}</div>
}
export function DailyPlanner({report}:{report:(text:string)=>void}){
 const actual=useLocalDay(),[selected,setSelected]=useState(''),day=selected||actual;
 const {board,error,reload}=usePlanner(day),ops=usePlannerCommand(reload,report);
 const [editing,setEditing]=useState<AgendaItem>(),[view,setView]=useState('board'),[all,setAll]=useState<AgendaItem[]>([]),[query,setQuery]=useState('');
 useEffect(()=>{if(view==='trash'||view==='all')void api<AgendaItem[]>('/agenda').then(setAll).catch(e=>report(message(e)))},[view,board]);
 function editor(a:PlannerItem){const source=a.seriesId?board?.series.find(s=>s.id===a.seriesId):a;if(source)setEditing({...source})}
 function create(important=false){setEditing({...freshAgenda,day,important,milestone:important?'exam':'',repeat:'none',repeatDays:0,repeatUntil:'',paused:false})}
 const done=board?.today.filter(a=>a.done)||[],todo=board?.today.filter(a=>!a.done)||[];
 const moveDate=(offset:number)=>{const d=new Date(day+'T12:00:00');d.setDate(d.getDate()+offset);setSelected([d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-'))};
 return <div className="workspace-page planner-page">
  <header className="page-heading"><div><h1>任务日程</h1><p>重要的日子一直记着，今天的事情一项项做。</p></div><DeskArt kind="calendar"/>
   <div className="planner-heading-actions"><button className="secondary" onClick={()=>create(true)}><CalendarDays size={16}/>记重要日期</button><button className="primary" onClick={()=>create()}><Plus size={16}/>添加待办</button></div>
  </header>
  <div className="planner-toolbar"><div className="segmented">{[['board','清单'],['series','重复安排'],['all','全部事项'],['trash','回收站']].map(([id,label])=><button key={id} aria-pressed={view===id} onClick={()=>setView(id)}>{label}</button>)}</div>
   <input aria-label="搜索事项" placeholder="搜索事项" value={query} onChange={e=>setQuery(e.target.value)}/></div>
  {(error||ops.error)&&<p className="error" role="alert">{error||ops.error}<button className="quiet" onClick={()=>void reload()}>刷新核对</button></p>}
  {!board&&!error&&<p className="quiet-text">正在读取事项…</p>}
  {board&&view==='board'&&<div className="planner-grid">
   <section className="planner-important" aria-label="重要日期"><div className="planner-section-title"><h2>重要日期</h2><span>{board.important.length} 项持续提醒</span></div>
    <div className="important-strip">{board.important.filter(a=>!query||(a.title+a.detail).includes(query)).map(a=>{const date=point(a),delta=daysUntil(date,actual);return <article className="important-item" data-urgent={delta<=3} key={a.id}>
     <div className="important-date"><small>{Number(date.slice(5,7))} 月</small><strong>{Number(date.slice(8,10))}</strong><span>{weekday(date)}</span></div>
     <div className="important-copy"><small>{labels[a.milestone as keyof typeof labels]||'截止'}</small><button onClick={()=>editor(a)}>{a.title}</button><p>{dateLabel(date)}{a.start?' '+a.start:''}</p>{a.detail&&<p className="important-detail">{a.detail}</p>}
      <div className="important-actions"><button disabled={!!ops.busy} onClick={()=>void ops.run(a,'complete')}>标记完成</button><button onClick={()=>editor(a)}>编辑</button></div>
     </div><span className="important-countdown">{delta>0?<><strong>{delta}</strong>天后</>:delta===0?'今天':<>已过<strong>{-delta}</strong>天</>}</span>
    </article>})}</div>
    {!board.important.length&&<div className="planner-empty"><CalendarDays size={25}/><p>考试、作业截止、重要约定</p><small>不论还有多久，记下后都会留在这里。</small><button className="quiet" onClick={()=>create(true)}>记下一个重要日期</button></div>}
   </section>
   <section className="planner-daily" aria-label="每日待办"><div className="planner-section-title"><div><h2>{day===actual?'今日待办':dateLabel(day)+'待办'}</h2><span>{dateLabel(day)} {weekday(day)} · 已完成 {done.length}/{board.today.length}</span></div>
    <div className="planner-date-tools"><button className="icon" aria-label="前一天" onClick={()=>moveDate(-1)}><ChevronLeft size={16}/></button><input aria-label="待办日期" type="date" value={day} onChange={e=>setSelected(e.target.value)}/><button className="icon" aria-label="后一天" onClick={()=>moveDate(1)}><ChevronRight size={16}/></button>{day!==actual&&<button className="quiet" onClick={()=>setSelected('')}>今天</button>}</div>
    </div>
    <PlannerQuick day={day} saved={()=>void reload()}/>
    <TaskRows items={todo.filter(a=>!query||(a.title+a.detail).includes(query))} command={ops.run} busy={ops.busy} edit={editor}/>
    {!todo.length&&<div className="planner-empty daily-empty"><Check size={23}/><p>{done.length?'今天的待办都完成了':'给今天记下几件事'}</p><small>重复任务会在对应日期自动出现。</small></div>}
    {!!done.length&&<details className="planner-fold"><summary>已完成 {done.length} 项</summary><TaskRows items={done} command={ops.run} busy={ops.busy} edit={editor}/></details>}
    {!!board.overdue.length&&<details className="planner-fold" open><summary>之前未完成 {board.overdue.length} 项</summary><TaskRows items={board.overdue.filter(a=>!query||a.title.includes(query))} command={ops.run} busy={ops.busy} edit={editor} move/></details>}
    {!!board.unscheduled.length&&<details className="planner-fold"><summary>待安排 {board.unscheduled.length} 项</summary><TaskRows items={board.unscheduled} command={ops.run} busy={ops.busy} edit={editor} move/></details>}
    {!!board.later.length&&<details className="planner-fold" open><summary>以后安排 {board.later.length} 项</summary><TaskRows items={board.later.filter(a=>!query||a.title.includes(query))} command={ops.run} busy={ops.busy} edit={editor}/></details>}
    {!!board.skipped.length&&<details className="planner-fold"><summary>今天略过 {board.skipped.length} 项</summary>{board.skipped.map(a=><div className="planner-skipped" key={a.id}><span>{a.title}</span><button className="quiet" onClick={()=>void ops.run(a,'restore')}><RotateCcw size={13}/>恢复今天</button></div>)}</details>}
   </section>
   <MonthNavigator selected={day} select={setSelected}/></div>}
  {board&&view==='series'&&<section className="planner-rule-list"><h2>重复安排</h2><p className="quiet-text">当天独立完成，暂停或调整规则保留已记录的日期。</p>{board.series.filter(a=>!query||a.title.includes(query)).map(a=><button key={a.id} onClick={()=>setEditing(a)}><Repeat2 size={18}/><span><strong>{a.title}</strong><WeekDots days={a.repeat==='daily'?127:a.repeatDays}/><small>{repeatLabel(a)} · {a.day} 起{a.repeatUntil?'，至 '+a.repeatUntil:''}</small></span><em>{a.paused?'已暂停':'进行中'}</em></button>)}
   {!board.series.length&&<Empty title="还没有重复安排" detail="添加待办时，可以选择每天、工作日或每周指定日期。"/>}</section>}
  {(view==='trash'||view==='all')&&<section className="planner-rule-list"><h2>{view==='trash'?'回收站':'全部事项'}</h2>{all.filter(a=>a.deleted===(view==='trash')&&(!query||a.title.includes(query))).map(a=><button key={a.id} onClick={()=>setEditing(a)}><CalendarDays size={18}/><span><strong>{a.title}</strong><small>{a.important?'重要日期 · ':''}{a.day||'待安排'} {a.deadline?'截止 '+a.deadline:''} {repeatLabel(a)}</small></span><em>{a.done?'已完成':a.deleted?'已删除':''}</em></button>)}</section>}
  {editing&&<PlannerEditor initial={editing} close={()=>setEditing(undefined)} saved={()=>{void reload();report('事项已保存')}}/>}
 </div>
}
function PlannerQuick({day,saved}:{day:string;saved:()=>void}){
 const [text,setText]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');const request=useRef<{title:string;day:string;id:string}|undefined>(undefined);
 return <form className="planner-quick" onSubmit={async e=>{e.preventDefault();const title=text.trim();if(!title||busy)return;setBusy(true);setError('');if(!request.current||request.current.title!==title||request.current.day!==day)request.current={title,day,id:id()};
  try{await api('/agenda','POST',{...freshAgenda,...request.current});setText('');request.current=undefined;saved();window.dispatchEvent(new Event('workspace-data-changed'))}catch(err){setError(message(err))}finally{setBusy(false)}
 }}><input aria-label="快速记录今日事项" placeholder="记下这一天要做的事，回车添加" maxLength={250} value={text} onChange={e=>setText(e.target.value)} disabled={busy}/><button aria-label="添加今日事项" disabled={busy||!text.trim()}><Plus size={18}/></button>{error&&<p className="error">{error}</p>}</form>
}
export function HomeToday({open,report,children}:{open:()=>void;report:(s:string)=>void;children?:(parts:{dates:ReactNode;tasks:ReactNode})=>ReactNode}){
 const day=useLocalDay(),{board,error,reload}=usePlanner(day),ops=usePlannerCommand(reload,report);
 const dates=<section className="home-dates"><div className="section-heading"><h2><CalendarDays size={17}/>重要日期</h2><button className="quiet" onClick={open}>查看全部</button></div>{board?.important.length?board.important.slice(0,4).map(a=><button key={a.id} className="home-date-row" onClick={open}><span><strong>{a.title}</strong><small>{point(a)}</small></span><em>{daysUntil(point(a),day)>0?'还有 '+daysUntil(point(a),day)+' 天':daysUntil(point(a),day)===0?'就是今天':'已过 '+(-daysUntil(point(a),day))+' 天'}</em></button>):<p className="quiet-text">记下考试、作业截止或重要约定，远期日期也会留在这里。</p>}</section>;const tasks=<section className="home-focus"><div className="section-heading"><h2><CalendarDays size={17}/>今日待办</h2><button className="quiet" onClick={open}>打开任务日程</button></div>
  <PlannerQuick day={day} saved={()=>void reload()}/>{board&&<TaskRows items={board.today.filter(a=>!a.done)} command={ops.run} busy={ops.busy} edit={()=>open()}/>}
  {board&&!board.today.some(a=>!a.done)&&<p className="quiet-text">今天没有待完成的事项。</p>}{(error||ops.error)&&<p className="error">{error||ops.error}</p>}
 </section>;return children?children({dates,tasks}):<>{dates}{tasks}</>
}

function WeekDots({days}:{days:number}){return <span className='week-dots' aria-label='重复星期'>{['一','二','三','四','五','六','日'].map((d,i)=><i key={d} data-on={!!(days & (1<<i))}>{d}</i>)}</span>}