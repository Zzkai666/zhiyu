import {DeskArt} from './Journal';
import { ArrowRight, BookOpen, FolderKanban, ListChecks, Plus, Target } from 'lucide-react';
import { useEffect, useState } from 'react';
import { APIError, api, message, type Note, type Paper } from './api';
import { freshAgenda, type AgendaItem, type Project } from './Agenda';
import { Empty, Modal } from './ui';

type WorkItem=Project;
type Measure={kind:'manual'|'numeric'|'milestones';current:number;target:number;unit:string;percent:number;milestones:{title:string;done:boolean}[]};
type Goal=WorkItem&{measure:Measure;projects:string[]};
type Change={goal:Goal;reason:string;savedAt:string};
type Material={kind:'paper'|'note';id:string};
type Props={projects:Project[];rows:AgendaItem[];papers:Paper[];notes:Note[];onSave:(p:Project)=>void;
  editTask:(item:AgendaItem)=>void;openPaper:(p:Paper)=>void;openNote:(n:Note)=>void;report:(text:string)=>void};
const status={active:'进行中',done:'已完成',archived:'已归档'};
const areas={research:'科研',study:'课程学习',fitness:'运动',habit:'习惯',life:'生活'};
const modes={manual:'自主评估',numeric:'数值目标',milestones:'里程碑'};
const freshProject:Project={id:'',title:'',description:'',status:'active',area:'',deadline:'',revision:0};
const newGoal=():Goal=>({...freshProject,id:crypto.randomUUID().replaceAll('-',''),projects:[],
  measure:{kind:'manual',current:0,target:1,unit:'',percent:0,milestones:[]}});

function progress(m:Measure) {
  if(m.kind==='numeric'){
    const percent=m.current/m.target*100;
    return {percent,label:m.current+' / '+m.target+(m.unit?' '+m.unit:''),detail:Math.round(percent)+'%'};
  }
  if(m.kind==='milestones'){
    const done=m.milestones.filter(item=>item.done).length;
    return {percent:m.milestones.length?done/m.milestones.length*100:0,label:done+' / '+m.milestones.length+' 项',detail:'里程碑'};
  }
  return {percent:m.percent,label:m.percent+'%',detail:'自主评估'};
}

function WorkFields<T extends WorkItem>({value,update,label}:{value:T;update:(value:T)=>void;label:string}){
  return <>
    <label>{label}名称<input required maxLength={250} value={value.title} onChange={e=>update({...value,title:e.target.value})}/></label>
    <label>{label}说明<textarea rows={3} maxLength={4000} value={value.description} onChange={e=>update({...value,description:e.target.value})}/></label>
    <div className="work-fields">
      <label>领域<select value={value.area} onChange={e=>update({...value,area:e.target.value})}>
        <option value="">未分类</option>{Object.entries(areas).map(([id,name])=><option key={id} value={id}>{name}</option>)}
      </select></label>
      <label>截止日期<input type="date" value={value.deadline} onChange={e=>update({...value,deadline:e.target.value})}/></label>
      <label>状态<select value={value.status} onChange={e=>update({...value,status:e.target.value as WorkItem['status']})}>
        {Object.entries(status).map(([id,name])=><option key={id} value={id}>{name}</option>)}
      </select></label>
    </div>
  </>;
}

function ProjectEditor({initial,close,save}:{initial:Project;close:()=>void;save:(p:Project)=>void}){
  const [form,setForm]=useState(initial);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [latest,setLatest]=useState<Project>();
  return <Modal guardDraft title={initial.id?'编辑项目':'新建项目'} close={()=>{if(!busy)close()}}>
    <form className="form" onSubmit={async e=>{
      e.preventDefault();if(busy)return;setBusy(true);setError('');
      try{save(await api<Project>('/projects'+(form.id?'/'+form.id:''),form.id?'PATCH':'POST',form))}
      catch(err){
        setError(message(err));
        if(form.id&&err instanceof APIError&&err.status===409)
          setLatest(await api<Project[]>('/projects').then(items=>items.find(item=>item.id===form.id)).catch(()=>undefined));
      }finally{setBusy(false)}
    }}>
      <WorkFields value={form} update={setForm} label="项目"/>
      {error&&<p className="error" role="alert">{error}</p>}
      {latest&&<p>已保存版本为「{latest.title}」。<button className="quiet" type="button" onClick={()=>{
        if(window.confirm('载入已保存版本会替换本次表单内容。继续？')){setForm(latest);setLatest(undefined);setError('')}
      }}>载入已保存版本</button></p>}
      <div className="form-actions"><button className="primary" disabled={busy||Boolean(latest)}>{busy?'保存中…':'保存项目'}</button></div>
    </form>
  </Modal>;
}

