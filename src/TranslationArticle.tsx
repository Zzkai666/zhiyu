import {useEffect,useRef,useState,type ReactNode} from 'react';
import {RefreshCw} from 'lucide-react';
import type {PDFDocumentProxy} from 'pdfjs-dist';
import {cropOriginal} from './ContinuousPDF';
import {InlineMath} from './InlineMath';
import {TranslationText,type ReferenceIndex,type ReferenceTarget} from './ReaderReferences';
import {isParagraph,visualKinds,kinds,type Group,type Located} from './ReadingRegions';

function OriginalCrop({doc,group,locate}:{doc?:PDFDocumentProxy;group:Group;locate:()=>void}){
  const root=useRef<HTMLButtonElement>(null),[url,setURL]=useState(''),[error,setError]=useState(false);
  const region=group.regions[0];
  useEffect(()=>{
    if(!doc||!root.current)return;
    let stopped=false;
    const observer=new IntersectionObserver(entries=>{
      if(!entries.some(entry=>entry.isIntersecting))return;observer.disconnect();
      void cropOriginal(doc,region.page,region.rect).then(value=>{if(!stopped)setURL(value)}).catch(()=>{if(!stopped)setError(true)});
    },{rootMargin:'250px'});
    observer.observe(root.current);return()=>{stopped=true;observer.disconnect()};
  },[doc,region.id]);
  return <button ref={root} className="article-crop" onClick={locate} aria-label={'定位'+kinds[region.kind]+'原文'}>
    {url?<img src={url} alt={kinds[region.kind]+' · 原文第 '+region.page+' 页'}/>:<span>{error?'裁图暂不可用，点击查看原页':'正在载入'+kinds[region.kind]+'…'}</span>}
  </button>;
}
type Props={doc?:PDFDocumentProxy;groups:Group[];active:string;index:ReferenceIndex;matching:boolean;actions:(group:Group)=>ReactNode;repairing:boolean;picked:ReadonlySet<string>;
  locate:(group:Group,region?:Located['region'])=>void;reference:(items:ReferenceTarget[],label:string)=>void;
  choose:(group:Group)=>void;
  retranslate:(group:Group)=>void;retranslating:string;translationBusy:boolean};
export function TranslationArticle({doc,groups,active,index,matching,actions,repairing,picked,locate,reference,choose,retranslate,retranslating,translationBusy}:Props){
  return <article className="translation-article" aria-label="论文译文">
    {groups.map(group=>{
      const region=group.regions[0],kind=region.kind,visual=visualKinds.has(kind),current=active===group.id,canJoin=group.regions.every(r=>isParagraph(r.kind))&&group.translate;
      const Tag=kind==='title'?'h1':kind==='heading'?'h2':'p';
      const activate=()=>repairing?canJoin&&choose(group):locate(group);
      return <section key={group.id} className="article-block" data-card={group.id} data-translated={Boolean(group.translation)} data-active={current&&matching&&!repairing} data-picked={repairing&&picked.has(group.id)} data-kind={kind}>
        {visual?<OriginalCrop doc={doc} group={group} locate={()=>{if(!repairing)locate(group)}}/>:
          <Tag className={'translation-text'+(group.translate&&!group.translation?' awaiting-translation':'')}
            tabIndex={0} onClick={e=>{
              if((e.target as Element).closest('button,a'))return;
              if(window.getSelection()?.isCollapsed!==false)activate();
            }} onKeyDown={e=>{if((e.key==='Enter'||repairing&&e.key===' ')&&e.target===e.currentTarget){e.preventDefault();activate()}}}>
            {group.translation&&!repairing?<TranslationText text={group.translation} index={index} locate={reference}/>:<InlineMath text={group.translation||group.text}/>}
          </Tag>}
        {group.translate&&group.translation&&!repairing&&<button type="button" className="article-retranslate"
          aria-label={retranslating===group.id?'正在重翻此段':'重翻此段'} title="重翻此段"
          aria-busy={retranslating===group.id} disabled={translationBusy&&retranslating!==group.id}
          aria-disabled={retranslating===group.id||undefined}
          onClick={()=>{if(!translationBusy)retranslate(group)}}><RefreshCw size={14}/></button>}
        {actions(group)}
      </section>;
    })}
  </article>;
}
