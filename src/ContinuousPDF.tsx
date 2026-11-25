import { useEffect,useLayoutEffect,useRef,useState,type CSSProperties,type RefObject } from 'react';
import type { PDFDocumentProxy,PDFPageProxy } from 'pdfjs-dist';
import type { Mark,Rect,Selection } from './api';
import { selected,TextLayer } from './pdf';
import { regionName, type Located } from './ReadingRegions';
import { frameLabels,type Badge } from './FrameLabels';
import {AnnotationLayer,type DrawingTool,type MarkDraft} from './PDFAnnotations';
import { SentenceHover } from './SentenceHover';
import { SavedHighlights,SelectionPaint } from './SelectionPaint';
import { inside,pdfLinks,textReference,type NativeLink,type PDFDestination,type ReferenceIndex,type ReferenceTarget } from './ReaderReferences';

export function placement(rect:Rect):CSSProperties {
  return {left:rect.x*100+'%',top:rect.y*100+'%',width:rect.w*100+'%',height:rect.h*100+'%'};
}
type PageProps={
  doc:PDFDocumentProxy;number:number;width:number;ratio:number;visible:boolean;dpr:number;
  regions:Located[];marks:Mark[];active?:string;picked?:ReadonlySet<string>;
  joining:boolean;showFrames:boolean;reading:boolean;focus:boolean;
  select:(item:Located)=>void;onSelection:(selection:Selection|null,page:number)=>void;
  markTool:boolean; refs:ReferenceIndex;
  drawTool:DrawingTool;color:Mark['color'];onCreate:(mark:MarkDraft,point:{x:number;y:number})=>void;onEdit:(mark:Mark,point:{x:number;y:number})=>void;onMove:(mark:Mark)=>void;
  onMark:(mark:Mark,point:{x:number;y:number})=>void;
  onNativeLink:(dest:PDFDestination)=>void;
  onReference:(items:ReferenceTarget[],label:string)=>void;
  target?:Rect;
};
export function PageSurface(props:PageProps) {
  const {doc,number,width,ratio,visible,dpr,regions,marks,active,picked,showFrames}=props;
  const [page,setPage]=useState<PDFPageProxy>();
  const [failure,setFailure]=useState('');
  const [raster,setRaster]=useState<HTMLCanvasElement|null>(null);
  const [links,setLinks]=useState<NativeLink[]>([]);
  const [badges,setBadges]=useState<Map<string,Badge>>(new Map());
  const paper=useRef<HTMLDivElement>(null);
  const layer=useRef<HTMLDivElement>(null);
  const bitmap=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    if(!visible){setRaster(null);setPage(undefined);return}
    let alive=true;
    void doc.getPage(number).then(value=>{if(alive)setPage(value)}).catch(err=>{if(alive)setFailure(String(err))});
    return ()=>{alive=false};
  },[doc,number,visible]);

  const viewport=page?.getViewport({scale:width/page.getViewport({scale:1}).width});
  const height=viewport?.height??width*ratio;
  useEffect(()=>{
    if(!page||!layer.current){setLinks([]);return}
    const text=layer.current, view=page.getViewport({scale:1});
    let alive=true;
    text.replaceChildren();
    const textLayer=new TextLayer({textContentSource:page.streamTextContent(),container:text,viewport:view});
    void textLayer.render().catch(()=>{});
    void pdfLinks(page).then(value=>{if(alive)setLinks(value)}).catch(()=>{});
    return ()=>{alive=false;textLayer.cancel()};
  },[page]);
  useLayoutEffect(()=>{
    if(viewport&&layer.current)layer.current.style.setProperty('--total-scale-factor',String(viewport.scale));
  },[viewport?.scale]);
  useEffect(()=>{
    if(!page||!viewport||!visible)return;
    let alive=true;
    let render:ReturnType<PDFPageProxy['render']>|undefined;
    const timer=setTimeout(()=>{
    const canvas=document.createElement('canvas');
    canvas.setAttribute('aria-hidden','true');
    const backing=Math.min(Math.max(1.65,dpr*1.35),Math.sqrt(20_000_000/(viewport.width*viewport.height)));
    canvas.width=Math.ceil(viewport.width*backing);canvas.height=Math.ceil(viewport.height*backing);
    canvas.dataset.rasterWidth=String(Math.round(viewport.width));
    canvas.dataset.scale=String(backing);
    render=page.render({canvas,viewport,transform:[canvas.width/viewport.width,0,0,canvas.height/viewport.height,0,0]});
    void render.promise.then(()=>{if(alive){setRaster(canvas);setFailure('')}})
      .catch(err=>{if(alive)setFailure(String(err))});
    },raster?105:0);
    return ()=>{alive=false;clearTimeout(timer);render?.cancel()};
  },[page,width,dpr,visible]);
  useLayoutEffect(()=>{
    if(!bitmap.current)return;
    bitmap.current.replaceChildren(...(raster?[raster]:[]));
  },[raster]);

  useEffect(()=>{
    if(!raster||!showFrames||!regions.length){setBadges(old=>old.size?new Map():old);return}
    const timer=setTimeout(()=>setBadges(frameLabels(raster,width,height,regions)),65);
    return ()=>clearTimeout(timer);
  },[raster,width,height,regions,showFrames]);

  return <div className="continuous-page" data-pdf-page={number} style={{'--page-width':width+'px','--page-height':height+'px'} as CSSProperties}>
    <div className="sheet paper-surface" data-mark-tool={props.markTool} data-draw-tool={Boolean(props.drawTool)} ref={paper} aria-label={'PDF 第 '+number+' 页'}
      onPointerMove={e=>{
        const el=e.currentTarget;
        const bounds=el.getBoundingClientRect();
        const x=(e.clientX-bounds.left)/bounds.width,y=(e.clientY-bounds.top)/bounds.height;
        el.dataset.linkHover=String(!e.buttons&&!props.markTool&&!props.joining&&
          (links.some(link=>inside(link.rect,x,y))||marks.some(mark=>mark.kind!=='bookmark'&&mark.rects.some(rect=>inside(rect,x,y)))));
      }}
      onPointerUp={e=>{
        const el=paper.current;if(!el)return;
        const quote=selected(el);
        props.onSelection(quote,number);
        if(quote||props.markTool||props.drawTool||e.button!==0)return;
        const bounds=el.getBoundingClientRect();
        const x=(e.clientX-bounds.left)/bounds.width,y=(e.clientY-bounds.top)/bounds.height;
        if(!props.joining){
          const link=links.find(link=>inside(link.rect,x,y));
          if(link){props.onNativeLink(link.dest);return}
          const hit=document.caretPositionFromPoint(e.clientX,e.clientY);
          const reference=textReference(hit?.offsetNode??null,hit?.offset??-1,props.refs);
          if(reference){props.onReference(reference.items,reference.label);return}
          const mark=marks.findLast(mark=>mark.kind!=='bookmark'&&mark.rects.some(rect=>inside(rect,x,y)));
          if(mark){props.onMark(mark,{x:e.clientX,y:e.clientY+20});return}
        }
        if(!showFrames&&!props.reading)return;
        const item=regions.filter(({region:{rect}})=>inside(rect,x,y))
          .sort((a,b)=>a.region.rect.w*a.region.rect.h-b.region.rect.w*b.region.rect.h)[0];
        if(item)props.select(item);
      }}>
      <div className="page-bitmap" ref={bitmap} data-ready={Boolean(raster)}/>
      {visible&&!raster&&<div className="page-placeholder">{failure?'无法绘制本页。'+failure:'正在绘制第 '+number+' 页…'}</div>}
      <div className="mark-layer"><SavedHighlights marks={marks}/>{marks.filter(mark=>mark.kind==="underline").flatMap(mark=>mark.rects.map((rect,index)=><i key={mark.id+index} className={mark.kind+' '+mark.color} style={placement(rect)}/>))}</div>
      {showFrames&&<div className="region-layer">
        {regions.map(({region,group})=>{
          const badge=badges.get(region.id);
          return <div key={region.id} id={'region-'+region.id} className="source-region" data-kind={region.kind}
            data-group={group.id} data-region={region.id} data-active={group.id===active} data-picked={Boolean(picked?.has(region.id))}
            data-continued={group.regions.length>1}
            style={placement(badge?.frame??region.rect)}/>;
        })}
        {regions.map(item=>{
          const {region,group}=item, badge=badges.get(region.id);
          if(!badge)return null;
          const label=regionName(item)+'，'+(region.translate?'需翻译':'无需翻译');
          return <button key={region.id} type="button" className="region-label" data-region={region.id} data-kind={region.kind}
            data-active={group.id===active} data-picked={Boolean(picked?.has(region.id))} data-mode={badge.mode}
            style={{left:badge.x,top:badge.y,width:badge.width,height:badge.height}}
            aria-label={label}
            title={label+(props.joining?' · 点选区块':' · 点击更正类别或分段')}
            onPointerUp={e=>e.stopPropagation()} onClick={()=>props.select(item)}>
            <span>{regionName(item)}</span><small>{region.translate?'译':'原'}</small>
          </button>;
        })}
      </div>}
      {!showFrames&&(props.focus||props.joining)&&<div className="region-layer source-focus-layer">{regions.filter(item=>props.joining?picked?.has(item.region.id):item.group.id===active).map(({region,group})=>
        <div key={region.id} className="source-focus" data-region={region.id} data-group={group.id} style={placement(region.rect)}/>)}</div>}
      {props.target&&<div className="reference-target" style={placement(props.target)}/>}
      <div className="pdf-native-links">{links.map((link,i)=><button type="button" key={i} aria-label={'PDF 内部引用 '+(i+1)}
        data-destination={typeof link.dest==='string'?link.dest:undefined}
        style={placement(link.rect)} onPointerUp={e=>e.stopPropagation()} onClick={()=>props.onNativeLink(link.dest)}/>)}</div>
      <SentenceHover paper={paper} enabled={visible&&!props.markTool&&!props.drawTool&&!props.joining} regions={regions} width={width} height={height}/>
      <SelectionPaint paper={paper} enabled={visible} width={width} height={height}/>
      <div ref={layer} className="textLayer selectionRendering"/>
      <AnnotationLayer marks={marks} page={number} tool={props.drawTool} color={props.color} width={width} height={height} baseWidth={page?.getViewport({scale:1}).width||612} create={props.onCreate} edit={props.onEdit} move={props.onMove}/>
    </div>
    <div className="page-number-label" aria-hidden="true">{number}</div>
  </div>;
}

