import {DeskArt} from './Journal';
import { BookOpen, Download, History, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api, message, type Note, type Word } from './api';
import { Empty, Modal } from './ui';

export const blankNote: Note = { id: '', title: '', body: '', paperId: '', page: 0, quote: '', updatedAt: '', revision: 0, deleted: false };
export const blankWord: Word = { id: '', term: '', meaning: '', paperId: '', page: 0, quote: '', dueAt: '', interval: 0, revision: 0 };

export function NoteEditor({ initial, close, save }: { initial: Note; close: () => void; save: (n: Note) => void }) {
  const [draft, setDraft] = useState(initial);
  const [history, setHistory] = useState<Note[] | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function submit(deleted = draft.deleted) {
    setPending(true); setError('');
    try { save(await api<Note>('/notes' + (draft.id ? '/' + draft.id : ''), draft.id ? 'PATCH' : 'POST', { ...draft, deleted })); }
    catch (e) { setError(message(e)); }
    finally { setPending(false); }
  }
  async function loadHistory() {
    try { setHistory(await api<Note[]>('/notes/' + draft.id + '/history')); }
    catch (e) { setError(message(e)); }
  }
  function cancel() {
    if (!pending && (draft.title === initial.title && draft.body === initial.body || window.confirm('放弃本次未保存的笔记编辑？'))) close();
  }
  return <Modal title={draft.id ? '编辑笔记' : '新建笔记'} subtitle={draft.paperId ? '固定来源 · 原 PDF 第 ' + draft.page + ' 页' : undefined} close={cancel}>
    <form className="form" onSubmit={e => { e.preventDefault(); void submit(); }}>
      {draft.quote && <blockquote>{draft.quote}</blockquote>}
      <label>标题<input required value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })}/></label>
      <label>笔记内容<textarea rows={9} value={draft.body} onChange={e => setDraft({ ...draft, body: e.target.value })} placeholder="支持 Markdown 文本"/></label>
      {error && <p className="error" role="alert">{error}</p>}
      {history && <div className="history-list">{history.length ? history.map(item => <button type="button" key={item.revision}
        onClick={() => setDraft({ ...draft, title: item.title, body: item.body })}>第 {item.revision} 版 · {item.title}</button>) : '暂无历史版本'}</div>}
      <div className="form-actions">
        {draft.id && <><button className="quiet" type="button" onClick={() => void loadHistory()}><History size={16}/>历史</button>
          <button className="quiet" type="button" onClick={() => { if (draft.deleted || window.confirm('移入笔记回收站？')) void submit(!draft.deleted); }}>{draft.deleted ? '恢复' : '移入回收站'}</button></>}
        <button className="primary" type="submit" disabled={pending}>保存笔记</button>
      </div>
    </form>
  </Modal>;
}

export function WordEditor({ initial, close, save }: { initial: Word; close: () => void; save: (n: Word) => void }) {
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  async function submit() {
    setPending(true);
    try {
      save(await (initial.id
        ? api<Word>('/words/'+initial.id+'/meaning','PUT',{meaning:draft.meaning,revision:initial.revision})
        : api<Word>('/words','POST',draft)));
    }
    catch (e) { setError(message(e)); }
    finally { setPending(false); }
  }
  return <Modal guardDraft title={initial.id?"补充释义":"收录生词"} subtitle={draft.paperId ? '原 PDF 第 ' + draft.page + ' 页' : undefined} close={() => { if (!pending) close(); }}>
    <form className="form" onSubmit={e => { e.preventDefault(); void submit(); }}>
      <label>词条<input required readOnly={Boolean(initial.id)} value={draft.term} onChange={e => setDraft({ ...draft, term: e.target.value })}/></label>
      <label>释义<textarea rows={4} value={draft.meaning} onChange={e => setDraft({ ...draft, meaning: e.target.value })}/></label>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="form-actions"><button className="primary" disabled={pending} type="submit">{initial.id?"保存释义":"保存生词"}</button></div>
    </form>
  </Modal>;
}

