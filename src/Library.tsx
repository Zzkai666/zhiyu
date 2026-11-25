import { ArrowDown, ArrowRight, BookOpen, CirclePlay, Clock3, FileText, FileUp, LibraryBig, Search, Star, Trash2, List, LayoutGrid } from 'lucide-react';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { api, updatePaper, message, type Paper } from './api';
import {PaperDetails} from './PaperDetails';
import {ReadingProgress,PaperState,allowRemarkLeave} from './LibraryControls';
import {PaperProcessingStatus} from './PaperTaskCenter';
import {AzhiMascot} from './Brand';
import {DeskArt,PaperCover,DateStamp} from './Journal';
import { Empty, Modal } from './ui';

export function Home({papers,open,navigate,importPDF,guide,dates,tasks,focus,shortcuts}:{papers:Paper[];open:(p:Paper)=>void;navigate:()=>void;importPDF:()=>void;guide?:()=>void;dates:ReactNode;tasks:ReactNode;focus:ReactNode;shortcuts:ReactNode}){
 const recent=papers.filter(p=>!p.deleted&&p.readAt).toSorted((a,b)=>b.readAt.localeCompare(a.readAt)),next=recent[0]||papers.find(p=>!p.deleted);
 return <div className="workspace-page home-page"><header className="page-heading"><div><h1 aria-label="今日工作台">今天，从这里开始</h1><p className="home-date"><DateStamp/></p></div><DeskArt/><button className="primary" onClick={importPDF}><FileUp size={17}/>导入 PDF</button></header>
 <div className="home-journal"><div className="home-primary"><section className="resume-panel">{next&&<PaperCover paper={next} large/>}<div className="resume-copy"><div className="resume-rule"><BookOpen size={18}/><span>继续阅读</span></div>{next?<><h2>{next.title}</h2><p className="resume-author" title={next.authors}>{next.authors||'作者待补充'}{next.year?' · '+next.year:''}</p><ReadingProgress paper={next}/><div className="study-actions"><button className="primary" onClick={()=>open(next)}>继续阅读<ArrowRight size={16}/></button><button className="secondary" onClick={navigate}>打开文献库</button></div></>:<><h2>从一篇想读的论文开始。</h2><p>阅读位置和批注都留在本机，随时回来接着读。</p><div className="study-actions"><button className="primary" onClick={importPDF}>选择 PDF<ArrowRight size={16}/></button>{guide&&<button className="quiet guide-welcome" onClick={guide}><CirclePlay size={16}/>观看文献引导</button>}</div></>}</div>{!next&&<AzhiMascot className="resume-empty-art"/>}</section>{tasks}</div>
 <aside className="home-secondary" aria-label="今日提醒与接续">{dates}{focus}<section className="recent"><div className="section-heading"><h2><Clock3 size={17}/>最近阅读</h2><button className="quiet" onClick={navigate}>查看全部</button></div>{recent.length?recent.slice(0,3).map(p=><button className="recent-row" key={p.id} onClick={()=>open(p)}><FileText size={15}/><span>{p.title}</span><small>{p.page}{p.totalPages?' / '+p.totalPages:''} 页</small></button>):<p className="quiet-text">最近打开的论文会留在这里。</p>}</section>{shortcuts}</aside></div></div>
}

type Props = { papers: Paper[]; open: (p: Paper,page?:number,review?:boolean) => void; onUpdate: (p: Paper) => void; importPDF: () => void; dropPDF: (files:File[])=>void; importing: boolean; report: (text: string) => void };