function GoalEditor({initial,projects,close,save}:{initial:Goal;projects:Project[];close:()=>void;save:(g:Goal)=>void}){
  const [base,setBase]=useState(initial);
  const [form,setForm]=useState(initial);
  const [reason,setReason]=useState('');
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [latest,setLatest]=useState<Goal>();
  const m=form.measure;
  const measureChanged=base.revision>0&&JSON.stringify(base.measure)!==JSON.stringify(m);
  function measure(patch:Partial<Measure>){setForm({...form,measure:{...m,...patch}})}
  return <Modal guardDraft title={base.revision?'编辑目标':'新建目标'} wide close={()=>{if(!busy)close()}}>
    <form className="form" onSubmit={async e=>{
      e.preventDefault();if(busy)return;setBusy(true);setError('');
      try{save(await api<Goal>(form.revision?'/goals/'+form.id:'/goals',form.revision?'PATCH':'POST',{...form,reason}))}
      catch(err){
        setError(message(err));
        if(err instanceof APIError&&err.status===409)
          setLatest(await api<Goal[]>('/goals').then(items=>items.find(item=>item.id===form.id)).catch(()=>undefined));
      }finally{setBusy(false)}
    }}>
      <WorkFields value={form} update={setForm} label="目标"/>
      <label>衡量方式<select value={m.kind} disabled={base.revision>0} onChange={e=>measure({kind:e.target.value as Measure['kind']})}>
        {Object.entries(modes).map(([id,name])=><option key={id} value={id}>{name}</option>)}
      </select></label>
      {m.kind==='numeric'&&<div className="work-fields">
        <label>当前值<input type="number" min={0} max={1e12} step="any" required value={Number.isNaN(m.current)?'':m.current} onChange={e=>measure({current:e.target.valueAsNumber})}/></label>
        <label>目标值<input type="number" max={1e12} step="any" required value={Number.isNaN(m.target)?'':m.target} onChange={e=>measure({target:e.target.valueAsNumber})}/></label>
        <label>单位<input maxLength={45} value={m.unit} onChange={e=>measure({unit:e.target.value})} placeholder="例如 篇"/></label>
      </div>}
      {m.kind==='manual'&&<label>进展百分比<input type="number" required min={0} max={100} step={1} value={Number.isNaN(m.percent)?'':m.percent} onChange={e=>measure({percent:e.target.valueAsNumber})}/></label>}
      {m.kind==='milestones'&&<fieldset className="work-fieldset"><legend>里程碑</legend>
        {m.milestones.map((item,i)=><div className="milestone-edit" key={i}>
          <input type="checkbox" aria-label={'完成里程碑 '+(i+1)} checked={item.done} onChange={e=>measure({milestones:m.milestones.map((v,index)=>index===i?{...v,done:e.target.checked}:v)})}/>
          <input aria-label={'里程碑 '+(i+1)} required maxLength={140} value={item.title} onChange={e=>measure({milestones:m.milestones.map((v,index)=>index===i?{...v,title:e.target.value}:v)})}/>
          <button className="quiet" type="button" onClick={()=>measure({milestones:m.milestones.filter((_,index)=>index!==i)})}>移除</button>
        </div>)}
        <button type="button" className="quiet" disabled={m.milestones.length>=50} onClick={()=>measure({milestones:[...m.milestones,{title:'',done:false}]})}>添加里程碑</button>
      </fieldset>}
      {measureChanged&&<label>进展依据<textarea rows={2} required maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)} placeholder="记录这次更新的依据"/></label>}
      {projects.length>0&&<fieldset className="work-fieldset"><legend>关联项目</legend><div className="work-checks">
        {projects.filter(p=>p.status!=='archived'||form.projects.includes(p.id)).map(p=><label key={p.id}>
          <input type="checkbox" checked={form.projects.includes(p.id)} onChange={e=>setForm({...form,
            projects:e.target.checked?[...form.projects,p.id]:form.projects.filter(id=>id!==p.id)})}/>{p.title}
        </label>)}
      </div></fieldset>}
      {error&&<p className="error" role="alert">{error}</p>}
      {latest&&<p>已保存版本为第 {latest.revision} 版。<button className="quiet" type="button" onClick={()=>{
        if(window.confirm('载入已保存版本会替换本次表单内容。继续？')){setBase(latest);setForm(latest);setReason('');setLatest(undefined);setError('')}
      }}>载入已保存版本</button></p>}
      <div className="form-actions"><button className="primary" disabled={busy||Boolean(latest)}>{busy?'保存中…':'保存目标'}</button></div>
    </form>
  </Modal>;
}

