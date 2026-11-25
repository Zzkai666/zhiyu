import { FlaskConical, GitCompareArrows, Plus } from 'lucide-react';
import { useState } from 'react';
import { today, type Project } from './Agenda';
import { api, message } from './api';
import { DataStatus, DomainShell, SaveActions, useRows } from './WorkspacePanels';
import { Empty, Modal } from './ui';

type Experiment = { id:string; title:string; question:string; projectId:string; archived:boolean; revision:number };
type Metric = { name:string; value:number; unit:string };
type Run = { id:string; experimentId:string; title:string; day:string; status:'finished'|'failed'|'incomplete'; condition:string; metrics:Metric[]; revision:number };
const blank:Experiment = { id:'',title:'',question:'',projectId:'',archived:false,revision:0 };
const statuses = { finished:'已结束', failed:'失败', incomplete:'未完成' };
const metricKey = (m:Metric)=>JSON.stringify([m.name,m.unit]);

export function Lab({ projects }: { projects:Project[] }) {
  const experiments=useRows<Experiment>('/experiments');
  const [active,setActive]=useState('');
  const [form,setForm]=useState<Experiment|null>(null);
  const [run,setRun]=useState<Run|null>(null);
  const [checked,setChecked]=useState<string[]>([]);
  const [comparison,setComparison]=useState<Run[]|null>(null);
  const [baseline,setBaseline]=useState('');
  const [query,setQuery]=useState('');
  const [runFilter,setRunFilter]=useState('all');
  const [error,setError]=useState('');
  const [pending,setPending]=useState(false);
  const experiment=experiments.rows.find(e=>e.id===active)||experiments.rows[0];
  const path=experiment?'/experiments/'+experiment.id+'/runs':'';
  const runs=useRows<Run>(path);
  function edit(e:Experiment) {setError('');setForm(e);}
  function editRun(r:Run) {setError('');setRun(r);}
  async function save() {
    setPending(true); setError('');
    try {
      if (form) {
        const saved=await api<Experiment>('/experiments'+(form.id?'/'+form.id:''),form.id?'PATCH':'POST',form);
        experiments.update(saved);
        if (active!==saved.id) setChecked([]);
        setActive(saved.id); setForm(null);
      } else if (run) {
        runs.update(await api<Run>(path+(run.id?'/'+run.id:''),run.id?'PATCH':'POST',run));setRun(null);
      }
    } catch(err) {setError(message(err));}
    finally {setPending(false);}
  }
  const visibleRuns=runs.rows.filter(r=>(runFilter==='all'||r.status===runFilter)&&
    [r.title,r.condition,...r.metrics.map(m=>m.name)].some(value=>value.toLowerCase().includes(query.trim().toLowerCase())));
  const compareRuns=runs.rows.filter(r=>checked.includes(r.id));
  const reference=comparison?.find(r=>r.id===baseline);
  function comparisonValue(r:Run,m:Metric){
    const value=r.metrics.find(v=>metricKey(v)===metricKey(m))?.value;
    const base=reference?.metrics.find(v=>metricKey(v)===metricKey(m))?.value;
    if(value===undefined)return '—';
    if(r.id===baseline||r.status!=='finished'||reference?.status!=='finished'||base===undefined)return value;
    const diff=Number((value-base).toPrecision(8));
    return <>{value} <small className="metric-delta" title="相对基线的差值">{diff>0?'+':''}{diff}</small></>;
  }
  const columns=comparison ? [...new Map(comparison.flatMap(r=>r.metrics.map(m=>[metricKey(m),m] as const))).values()] : [];
  return <DomainShell label="阅读与研究" title="实验记录" description="登记已经执行的运行，用相同名称与单位核对指标。"
    action={<button className="primary" onClick={()=>edit(blank)}><Plus size={17}/>新建实验</button>}
    rail={<><p className="domain-rail-label">实验清单</p><DataStatus {...experiments}/>{experiments.rows.map(e=><button className="domain-item" key={e.id} aria-pressed={e.id===experiment?.id}
      onClick={()=>{setActive(e.id);setChecked([]);setQuery('');setRunFilter('all');}}><FlaskConical size={16}/><span>{e.title}</span>{e.archived&&<small>归档</small>}</button>)}</>}>
    {experiment ? <><div className="section-heading"><h2>{experiment.title}</h2><button className="quiet" onClick={()=>edit(experiment)}>编辑实验</button></div>
      {experiment.question&&<p className="domain-description">{experiment.question}</p>}
      {experiment.projectId&&<p className="quiet-text">项目 {projects.find(p=>p.id===experiment.projectId)?.title}</p>}
      <div className="section-heading section-offset"><h2>运行记录</h2>
        {!experiment.archived && <button className="secondary" onClick={()=>editRun({id:'',experimentId:experiment.id,title:'',day:today(),status:'finished',condition:'',metrics:[],revision:0})}><Plus size={16}/>登记运行</button>}</div>
      <DataStatus {...runs}/>
      {runs.rows.length>0&&<div className="agenda-search run-filters">
        <input aria-label="搜索运行" placeholder="搜索运行、条件或指标" value={query} onChange={e=>setQuery(e.target.value)}/>
        <select aria-label="运行筛选" value={runFilter} onChange={e=>setRunFilter(e.target.value)}>
          <option value="all">全部状态</option>{Object.entries(statuses).map(([id,name])=><option key={id} value={id}>{name}</option>)}
        </select>
      </div>}
      {visibleRuns.length ? <div className="data-list run-list">{visibleRuns.map(r=><div key={r.id}>
        <label><input type="checkbox" aria-label={'对比 '+r.title} disabled={!checked.includes(r.id)&&checked.length>=4} checked={checked.includes(r.id)}
          onChange={e=>setChecked(e.target.checked?[...checked,r.id]:checked.filter(id=>id!==r.id))}/></label>
        <button className="quiet" onClick={()=>editRun(r)}>{r.title}</button><time>{r.day}</time><span>{statuses[r.status]}</span><small>{r.metrics.length} 个指标</small>
        {!experiment.archived&&<button className="quiet" aria-label={'复用运行条件 '+r.title} onClick={()=>editRun({
          ...r,id:'',revision:0,day:today(),title:'',status:'incomplete',metrics:r.metrics.map(m=>({...m,value:NaN})),
        })}>复用条件</button>}
      </div>)}</div> : <p className="quiet-text">{runs.rows.length?'没有匹配的运行。':'还没有已登记的运行。'}</p>}
      {runs.rows.length>0&&<button className="secondary section-offset" disabled={compareRuns.length<2} onClick={()=>{
        setBaseline((compareRuns.find(r=>r.status==='finished')||compareRuns[0]).id);setComparison(compareRuns);
      }}><GitCompareArrows size={16}/>比较 {compareRuns.length} 次运行</button>}
    </> : <Empty title="还没有实验" detail="先写下要验证的问题。做完一次运行后，可以补记条件和指标。"/>}
    {(form||run)&&<Modal guardDraft title={form?(form.id?'编辑实验':'新建实验'):(run?.id?'编辑运行':'登记运行')} close={()=>{if(!pending){setForm(null);setRun(null);}}}>
      <form className="form" onSubmit={e=>{e.preventDefault();void save();}}>
        {form&&<><label>实验名称<input required value={form.title} onChange={e=>setForm({...form,title:e.target.value})}/></label>
          <label>研究问题<textarea rows={4} value={form.question} onChange={e=>setForm({...form,question:e.target.value})}/></label>
          <label>关联项目<select value={form.projectId} onChange={e=>setForm({...form,projectId:e.target.value})}><option value="">不关联</option>
            {projects.map(p=><option key={p.id} value={p.id}>{p.title}</option>)}</select></label>
          {form.id&&<label className="check-line"><input type="checkbox" checked={form.archived} onChange={e=>setForm({...form,archived:e.target.checked})}/>归档实验</label>}</>}
        {run&&<><label>运行名称<input required value={run.title} onChange={e=>setRun({...run,title:e.target.value})}/></label>
          <div className="form-row"><label>实际日期<input type="date" required max={today()} value={run.day} onChange={e=>setRun({...run,day:e.target.value})}/></label>
          <label>运行状态<select value={run.status} onChange={e=>setRun({...run,status:e.target.value as Run['status']})}>
            {Object.entries(statuses).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label></div>
          <label>运行条件<textarea rows={3} value={run.condition} onChange={e=>setRun({...run,condition:e.target.value})}/></label>
          {run.metrics.map((m,i)=><div className="form-row metric-row" key={i}>
            <label>指标<input required value={m.name} onChange={e=>setRun({...run,metrics:run.metrics.map((v,j)=>i===j?{...v,name:e.target.value}:v)})}/></label>
            <label>数值<input type="number" step="any" required value={Number.isNaN(m.value)?'':m.value} onChange={e=>setRun({...run,metrics:run.metrics.map((v,j)=>i===j?{...v,value:e.target.valueAsNumber}:v)})}/></label>
            <label>单位<input value={m.unit} onChange={e=>setRun({...run,metrics:run.metrics.map((v,j)=>i===j?{...v,unit:e.target.value}:v)})}/></label>
            <button className="quiet" type="button" onClick={()=>setRun({...run,metrics:run.metrics.filter((_,j)=>i!==j)})}>移除</button>
          </div>)}
          <button type="button" className="secondary" disabled={run.metrics.length>=40} onClick={()=>setRun({...run,metrics:[...run.metrics,{name:'',unit:'',value:NaN}]})}><Plus size={15}/>添加指标</button></>}
        <SaveActions pending={pending} error={error} label="保存"/>
      </form>
    </Modal>}
    {comparison&&<Modal title="运行对比" subtitle="同名同单位的已结束运行显示相对基线的差值。缺失指标保留为空。" close={()=>setComparison(null)} wide>
      <label className="run-baseline">对比基线 <select value={baseline} onChange={e=>setBaseline(e.target.value)}>
        {comparison.map(r=><option key={r.id} value={r.id}>{r.title}</option>)}
      </select></label>
      <div className="compare-scroll"><table className="compare-table"><thead><tr><th scope="col">指标</th>{comparison.map(r=><th scope="col" key={r.id}>{r.title}</th>)}</tr></thead>
        <tbody><tr><th scope="row">状态</th>{comparison.map(r=><td key={r.id}>{statuses[r.status]}</td>)}</tr>
        <tr><th scope="row">条件</th>{comparison.map(r=><td key={r.id}>{r.condition||'—'}</td>)}</tr>
        {columns.map(m=><tr key={metricKey(m)}><th scope="row">{m.name}{m.unit?' ('+m.unit+')':''}</th>{comparison.map(r=><td key={r.id}>{comparisonValue(r,m)}</td>)}</tr>)}</tbody>
      </table></div>
    </Modal>}
  </DomainShell>;
}