export function Library({papers,open,onUpdate,importPDF,dropPDF,importing,report}:Props){
 const[filter,setFilter]=useState(()=>localStorage.getItem('rdnext.library.filter')||'全部'),[tag,setTag]=useState(''),[query,setQuery]=useState(''),[sort,setSort]=useState(()=>localStorage.getItem('rdnext.library.sort')||'added'),[view,setView]=useState(()=>localStorage.getItem('rdnext.library.view')==='grid'?'grid':'list'),[drag,setDrag]=useState(false),[editing,setEditing]=useState<Paper|null>(null),[details,setDetails]=useState<string|null|undefined>(undefined),[pending,setPending]=useState<Set<string>>(new Set());
 const writes=useRef(new Set<string>()),live=papers.filter(p=>!p.deleted),tags=useMemo(()=>Array.from(new Set(papers.filter(p=>!p.deleted).flatMap(p=>p.tags))).sort((a,b)=>a.localeCompare(b,'zh-CN')),[papers]);
 const counts:Record<string,number>={全部:live.length,收藏:live.filter(p=>p.favorite).length,待读:live.filter(p=>p.status==='待阅读').length,阅读中:live.filter(p=>p.status==='阅读中').length,已读:live.filter(p=>p.status==='已读').length,回收站:papers.filter(p=>p.deleted).length};
 const rows=useMemo(()=>{const q=query.trim().toLowerCase();return papers.filter(p=>(filter==='回收站'?p.deleted:!p.deleted)&&(filter==='收藏'?p.favorite:filter==='待读'?p.status==='待阅读':filter==='阅读中'||filter==='已读'?p.status===filter:true)&&(!tag||p.tags.includes(tag))&&(!q||[p.title,p.authors,p.doi,p.metadata?.arxiv||'',p.metadata?.keywords||'',p.remark||'',...p.tags].some(s=>s.toLowerCase().includes(q)))).toSorted((a,b)=>sort==='title'?a.title.localeCompare(b.title):sort==='recent'?b.readAt.localeCompare(a.readAt)||b.addedAt.localeCompare(a.addedAt):sort==='year'?b.year-a.year:b.addedAt.localeCompare(a.addedAt))},[papers,filter,query,sort,tag]);
 const detailPaper=details===undefined?rows[0]:rows.find(p=>p.id===details);
 function choose(id:string|null){if(allowRemarkLeave())setDetails(id)}
 function changeView(next:string){setView(next);try{localStorage.setItem('rdnext.library.view',next)}catch{report('视图已切换，本机偏好暂未保存')}}
 async function change(p:Paper,patch:Partial<Paper>){if(writes.current.has(p.id))return;writes.current.add(p.id);setPending(new Set(writes.current));try{const saved=await updatePaper(p,patch);onUpdate(saved);return saved}catch(e){report(message(e));try{const latest=await api<Paper[]>('/papers');latest.forEach(onUpdate)}catch{}return undefined}finally{writes.current.delete(p.id);setPending(new Set(writes.current))}}
 function selectFilter(next:string){if(!allowRemarkLeave())return;setFilter(next);setDetails(undefined);try{localStorage.setItem('rdnext.library.filter',next)}catch{report('筛选偏好暂未保存')}if(next==='回收站')setTag('')}
 return <div className="workspace-page library-page" onDragOver={e=>{if(e.dataTransfer.types.includes('Files')){e.preventDefault();if(!importing)setDrag(true)}}} onDragLeave={e=>{if(!(e.relatedTarget instanceof Node)||!e.currentTarget.contains(e.relatedTarget))setDrag(false)}} onDrop={e=>{e.preventDefault();setDrag(false);if(!importing&&e.dataTransfer.files.length)dropPDF(Array.from(e.dataTransfer.files))}}>
 {drag&&<div className="drop-hint" role="status"><FileUp size={26}/>松开鼠标，导入文献</div>}
 <header className="page-heading"><div><p className="section-label">阅读与研究</p><h1>文献库</h1><p>整理论文，回到原页，保留读过的证据。</p></div><DeskArt kind="library"/><button className="primary" disabled={importing} onClick={importPDF}><FileUp size={17}/>{importing?'正在导入…':'导入 PDF'}</button></header>
 <div className="library-bar"><div className="segmented" aria-label="文献筛选">{['全部','收藏','待读','阅读中','已读','回收站'].map(item=><button key={item} aria-label={item} aria-pressed={filter===item} onClick={()=>selectFilter(item)}>{item}<span className="filter-count">{counts[item]}</span></button>)}</div><label className="search-field"><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="查找标题、作者、标签或备注" aria-label="查找文献"/></label></div>
 {filter!=='回收站'&&tags.length>0&&<div className="library-facets"><label>标签 <select value={tag} onChange={e=>setTag(e.target.value)}><option value="">全部标签</option>{tags.map(t=><option key={t}>{t}</option>)}</select></label>{tag&&<button className="quiet" onClick={()=>setTag('')}>清除标签</button>}</div>}
 <div className="library-desk" data-details={Boolean(detailPaper)}><section className="paper-list"><div className="list-caption"><span>{rows.length} 篇文献</span><div className="library-display-tools"><label><ArrowDown size={14}/><select value={sort} aria-label="文献排序" onChange={e=>{setSort(e.target.value);try{localStorage.setItem('rdnext.library.sort',e.target.value)}catch{report('排序偏好暂未保存')}}}><option value="added">最近添加</option><option value="recent">最近阅读</option><option value="title">标题</option><option value="year">年份</option></select></label><div className="library-view-switch" aria-label="文献视图"><button className="icon" aria-label="列表视图" aria-pressed={view==='list'} onClick={()=>changeView('list')}><List size={16}/></button><button className="icon" aria-label="卡片视图" aria-pressed={view==='grid'} onClick={()=>changeView('grid')}><LayoutGrid size={16}/></button></div></div></div>
 <div className={'paper-results '+(view==='grid'?'paper-grid':'paper-rows')}>{rows.map(p=><article className="paper-row" key={p.id} data-selected={p.id===detailPaper?.id} data-paper-id={p.id}><div className="paper-identity"><PaperCover paper={p}/><div className="paper-entry-copy"><button className="paper-copy paper-summary-button" aria-label={'查看文献信息：'+p.title} onClick={()=>choose(p.id)}><strong>{p.title}</strong><span className="paper-authors" title={p.authors}>{p.authors||'作者待补充'}</span><span className="paper-meta">{p.year>0&&<span>{p.year}</span>}{p.metadata?.arxiv?<span>arXiv: {p.metadata.arxiv}</span>:p.doi?<span>DOI: {p.doi}</span>:null}{!p.year&&!p.metadata?.arxiv&&!p.doi&&<span>元数据待补充</span>}</span>{p.tags.length>0&&<span className="tags">{p.tags.slice(0,3).map(t=><span key={t}>{t}</span>)}{p.tags.length>3&&<span>+{p.tags.length-3}</span>}</span>}</button>{!p.deleted&&<PaperProcessingStatus paperId={p.id} review={()=>{if(allowRemarkLeave())open(p,p.page,true)}}/>}</div></div>
 {p.deleted?<button className="secondary" disabled={pending.has(p.id)} onClick={()=>void change(p,{deleted:false})}>恢复</button>:<div className="paper-actions"><div className="paper-state-progress"><PaperState paper={p} change={change} busy={pending.has(p.id)}/><ReadingProgress paper={p}/></div><button className="icon" disabled={pending.has(p.id)} aria-label={p.favorite?'取消收藏':'收藏'} onClick={()=>void change(p,{favorite:!p.favorite})}><Star size={17} fill={p.favorite?'currentColor':'none'}/></button><button className="primary" onClick={()=>{if(allowRemarkLeave())open(p)}}>阅读</button></div>}</article>)}</div>
 {!rows.length&&<Empty title={query?'没有匹配的文献':filter==='回收站'?'回收站为空':'这里还没有文献'} detail={query?'试试标题的一部分，或清除筛选。':filter==='全部'?'选择或拖入一份或多份 PDF。':undefined}>{filter==='全部'&&!query&&<button className="primary" onClick={importPDF}><LibraryBig size={16}/>导入论文</button>}</Empty>}
 </section>{detailPaper&&<PaperDetails key={detailPaper.id} inline paper={detailPaper} close={()=>choose(null)} open={()=>{if(allowRemarkLeave())open(detailPaper)}} edit={()=>{if(allowRemarkLeave())setEditing(detailPaper)}} update={onUpdate}/>}</div>
 {editing&&<PaperEditor key={editing.id} paper={editing} close={()=>setEditing(null)} onSave={p=>{onUpdate(p);setEditing(null)}}/>}
 </div>
}

