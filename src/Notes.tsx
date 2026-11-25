import {DeskArt} from './Journal';
import { BookOpen, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api, message, type Word } from './api';
import { Empty, Modal } from './ui';

export const blankWord: Word = { id: '', term: '', meaning: '', paperId: '', page: 0, quote: '', dueAt: '', interval: 0, revision: 0 };

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
