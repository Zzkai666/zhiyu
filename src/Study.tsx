import { ArrowRight, BookOpen, Check, Clock3, Edit2, GraduationCap, Plus } from 'lucide-react';
import {Rhythm} from './Journal';
import { useState } from 'react';
import { today } from './Agenda';
import { api, message, type Paper } from './api';
import { DataStatus, DomainShell, SaveActions, useRows } from './WorkspacePanels';
import { Empty, Modal } from './ui';

type Course = { id:string; title:string; description:string; archived:boolean; revision:number };
type Chapter = { id:string; courseId:string; title:string; state:'pending'|'reading'|'done'; paperId:string; page:number; revision:number };
type RecordEntry = { id:string; chapterId:string; day:string; minutes:number; detail:string };
const blankCourse:Course = { id:'',title:'',description:'',archived:false,revision:0 };
const chapterStates = { pending:'待学习',reading:'学习中',done:'已学完' };

export function Study({ papers, source }: { papers:Paper[]; source:(id:string,page:number)=>void }) {
  const courses=useRows<Course>('/courses');
  const [courseId,setCourseId]=useState(()=>localStorage.getItem('rdnext.study.course')||'');
  const [chapterId,setChapterId]=useState('');
  const [archived,setArchived]=useState(false);
  const [form,setForm]=useState<{ kind:'course'; data:Course } | { kind:'chapter'; data:Chapter } | { kind:'record'; data:RecordEntry } | null>(null);
  const [pending,setPending]=useState(false);
  const [error,setError]=useState('');
  const [chapterError,setChapterError]=useState('');
  const [chapterBusy,setChapterBusy]=useState(false);
  const visible=courses.rows.filter(c=>c.archived===archived);
  const course=visible.find(c=>c.id===courseId) || visible[0];
  const chapterPath=course ? '/courses/' + course.id + '/chapters' : '';
  const chapters=useRows<Chapter>(chapterPath);
  const next=chapters.rows.find(c=>c.state==='reading')||chapters.rows.find(c=>c.state==='pending');
  const lastChapter=course?localStorage.getItem('rdnext.study.chapter.'+course.id):null;
  const chapter=chapters.rows.find(c=>c.id===chapterId)||chapters.rows.find(c=>c.id===lastChapter)||next||chapters.rows[0];
  const doneCount=chapters.rows.filter(c=>c.state==='done').length;
  function pickChapter(id:string){
    setChapterId(id);setChapterError('');
    if(course)localStorage.setItem('rdnext.study.chapter.'+course.id,id);
  }
  function pickCourse(id:string){
    setCourseId(id);setChapterId('');setChapterError('');localStorage.setItem('rdnext.study.course',id);
  }
  async function toggleChapter(){
    if(!chapter||chapterBusy)return;
    setChapterBusy(true);setChapterError('');
    try{chapters.update(await api<Chapter>(chapterPath+'/'+chapter.id,'PATCH',{...chapter,state:chapter.state==='done'?'reading':'done'}),true)}
    catch(err){setChapterError(message(err))}
    finally{setChapterBusy(false)}
  }
  const records=useRows<RecordEntry>(chapter ? '/chapters/' + chapter.id + '/records' : '');
  function open(value:NonNullable<typeof form>) { setForm(value); setError(''); }
  async function submit() {
    if (!form) return;
    setPending(true); setError('');
    try {
      if (form.kind==='course') {
        const c=form.data, saved=await api<Course>('/courses'+(c.id?'/'+c.id:''),c.id?'PATCH':'POST',c);
        courses.update(saved); pickCourse(saved.id); setArchived(saved.archived);
      } else if (form.kind==='chapter') {
        const c=form.data, saved=await api<Chapter>(chapterPath+(c.id?'/'+c.id:''),c.id?'PATCH':'POST',c);
        chapters.update(saved,true); pickChapter(saved.id);
      } else records.update(await api<RecordEntry>('/chapters/'+form.data.chapterId+'/records','POST',form.data));
      setForm(null);
    } catch(err) { setError(message(err)); }
    finally { setPending(false); }
  }
  function patch<T extends Course|Chapter|RecordEntry>(data:T) { if(form) setForm({ ...form,data } as NonNullable<typeof form>); }

  return <DomainShell label="学习与生活" title="课程学习" description="按章节继续学习，资料和实际记录放在一起。"
    action={<button className="primary" onClick={()=>open({kind:'course',data:blankCourse})}><Plus size={17}/>新建课程</button>}
    rail={<><div className="segmented"><button aria-pressed={!archived} onClick={()=>setArchived(false)}>课程</button><button aria-pressed={archived} onClick={()=>setArchived(true)}>归档</button></div>
      <DataStatus {...courses}/>{visible.map(c=><button className="domain-item" key={c.id} aria-pressed={c.id===course?.id} disabled={chapterBusy} onClick={()=>pickCourse(c.id)}>
        <GraduationCap size={17}/><span>{c.title}</span></button>)}</>}>
    {course ? <><div className="section-heading"><h2>{course.title}</h2><button className="quiet" onClick={()=>open({kind:'course',data:course})}><Edit2 size={15}/>编辑课程</button></div>
      {course.description && <p className="domain-description">{course.description}</p>}
      {!course.archived&&next&&<button className="daily-action section-offset" disabled={chapterBusy} onClick={()=>{
        pickChapter(next.id);
        if(next.paperId)source(next.paperId,next.page);
      }}><BookOpen size={18}/><span><small>{next.state==='reading'?'继续学习':'下一章'}</small><strong>{next.title}</strong></span><ArrowRight size={17}/></button>}
      <div className="section-heading section-offset"><h2>章节 <small>{doneCount} / {chapters.rows.length} 已学完</small></h2>
        {!course.archived && <button className="secondary" onClick={()=>open({kind:'chapter',data:{id:'',courseId:course.id,title:'',state:'pending',paperId:'',page:0,revision:0}})}><Plus size={15}/>添加章节</button>}</div>
      <DataStatus {...chapters}/>
      {chapters.rows.length>0&&<progress className="course-progress" aria-label="课程章节完成进度" value={doneCount} max={chapters.rows.length}/>}
      <div className="chapter-workspace">{chapters.rows.length ? <div className="chapter-list">{chapters.rows.map((c,index)=><button data-state={c.state} key={c.id} aria-pressed={c.id===chapter?.id} disabled={chapterBusy} onClick={()=>pickChapter(c.id)}>
        <b className="chapter-stop" aria-hidden="true">{c.state==='done'?'✓':index+1}</b><span>{c.title}</span><small>{chapterStates[c.state]}</small></button>)}</div> : <p className="quiet-text">还没有章节。</p>}
      {chapter && <section className="domain-section"><div className="section-heading"><h2>{chapter.title}</h2>
        {!course.archived&&<div className="study-actions">
          <button className="quiet" disabled={chapterBusy} onClick={()=>void toggleChapter()}><Check size={15}/>{chapter.state==='done'?'重新开始学习':'标记学完'}</button>
          <button className="quiet" disabled={chapterBusy} onClick={()=>open({kind:'chapter',data:chapter})}>编辑章节</button>
        </div>}</div>
        {chapterError&&<p className="error" role="alert">{chapterError} <button className="quiet" onClick={()=>{setChapterError('');chapters.retry()}}>重新读取章节</button></p>}
        {chapter.paperId ? <button className="secondary" onClick={()=>source(chapter.paperId,chapter.page)}><BookOpen size={16}/>打开资料第 {chapter.page} 页</button> : <p className="quiet-text">可在编辑章节时关联文献库的 PDF。</p>}
        <div className="section-heading section-offset"><h2><Clock3 size={16}/>学习记录</h2>{!course.archived && <button className="quiet" onClick={()=>open({kind:'record',data:{id:'',chapterId:chapter.id,day:today(),minutes:0,detail:''}})}>记一次学习</button>}</div>
        <DataStatus {...records}/>
        {records.rows.length ? <div className="data-list">{records.rows.map(r=><div key={r.id}><time>{r.day}</time><strong>{r.minutes ? r.minutes+' 分钟' : '补记'}</strong><span>{r.detail}</span></div>)}</div> : <p className="quiet-text">本章还没有实际记录。</p>}
      </section>}</div>{chapter&&<Rhythm title="本章学习节律" entries={records.rows.map(r=>({day:r.day,value:r.minutes}))}/>}
    </> : <Empty title={archived?'暂无已归档课程':'先创建一门课程'} detail="创建后可以加章节、关联 PDF，并补记实际学习。"/>}
    {form && <Modal guardDraft title={form.kind==='course'?(form.data.id?'编辑课程':'新建课程'):form.kind==='chapter'?(form.data.id?'编辑章节':'添加章节'):'记录学习'} close={()=>{if(!pending)setForm(null);}}>
      <form className="form" onSubmit={e=>{e.preventDefault();void submit();}}>
        {form.kind==='course' && <><label>课程名称<input required value={form.data.title} onChange={e=>patch({...form.data,title:e.target.value})}/></label>
          <label>课程说明<textarea value={form.data.description} rows={4} onChange={e=>patch({...form.data,description:e.target.value})}/></label>
          {form.data.id && <label className="check-line"><input type="checkbox" checked={form.data.archived} onChange={e=>patch({...form.data,archived:e.target.checked})}/>归档课程</label>}</>}
        {form.kind==='chapter' && <><label>章节名称<input required value={form.data.title} onChange={e=>patch({...form.data,title:e.target.value})}/></label>
          <label>章节状态<select value={form.data.state} onChange={e=>patch({...form.data,state:e.target.value as Chapter['state']})}>
            {Object.entries(chapterStates).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
          <div className="form-row"><label>关联 PDF<select value={form.data.paperId} onChange={e=>patch({...form.data,paperId:e.target.value,page:e.target.value?1:0})}>
            <option value="">暂不关联</option>{papers.map(p=><option key={p.id} value={p.id} disabled={p.deleted}>{p.title}</option>)}</select></label>
          {form.data.paperId && <label>原文页码<input type="number" min="1" value={form.data.page} onChange={e=>patch({...form.data,page:Number(e.target.value)})}/></label>}</div></>}
        {form.kind==='record' && <><div className="form-row"><label>实际日期<input type="date" required max={today()} value={form.data.day} onChange={e=>patch({...form.data,day:e.target.value})}/></label>
          <label>用时（分钟）<input type="number" min="0" max="1440" value={form.data.minutes||''} onChange={e=>patch({...form.data,minutes:Number(e.target.value)})}/></label></div>
          <label>学习内容<textarea rows={4} value={form.data.detail} onChange={e=>patch({...form.data,detail:e.target.value})}/></label></>}
        <SaveActions pending={pending} error={error} label="保存"/>
      </form>
    </Modal>}
  </DomainShell>;
}
