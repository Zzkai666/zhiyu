import {useId,useState} from 'react';
import {X,BookOpen,Plus,Star} from 'lucide-react';
import type {Paper} from './api';
import {api,message,updatePaper} from './api';
import {Modal} from './ui';
import {PaperCover} from './Journal';
import {ReadingProgress,PaperState,PaperRemark} from './LibraryControls';
import {enrichMetadata} from './PaperMetadata';
import {summarizeAuthors} from './PaperAuthors';

function PaperAuthorList({authors}: {authors:string}) {
 const summary=summarizeAuthors(authors);
 const [expanded,setExpanded]=useState(false);
 const id=useId();
 return <div className="metadata-authors">
   <p id={id} data-clamp={!expanded&&summary.clamp}>{expanded?summary.full:summary.preview}</p>
   {summary.expandable&&
     <button className="quiet" type="button" aria-expanded={expanded} aria-controls={id}
       onClick={()=>setExpanded(value=>!value)}>
       {expanded?'收起作者':summary.remaining?'展开作者（另 '+summary.remaining+' 位）':'展开全部作者'}
     </button>}
 </div>;
}

export function PaperDetails({paper,close,open,edit,update,inline=false}:{paper:Paper;close:()=>void;open:()=>void;edit:()=>void;update:(p:Paper)=>void;inline?:boolean}){
 const[busy,setBusy]=useState(false),[error,setError]=useState(''),[tag,setTag]=useState('');const m=paper.metadata;
 async function change(p:Paper,patch:Partial<Paper>){if(busy)return;setBusy(true);setError('');try{const saved=await updatePaper(p,patch);update(saved);return saved}catch(e){setError(message(e));try{const latest=(await api<Paper[]>('/papers')).find(v=>v.id===p.id);if(latest)update(latest)}catch{}}finally{setBusy(false)}}
 const link=(url:string)=>url&&/^https?:\/\//i.test(url)?<button className="quiet metadata-link" onClick={()=>void window.desktop.openExternal(url).catch(e=>setError(message(e)))}>{url}</button>:'—';
 const content=<div className="metadata-panel">
 <div className="metadata-paper"><PaperCover paper={paper}/><div><h2>{paper.title}</h2><PaperAuthorList key={paper.authors} authors={paper.authors}/><small>{paper.year||'年份待补充'}</small></div></div>
 <section className="metadata-reading"><label>阅读状态<PaperState paper={paper} change={change} busy={busy}/></label><ReadingProgress paper={paper}/><p>打开原文后自动进入阅读中，读完后可在这里标记。</p></section>
 <section className="metadata-tags"><h3>标签</h3><div className="tags">{paper.tags.map(t=><button key={t} type="button" disabled={busy||paper.deleted} aria-label={'移除标签：'+t} onClick={()=>void change(paper,{tags:paper.tags.filter(v=>v!==t)})}>{t}<X size={11}/></button>)}</div><form onSubmit={e=>{e.preventDefault();const next=tag.trim();if(next)void change(paper,{tags:[...paper.tags,next]}).then(saved=>{if(saved)setTag('')})}}><input aria-label="新标签" placeholder="添加主题标签" maxLength={100} value={tag} disabled={busy||paper.deleted} onChange={e=>setTag(e.target.value)}/><button className="icon" aria-label="添加标签" disabled={busy||paper.deleted||!tag.trim()}><Plus size={16}/></button></form></section>
 <PaperRemark paper={paper} update={update}/>
 <details className="metadata-facts" open><summary>完整文献信息</summary><dl className="metadata-summary"><dt>年份</dt><dd>{paper.year||'—'}</dd><dt>arXiv</dt><dd>{m?.arxiv||'—'}</dd><dt>DOI</dt><dd>{paper.doi||'—'}</dd><dt>论文链接</dt><dd>{link(m?.url||(paper.doi?'https://doi.org/'+paper.doi:''))}</dd><dt>PDF 链接</dt><dd>{link(m?.pdf||'')}</dd><dt>刊物</dt><dd>{m?.journal||'—'}</dd><dt>关键词</dt><dd>{m?.keywords||'—'}</dd>{m?.abstract&&<><dt>摘要</dt><dd>{m.abstract}</dd></>}<dt>信息来源</dt><dd>{m?.source||'尚未获取元数据'}</dd><dt>文件</dt><dd>{paper.filename||paper.title} · {(paper.bytes/1024/1024).toFixed(1)} MB</dd><dt>添加时间</dt><dd>{new Date(paper.addedAt).toLocaleString('zh-CN')}</dd><dt>阅读位置</dt><dd>{paper.readAt?'已保存 · 第 '+paper.page+' 页':'尚未开始阅读'}</dd></dl></details>
 {m?.error&&<p className="quiet-text">{m.error}</p>}{error&&<p className="error" role="alert">{error}</p>}
 <div className="form-actions"><button className="primary" onClick={open} disabled={paper.deleted||busy}><BookOpen size={16}/>阅读论文</button><button className="secondary" onClick={edit} disabled={busy}>编辑资料</button><button className="icon" disabled={busy||paper.deleted} aria-label={paper.favorite?'取消收藏':'收藏'} onClick={()=>void change(paper,{favorite:!paper.favorite})}><Star size={17} fill={paper.favorite?'currentColor':'none'}/></button><button className="quiet" disabled={busy||paper.deleted} onClick={async()=>{setBusy(true);setError('');try{update(await enrichMetadata(paper,localStorage.getItem('rdnext.metadata.offline')!=='true'))}catch(e){setError(message(e))}finally{setBusy(false)}}}>{busy?'正在核对…':'重新获取元数据'}</button></div>
 </div>;
 return inline?<aside className="metadata-inline" aria-label="文献详情"><header><h3>文献详情</h3><button className="icon" aria-label="收起文献详情" disabled={busy} onClick={close}><X size={17}/></button></header>{content}</aside>:<Modal title="文献详情" close={()=>{if(!busy)close()}} wide>{content}</Modal>
}