export function useVisiblePages(root:RefObject<HTMLDivElement|null>,count:number) {
  const [visible,setVisible]=useState<Set<number>>(new Set());
  useEffect(()=>{
    const scroll=root.current;if(!scroll||!count)return;
    const observer=new IntersectionObserver(entries=>{
      setVisible(old=>{
        const next=new Set(old);
        for(const entry of entries) {
          const page=Number((entry.target as HTMLElement).dataset.pdfPage);
          if(entry.isIntersecting)next.add(page);else next.delete(page);
        }
        return next;
      });
    },{root:scroll,rootMargin:'320px 0px'});
    scroll.querySelectorAll('[data-pdf-page]').forEach(page=>observer.observe(page));
    return ()=>observer.disconnect();
  },[root,count]);
  return visible;
}

export async function cropOriginal(doc:PDFDocumentProxy,number:number,rect:Rect) {
  const page=await doc.getPage(number);
  const base=page.getViewport({scale:1});
  const scale=Math.min(4,1450/(base.width*rect.w),1350/(base.height*rect.h));
  const viewport=page.getViewport({scale});
  const canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.ceil(viewport.width*rect.w));canvas.height=Math.max(1,Math.ceil(viewport.height*rect.h));
  await page.render({canvas,viewport,transform:[1,0,0,1,-viewport.width*rect.x,-viewport.height*rect.y]}).promise;
  return canvas.toDataURL('image/png');
}
