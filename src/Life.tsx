import { Activity, Droplet, Minus, Plus } from 'lucide-react';
import {Rhythm} from './Journal';
import { useState } from 'react';
import { today } from './Agenda';
import { api, message } from './api';
import { DataStatus, DomainShell, SaveActions, useRows } from './WorkspacePanels';
import { Empty, Modal } from './ui';

type Entry = { id:string; kind:'water'|'habit'|'cardio'|'strength'; title:string; day:string; quantity:number; minutes:number; detail:string; deleted:boolean; revision:number };
const labels={water:'饮水',habit:'习惯',cardio:'有氧',strength:'力量'};
export function Life({ report }: { report:(message:string)=>void }) {
  const data=useRows<Entry>('/life');
  const [filter,setFilter]=useState('all');
  const [item,setItem]=useState<Entry|null>(null);
  const [pending,setPending]=useState(false);
  const [waterPending,setWaterPending]=useState(false);
  const [error,setError]=useState('');
  const [thisWeek,setThisWeek]=useState(false);
  const now=new Date();
  now.setDate(now.getDate()-((now.getDay()+6)%7));
  const monday=[now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-');
  const training=data.rows.filter(v=>!v.deleted&&(v.kind==='cardio'||v.kind==='strength')).toSorted((a,b)=>b.day.localeCompare(a.day));
  const weekTraining=training.filter(v=>v.day>=monday&&v.day<=today());
  const weekMinutes=weekTraining.reduce((total,v)=>total+v.minutes,0);
  const trainingDays=new Set(weekTraining.map(v=>v.day)).size;
  const water=data.rows.find(v=>v.kind==='water'&&v.day===today())?.quantity||0;
  const visible=data.rows.filter(v=>v.kind!=='water'&&v.deleted===(filter==='trash')&&(filter==='all'||filter==='trash'||v.kind===filter)&&(!thisWeek||filter==='trash'||v.day>=monday&&v.day<=today()));
  function edit(v:Entry) {setError('');setItem(v);}
  function start(kind:'cardio'|'strength'|'habit',title=''){
    edit({id:'',kind,title,day:today(),quantity:0,minutes:0,detail:'',deleted:false,revision:0});
  }
  async function drink(delta:number) {
    setWaterPending(true);
    try {data.update(await api<Entry>('/life/water','POST',{day:today(),delta}));}
    catch(err) {report(message(err));}
    finally {setWaterPending(false);}
  }
  async function save(deleted=item?.deleted||false) {
    if(!item)return;
    setPending(true);setError('');
    try {
      data.update(await api<Entry>('/life'+(item.id?'/'+item.id:''),item.id?'PATCH':'POST',{...item,deleted}));setItem(null);
    } catch(err){setError(message(err));}
    finally{setPending(false);}
  }
  return <DomainShell label="学习与生活" title="运动与生活" description="照顾好身体，也是一种进展。"
    action={<button className="primary" onClick={()=>start('cardio')}><Plus size={17}/>新建记录</button>}>
    <DataStatus {...data}/>
    <div className="life-overview"><section className="water-panel" aria-label="今日饮水"><div><h2><Droplet size={19}/>今日饮水</h2><p role="status">{water} / 4 瓶</p></div>
      <div className="water-meter" aria-hidden="true">{[1,2,3,4].map(n=><span key={n} data-filled={n<=water}/>)}</div>
      <div className="water-actions"><button className="icon" disabled={waterPending||data.loading||water===0} aria-label="撤销一瓶" onClick={()=>void drink(-1)}><Minus size={18}/></button>
        <button className="secondary" disabled={waterPending||data.loading||water>=24} onClick={()=>void drink(1)}><Plus size={16}/>记一瓶</button></div></section>
    {!data.loading&&!data.error&&<section className="life-week" aria-label="本周运动概况">
      <div><h2><Activity size={18}/> 本周运动</h2><small>{monday} 起</small></div>
      <div className="life-totals"><span><strong>{trainingDays}</strong> 天</span><span><strong>{weekTraining.length}</strong> 次</span><span><strong>{weekMinutes}</strong> 分钟</span></div>
      {training[0]&&<button className="secondary" onClick={()=>start(training[0].kind as 'cardio'|'strength',training[0].title)}>再记一次 {training[0].title}</button>}
      <div className="study-actions"><button className="quiet" onClick={()=>start('habit')}>记习惯</button><button className="quiet" onClick={()=>start('strength')}>记力量</button></div>
    </section>}
    <Rhythm title="运动节律" entries={training.map(r=>({day:r.day,value:r.minutes}))}/></div>
    <div className="library-bar section-offset"><div className="segmented">
      {[['all','全部'],['habit','习惯'],['cardio','有氧'],['strength','力量'],['trash','回收站']].map(([id,label])=><button key={id} aria-pressed={filter===id} onClick={()=>setFilter(id)}>{label}</button>)}
    </div>{filter!=='trash'&&<label className="check-line"><input type="checkbox" checked={thisWeek} onChange={e=>setThisWeek(e.target.checked)}/>只看本周</label>}</div>
    {visible.length ? <div className="notes-list">{visible.map(v=><article className="note-card" key={v.id}>
      <button className="note-title" onClick={()=>edit(v)}>{v.title}</button><p>{[v.day,labels[v.kind],v.minutes?v.minutes+' 分钟':'',v.quantity?v.quantity+(v.kind==='cardio'?' 公里':''):''].filter(Boolean).join(' / ')}</p>
      {v.detail&&<p>{v.detail}</p>}
    </article>)}</div> : <Empty title="这里还没有记录" detail="可补记已经完成的活动。"/>}
    {item&&<Modal guardDraft className="life-drawer" title={item.id?'编辑实际记录':'新建实际记录'} close={()=>{if(!pending)setItem(null);}}>
      <form className="form" onSubmit={e=>{e.preventDefault();void save();}}>
        <div className="form-row"><label>类型<select disabled={Boolean(item.id)} value={item.kind} onChange={e=>setItem({...item,kind:e.target.value as Entry['kind'],quantity:0})}>
          <option value="habit">习惯</option><option value="cardio">有氧</option><option value="strength">力量</option></select></label>
          <label>实际日期<input type="date" required max={today()} value={item.day} onChange={e=>setItem({...item,day:e.target.value})}/></label></div>
        <label>记录名称<input required value={item.title} onChange={e=>setItem({...item,title:e.target.value})}/></label>
        <div className="form-row"><label>时长（分钟）<input type="number" min={item.kind==='habit'?0:1} max="1440" required={item.kind!=='habit'} value={item.minutes||''} onChange={e=>setItem({...item,minutes:Number(e.target.value)})}/></label>
          {item.kind!=='strength'&&<label>{item.kind==='cardio'?'距离（公里）':'数量'}<input type="number" min="0" step="0.001" value={item.quantity||''} onChange={e=>setItem({...item,quantity:Number(e.target.value)})}/></label>}</div>
        <label>记录说明<textarea rows={4} value={item.detail} onChange={e=>setItem({...item,detail:e.target.value})}/></label>
        {item.id&&<button className="quiet" type="button" disabled={pending} onClick={()=>{if(item.deleted||window.confirm('移入生活记录回收站？'))void save(!item.deleted);}}>{item.deleted?'恢复':'移入回收站'}</button>}
        <SaveActions pending={pending} error={error} label="保存记录"/>
      </form>
    </Modal>}
  </DomainShell>;
}
