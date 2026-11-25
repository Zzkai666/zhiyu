import {useEffect,useLayoutEffect,useRef,useState,type CSSProperties} from 'react';
import {Bookmark,Highlighter,Underline,StickyNote,Type,SquareDashed,PenLine,Ellipsis,X} from 'lucide-react';
import {createPortal} from 'react-dom';
import type {Mark} from './api';
import type {MarkDraft} from './PDFAnnotations';
import {colors} from './ReaderMarkTools';
const names={bookmark:'书签',highlight:'高亮文本',underline:'下划线文本',note:'笔记注释',text:'新增文字',area:'区域标注',ink:'绘图'};
const icons={bookmark:Bookmark,highlight:Highlighter,underline:Underline,note:StickyNote,text:Type,area:SquareDashed,ink:PenLine};
type Props={initial:MarkDraft;point?:{x:number;y:number};close?:()=>void;locate?:()=>void;
 save:(mark:MarkDraft)=>Promise<Mark>;remove?:(mark:MarkDraft)=>Promise<void>;crop?:()=>void;createTask?:(mark:MarkDraft)=>void};
export function AnnotationCard({initial,point,close,locate,save,remove,crop,createTask}:Props){
 const [draft,setDraft]=useState(initial),[baseline,setBaseline]=useState(initial),[menu,setMenu]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false);
 const root=useRef<HTMLFormElement>(null),more=useRef<HTMLButtonElement>(null),[position,setPosition]=useState(point||{x:0,y:0});
 const options=useRef<HTMLDivElement>(null),[menuPoint,setMenuPoint]=useState({x:0,y:0});
 const dirty=JSON.stringify(draft)!==JSON.stringify(baseline),Icon=icons[draft.kind];
 useEffect(()=>{if(!dirty&&initial.revision!==baseline.revision){setDraft(initial);setBaseline(initial)}},[initial]);
 const dismiss=()=>{if(!busy&&(!dirty||window.confirm('放弃这次未保存的批注修改？')))close?.()};
 useLayoutEffect(()=>{
  if(!point||!root.current)return;const box=root.current.getBoundingClientRect();
  setPosition({x:Math.max(10,Math.min(point.x,innerWidth-box.width-10)),y:Math.max(10,Math.min(point.y,innerHeight-box.height-10))});
 },[point,menu,draft.kind]);
 useLayoutEffect(()=>{if(!menu||!more.current||!options.current)return;const anchor=more.current.getBoundingClientRect(),box=options.current.getBoundingClientRect();setMenuPoint({x:Math.max(10,Math.min(innerWidth-box.width-10,anchor.right+8+box.width<=innerWidth-10?anchor.right+8:anchor.left-box.width-8)),y:Math.max(10,Math.min(anchor.top,innerHeight-box.height-10))});options.current.querySelector<HTMLButtonElement>('button')?.focus()},[menu]);
 useEffect(()=>{
  if(!point)return;
  const down=(e:PointerEvent)=>{if(root.current&&!root.current.contains(e.target as Node)&&!options.current?.contains(e.target as Node)&&!(e.target as Element).closest('[role="dialog"]'))dismiss()};
  document.addEventListener('pointerdown',down);return()=>document.removeEventListener('pointerdown',down);
 },[point,dirty,busy]);
 async function commit(value=draft){
  if(busy)return;setBusy(true);setError('');setSaved(false);
  try{const next=await save(value);setDraft(next);setBaseline(next);setSaved(true);return next}
  catch(err){setError(err instanceof Error?err.message:String(err))}
  finally{setBusy(false)}
 }
 return <form ref={root} className={'annotation-card'+(point?' annotation-popover':'')} aria-label={point?'标注评论':'标注卡片'}
  data-annotation-card={initial.id||'new'} data-kind={draft.kind} data-dirty={dirty} data-busy={busy}
  style={{'--annotation-tone':colors[draft.color][1],...(point?{left:position.x,top:position.y}:{})} as CSSProperties}
  onSubmit={e=>{e.preventDefault();void commit()}}
  onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();if(menu){setMenu(false);more.current?.focus()}else dismiss()}}}>
  <header className="annotation-card-head"><Icon size={16}/><button type="button" className="annotation-page" disabled={!locate} onClick={locate}>{names[draft.kind]} · 第 {draft.page} 页</button>
   <button ref={more} type="button" className="icon annotation-more" aria-label="标注更多操作" aria-haspopup="menu" aria-expanded={menu} onClick={()=>setMenu(!menu)}><Ellipsis size={18}/></button>
   {close&&<button type="button" className="icon" aria-label="关闭标注评论" disabled={busy} onClick={dismiss}><X size={15}/></button>}
  </header>
  {menu&&createPortal(<div ref={options} className="annotation-options" style={{left:menuPoint.x,top:menuPoint.y}} role="menu" aria-label="标注更多操作" onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();setMenu(false);more.current?.focus()}if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();const items=Array.from(options.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')||[]),index=items.indexOf(document.activeElement as HTMLButtonElement);items[(index+(e.key==='ArrowDown'?1:items.length-1))%items.length]?.focus()}}} onClick={e=>e.stopPropagation()}>
   <div className="annotation-colors">{Object.entries(colors).map(([id,[label,tone]])=><button type="button" role="menuitemradio" aria-checked={draft.color===id} key={id} disabled={busy}
    onClick={()=>{setMenu(false);void commit({...draft,color:id as Mark['color']})}}><i style={{background:tone}}/>{label}{draft.color===id&&<span>✓</span>}</button>)}</div>
   {draft.kind==='text'&&<label>文字字号<input aria-label="标注文字字号" type="number" min="8" max="48" value={draft.size||14} onChange={e=>setDraft({...draft,size:Number(e.target.value)})}/></label>}
   {draft.kind==='ink'&&<label>绘图线宽<input aria-label="绘图线宽" type="range" min="1" max="12" value={draft.width||2} onChange={e=>setDraft({...draft,width:Number(e.target.value)})}/></label>}
   {(draft.kind==='text'||draft.kind==='ink')&&<button type="button" role="menuitem" disabled={busy||!dirty} onClick={()=>{setMenu(false);void commit()}}>应用设置</button>}
   {crop&&<button type="button" role="menuitem" onClick={()=>{setMenu(false);crop()}}>查看区域截图</button>}
   {remove&&draft.id&&<button type="button" role="menuitem" className="danger" disabled={busy} onClick={async()=>{
    if(!window.confirm('删除这条'+names[draft.kind]+'？'))return;setBusy(true);setError('');
    try{await remove(draft);close?.()}catch(err){setError(err instanceof Error?err.message:String(err));setBusy(false)}
   }}>删除标注</button>}
   <button type="button" role="menuitem" onClick={()=>{setMenu(false);more.current?.focus()}}>收起菜单</button>
  </div>,document.body)}
  {draft.quote&&<blockquote>{draft.quote.length>260?draft.quote.slice(0,260)+'…':draft.quote}</blockquote>}
  {draft.kind==='text'&&<label className="annotation-input">文字内容<textarea aria-label="文字内容" autoFocus={Boolean(point&&!draft.id)} rows={2} maxLength={3600} value={draft.content||''} onChange={e=>{setSaved(false);setDraft({...draft,content:e.target.value})}} placeholder="输入要放在 PDF 上的文字…"/></label>}
  <label className="annotation-input">评论<textarea aria-label="评论" autoFocus={Boolean(point&&draft.kind!=='text')} rows={point?3:2} maxLength={3600} value={draft.comment||''}
   onChange={e=>{setSaved(false);setDraft({...draft,comment:e.target.value})}} placeholder="添加评论…"/></label>
  {error&&<p className="error" role="alert">{error}</p>}
  {createTask&&baseline.id&&<button type="button" className="research-create-button" disabled={busy||dirty} title={dirty?'请先保存批注':'保留原文来源，稍后接着处理'} onClick={()=>createTask(baseline)}>创建研究任务</button>}
  <footer><span role="status">{busy?'正在保存…':saved?'已保存':''}</span><button type="submit" className="annotation-save" disabled={busy||(!dirty&&Boolean(draft.id))||draft.kind==='text'&&!draft.content?.trim()}>{draft.id?'保存评论':'保存标注'}</button></footer>
 </form>;
}