function PaperEditor({ paper, close, onSave }: { paper: Paper; close: () => void; onSave: (p: Paper) => void }) {
  const [form, setForm] = useState(paper);
  const [tags, setTags] = useState(paper.tags.join('，'));
  const [pending, setPending] = useState(false);
  const [remove, setRemove] = useState(false);
  const [error, setError] = useState('');
  async function save(deleted = paper.deleted) {
    setPending(true); setError('');
    try { onSave(await updatePaper(paper, { ...form, deleted, tags: tags.split(/[,，]/) })); }
    catch (err) { setError(message(err)); }
    finally { setPending(false); }
  }
  return <Modal guardDraft title="文献详情" close={() => { if (!pending) close(); }}>
    <form className="form" onSubmit={e => { e.preventDefault(); void save(); }}>
      <label>标题<input required value={form.title} onChange={e => setForm({ ...form, title: e.target.value })}/></label>
      <label>作者<input value={form.authors} onChange={e => setForm({ ...form, authors: e.target.value })}/></label>
      <div className="form-row"><label>年份<input type="number" min="0" max="9999" value={form.year || ''} onChange={e => setForm({ ...form, year: Number(e.target.value) })}/></label>
        <label>阅读状态<select value={form.status} onChange={e => setForm({ ...form, status: e.target.value as Paper['status'] })}><option>待阅读</option><option>阅读中</option><option>已读</option></select></label></div>
      <label>DOI<input value={form.doi} onChange={e => setForm({ ...form, doi: e.target.value })}/></label>
      <label>标签<input value={tags} placeholder="用逗号分隔" onChange={e => setTags(e.target.value)}/></label>
      {error && <p className="error" role="alert">{error}</p>}
      {remove && <p className="quiet-text">文献会移到回收站，原 PDF 和已保存的阅读标记仍可恢复。</p>}
      <div className="form-actions">
        <button className="danger" type="button" disabled={pending} onClick={() => paper.deleted ? void save(false) : remove ? void save(true) : setRemove(true)}><Trash2 size={15}/>{paper.deleted ? '恢复' : remove ? '确认移入回收站' : '移入回收站'}</button>
        <button className="primary" disabled={pending} type="submit">保存</button>
      </div>
    </form>
  </Modal>;
}
