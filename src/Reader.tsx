import {usePaperJobs,startPaperTranslation,retryPaperParse,controlPaperJob} from './PaperJobs';
import {publishReadingSummary} from './PaperTaskCenter';
import {TranslationSettings,readTranslationChoice} from './TranslationSettings';
import './reader-article.css';
import './reader-comfort.css';
import './reading-040.css';
import './reading-041.css';
import './region-review.css';
import './paper-export.css';
import {ResearchTask,type ResearchSource} from './Companion';
import {PaperExport} from './PaperExport';
import {AnnotationCard} from './AnnotationCard';
import {focusZoom} from './ReaderFocus';
import { ArrowLeft, ArrowRight, ArrowLeftRight, Bookmark, Type, Highlighter, Link2, List, Minus, MoreHorizontal, PanelRight, Plus, ScanLine, Underline } from 'lucide-react';
import { useEffect,useLayoutEffect,useMemo,useRef,useState,type CSSProperties,type RefObject } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { api,message,type Mark,type Paper,type Rect,type Selection,type Word } from './api';
import { captureExcerpt, selectedTerm } from './WordCapture';
import { cropOriginal,PageSurface,useVisiblePages } from './ContinuousPDF';
import { loadPDF } from './pdf';
import {recordPageCount} from './PaperPreview';
import { isParagraph,kinds,regionName,visualKinds,type Group,type Kind,type Located,type ReadingPlan } from './ReadingRegions';
import { ReadingColorSettings,readingColorStyle,useReadingColors } from './ReadingColors';
import { TranslationArticle } from './TranslationArticle';
import { translateStream } from './TranslationStream';
import { ReaderDivider,maxPane,minPane } from './ReaderDivider';
import { InlineMath } from './InlineMath';
import { Modal } from './ui';
import { ReviewQueue } from './ReviewQueue';
import { reviewChains, type ReviewChain } from './ReviewChains';
import { RegionCorrection, RegionPopover, type RegionAction } from './RegionCorrection';
import {DrawingTools,SelectionPalette,type DrawingTool,type MarkDraft} from './PDFAnnotations';
import { MarkColor } from './ReaderMarkTools';
import { referenceIndex,type PDFDestination,type ReferenceTarget } from './ReaderReferences';
import { loadAppearance,ReaderAppearance,saveAppearance,translationStyle,type Appearance } from './ReaderAppearance';

type Props={paper:Paper;start:number;backLabel:string;leave:()=>void;update:(paper:Paper)=>void;
  addWord:(draft:Word)=>void;report:(text:string)=>void;reviewRequest?:number;source?:ResearchSource&{token:number};prepare?:RefObject<(()=>Promise<void>)|null>};
type Outline=Awaited<ReturnType<PDFDocumentProxy['getOutline']>>;
type Tab='regions'|'review'|'marks';
type ReviewItem=ReviewChain;
type ReadingLocation={page:number;top:number;left:number;panelTop:number;active:string;part:string;width:number;x:number;y:number;target:{page:number;rect:Rect}|null};
const noPlan:ReadingPlan={pages:[],revision:0,groups:[],review:[],otherReview:[],confirmedReview:[]};
const noRegions:Located[]=[];
const noMarks:Mark[]=[];

function revealCard(root:HTMLDivElement,id:string,inset=12) {
  const card=root.querySelector<HTMLElement>('[data-card="'+CSS.escape(id)+'"]');
  if(!card)return;
  const box=card.getBoundingClientRect(),view=root.getBoundingClientRect();
  if(box.top>=view.top+inset&&box.bottom<=view.bottom-12)return;
  const center=(root.clientHeight-inset-12-box.height)/2;
  root.scrollTop+=box.top-view.top-inset-Math.max(0,center);
}
const markNames={bookmark:'书签',highlight:'高亮',underline:'下划线',note:'笔记注释',text:'新增文字',area:'区域标注',ink:'绘图'};


function OutlineTree({items,go}:{items:Outline;go:(dest:Outline[number]['dest'])=>void}){
  return <ul className="outline-tree">{items.map((item,index)=><li key={index}>
    <button disabled={!item.dest} onClick={()=>go(item.dest)}>{item.title}</button>
    {item.items.length>0&&<OutlineTree items={item.items} go={go}/>}
  </li>)}</ul>;
}