export function Notes({ notes, edit, create, source, report }: { notes: Note[]; edit: (n: Note) => void; create: () => void; source: (id: string, page: number) => void; report: (s: string) => void }) {
  const [trash, setTrash] = useState(false);
  const [query, setQuery] = useState('');
  const [kind,setKind]=useState<'all'|'paper'|'independent'>('all');
  const rows = notes.filter(n => n.deleted === trash && (kind==='all'||Boolean(n.paperId)===(kind==='paper')) &&
    [n.title,n.body,n.quote].some(text=>text.toLowerCase().includes(query.trim().toLowerCase())))
    .toSorted((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
  return <div className="workspace-page">
    <header className="page-heading"><div><p className="section-label">阅读与研究</p><h1>笔记中心</h1><p>保存独立想法，也可以从笔记回到论文原页。</p></div><button className="primary" onClick={create}><Plus size={17}/>新建笔记</button></header>
    <div className="library-bar"><div className="segmented"><button aria-pressed={!trash} onClick={() => setTrash(false)}>笔记</button><button aria-pressed={trash} onClick={() => setTrash(true)}>回收站</button></div><div className="agenda-search">
      <input className="plain-search" aria-label="搜索笔记" placeholder="搜索标题、正文和摘录" value={query} onChange={e => setQuery(e.target.value)}/>
      <select aria-label="笔记来源" value={kind} onChange={e=>setKind(e.target.value as typeof kind)}>
        <option value="all">所有来源</option><option value="paper">论文笔记</option><option value="independent">独立笔记</option>
      </select></div></div>
    {rows.length ? <div className="notes-list">{rows.map(n => <article className="note-card" key={n.id}>
      <button className="note-title" onClick={() => edit(n)}>{n.title}</button><p>{n.body || n.quote || '空笔记'}</p>
      <small className="quiet-text">{n.updatedAt&&'更新于 '+new Date(n.updatedAt).toLocaleDateString('zh-CN')}</small>
      <div>{n.paperId && <button className="quiet" onClick={() => source(n.paperId,n.page)}><BookOpen size={15}/>原文第 {n.page} 页</button>}
        <button className="quiet" onClick={() => void window.desktop.saveMarkdown(n.title, '# ' + n.title + '\n\n' + (n.quote ? '> ' + n.quote + '\n\n' : '') + n.body).catch(e => report(message(e)))}><Download size={15}/>导出</button></div>
    </article>)}</div> : <Empty title={trash ? '笔记回收站为空' : '没有匹配的笔记'} detail="可以单独新建笔记，也可以在论文原页选中文字后记录。"/>}
  </div>;
}


export function Words({words,create,edit,source,reviewed,report,startReview=false}:{words:Word[];create:()=>void;edit:(word:Word)=>void;source:(id:string,page:number)=>void;reviewed:(v:Word)=>void;report:(s:string)=>void;startReview?:boolean}){
 const[review,setReview]=useState(startReview),[revealed,setRevealed]=useState<string|null>(null),[query,setQuery]=useState(''),[letter,setLetter]=useState(''),[choice,setChoice]=useState(''),[busy,setBusy]=useState(false),[reviewedCount,setReviewedCount]=useState(0),[repeat,setRepeat]=useState<string[]>([]);const reviewArea=useRef<HTMLElement>(null);
 const [onlyUnfilled,setOnlyUnfilled]=useState(false);
 const unfilled=words.filter(word=>!word.meaning.trim()).length;
 const order=new Map(repeat.map((id,index)=>[id,index]));const due=words.filter(v=>v.meaning.trim()&&Date.parse(v.dueAt)<=Date.now()).toSorted((a,b)=>(order.get(a.id)??-1)-(order.get(b.id)??-1)||a.dueAt.localeCompare(b.dueAt)||a.id.localeCompare(b.id));const current=due[0];
 const rows=words.filter(v=>(!onlyUnfilled||!v.meaning.trim())&&(!letter||v.term.toUpperCase().startsWith(letter))&&[v.term,v.meaning,v.quote].some(t=>t.toLowerCase().includes(query.trim().toLowerCase()))).toSorted((a,b)=>a.term.localeCompare(b.term));
 const selected=rows.find(v=>v.id===choice)||rows[0],letters=Array.from(new Set(words.map(w=>w.term.charAt(0).toUpperCase()).filter(c=>/^[A-Z]$/.test(c)))).sort();
 async function rate(word:Word,known:boolean){if(busy)return;setBusy(true);try{reviewed(await api<Word>('/words/'+word.id,'PATCH',{known,revision:word.revision}));if(known)setReviewedCount(n=>n+1);else setRepeat(items=>[...items.filter(id=>id!==word.id),word.id]);setRevealed(null);reviewArea.current?.focus()}catch(e){report(message(e))}finally{setBusy(false)}}
 useEffect(()=>{if(review)reviewArea.current?.focus()},[review]);
 return <div className={'workspace-page words-page'+(review?' review-mode':'')}><header className="page-heading"><div><p className="section-label">学习与生活</p><h1>生词与复习</h1><p>把读到的词，慢慢变熟。</p></div><DeskArt kind="words"/><button className="primary" onClick={create}><Plus size={17}/>收录生词</button></header>
 <div className="library-bar"><div className="segmented"><button aria-pressed={!review&&!onlyUnfilled} onClick={()=>{setReview(false);setOnlyUnfilled(false)}}>词表</button>{unfilled>0&&<button aria-pressed={!review&&onlyUnfilled} onClick={()=>{setReview(false);setOnlyUnfilled(true);setLetter('');setQuery('')}}>待补释义 {unfilled}</button>}<button aria-pressed={review} onClick={()=>setReview(true)}>待复习 {due.length}</button></div>{!review&&<input aria-label="搜索生词" placeholder="搜索词条、释义或摘录" value={query} onChange={e=>setQuery(e.target.value)}/>}</div>
 {review?<section ref={reviewArea} tabIndex={0} className="word-review" aria-label="生词复习卡" onKeyDown={e=>{if(!current||busy||e.altKey||e.ctrlKey||e.metaKey||e.repeat||e.target!==e.currentTarget)return;if(e.key===' '&&revealed!==current.id){e.preventDefault();setRevealed(current.id)}if(revealed===current.id&&(e.key==='1'||e.key==='2')){e.preventDefault();void rate(current,e.key==='2')}}}>
 <div className="review-session"><span>今日复习</span><p role="status">本次记住 {reviewedCount} 个 · 待复习 {due.length} 个</p><span className="paper-tab">学术词卡</span></div>
 {current?<><div className="flashcard"><h2>{current.term}</h2>{revealed===current.id?<><p className="word-definition">{current.meaning||'尚未填写释义'}</p>{current.quote&&<blockquote>{current.quote}</blockquote>}{current.paperId&&<button className="quiet" onClick={()=>source(current.paperId,current.page)}><BookOpen size={15}/>原文第 {current.page} 页</button>}</>:<div className="recall-prompt"><p>先想一想，它在原文里是什么意思？</p><button className="secondary" onClick={()=>{setRevealed(current.id);reviewArea.current?.focus()}}>显示释义 <kbd>空格</kbd></button></div>}</div>
 {revealed===current.id&&<div className="word-actions"><button className="secondary" disabled={busy} onClick={()=>void rate(current,false)}>再复习 <kbd>1</kbd></button><button className="primary" disabled={busy} onClick={()=>void rate(current,true)}>记住了 · {Math.min(365,Math.max(1,current.interval*2))} 天后 <kbd>2</kbd></button></div>}</>:<div className="review-finished"><DeskArt kind="words"/><h2>今天没有到期词条</h2><p>这次已记住 {reviewedCount} 个，晚些时候再来看看。</p><button className="secondary" onClick={()=>setReview(false)}>回到词表</button></div>}
 </section>:<><div className="alphabet-index" aria-label="词条字母索引"><button aria-pressed={!letter} onClick={()=>setLetter('')}>全部 {words.length}</button>{letters.map(c=><button key={c} aria-pressed={letter===c} onClick={()=>setLetter(c)}>{c}</button>)}</div>
 {rows.length?<div className="word-workspace"><section className="word-index" aria-label="词条清单">{rows.map(v=><button key={v.id} className="word-row" aria-current={v.id===selected?.id?'true':undefined} onClick={()=>setChoice(v.id)}><strong>{v.term}</strong><span>{v.meaning||'尚未填写释义'}</span><small>{!v.meaning.trim()?'待补释义':Date.parse(v.dueAt)<=Date.now()?'已到期':new Date(v.dueAt).toLocaleDateString('zh-CN')+' 到期'}</small></button>)}</section>
 {selected&&<article className="dictionary-card"><span className="paper-tab">词条与原文</span><h2>{selected.term}</h2><p className="word-definition">{selected.meaning||'尚未填写释义'}</p><button className="secondary" onClick={()=>edit(selected)}>{selected.meaning.trim()?'编辑释义':'补充释义'}</button>{selected.quote&&<blockquote>{selected.quote}</blockquote>}<div className="dictionary-source">{selected.paperId?<button className="quiet" onClick={()=>source(selected.paperId,selected.page)}><BookOpen size={15}/>原文第 {selected.page} 页</button>:<span>手动收录</span>}<small>复习间隔 · {selected.interval} 天</small></div><p className="quiet-text">释义来自已保存词条；原文出处始终保留。</p></article>}</div>:<Empty title={query||letter?'没有匹配的生词':'还没有生词'} detail="在论文里选中词语，即可连同来源一起保存。"/>}</>}
 </div>
}