function MaterialPicker({kind,rows,close,add}:{kind:Material['kind'];rows:(Paper|Note)[];close:()=>void;add:(id:string)=>Promise<void>}){
  const [query,setQuery]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const filtered=rows.filter(row=>row.title.toLowerCase().includes(query.trim().toLowerCase()));
  const label=kind==='paper'?'文献':'笔记';
  return <Modal title={'关联'+label} close={()=>{if(!busy)close()}}>
    <label className="form">搜索{label}<input value={query} onChange={e=>setQuery(e.target.value)}/></label>
    <div className="work-picks">
      {filtered.slice(0,100).map(row=><button className="quiet" key={row.id} disabled={busy} onClick={async()=>{
        setBusy(true);setError('');try{await add(row.id);close()}catch(err){setError(message(err))}finally{setBusy(false)}
      }}>{row.title}<Plus size={14}/></button>)}
      {!filtered.length&&<p className="quiet-text">没有可关联的{label}。</p>}
      {filtered.length>100&&<p className="quiet-text">显示前 100 条，请用标题缩小范围。</p>}
    </div>
    {error&&<p className="error" role="alert">{error}</p>}
  </Modal>;
}

export function Projects({projects,rows,papers,notes,onSave,editTask,openPaper,openNote,report}:Props){
  const [goals,setGoals]=useState<Goal[]>([]);
  const [mode,setMode]=useState<'project'|'goal'>('project');
  const [choice,setChoice]=useState({project:'',goal:''});
  const [query,setQuery]=useState('');
  const [scope,setScope]=useState<'open'|'archived'|'all'>('open');
  const [projectForm,setProjectForm]=useState<Project>();
  const [goalForm,setGoalForm]=useState<Goal>();
  const [linkKind,setLinkKind]=useState<Material['kind']>();
  const [goalPicker,setGoalPicker]=useState(false);
  const [linkBusy,setLinkBusy]=useState(false);
  const [error,setError]=useState('');
  const [materialError,setMaterialError]=useState('');
  const [materialRetry,setMaterialRetry]=useState(0);
  const [materials,setMaterials]=useState<{project:string;items:Material[]}>();
  const [history,setHistory]=useState<{id:string;items:Change[]}>();
  const [historyOpen,setHistoryOpen]=useState(false);
  const pool=mode==='project'?projects:goals;
  const filtered=pool.filter(item=>(scope==='all'||(scope==='archived')===(item.status==='archived'))&&
    (item.title+' '+item.description).toLowerCase().includes(query.trim().toLowerCase()));
  const selected=filtered.find(item=>item.id===choice[mode])||filtered[0];
  const project=mode==='project'?selected:undefined;
  const goal=mode==='goal'?goals.find(g=>g.id===selected?.id):undefined;
  const linked=materials?.project===project?.id?materials?.items||[]:[];
  const tasks=project?rows.filter(item=>item.projectId===project.id&&!item.deleted):[];
  const sortedTasks=tasks.toSorted((a,b)=>Number(a.done)-Number(b.done)||(a.day||a.deadline||'9999').localeCompare(b.day||b.deadline||'9999'));
  const nextTask=sortedTasks.find(item=>!item.done);
  const attachedGoals=project?goals.filter(item=>item.projects.includes(project.id)):[];
  const currentProgress=goal?progress(goal.measure):undefined;

  function loadGoals(signal?:AbortSignal){
    setError('');
    void api<Goal[]>('/goals','GET',undefined,signal).then(setGoals).catch(err=>{if(!signal?.aborted)setError(message(err))});
  }
  useEffect(()=>{const abort=new AbortController();loadGoals(abort.signal);return()=>abort.abort()},[]);
  useEffect(()=>{
    if(!project)return;
    const abort=new AbortController();
    setMaterialError('');
    void api<Material[]>('/projects/'+project.id+'/materials','GET',undefined,abort.signal)
      .then(items=>setMaterials({project:project.id,items})).catch(err=>{if(!abort.signal.aborted)setMaterialError(message(err))});
    return()=>abort.abort();
  },[project?.id,materialRetry]);
  useEffect(()=>{
    if(!goal||!historyOpen)return;
    const abort=new AbortController();
    void api<Change[]>('/goals/'+goal.id+'/history','GET',undefined,abort.signal)
      .then(items=>setHistory({id:goal.id,items})).catch(err=>{if(!abort.signal.aborted)report(message(err))});
    return()=>abort.abort();
  },[goal?.id,goal?.revision,historyOpen]);

  function show(next:'project'|'goal',id?:string){
    setMode(next);setHistoryOpen(false);
    if(id){setQuery('');setScope('all');setChoice(value=>({...value,[next]:id}))}
  }
  function savedGoal(g:Goal){
    setGoals(items=>[g,...items.filter(item=>item.id!==g.id)]);setGoalForm(undefined);
    if(mode==='goal'){setChoice({...choice,goal:g.id});setQuery('');if(scope!=='all')setScope(g.status==='archived'?'archived':'open')}
    report('目标已保存');
  }
  async function changeMaterial(material:Material,method:'PUT'|'DELETE'){
    if(!project||linkBusy)return;
    setLinkBusy(true);
    try{
      await api('/projects/'+project.id+'/materials/'+material.kind+'/'+material.id,method);
      setMaterials(current=>{
        const kept=(current?.project===project.id?current.items:[]).filter(item=>item.kind!==material.kind||item.id!==material.id);
        return {project:project.id,items:method==='PUT'?[...kept,material]:kept};
      });
      report(method==='PUT'?'已关联到项目':'已解除关联');
    }finally{setLinkBusy(false)}
  }

  return <div className="workspace-page project-workspace">
    <header className="page-heading"><div><p className="section-label">工作台</p><h1>目标与项目</h1>
      <p>看下一步安排、记录目标进展、打开项目资料。</p></div>
      <DeskArt kind="project"/><button className="primary" onClick={()=>mode==='project'?setProjectForm(freshProject):setGoalForm(newGoal())}>
        <Plus size={17}/>{mode==='project'?'新建项目':'新建目标'}</button></header>
    <div className="project-tools">
      <div className="project-switch" aria-label="目标与项目视图">
        <button aria-pressed={mode==='project'} onClick={()=>show('project')}><FolderKanban size={16}/>项目</button>
        <button aria-pressed={mode==='goal'} onClick={()=>show('goal')}><Target size={16}/>目标</button>
      </div>
      <input placeholder={mode==='project'?'搜索项目':'搜索目标'} aria-label="搜索目标与项目" value={query} onChange={e=>setQuery(e.target.value)}/>
      <select aria-label="显示范围" value={scope} onChange={e=>setScope(e.target.value as typeof scope)}>
        <option value="open">未归档</option><option value="archived">已归档</option><option value="all">全部</option>
      </select>
    </div>
    {error&&<div className="error" role="alert">{error} <button className="quiet" onClick={()=>loadGoals()}>重新读取目标</button></div>}
    <div className="project-grid" data-mode={mode}>
      <section className="project-index" aria-label={mode==='project'?'项目清单':'目标清单'}>
        {filtered.map(item=><button key={item.id} aria-current={selected?.id===item.id?'true':undefined}
          onClick={()=>{setChoice({...choice,[mode]:item.id});setHistoryOpen(false)}}>
          <strong>{item.title}</strong><small>{status[item.status]}{item.area?' · '+areas[item.area as keyof typeof areas]:''}</small>
        </button>)}
        {!filtered.length&&<p className="quiet-text">{query?'没有符合搜索的条目。':scope==='archived'?'暂无已归档条目。':'新建后会显示在这里。'}</p>}
      </section>
      {selected?<section className="project-detail" aria-label={project?'项目详情':'目标详情'}>
        <div className="project-detail-head"><div><h2>{selected.title}</h2>
          <p>{status[selected.status]}{selected.area?' · '+areas[selected.area as keyof typeof areas]:''}
            {selected.deadline?' · 截止 '+selected.deadline:''}</p></div>
          <button className="secondary" onClick={()=>project?setProjectForm(project):goal&&setGoalForm(goal)}>{project?'编辑项目':'更新进展'}</button>
        </div>
        {selected.description&&<p className="project-description">{selected.description}</p>}
        {project&&<>
          {nextTask&&<button className="project-next" onClick={()=>editTask(nextTask)}>
            <ListChecks size={19}/><span><small>下一项安排</small><strong>{nextTask.title}</strong></span><ArrowRight size={17}/>
          </button>}
          <section className="project-section"><header><h3>任务与日程 <small>{tasks.filter(item=>item.done).length} / {tasks.length} 已完成</small></h3>
            <button className="quiet" disabled={project.status==='archived'} onClick={()=>editTask({...freshAgenda,projectId:project.id})}>添加项目任务</button></header>
            {sortedTasks.length?<ul className="project-related">{sortedTasks.map(item=><li key={item.id}>
              <button onClick={()=>editTask(item)}>{item.title}</button><small>{item.done?'已完成':item.day||item.deadline||'待安排'}</small>
            </li>)}</ul>:<p className="quiet-text">还没有项目安排。</p>}
          </section>
          <section className="project-section"><header><h3>文献资料</h3><div>
            <button className="quiet" disabled={project.status==='archived'||materials?.project!==project.id} onClick={()=>setLinkKind('paper')}>关联文献</button>
          </div></header>
            {materialError?<p className="error" role="alert">{materialError} <button className="quiet" onClick={()=>setMaterialRetry(n=>n+1)}>重试</button></p>:
              materials?.project!==project.id?<p className="quiet-text">正在读取关联材料…</p>:linked.length?<ul className="project-related">
                {linked.map(material=>{
                  const paper=material.kind==='paper'?papers.find(p=>p.id===material.id):undefined;
                  const note=material.kind==='note'?notes.find(n=>n.id===material.id):undefined;
                  const row=paper||note;
                  return <li key={material.kind+material.id}><button disabled={!row||row.deleted} onClick={()=>paper?openPaper(paper):note&&openNote(note)}>
                    {material.kind==='paper'&&<BookOpen size={15}/>} {row?.title||'材料不可用'} {row?.deleted&&'（回收站）'}
                  </button><button className="quiet" disabled={linkBusy} aria-label={'解除关联 '+(row?.title||'材料')}
                    onClick={()=>void changeMaterial(material,'DELETE').catch(err=>report(message(err)))}>解除</button></li>
                })}
              </ul>:<p className="quiet-text">把项目资料关联到这里，可直接打开原文。</p>}
          </section>
          <section className="project-section"><header><h3>关联目标</h3><button className="quiet" disabled={project.status==='archived'} onClick={()=>setGoalPicker(true)}>关联已有目标</button></header>
            {attachedGoals.length?<ul className="project-related">{attachedGoals.map(item=><li key={item.id}>
              <button onClick={()=>show('goal',item.id)}>{item.title}</button><small>{progress(item.measure).label}</small>
            </li>)}</ul>:<p className="quiet-text">暂无关联目标。</p>}
          </section>
        </>}
        {goal&&currentProgress&&<>
          <div className="goal-progress">
            <div><strong>{currentProgress.label}</strong><span>{currentProgress.detail}</span></div>
            <progress aria-label="目标进展" value={Math.min(100,currentProgress.percent)} max={100}/>
          </div>
          {goal.measure.kind==='milestones'&&goal.measure.milestones.length>0&&<ul className="project-related goal-route">
            {goal.measure.milestones.map((item,i)=><li key={i} data-done={item.done}><b aria-hidden="true">{item.done?'✓':i+1}</b><span>{item.title}</span><small>{item.done?'已达成':'待达成'}</small></li>)}
          </ul>}
          <section className="project-section"><header><h3>关联项目</h3></header>
            {goal.projects.length?<ul className="project-related">{goal.projects.map(id=><li key={id}><button onClick={()=>show('project',id)}>
              {projects.find(p=>p.id===id)?.title||'项目不可用'}</button></li>)}</ul>:<p className="quiet-text">暂无关联项目。</p>}
          </section>
          <section className="project-section"><header><h3>进展历史</h3><button className="quiet" aria-expanded={historyOpen} onClick={()=>setHistoryOpen(!historyOpen)}>
            {historyOpen?'收起记录':'查看记录'}</button></header>
            {historyOpen&&(history?.id===goal.id?<ul className="project-related goal-history">
              {history.items.map(item=><li key={item.goal.revision}><div><strong>{progress(item.goal.measure).label} · 第 {item.goal.revision} 版</strong>
                <p>{item.reason||(item.goal.revision===1?'创建目标':'更新目标资料')}</p></div>
                <time dateTime={item.savedAt}>{new Date(item.savedAt).toLocaleString('zh-CN',{dateStyle:'short',timeStyle:'short'})}</time></li>)}
            </ul>:<p className="quiet-text">正在读取历史…</p>)}
          </section>
        </>}
      </section>:<Empty title={mode==='project'?'选一个项目':'选一个目标'} detail="从清单选择条目，或点击右上角新建。"/>}
    </div>
    {projectForm&&<ProjectEditor initial={projectForm} close={()=>setProjectForm(undefined)} save={item=>{
      onSave(item);setProjectForm(undefined);setChoice({...choice,project:item.id});setQuery('');
      if(scope!=='all')setScope(item.status==='archived'?'archived':'open');report('项目已保存');
    }}/>}
    {goalForm&&<GoalEditor initial={goalForm} projects={projects} close={()=>setGoalForm(undefined)} save={savedGoal}/>}
    {linkKind&&project&&<MaterialPicker kind={linkKind} close={()=>setLinkKind(undefined)}
      rows={(linkKind==='paper'?papers:notes).filter(row=>!row.deleted&&!linked.some(item=>item.kind===linkKind&&item.id===row.id))}
      add={id=>changeMaterial({kind:linkKind,id},'PUT')}/>}
    {goalPicker&&project&&<Modal title="关联已有目标" close={()=>setGoalPicker(false)}>
      <div className="work-picks">
        {goals.filter(g=>g.status!=='archived'&&!g.projects.includes(project.id)).map(g=><button className="quiet" key={g.id} onClick={()=>{
          setGoalPicker(false);setGoalForm({...g,projects:[...g.projects,project.id]});
        }}>{g.title}<Plus size={14}/></button>)}
        {!goals.some(g=>g.status!=='archived'&&!g.projects.includes(project.id))&&<p className="quiet-text">暂无可关联目标。可在「目标」新建。</p>}
      </div>
    </Modal>}
  </div>;
}