export function Reader({paper,start,backLabel,leave,update,addWord,report,reviewRequest,source,prepare}:Props) {
  const [researchMark,setResearchMark]=useState<Mark>();
  const [researchSource,setResearchSource]=useState<ResearchSource>();
  const [doc,setDoc]=useState<PDFDocumentProxy>();
  const [ratio,setRatio]=useState(1.414);
  const [width,setWidth]=useState(900);
  const [dpr,setDpr]=useState(devicePixelRatio);
  const [zoom,setZoom]=useState(paper.zoom);
  const [page,setPage]=useState(start);
  const [pageInput,setPageInput]=useState(String(start));
  const [outline,setOutline]=useState<Outline>([]);
  const [outlineOpen,setOutlineOpen]=useState(false);
  const [bilingual,setBilingual]=useState(()=>!reviewRequest&&localStorage.getItem('rdnext.reader.mode')==='bilingual');
  const [preparation,setPreparation]=useState(Boolean(reviewRequest));
  const [pane,setPane]=useState(Boolean(reviewRequest));
  const [leftSide,setLeftSide]=useState(()=>localStorage.getItem('rdnext.reader.translation-side')==='left');
  const [appearance,setAppearance]=useState(loadAppearance);
  useEffect(()=>{const sync=()=>setAppearance(loadAppearance());window.addEventListener('rdnext:reader-appearance',sync);window.addEventListener('storage',sync);return()=>{window.removeEventListener('rdnext:reader-appearance',sync);window.removeEventListener('storage',sync)}},[]);
  const [appearanceOpen,setAppearanceOpen]=useState(false);
  const [exportOpen,setExportOpen]=useState(false);
  const [colorsOpen,setColorsOpen]=useState(false);
  const readingColors=useReadingColors();
  const [splitRatio,setSplitRatio]=useState(()=>{
    const stored=Number(localStorage.getItem('rdnext.reader.split-ratio'));
    return stored>=.2&&stored<=.8?stored:.5;
  });
  const [splitSpace,setSplitSpace]=useState(0);
  const readerBody=useRef<HTMLDivElement>(null);
  const [paneWidth]=useState(()=>Math.max(minPane,Math.min(maxPane,Number(localStorage.getItem('rdnext.reader.width'))||365)));
  const [showFrames,setShowFrames]=useState(Boolean(reviewRequest));
  const [sourceFocus,setSourceFocus]=useState(false);
  const [repairIDs,setRepairIDs]=useState<string[]|null>(null);
  const [repairError,setRepairError]=useState('');
  const [repairBusy,setRepairBusy]=useState(false);
  const repairSet=useMemo(()=>new Set(repairIDs||[]),[repairIDs]);
  const [tab,setTab]=useState<Tab>(reviewRequest?'review':'marks');
  useEffect(()=>{
    if(reviewRequest){
      setBilingual(false);setPreparation(true);setPane(true);setShowFrames(true);setTab('review');
    }
  },[reviewRequest]);
  const [plan,setPlan]=useState<ReadingPlan>(noPlan);
  const [layoutError,setLayoutError]=useState('');
  const [parseWarning,setParseWarning]=useState('');
  const {jobs:paperJobs}=usePaperJobs();
  const parseJob=paperJobs.find(j=>j.paperId===paper.id&&j.stage==='parse');
  const translationJob=paperJobs.find(j=>j.paperId===paper.id&&j.stage==='translate');
  const [analyzing,setAnalyzing]=useState(true);
  const [active,setActive]=useState('');
  const [focusPart,setFocusPart]=useState('');
  const [joining,setJoining]=useState(false);
  const [picked,setPicked]=useState<Located[]>([]);
  const [changeBusy,setChangeBusy]=useState(false);
  const [selection,setSelection]=useState<{quote:Selection;page:number;point:{x:number;y:number}}|null>(null);
  const capturePending=useRef(false);
  const [savingWord,setSavingWord]=useState(false);
  const wordTerm=selection?selectedTerm(selection.quote.text):'';
  const [drawTool,setDrawTool]=useState<DrawingTool>(null);
  const [annotation,setAnnotation]=useState<{mark:MarkDraft;point:{x:number;y:number};token:number}|null>(null);
  const annotationTicket=useRef(0);
  const [annotationImage,setAnnotationImage]=useState<{url:string;page:number}|null>(null);
  const [marks,setMarks]=useState<Mark[]>([]);
  const [markTool,setMarkTool]=useState<'highlight'|'underline'|null>(null);
  const [reviewScope,setReviewScope]=useState<'suggested'|'labels'|'more'|'confirmed'>('suggested');
  const [regionKindFilter,setRegionKindFilter]=useState<Kind|'all'>('all');
  const [regionReveal,setRegionReveal]=useState<{id:string}|null>(null);
  const regionPanel=useRef<HTMLDivElement>(null);
  useLayoutEffect(()=>{
    const root=regionPanel.current;
    if(root&&regionReveal)revealCard(root,regionReveal.id,40);
  },[regionReveal,tab]);
  const [reviewFocus,setReviewFocus]=useState<ReviewItem|null>(null);
  const [correctionID,setCorrectionID]=useState<string|null>(null);
  const [priorGroup,setPriorGroup]=useState<Group|null>(null);
  const [references,setReferences]=useState<{label:string;items:ReferenceTarget[]}|null>(null);
  const [referenceTarget,setReferenceTarget]=useState<{page:number;rect:Rect}|null>(null);
  const [returnStack,setReturnStack]=useState<ReadingLocation[]>([]);
  const [forwardStack,setForwardStack]=useState<ReadingLocation[]>([]);
  const [color,setColor]=useState<Mark['color']>('amber');
  const [error,setError]=useState('');
  const [crop,setCrop]=useState<{url:string;item:Located}|null>(null);
  const [config,setConfig]=useState(false);
  const [moreOpen,setMoreOpen]=useState(false);
  const moreButton=useRef<HTMLButtonElement>(null);
  const [translationChoice,setTranslationChoice]=useState(readTranslationChoice);
  const {model}=translationChoice;
  const [localTranslating,setTranslating]=useState(false);
  const [retranslating,setRetranslating]=useState('');
  const translating=localTranslating||Boolean(retranslating)||Boolean(translationJob&&(translationJob.state==='queued'||translationJob.state==='running'));
  const [translationError,setTranslationError]=useState('');
  
  const scroll=useRef<HTMLDivElement>(null);
  const panel=useRef<HTMLDivElement>(null);
  const articleTop=useRef(0);
  const pageRef=useRef(start);
  const saveTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const saved=useRef('');
  const positionChain=useRef(Promise.resolve());
  const positionError=useRef<unknown>(null);
  const requestVersion=useRef(0);
  const scrollFrame=useRef(0);
  const initialized=useRef(false);
  const pendingFocus=useRef<{page:number;rect:Rect}|null>(null);
  const zoomAnchor=useRef<{page:number;x:number;y:number;clientX:number;clientY:number}|null>(null);
  const zoomLive=useRef(zoom);
  const measuredWidth=useRef(width);
  const wheelFrame=useRef(0);
  const wheelZoom=useRef<number|null>(null);
  const translationAbort=useRef<AbortController|null>(null);
  const alive=useRef(true);
  useEffect(()=>{const changed=()=>{if(!window.getSelection()||window.getSelection()!.isCollapsed)setSelection(null)};const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){setDrawTool(null);setMarkTool(null);setSelection(null);window.getSelection()?.removeAllRanges()}};document.addEventListener('selectionchange',changed);window.addEventListener('keydown',escape);return()=>{document.removeEventListener('selectionchange',changed);window.removeEventListener('keydown',escape)}},[]);
  const base='/papers/'+paper.id;
  const visible=useVisiblePages(scroll,doc?.numPages??0);
  const pageWidth=Math.max(265,Math.min(1000,width-40))*zoom/100;
  const total=doc?.numPages??0;
  const pickedRegions=useMemo(()=>new Set(joining?picked.flatMap(item=>item.group.regions.map(region=>region.id)):
    tab==='review'&&reviewFocus?reviewFocus.parts:[]),[picked,joining,tab,reviewFocus]);
  const refs=useMemo(()=>referenceIndex(plan.groups),[plan.groups]);
  const pendingRegions=useMemo(()=>{
    const pending=new Set<string>();
    for(const item of [...plan.review,...plan.otherReview]){
      pending.add(item.first);
      if(item.second)pending.add(item.second);
    }
    return pending;
  },[plan.review,plan.otherReview]);
  const pickedGroups=useMemo(()=>new Set(picked.map(item=>item.group.id)),[picked]);

  
  const bookmark=marks.find(mark=>mark.kind==='bookmark'&&mark.page===page);
  const groupsByPage=useMemo(()=>{
    const byPage=new Map<number,Located[]>();
    for(const group of plan.groups) group.regions.forEach((region,part)=>{
      if(!byPage.has(region.page))byPage.set(region.page,[]);
      byPage.get(region.page)!.push({region,group,part});
    });
    return byPage;
  },[plan]);
  const regionLookup=useMemo(()=>new Map([...groupsByPage.values()].flat().map(item=>[item.region.id,item])),[groupsByPage]);
  const marksByPage=useMemo(()=>{
    const map=new Map<number,Mark[]>();
    for(const mark of marks) {if(!map.has(mark.page))map.set(mark.page,[]);map.get(mark.page)!.push(mark)}
    return map;
  },[marks]);

  useLayoutEffect(()=>{
    const root=panel.current;if(!root||!bilingual)return;
    root.scrollTop=articleTop.current;
    const remember=()=>{articleTop.current=root.scrollTop};root.addEventListener('scroll',remember);
    return()=>root.removeEventListener('scroll',remember);
  },[bilingual]);

  function applyPlan(next:ReadingPlan,ticket:number) {
    if(alive.current&&ticket===requestVersion.current){setPlan(next);publishReadingSummary(paper.id,next)}
  }
  async function refreshPlan() {
    const ticket=++requestVersion.current;
    const value=await api<ReadingPlan>(base+'/reading');
    applyPlan(value,ticket);return value;
  }
  useEffect(()=>{
    alive.current=true;
    const task=loadPDF(paper.id);
    void task.promise.then(async value=>{
      const first=await value.getPage(1);
      if(!alive.current)return;
      const viewport=first.getViewport({scale:1});
      setRatio(viewport.height/viewport.width);setDoc(value);void recordPageCount(paper,value.numPages).catch(()=>{});
      try{const items=await value.getOutline();if(alive.current)setOutline(items||[])}catch{/* optional */}
    }).catch(err=>{if(alive.current)setError(message(err))});
    void api<Mark[]>(base+'/marks').then(value=>{if(alive.current)setMarks(value)}).catch(err=>{if(alive.current)report(message(err))});
    return ()=>{alive.current=false;translationAbort.current?.abort();void task.destroy().catch(()=>{});if(saveTimer.current)clearTimeout(saveTimer.current);cancelAnimationFrame(scrollFrame.current)};
  },[paper.id]);
  useEffect(()=>{
    const root=scroll.current;if(!root)return;
    const measure=()=>{
      if(root.clientWidth!==measuredWidth.current){
        if(!pendingFocus.current&&!zoomAnchor.current&&initialized.current)rememberZoomAnchor();
        measuredWidth.current=root.clientWidth;setWidth(root.clientWidth);
      }
      setDpr(devicePixelRatio);
    };
    const observer=new ResizeObserver(measure);observer.observe(root);window.addEventListener('resize',measure);measure();
    return ()=>{observer.disconnect();window.removeEventListener('resize',measure)};
  },[]);
  useEffect(()=>{localStorage.setItem('rdnext.reader.width',String(paneWidth))},[paneWidth]);
  useEffect(()=>{localStorage.setItem('rdnext.reader.split-ratio',String(splitRatio))},[splitRatio]);
  useEffect(()=>{
    const root=readerBody.current;if(!root)return;
    const measure=()=>{
      const outline=root.querySelector<HTMLElement>(':scope > .outline');
      const divider=root.querySelector<HTMLElement>(':scope > .reader-divider');
      const auxiliary=root.querySelector<HTMLElement>(':scope > .reader-auxiliary');
      setSplitSpace(root.clientWidth-(outline?.offsetWidth||0)-(divider?.offsetWidth||7)-(auxiliary&&getComputedStyle(auxiliary).position!=='absolute'?auxiliary.offsetWidth:0));
    };
    const observer=new ResizeObserver(measure);
    observer.observe(root);measure();
    return()=>observer.disconnect();
  },[bilingual,pane,outlineOpen]);

  useEffect(()=>{
    const active=!parseJob||parseJob.state==='queued'||parseJob.state==='running';
    setAnalyzing(active);
    setLayoutError(parseJob&&(parseJob.state==='failed'||parseJob.state==='paused')?parseJob.message:'');
    setParseWarning(parseJob?.message.includes('轻量')?parseJob.message:'');
    void refreshPlan().catch(e=>{if(alive.current)report(message(e))});
  },[parseJob?.revision,translationJob?.revision]);
  useEffect(()=>{
    if(!translationJob||repairBusy)return;
    setTranslationError(translationJob.state==='failed'?translationJob.message:'');
  },[translationJob?.revision,repairBusy]);

  function pageElement(n:number){return scroll.current?.querySelector<HTMLElement>('[data-pdf-page="'+n+'"]')}
  function scrollToElement(el:HTMLElement,align:number) {
    const root=scroll.current;if(!root)return;
    root.scrollTop+=el.getBoundingClientRect().top-root.getBoundingClientRect().top-align;
  }
  useEffect(()=>{
    if(!prepare)return;
    const flush=async()=>{if(saveTimer.current)clearTimeout(saveTimer.current);persist(pageRef.current,zoomLive.current);await positionChain.current;if(positionError.current)throw positionError.current};
    prepare.current=flush;return()=>{if(prepare.current===flush)prepare.current=null};
  },[prepare]);
  function persist(n:number,z:number) {
    const key=n+'/'+z;
    if(saved.current===key)return;
    saved.current=key;positionError.current=null;
    positionChain.current=positionChain.current.then(async()=>{
      try{
        const savedPaper=await api<Paper>(base+'/position','PUT',{page:n,zoom:z});
        if(alive.current)update(savedPaper);
      }catch(err){positionError.current=err;if(saved.current===key)saved.current='';if(alive.current)report(message(err))}
    });
  }
  function schedule(n:number,z:number) {
    if(saveTimer.current)clearTimeout(saveTimer.current);
    saveTimer.current=setTimeout(()=>persist(n,z),250);
  }
  function go(n:number) {
    if(!Number.isInteger(n)||n<1||n>total){setPageInput(String(pageRef.current));return}
    const target=pageElement(n);
    if(target)scrollToElement(target,12);
    pageRef.current=n;setPage(n);setPageInput(String(n));setSelection(null);schedule(n,zoom);
  }
  useLayoutEffect(()=>{
    if(!doc||initialized.current)return;
    initialized.current=true;go(Math.max(1,Math.min(start,doc.numPages)));
  },[doc]);
  useEffect(()=>{
    if(!doc||!source)return;
    const id=requestAnimationFrame(()=>{if(source.rects[0]){pendingFocus.current={page:source.page,rect:source.rects[0]};placeFocus();setReferenceTarget({page:source.page,rect:source.rects[0]});}else go(source.page)});
    return()=>cancelAnimationFrame(id);
  },[doc,source?.token]);
  useLayoutEffect(()=>{
    const anchor=zoomAnchor.current;
    if(!anchor)return;
    zoomAnchor.current=null;
    const root=scroll.current,target=pageElement(anchor.page)?.querySelector<HTMLElement>(".paper-surface");
    if(root&&target){
      const box=target.getBoundingClientRect();
      root.scrollTop+=box.top+anchor.y*box.height-anchor.clientY;
      root.scrollLeft+=box.left+anchor.x*box.width-anchor.clientX;
    }
    schedule(pageRef.current,zoom);
  },[width,pageWidth,zoom,bilingual,pane]);

  function onScroll() {
    if(selection){const value=window.getSelection();const box=value?.rangeCount?value.getRangeAt(0).getBoundingClientRect():null;const view=scroll.current?.getBoundingClientRect();
      if(box&&view&&box.bottom>=view.top&&box.top<=view.bottom)setSelection(current=>current?{...current,point:{x:box.left,y:box.bottom+8}}:null);else setSelection(null);
    }
    if(scrollFrame.current)return;
    scrollFrame.current=requestAnimationFrame(()=>{
      scrollFrame.current=0;
      const root=scroll.current;if(!root||!total)return;
      const line=root.getBoundingClientRect().top+Math.min(165,root.clientHeight*.27);
      let lo=1,hi=total;
      while(lo<hi){
        const mid=Math.floor((lo+hi+1)/2),el=pageElement(mid);
        if(el&&el.getBoundingClientRect().top<=line)lo=mid;else hi=mid-1;
      }
      if(lo!==pageRef.current){pageRef.current=lo;setPage(lo);setPageInput(String(lo));schedule(lo,zoom)}
    });
  }
  function rememberZoomAnchor(clientX?:number,clientY?:number,element?:Element|null) {
    const root=scroll.current;
    const pageNode=element?.closest<HTMLElement>('[data-pdf-page]')||pageElement(pageRef.current);
    const sheet=pageNode?.querySelector<HTMLElement>('.paper-surface');
    if(!root||!sheet||!pageNode)return;
    const view=root.getBoundingClientRect(),box=sheet.getBoundingClientRect();
    const x=clientX??view.left+view.width/2,y=clientY??view.top+Math.min(120,view.height*.2);
    zoomAnchor.current={page:Number(pageNode.dataset.pdfPage),x:(x-box.left)/box.width,y:(y-box.top)/box.height,clientX:x,clientY:y};
  }
  function resizeZoom(next:number,point?:{x:number;y:number;element:Element|null}) {
    next=Math.max(20,Math.min(400,Math.round(next)));
    if(next===zoomLive.current)return;
    if(!zoomAnchor.current)rememberZoomAnchor(point?.x,point?.y,point?.element);
    zoomLive.current=next;setZoom(next);
  }
  useEffect(()=>{
    const root=scroll.current;if(!root)return;
    const wheel=(event:WheelEvent)=>{
      if(!event.ctrlKey&&!event.metaKey){wheelZoom.current=null;return}
      event.preventDefault();
      if(!event.deltaY)return;
      const delta=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?root.clientHeight:1);
      const base=wheelZoom.current??zoomLive.current;
      wheelZoom.current=Math.max(20,Math.min(400,base*Math.exp(-Math.max(-160,Math.min(160,delta))*.0008)));
      if(wheelFrame.current)return;
      const point={x:event.clientX,y:event.clientY,element:event.target instanceof Element?event.target:null};
      wheelFrame.current=requestAnimationFrame(()=>{
        wheelFrame.current=0;
        if(wheelZoom.current!==null)resizeZoom(wheelZoom.current,point);
      });
    };
    root.addEventListener('wheel',wheel,{passive:false});
    const reset=()=>{wheelZoom.current=null};
    const release=(e:KeyboardEvent)=>{if(e.key==='Control'||e.key==='Meta'){if(wheelFrame.current)requestAnimationFrame(reset);else reset()}};
    window.addEventListener('keyup',release);
    return ()=>{root.removeEventListener('wheel',wheel);window.removeEventListener('keyup',release);cancelAnimationFrame(wheelFrame.current)};
  },[]);
  function changeMode(next:boolean) {
    rememberZoomAnchor();
    setBilingual(next);setPane(false);setShowFrames(false);setPreparation(false);setSourceFocus(false);if(!repairBusy)setRepairIDs(null);
    setTab('marks');setJoining(false);setPicked([]);setReviewFocus(null);
    localStorage.setItem('rdnext.reader.mode',next?'bilingual':'original');
  }
  function changeAppearance(next:Appearance) {
    const root=panel.current,top=root?.getBoundingClientRect().top??0;
    const anchor=root?Array.from(root.querySelectorAll<HTMLElement>('.article-block')).find(el=>el.getBoundingClientRect().bottom>top):undefined;
    const offset=anchor?anchor.getBoundingClientRect().top-top:0;
    setAppearance(next);saveAppearance(next);
    if(anchor&&root)requestAnimationFrame(()=>{root.scrollTop+=anchor.getBoundingClientRect().top-root.getBoundingClientRect().top-offset});
  }
  function swapSides() {
    setLeftSide(!leftSide);
    localStorage.setItem('rdnext.reader.translation-side',leftSide?'right':'left');
  }

  async function goDest(dest:Outline[number]['dest']) {
    if(!doc||!dest)return;
    if(innerWidth<=1050)setOutlineOpen(false);
    try{
      const value=typeof dest==='string'?await doc.getDestination(dest):dest;
      const first=value?.[0];
      if(first!=null){const n=typeof first==='number'?first+1:await doc.getPageIndex(first)+1;rememberReference();go(n)}
    }catch(err){report(message(err))}
  }
  function captureLocation():ReadingLocation|null {
    const root=scroll.current,sheet=pageElement(pageRef.current)?.querySelector<HTMLElement>('.paper-surface');
    if(!root||!sheet)return null;
    const box=sheet.getBoundingClientRect(),view=root.getBoundingClientRect();
    return {page:pageRef.current,top:root.scrollTop,left:root.scrollLeft,panelTop:panel.current?.scrollTop??0,
      active,part:focusPart,width:pageWidth,x:(view.left-box.left)/box.width,y:(view.top-box.top)/box.height,target:referenceTarget};
  }
  function rememberReference() {
    const location=captureLocation();if(!location)return;
    setReturnStack(stack=>[...stack.slice(-39),location]);setForwardStack([]);
  }
  function restoreLocation(location:ReadingLocation) {
    const root=scroll.current;if(!root)return;
    const sheet=pageElement(location.page)?.querySelector<HTMLElement>('.paper-surface');
    if(sheet&&Math.abs(location.width-pageWidth)>.5){
      const box=sheet.getBoundingClientRect(),view=root.getBoundingClientRect();
      root.scrollTop+=box.top+location.y*box.height-view.top;
      root.scrollLeft+=box.left+location.x*box.width-view.left;
    }else root.scrollTo(location.left,location.top);
    if(panel.current)panel.current.scrollTop=location.panelTop;
    pageRef.current=location.page;setPage(location.page);setPageInput(String(location.page));schedule(location.page,zoom);
    setActive(location.active);setFocusPart(location.part);setReferenceTarget(location.target);setSourceFocus(Boolean(location.active));
  }
  function returnToReading() {
    const location=returnStack.at(-1),current=captureLocation();if(!location||!current)return;
    setReturnStack(stack=>stack.slice(0,-1));setForwardStack(stack=>[...stack.slice(-39),current]);restoreLocation(location);
  }
  function forwardToReading() {
    const location=forwardStack.at(-1),current=captureLocation();if(!location||!current)return;
    setForwardStack(stack=>stack.slice(0,-1));setReturnStack(stack=>[...stack.slice(-39),current]);restoreLocation(location);
  }
  function openReview(tab: 'review' | 'regions' = 'review') {
    rememberZoomAnchor();
    setBilingual(false);setCorrectionID(null);setDrawTool(null);setMarkTool(null);setSelection(null);
    setRepairIDs(null);setPreparation(true);setShowFrames(true);setJoining(false);setPicked([]);
    setPane(true);setTab(tab);setReviewScope('suggested');setRegionKindFilter('all');setReviewFocus(null);
  }
  function closeReview() {
    rememberZoomAnchor();
    setPane(false);setPreparation(false);setShowFrames(false);setJoining(false);setPicked([]);setReviewFocus(null);setCorrectionID(null);
  }
  function toggleAnnotations() {
    const close=pane&&tab==='marks';
    closeReview();
    if(!close){setTab('marks');setPane(true)}
  }
  function openExport() {
    if(document.querySelector('.annotation-card[data-dirty="true"],.annotation-card[data-busy="true"]')){
      report('请先保存正在编辑的批注，再导出论文');return;
    }
    setMoreOpen(false);setExportOpen(true);
  }
  function revealReference(n:number,rect:Rect) {
    const root=scroll.current,sheet=pageElement(n)?.querySelector<HTMLElement>('.paper-surface');
    if(!root||!sheet)return;
    const bounds=sheet.getBoundingClientRect(),view=root.getBoundingClientRect();
    root.scrollTop+=bounds.top+rect.y*bounds.height-view.top-Math.min(110,root.clientHeight*.2);
    const left=bounds.left+rect.x*bounds.width,right=left+rect.w*bounds.width;
    if(left<view.left||right>view.right)root.scrollLeft+=left-view.left-(root.clientWidth-rect.w*bounds.width)/2;
    setReferenceTarget({page:n,rect});setSelection(null);
  }
  async function followPDF(dest:PDFDestination) {
    if(!doc)return;
    try {
      const value=typeof dest==='string'?await doc.getDestination(dest):dest;
      const first=value?.[0];
      if(first==null)return;
      const index=typeof first==='number'?first:await doc.getPageIndex(first as Parameters<PDFDocumentProxy['getPageIndex']>[0]);
      const destination=await doc.getPage(index+1);
      if(!alive.current)return;
      const viewport=destination.getViewport({scale:1});
      const mode=(value?.[1] as {name?:string}|undefined)?.name;
      const x=mode==='XYZ'||mode==='FitR'||mode==='FitV'?value?.[2]:null;
      const y=mode==='XYZ'?value?.[3]:mode==='FitR'?value?.[5]:mode==='FitH'||mode==='FitBH'?value?.[2]:null;
      const [left,top]=viewport.convertToViewportPoint(typeof x==='number'?x:destination.view[0],
        typeof y==='number'?y:destination.view[3]);
      const height=Math.max(0,Math.min(.985,top/viewport.height));
      const position=Math.max(0,Math.min(.985,left/viewport.width));
      rememberReference();
      const named=typeof dest==='string'?dest.match(/^(figure|table|equation)\.(\d+(?:\.\d+)?)$/i):null;
      const indexed=named?refs.get((named[1].toLowerCase()==='equation'?'formula':named[1].toLowerCase())+':'+named[2]):null;
      if(indexed?.item.region.page===index+1){revealReference(index+1,indexed.rect);return}
      const area=groupsByPage.get(index+1)?.filter(({region})=>{
        const rect=region.rect;
        return height>=rect.y-.025&&height<=rect.y+rect.h+.012&&(x==null||position>=rect.x-.025&&position<=rect.x+rect.w+.012);
      }).sort((a,b)=>{
        if(typeof dest==='string'&&dest.startsWith('cite.')&&a.region.kind!==b.region.kind){
          if(a.region.kind==='reference')return -1;
          if(b.region.kind==='reference')return 1;
        }
        return Math.abs(a.region.rect.y-height)-Math.abs(b.region.rect.y-height);
      })[0];
      revealReference(index+1,area?.region.rect??{x:position,y:height,w:Math.min(.88,1-position),h:.012});
    }catch(err){report(message(err))}
  }
  function followReference(items:ReferenceTarget[],label:string) {
    if(items.length>1){setReferences({items,label});return}
    const target=items[0];if(!target)return;
    rememberReference();setReferences(null);revealReference(target.item.region.page,target.rect);
  }
  function focusReview(item:ReviewItem,part=item.first) {
    const located=regionLookup.get(part);if(!located)return;
    setReviewFocus(item);setPane(true);setTab('review');setPreparation(true);setShowFrames(true);
    focusSource(located.group,located.region);
  }
  function focusRight(id:string) {
    requestAnimationFrame(()=>{if(panel.current)revealCard(panel.current,id)});
  }
  function revealRegion(group:Group) {
    if(regionKindFilter!=='all'&&!group.regions.some(region=>region.kind===regionKindFilter))setRegionKindFilter('all');
    setRegionReveal({id:group.id});
  }
  function fitSource(region:Located['region']) {
    const root=scroll.current;if(!root)return;
    const next=focusZoom(region.rect,{width:root.clientWidth,height:root.clientHeight,base:Math.max(265,Math.min(1000,width-40)),aspect:ratio,zoom});
    pendingFocus.current={page:region.page,rect:region.rect};zoomAnchor.current=null;
    if(next!==zoom){zoomLive.current=next;setZoom(next)}
    requestAnimationFrame(()=>placeFocus());
  }
  function placeFocus(){
    const target=pendingFocus.current,root=scroll.current;if(!target||!root)return;
    const sheet=pageElement(target.page)?.querySelector<HTMLElement>('.paper-surface');if(!sheet)return;
    const bounds=sheet.getBoundingClientRect(),view=root.getBoundingClientRect(),rect=target.rect;
    root.scrollTop+=bounds.top+rect.y*bounds.height-view.top-Math.max(22,(root.clientHeight-rect.h*bounds.height)/2);
    root.scrollLeft+=bounds.left+rect.x*bounds.width-view.left-Math.max(22,(root.clientWidth-rect.w*bounds.width)/2);
    pageRef.current=target.page;setPage(target.page);setPageInput(String(target.page));schedule(target.page,zoomLive.current);
    pendingFocus.current=null;
  }
  useLayoutEffect(()=>{if(pendingFocus.current)placeFocus()},[zoom,pageWidth,width]);
  function focusSource(group:Group,region=group.regions[0]) {
    if(!preparation)rememberReference();
    setActive(group.id);setFocusPart(region.id);setSourceFocus(true);
    fitSource(region);setReferenceTarget(null);
  }
  function openCorrection(item:Located) {
    setActive(item.group.id);setFocusPart(item.region.id);setCorrectionID(item.region.id);
    setDrawTool(null);setMarkTool(null);setSelection(null);
  }
  function select(item:Located) {
    if(joining){
      if(!isParagraph(item.region.kind)){report('请选择正文段落或摘要区块');return}
      setPicked(previous=>previous.some(p=>p.group.id===item.group.id)?
        previous.filter(p=>p.group.id!==item.group.id):[...previous,item]);
      return;
    }
    if(repairIDs){chooseRepair(item.group);return}
    setActive(item.group.id);setFocusPart(item.region.id);setSourceFocus(true);setReferenceTarget(null);
    if(preparation&&showFrames){
      setTab('regions');setPane(true);revealRegion(item.group);openCorrection(item);
    }else{
      fitSource(item.region);
      focusRight(item.group.id);
    }
  }
  function chooseRepair(group:Group) {
    if(repairBusy)return;
    if(!group.translate||!group.regions.every(r=>isParagraph(r.kind))){report('请选择需要翻译的正文或摘要');return}
    setRepairError('');
    setRepairIDs(current=>{
      if(!current)return [group.id];
      if(current.includes(group.id))return current.filter(id=>id!==group.id);
      if(current.length>=20){report('一次最多连接 20 段');return current}
      return [...current,group.id];
    });
  }
  function beginRepair(group?:Group) {
    if(translating||analyzing||changeBusy)return;
    if(!bilingual)changeMode(true);
    setPane(false);setPreparation(false);setShowFrames(false);setJoining(false);setPicked([]);setMarkTool(null);
    const selected=group??plan.groups.find(g=>g.id===active&&g.regions.every(r=>isParagraph(r.kind)));
    setRepairIDs(selected?[selected.id]:[]);setRepairError('');setSourceFocus(false);
  }
  async function repairParagraphs() {
    if(!repairIDs||repairIDs.length<2||repairBusy||translating)return;
    if(!model){configure();return}
    const selected=[...repairIDs],revision=plan.revision,abort=new AbortController();
    translationAbort.current=abort;setRepairBusy(true);setTranslating(true);setRepairError('');
    const members=new Set(plan.groups.filter(g=>selected.includes(g.id)).flatMap(g=>g.regions.map(r=>r.id)));
    let applied=false;
    const adoptSaved=(next:ReadingPlan)=>{
      const joined=next.groups.find(g=>g.translation&&g.regions.length===members.size&&g.regions.every(r=>members.has(r.id)));
      if(!joined)return false;
      applied=true;setRepairIDs(null);setRepairError('');setActive(joined.id);setFocusPart(joined.regions[0].id);setSourceFocus(true);focusRight(joined.id);
      return true;
    };
    try{
      await translateStream(base+'/reading/merge-translate',{groups:selected,revision,...translationChoice},abort.signal,async event=>{
        if(event.kind!=='done'||!alive.current)return;
        if(!adoptSaved(await refreshPlan()))throw new Error('尚未读取到完整保存结果，请重新打开论文核对');
      });
    }catch(err){
      if(alive.current){
        try{
          const latest=await refreshPlan();
          if(!adoptSaved(latest)){
            setRepairIDs(current=>current?.filter(id=>latest.groups.some(g=>g.id===id))??null);
            if(!abort.signal.aborted)setRepairError(message(err));
          }
        }catch{if(!abort.signal.aborted)setRepairError(message(err))}
      }
    }finally{
      if(alive.current){
        setRepairBusy(false);setTranslating(false);
        if(!applied){

          if(abort.signal.aborted)setRepairError('已停止，原段落和译文保持。可以重新连接并翻译。');
        }
      }
      translationAbort.current=null;
    }
  }
  async function edit(payload:RegionAction):Promise<boolean> {
    if(changeBusy||translating)return false;
    setChangeBusy(true);
    try{
      await api(base+'/reading','PATCH',{...payload,revision:plan.revision});
      const next=await refreshPlan();
      const target=next.groups.find(g=>g.regions.some(r=>r.id===payload.first));
      if(target){
        setActive(target.id);setFocusPart(payload.first);
        if(tab==='regions')revealRegion(target);
        else focusRight(target.id);
      }
      if(tab==='review')setReviewFocus(null);
      setPicked([]);setJoining(false);
      return true;
    }catch(err){report(message(err));void refreshPlan().catch(()=>{});return false}
    finally{setChangeBusy(false)}
  }
  async function captureSelectedWord() {
    const target=selection;
    if(!target||!wordTerm||capturePending.current)return;
    capturePending.current=true;
    setSavingWord(true);
    const quote=captureExcerpt(target.quote,wordTerm,groupsByPage.get(target.page)||[]);
    try {
      const saved=await api<{word:Word;existing:boolean}>('/words/capture','POST',{
        term:wordTerm,quote,paperId:paper.id,page:target.page,
      });
      addWord(saved.word);
      setSelection(current=>current===target?null:current);
      report(saved.existing?'这个词已从此处收录':'已收录「'+wordTerm+'」');
    } catch(error) {
      report('收词未完成：'+message(error));
    } finally {
      capturePending.current=false;
      if(alive.current)setSavingWord(false);
    }
  }

  async function toggleMark(kind:Mark['kind'],target=kind==='bookmark'?null:selection,chosenColor=color) {
    if(kind!=='bookmark'&&!target)return;
    try{
      if(kind==='bookmark'&&bookmark){await api(base+'/marks/'+bookmark.id,'DELETE');setMarks(prev=>prev.filter(item=>item.id!==bookmark.id));return}
      const mark=await api<Mark>(base+'/marks','POST',{page:target?.page??page,kind,color:chosenColor,quote:target?.quote.text??'',rects:target?.quote.rects??[]});
      setMarks(prev=>[...prev,mark]);setSelection(null);window.getSelection()?.removeAllRanges();
      if(kind!=='bookmark'&&target&&!markTool)openAnnotation(mark,target.point);
      report('已保存'+markNames[kind]);
    }catch(err){report(message(err))}
  }
  function markSelection(quote:Selection|null,n:number) {
    const box=window.getSelection()?.rangeCount?window.getSelection()!.getRangeAt(0).getBoundingClientRect():null;
    const target=quote?{quote,page:n,point:{x:box?.left??60,y:(box?.bottom??80)+8}}:null;
    setSelection(target);
    if(markTool&&target){void toggleMark(markTool,target)}
  }
  async function saveAnnotation(draft:MarkDraft) {
    const next=await api<Mark>(base+'/marks'+(draft.id?'/'+draft.id:''),draft.id?'PUT':'POST',draft);
    setMarks(current=>[...current.filter(mark=>mark.id!==next.id),next]);
    setAnnotation(current=>current&&(current.mark.id===draft.id||!current.mark.id&&!draft.id&&current.mark.kind===draft.kind)?{...current,mark:next}:current);return next;
  }
  function openAnnotation(mark:MarkDraft,point:{x:number;y:number}){
    setSelection(null);window.getSelection()?.removeAllRanges();setAnnotation({mark,point,token:++annotationTicket.current});
  }
  function createAnnotation(draft:MarkDraft,point:{x:number;y:number}){
    setDrawTool(null);
    if(draft.kind==='note'||draft.kind==='text')openAnnotation(draft,point);
    else void saveAnnotation(draft).then(mark=>openAnnotation(mark,point)).catch(err=>report(message(err)));
  }
  async function deleteAnnotation(mark:MarkDraft){
    if(!mark.id)return;await api(base+'/marks/'+mark.id,'DELETE');
    setMarks(current=>current.filter(item=>item.id!==mark.id));setAnnotation(current=>current?.mark.id===mark.id?null:current);
  }
  async function annotationCrop(mark:MarkDraft){
    if(!doc)return;
    try{setAnnotationImage({url:await cropOriginal(doc,mark.page,mark.rects[0]),page:mark.page})}catch(err){report(message(err))}
  }
  function locateAnnotation(mark:MarkDraft){
    rememberReference();if(mark.rects[0])revealReference(mark.page,mark.rects[0]);else go(mark.page);
  }
  function useMark(kind:'highlight'|'underline') {
    setDrawTool(null);
    if(selection){setMarkTool(null);void toggleMark(kind);return}
    setMarkTool(markTool===kind?null:kind);
    setJoining(false);setPicked([]);
  }
  async function showCrop(item:Located) {
    if(!doc)return;
    try{const url=await cropOriginal(doc,item.region.page,item.region.rect);if(alive.current)setCrop({url,item})}
    catch(err){report(message(err))}
  }
  function configure(){setConfig(true)}
  async function retranslate(group:Group) {
    if(translating||changeBusy||analyzing||repairIDs)return;
    if(!model){configure();return}
    const controller=new AbortController();
    translationAbort.current=controller;
    setRetranslating(group.id);
    try{
      const ticket=++requestVersion.current;
      const updated=await api<ReadingPlan>(base+'/reading/translate','POST',
        {groups:[group.id],replace:true,revision:plan.revision,...translationChoice},controller.signal);
      if(alive.current&&requestVersion.current===ticket)applyPlan(updated,ticket);
      else if(alive.current)await refreshPlan();
      if(alive.current)report('此段译文已更新');
    }catch(error){
      if(alive.current&&!controller.signal.aborted)report('重翻未完成，原译文保留。'+message(error));
    }finally{
      translationAbort.current=null;
      if(alive.current)setRetranslating('');
    }
  }
  async function translate(scope:'paper'|'page'|'one',one?:Group) {
    if(repairIDs||translating||analyzing||Boolean(layoutError)||scope==='paper'&&plan.review.length)return;
    if(!model){configure();return}
    const groups=(scope==='one'&&one?[one]:plan.groups.filter(g=>scope==='paper'||g.regions.some(r=>r.page===page)))
      .filter(g=>g.translate&&!g.translation);
    if(!groups.length){setTranslationError('这个范围内没有待翻译段落。');return}
    if(!bilingual)changeMode(true);
    setPreparation(false);setShowFrames(false);setJoining(false);setPicked([]);setSourceFocus(false);setPane(false);setTranslationError('');
    try{await startPaperTranslation(paper.id,{scope,page,group:one?.id,...translationChoice,revision:plan.revision})}
    catch(e){setTranslationError(message(e))}
  }  async function exit(){
    if(repairBusy&&!window.confirm('返回会停止当前连接翻译，已有译文保留。仍要返回吗？'))return;
    translationAbort.current?.abort();
    if(saveTimer.current)clearTimeout(saveTimer.current);
    persist(pageRef.current,zoom);await positionChain.current;leave();
  }

  const [labelReview, optionalReview]=useMemo(()=>[plan.otherReview.filter(item=>item.category==='label'),plan.otherReview.filter(item=>item.category!=='label')],[plan.otherReview]);
  const reviewItems=useMemo(()=>reviewChains(reviewScope==='labels'?labelReview:reviewScope==='more'?optionalReview:reviewScope==='confirmed'?plan.confirmedReview:plan.review),[labelReview,optionalReview,plan,reviewScope]);
  const hasUntranslated=plan.groups.some(group=>group.translate&&!group.translation);
  const canReview=!analyzing&&!layoutError&&plan.pages.length>0;
  const reviewOpen=pane&&preparation;
  const resumeTranslation=translationJob&&(translationJob.state==='paused'||translationJob.state==='failed')?translationJob:undefined;
  const needsReview=canReview&&plan.review.length>0&&(hasUntranslated||resumeTranslation);
  const pendingSeams=plan.review.filter(item=>item.second).length;
  const reviewSummary=reviewScope==='labels'?labelReview.length+' 项可疑标签':reviewScope==='more'?optionalReview.length+' 项可选检查':
    reviewScope==='confirmed'?plan.confirmedReview.length+' 项已确认':plan.review.length?'必核对 '+plan.review.length+' 项':'必核对已完成';
  const correcting=preparation&&showFrames&&correctionID?regionLookup.get(correctionID):undefined;
  const joiningAnchor=joining?picked.at(-1):undefined;
  const reviewActionsBusy=changeBusy||translating||analyzing;
  const translationGroups=plan.groups.filter(g=>g.translate||visualKinds.has(g.regions[0].kind)||g.regions[0].kind==='author');
  const regionPages=useMemo(()=>{
    if(tab!=='regions')return [];
    const byFirstPage=new Map<number,Group[]>();
    for(const group of plan.groups){
      if(regionKindFilter!=='all'&&!group.regions.some(region=>region.kind===regionKindFilter))continue;
      const firstPage=group.regions[0].page;
      const groups=byFirstPage.get(firstPage)??[];
      groups.push(group);
      byFirstPage.set(firstPage,groups);
    }
    return [...byFirstPage].sort(([a],[b])=>a-b);
  },[plan.groups,regionKindFilter,tab]);
  return <div className="reader continuous-reader" data-busy={localTranslating||changeBusy||repairBusy} style={readingColorStyle(readingColors)} onKeyDown={e=>{
    if(e.key==='Escape'&&repairIDs&&!repairBusy){setRepairIDs(null);setRepairError('')}
    if(e.altKey&&e.key==='ArrowLeft'&&returnStack.length){e.preventDefault();returnToReading()}
    if(e.altKey&&e.key==='ArrowRight'&&forwardStack.length){e.preventDefault();forwardToReading()}
  }}>
    <header className="reader-head">
      <button className="icon" aria-label={backLabel} title={backLabel} onClick={()=>void exit()}><ArrowLeft size={19}/></button>
      <div className="reader-title"><small>论文阅读</small><h1 title={paper.title}>{paper.title}</h1></div>
      <div className="reader-head-actions">
        <div className="reader-mode" aria-label="阅读模式">
          <button aria-pressed={!bilingual} onClick={()=>changeMode(false)}>原文</button>
          <button aria-pressed={bilingual} onClick={()=>changeMode(true)}>双语对照</button>
        </div>
        <button className="icon" title="目录" aria-label="目录" aria-pressed={outlineOpen} onClick={()=>setOutlineOpen(!outlineOpen)}><List size={19}/></button>
        <button className="icon" title="标注侧栏" aria-label="阅读侧栏" aria-pressed={pane&&tab==='marks'} onClick={toggleAnnotations}><PanelRight size={19}/></button>
        <div className="reader-more" onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget))setMoreOpen(false)}} onKeyDown={event=>{
          if(event.key==='Escape'){event.stopPropagation();setMoreOpen(false);moreButton.current?.focus()}
        }}>
          <button ref={moreButton} className="icon" aria-label="更多" title="更多" aria-expanded={moreOpen} aria-controls={moreOpen?'reader-more-actions':undefined} onClick={()=>setMoreOpen(!moreOpen)}><MoreHorizontal size={20}/></button>
          {moreOpen&&<div id="reader-more-actions" className="reader-more-actions" role="group" aria-label="更多阅读操作">
            <button disabled={!doc||translating||changeBusy} onClick={openExport}>导出论文</button>
            <button onClick={()=>{setMoreOpen(false);configure()}}>翻译设置</button>
            <button onClick={()=>{setMoreOpen(false);setColorsOpen(true)}}>阅读颜色设置</button>
            <button disabled={!canReview||translating||repairBusy} onClick={()=>{setMoreOpen(false);openReview()}}>核对解析</button>
            <button disabled={!canReview||translating||changeBusy||repairIDs!==null} onClick={()=>{setMoreOpen(false);void translate('page')}}>翻译本页</button>
            <button disabled={!canReview||translating||changeBusy||repairBusy} onClick={()=>{setMoreOpen(false);beginRepair()}}>连接断段</button>
          </div>}
        </div>
      </div>
    </header>
    <div className="reader-tools">
      <form onSubmit={e=>{e.preventDefault();rememberReference();go(Number(pageInput))}}><input inputMode="numeric" aria-label="页码" value={pageInput} onChange={e=>setPageInput(e.target.value)}/></form>
      <span className="total">/ {total||'–'}</span><span className="tools-divider"/>
      <button className="icon" aria-label="缩小" title="缩小" disabled={zoom<=20} onClick={()=>resizeZoom(zoom-10)}><Minus size={17}/></button>
      <button className="zoom-value" title="重置倍率 · Ctrl + 滚轮可缩放" onClick={()=>resizeZoom(100)}>{zoom}%</button>
      <button className="icon" aria-label="放大" title="放大" disabled={zoom>=400} onClick={()=>resizeZoom(zoom+10)}><Plus size={17}/></button>
      <span className="tools-divider"/>
      <button className="icon" aria-label={bookmark?'移除书签':'添加书签'} title="书签" disabled={!doc} onClick={()=>void toggleMark('bookmark')}><Bookmark size={17} fill={bookmark?'currentColor':'none'}/></button>
      <button className="icon" aria-label="高亮选区" title="高亮选区，也可先开启工具再选中文字" disabled={!doc}
        aria-pressed={markTool==='highlight'} onMouseDown={e=>e.preventDefault()} onClick={()=>useMark('highlight')}><Highlighter size={17}/></button>
      <button className="icon" aria-label="下划线" title="下划线，也可先开启工具再选中文字" disabled={!doc}
        aria-pressed={markTool==='underline'} onMouseDown={e=>e.preventDefault()} onClick={()=>useMark('underline')}><Underline size={16}/></button>
      <MarkColor value={color} change={setColor}/>
      <DrawingTools value={drawTool} selecting={!markTool} change={tool=>{setDrawTool(tool);setMarkTool(null);setSelection(null)}}/>
      <div className="reader-current-action">
        {translationJob&&translating&&!repairBusy&&<>
          <span role="status">{translationJob.total>0?'翻译 '+translationJob.done+' / '+translationJob.total+' 段':'正在翻译'}</span>
          <button className="quiet" onClick={()=>void controlPaperJob(translationJob,'pause').catch(error=>report(message(error)))}>暂停翻译</button>
        </>}
        {!translating&&resumeTranslation&&!needsReview&&canReview&&<button className="secondary" onClick={()=>void controlPaperJob(resumeTranslation,'resume').catch(error=>report(message(error)))}>{resumeTranslation.state==='failed'?'重试翻译':'继续翻译'}</button>}
        {!translating&&!resumeTranslation&&analyzing&&<span role="status">正在解析{parseJob?.total?' '+parseJob.done+' / '+parseJob.total+' 页':''}</span>}
        {!translating&&!analyzing&&layoutError&&<button className="quiet" title={layoutError} onClick={()=>void retryPaperParse(paper.id).catch(error=>report(message(error)))}>继续解析</button>}
        {!translating&&needsReview&&!reviewOpen&&
          <button className="primary" disabled={repairBusy} onClick={()=>openReview()}>核对解析 · {plan.review.length} 项</button>}
        {!translating&&!resumeTranslation&&canReview&&hasUntranslated&&!plan.review.length&&
          <button className="primary" disabled={changeBusy||repairIDs!==null} onClick={()=>void translate('paper')}>翻译全文</button>}
      </div>
    </div>
    {translationError&&<p className="reader-operation-error" role="alert">{translationError}</p>}
    {drawTool&&<div className="mark-mode" role="status">{markNames[drawTool]}工具已开启，按 Esc 或点击选择工具退出。<button className="quiet" onClick={()=>setDrawTool(null)}>退出工具</button></div>}
    {markTool&&<div className="mark-mode" role="status">选中文字后自动添加{markNames[markTool]}<button className="quiet" onClick={()=>setMarkTool(null)}>取消</button></div>}
    {joining&&!joiningAnchor&&<div className="join-banner" role="status">
      <span>点选两块或更多正文，再在原文旁确认连接。</span>
      <button className="quiet" onClick={()=>{setJoining(false);setPicked([])}}>取消连接</button>
    </div>}
    <div ref={readerBody} className="reader-body" style={{'--translation-share':splitRatio,'--original-share':1-splitRatio} as CSSProperties} data-bilingual={bilingual} data-translation-left={bilingual&&leftSide}>
      {outlineOpen&&<aside className="outline"><h2>文档目录</h2>{outline.length?<OutlineTree items={outline} go={dest=>void goDest(dest)}/>:<p>此 PDF 没有内嵌目录。</p>}</aside>}
      <div className="pdf-column"><div className="pdf-scroll continuous-scroll" ref={scroll} tabIndex={0} aria-label="连续滚动 PDF 原文" onScroll={onScroll}
        onKeyDown={e=>{
          if((e.ctrlKey||e.metaKey)&&(e.key==='+'||e.key==='='||e.key==='-')){e.preventDefault();resizeZoom(zoom+(e.key==='-'?-10:10))}
          if(e.key==='Escape'){setMarkTool(null);if(joining){setJoining(false);setPicked([])}}
        }}>
        {error?<p className="reader-error" role="alert">无法打开 PDF。{error}</p>:doc?
          <div className="pdf-stack">{Array.from({length:doc.numPages},(_,i)=>{
            const n=i+1;
            return <PageSurface key={n} doc={doc} number={n} width={pageWidth} ratio={ratio} visible={visible.has(n)||n===start&&visible.size===0} dpr={dpr}
              regions={groupsByPage.get(n)||noRegions} marks={marksByPage.get(n)||noMarks} active={active} picked={repairIDs?new Set(plan.groups.filter(g=>repairSet.has(g.id)).flatMap(g=>g.regions.map(r=>r.id))):pickedRegions}
              joining={joining||repairIDs!==null} showFrames={preparation&&showFrames} reading={bilingual&&!preparation} focus={sourceFocus} select={select} markTool={Boolean(markTool)} refs={refs}
              onMark={openAnnotation} onNativeLink={dest=>void followPDF(dest)} onReference={followReference}
              target={referenceTarget?.page===n?referenceTarget.rect:undefined} onSelection={markSelection}
              drawTool={drawTool} color={color} onCreate={createAnnotation} onEdit={openAnnotation} onMove={mark=>{void saveAnnotation(mark).catch(err=>report(message(err)))}}/>;
          })}</div>:<p className="loading">正在打开原文…</p>}
      </div>
      {(returnStack.length>0||forwardStack.length>0)&&<nav className="pdf-history" aria-label="原文阅读历史">
        <button disabled={!returnStack.length} aria-label="返回阅读位置" title="后退 · Alt + ←" onClick={returnToReading}><ArrowLeft size={16}/>后退</button>
        <span/>
        <button disabled={!forwardStack.length} aria-label="前进阅读位置" title="前进 · Alt + →" onClick={forwardToReading}>前进<ArrowRight size={16}/></button>
      </nav>}
      </div>
      {bilingual&&<><ReaderDivider left={leftSide} width={splitSpace*splitRatio}
        minimum={Math.min(240,splitSpace*.35)} maximum={splitSpace-Math.min(240,splitSpace*.35)}
        reset={()=>setSplitRatio(.5)} resize={next=>{if(splitSpace>0){const minimum=Math.min(240,splitSpace*.35)/splitSpace;setSplitRatio(Math.max(minimum,Math.min(1-minimum,next/splitSpace)))}}}/>
        <section className="translation-pane" id="translation-pane" aria-label="译文阅读区" style={translationStyle(appearance)}>
          <div className="translation-pane-tools">
            <span>译文</span>
            <div>
              <button className="icon" aria-label="交换原文和译文位置" title="交换原文和译文位置" onClick={swapSides}><ArrowLeftRight size={16}/></button>
              <button className="icon" aria-label="译文排版" title="译文排版" onClick={()=>setAppearanceOpen(true)}><Type size={17}/></button>
            </div>
          </div>
          {repairIDs&&<div className="paragraph-repair-bar" role="region" aria-label="连接断段">
            <div><strong>{repairBusy?'正在翻译完整段落…':'已选 '+repairIDs.length+' 段'}</strong><span>点击原文或译文继续选择；只连接选中正文，图表保留。完成前仍可阅读旧译文。</span></div>
            {repairBusy?<button className="secondary" onClick={()=>translationAbort.current?.abort()}>停止连接翻译</button>:<>
              <button className="primary" disabled={repairIDs.length<2||analyzing} onClick={()=>void repairParagraphs()}>连接并翻译完整段落</button>
              <button className="quiet" onClick={()=>{setRepairIDs(null);setRepairError('')}}>取消连接断段</button>
            </>}
            {repairError&&<p className="error" role="alert">{repairError}</p>}
          </div>}
          <div ref={panel} className="reading-content">
            <TranslationArticle doc={doc} groups={translationGroups} active={active} index={refs} locate={focusSource} reference={followReference}
              matching={sourceFocus} repairing={repairIDs!==null} picked={repairSet} choose={chooseRepair}
              retranslate={group=>void retranslate(group)} retranslating={retranslating} translationBusy={translating||analyzing||changeBusy}
              actions={group=>!repairIDs&&sourceFocus&&group.id===active&&(group.regions.length>1||group.translate||group.priorTranslation)?<nav className="reader-source-nav" aria-label="对应原文">
                {group.regions.length>1&&<span>对应原文</span>}{group.regions.length>1&&group.regions.map((source,i)=><button key={source.id} className="source-chip" aria-label={'查看第 '+(i+1)+' 处原文'} aria-pressed={focusPart===source.id}
                  title={'第 '+source.page+' 页 · '+source.text.slice(0,70)} onClick={()=>focusSource(group,source)}>原文 {i+1}</button>)}
                {group.translate&&!group.translation&&<button className="quiet" disabled={analyzing||translating||Boolean(layoutError)} onClick={()=>void translate('one',group)}>翻译此段</button>}
                {group.translate&&group.regions.every(region=>isParagraph(region.kind))&&
                  <button className="quiet" disabled={analyzing||translating||changeBusy} onClick={()=>beginRepair(group)}>连接断段</button>}
                {group.priorTranslation&&<button className="quiet" onClick={()=>setPriorGroup(group)}>查看先前译文</button>}
              </nav>:null}/>
          </div>
        </section></>}
      {pane&&<aside className="reader-auxiliary" id="reading-pane" aria-label="阅读侧栏" style={{'--reader-pane':paneWidth+'px'} as CSSProperties}>
          <div className="reading-tabs">
            {!preparation&&<h2>标注</h2>}
            {preparation&&<>
              <button aria-pressed={tab==='review'} onClick={()=>{setTab('review');setJoining(false);setPicked([])}}>核对解析</button>
              <button aria-pressed={tab==='regions'} onClick={()=>{setTab('regions');setRegionReveal(active?{id:active}:null)}}>解析区块</button>
            </>}
            <button className="icon" title={preparation?'退出核对':'关闭标注'} aria-label="关闭阅读侧栏" onClick={closeReview}>{preparation?<span>退出核对</span>:<span aria-hidden="true">×</span>}</button>
          </div>
          {preparation&&<div className="reader-review-tools">
            <button className="quiet" aria-pressed={showFrames} onClick={()=>{setShowFrames(!showFrames);setJoining(false);setPicked([]);setCorrectionID(null)}}><ScanLine size={15}/>显示解析框</button>
            <button className="quiet" aria-pressed={joining} disabled={translating||changeBusy||analyzing} onClick={()=>{setDrawTool(null);setMarkTool(null);setJoining(!joining);setPicked([]);setShowFrames(true)}}><Link2 size={15}/>{joining?'取消连接':'连接区块'}</button>
          </div>}
          {selection&&<div className="selection-box"><p>{selection.quote.text}</p><div>
            <button className="quiet" disabled={!wordTerm||savingWord} onClick={()=>void captureSelectedWord()}>收录生词</button>
          </div></div>}
          {tab==='regions'&&<div className="reading-status">
            <div><strong>解析区块</strong><small aria-live="polite">{analyzing?'正在解析 · ':''}{plan.pages.length} / {total||'–'} 页</small></div>
            {layoutError&&<p className="error" role="alert">{layoutError} <button className="quiet" onClick={()=>void retryPaperParse(paper.id).catch(e=>report(message(e)))}>继续解析</button></p>}
            {parseWarning&&<p className="quiet-text">{parseWarning}</p>}
          </div>}
          {tab==='review'&&<div className="reading-status review-status">
            <div><strong>{analyzing?'正在解析':reviewSummary}</strong></div>
            {!analyzing&&reviewScope==='suggested'&&pendingSeams>0&&<button className="quiet" disabled={changeBusy||translating} onClick={()=>{
              if(window.confirm('确认保留这 '+pendingSeams+' 处接缝的现有分段？字形和图表疑点会继续保留。'))void edit({action:'review-all',first:''});
            }}>保留其余划分</button>}
          </div>}
          {tab==='review'&&<div className="review-filters" aria-label="核对范围">
            <button aria-pressed={reviewScope==='suggested'} onClick={()=>{setReviewScope('suggested');setReviewFocus(null);setCorrectionID(null)}}>必核对 {plan.review.length}</button>
            <button aria-pressed={reviewScope==='labels'} onClick={()=>{setReviewScope('labels');setReviewFocus(null);setCorrectionID(null)}}>标签 {labelReview.length}</button>
            <button aria-pressed={reviewScope==='more'} onClick={()=>{setReviewScope('more');setReviewFocus(null);setCorrectionID(null)}}>可选检查 {optionalReview.length}</button>
            <button aria-pressed={reviewScope==='confirmed'} onClick={()=>{setReviewScope('confirmed');setReviewFocus(null);setCorrectionID(null)}}>已确认 {plan.confirmedReview.length}</button>
          </div>}
          {tab==='review'&&reviewScope==='more'&&<p className="review-scope-note">
            这些位置可以按需查看，全文翻译可以继续。
          </p>}
          {tab==='review'&&reviewScope==='labels'&&<p className="review-scope-note">检查可疑标签，也可点击 PDF 上的任意框更正。</p>}
          {tab==='regions'&&<div className="region-list-tools">
            <label className="region-category-filter">全文区块类别
              <select value={regionKindFilter} onChange={event=>{
                setRegionReveal(null);setRegionKindFilter(event.target.value as Kind|'all');
                if(regionPanel.current)regionPanel.current.scrollTop=0;
              }}>
                <option value="all">全部类别</option>{Object.entries(kinds).map(([value,label])=><option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <div className="region-legend" aria-label="解析框标记">
              <span data-continued="true">已连接</span>
              <span data-active="true">当前区块</span>{joining&&<span data-picked="true">已点选</span>}
            </div>
          </div>}
          <div key={tab} className={'reading-content'+(tab==='regions'?' region-list':'')} ref={tab==='regions'?regionPanel:undefined}
            aria-label={tab==='regions'?'全文解析区块':undefined} role={tab==='regions'?'region':undefined} tabIndex={tab==='regions'?0:undefined}>
            {tab==='review'&&<ReviewQueue items={reviewItems} located={regionLookup} active={reviewFocus}
              confirmed={reviewScope==='confirmed'} busy={reviewActionsBusy}
              empty={analyzing?'解析完成后可以核对。':reviewScope==='labels'?'没有发现可疑标签。可以点击原文框自行更正。':reviewScope==='more'?'没有可选检查项。':reviewScope==='confirmed'?'还没有确认记录。':'必核对项目已处理，可以翻译全文。'}
              focus={(item,part)=>{setCorrectionID(null);focusReview(item,part)}}
              collapse={()=>{setReviewFocus(null);setCorrectionID(null)}}
              correct={(item,part)=>{focusReview(item,part.region.id);openCorrection(part)}}
              save={edit}/>}
            {tab==='regions'&&(regionPages.length?regionPages.map(([number,groups])=><section key={number} className="region-page" aria-label={'第 '+number+' 页'}>
              <h3>第 {number} 页</h3>
              {groups.map(group=>{
                const first=group.regions[0],kind=first.kind,visual=visualKinds.has(kind);
                const current=group.id===active,continued=group.regions.length>1;
                const needsCheck=group.regions.some(region=>pendingRegions.has(region.id));
                return <article key={group.id} data-card={group.id} data-active={current} className="region-card" data-kind={kind}
                  data-continued={continued} data-picked={joining&&pickedGroups.has(group.id)}>
                  <div className="region-card-head"><span className="region-kind">{group.regions.length>1?'连续段落':kinds[kind]}</span>
                    <span>{group.translate?'需翻译':'无需翻译'}</span>
                    {continued&&<span className="region-state" data-continued="true">{group.auto?'自动连接':'已连接'}</span>}
                    {needsCheck&&<span className="region-state" data-review="true">待核对</span>}
                  </div>
                  {visual?<button className="source-preview" onClick={()=>void showCrop({region:first,group,part:0})}>查看{kinds[kind]}原图</button>:
                    <button className="region-text" onClick={()=>focusSource(group)}><InlineMath text={group.text}/></button>}
                  {group.priorTranslation&&<div className="prior-translation-notice">
                    <p>原文已清除页边文字，可核对先前保存的译文。</p>
                    <button className="quiet" onClick={()=>setPriorGroup(group)}>查看先前译文</button>
                  </div>}
                  <div className="region-parts">
                    {group.regions.map((region,index)=><button key={region.id} className="source-chip" aria-pressed={current&&focusPart===region.id}
                      onClick={()=>joining?select({region,group,part:index}):focusSource(group,region)}>
                      {continued?'原文 '+(index+1)+' · ':''}第 {region.page} 页
                    </button>)}
                    {group.regions.length===1&&<button className="quiet" disabled={reviewActionsBusy} onClick={()=>{focusSource(group,first);openCorrection({region:first,group,part:0})}}>改标签</button>}
                  </div>
                  {current&&<div className="region-edit">
                    {group.regions.length===1&&<label>类别<select value={kind} disabled={changeBusy||translating} onChange={e=>void edit({action:'region',first:first.id,kind:e.target.value as Kind})}>
                      {Object.entries(kinds).map(([value,label])=><option key={value} value={value}>{label}</option>)}
                    </select></label>}
                    {group.text&&!visual&&<label><input type="checkbox" checked={group.translate} disabled={changeBusy||translating}
                      onChange={e=>void edit({action:'region',first:first.id,translate:e.target.checked})}/>需要翻译</label>}
                    {group.regions.length>1&&<button className="quiet" disabled={changeBusy||translating} onClick={()=>void edit({action:'split',first:first.id})}>拆开连接</button>}
                  </div>}
                </article>;
              })}
            </section>):<p className="quiet-text reading-empty">{analyzing&&regionKindFilter==='all'?'已在后台解析，可以返回工作台继续其他事情。':regionKindFilter!=='all'?'全文中暂无此类别的区块。':'全文暂时没有可识别的区块。'}</p>)}
            {tab==='marks'&&<div className="reader-records annotation-records" aria-label="文献标注">{marks.length?marks.map(mark=><AnnotationCard key={mark.id} initial={mark}
              locate={()=>locateAnnotation(mark)} save={saveAnnotation} remove={deleteAnnotation} createTask={mark=>{if(mark.id)setResearchMark({...mark,id:mark.id})}} crop={mark.kind==='area'?()=>void annotationCrop(mark):undefined}/>):<p>选中文字或使用工具栏添加标注，评论会保存在这里。</p>}</div>}
          </div>
        </aside>}
    </div>
    {correcting&&!joining&&<RegionCorrection
      key={correcting.region.id} item={correcting} viewport={scroll}
      suggestedKind={reviewFocus?.first===correcting.region.id?reviewFocus.suggestedKind:undefined}
      disabled={reviewActionsBusy}
      close={()=>setCorrectionID(null)}
      save={edit}
      connect={()=>{setCorrectionID(null);setJoining(true);setPicked([correcting]);setShowFrames(true)}}
    />}
    {joiningAnchor&&<RegionPopover region={joiningAnchor.region.id} viewport={scroll} title="连接区块"
      close={()=>{if(!changeBusy){setJoining(false);setPicked([])}}} busy={changeBusy}>
      <p role="status">已选 {picked.length} 组。点选原文可继续添加或取消。</p>
      <button className="primary" disabled={picked.length<2||reviewActionsBusy}
        onClick={()=>void edit({action:'join',first:picked[0].region.id,selected:picked.map(item=>item.region.id)})}>连接已选区块</button>
    </RegionPopover>}
    {selection&&!markTool&&!drawTool&&<SelectionPalette task={()=>{setResearchSource({paperId:paper.id,page:selection.page,markId:'',markRevision:0,quote:selection.quote.text,rects:selection.quote.rects});setSelection(null)}} word={wordTerm?{save:()=>void captureSelectedWord(),busy:savingWord}:undefined} point={selection.point} choose={(kind,tone)=>{setColor(tone);void toggleMark(kind,selection,tone)}} annotate={()=>{const rect=selection.quote.rects[0];openAnnotation({kind:"note",page:selection.page,color,quote:selection.quote.text,rects:[{x:Math.min(.97,rect.x),y:Math.min(.97,rect.y),w:.025,h:.025}],comment:"",size:14,width:2},selection.point);setSelection(null);window.getSelection()?.removeAllRanges()}}/>}
    {annotationImage&&<Modal title="区域截图" subtitle={"第 "+annotationImage.page+" 页"} close={()=>setAnnotationImage(null)} wide><img className="region-crop" src={annotationImage.url} alt="原文选区截图"/><button className="primary" onClick={()=>void window.desktop.savePNG("论文区域-"+annotationImage.page,annotationImage.url).then(saved=>{if(saved)report("截图已保存")}).catch(err=>report(message(err)))}>保存 PNG</button></Modal>}
    {annotation&&<AnnotationCard key={annotation.token} initial={annotation.mark} point={annotation.point} close={()=>setAnnotation(null)}
      save={saveAnnotation} remove={deleteAnnotation} locate={()=>locateAnnotation(annotation.mark)} crop={annotation.mark.kind==='area'?()=>void annotationCrop(annotation.mark):undefined}/>}
    {priorGroup&&<Modal title="先前保存的译文" subtitle="这份译文对应清理页边文字之前的原文。" close={()=>setPriorGroup(null)}>
      <p className="prior-translation"><InlineMath text={priorGroup.priorTranslation||''}/></p>
    </Modal>}
    {references&&<Modal title={references.label} subtitle="选择要查看的原文引用" close={()=>setReferences(null)}>
      <div className="reference-list">{references.items.map((target,index)=><button className="secondary" key={index}
        onClick={()=>followReference([target],references.label)}>第 {target.item.region.page} 页 · {target.item.region.text.slice(0,100)||kinds[target.item.region.kind]}</button>)}</div>
    </Modal>}
    {crop&&<Modal title={regionName(crop.item)+'原图'} subtitle={'PDF 第 '+crop.item.region.page+' 页'} close={()=>setCrop(null)} wide>
      <img className="region-crop" src={crop.url} alt={regionName(crop.item)+'原页裁图'}/>
      <div className="form-actions"><button className="secondary" onClick={()=>{focusSource(crop.item.group,crop.item.region);setCrop(null)}}>定位原文</button></div>
    </Modal>}
    {(researchMark||researchSource)&&<ResearchTask paper={paper} mark={researchMark} source={researchSource} close={()=>{setResearchMark(undefined);setResearchSource(undefined)}} report={report}/>}
    {exportOpen&&<PaperExport paper={paper} doc={doc} close={()=>setExportOpen(false)}/>}
    {colorsOpen&&<Modal title="阅读颜色设置" close={()=>setColorsOpen(false)}><ReadingColorSettings/></Modal>}
    {appearanceOpen&&<ReaderAppearance value={appearance} onChange={changeAppearance} close={()=>setAppearanceOpen(false)}/>}
    {config&&<TranslationSettings initial={translationChoice} close={()=>setConfig(false)}
      save={next=>{setTranslationChoice(next);setConfig(false)}}/>}
  </div>;
}
