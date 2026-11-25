import {useRef,useState,type CSSProperties} from 'react';
import {BookPlus,Highlighter,Underline,StickyNote,Type,SquareDashed,PenLine,MousePointer2} from 'lucide-react';
import type {Mark,Rect} from './api';
import {colors} from './ReaderMarkTools';
export type DrawingTool='note'|'text'|'area'|'ink'|null;
export type MarkDraft=Omit<Mark,'id'>&{id?:string};
export const annotationNames={bookmark:'书签',highlight:'高亮文本',underline:'下划线文本',note:'笔记注释',text:'新增文字',area:'选择区域',ink:'绘图'};
export function DrawingTools({value,change,selecting=true}:{value:DrawingTool;selecting?:boolean;change:(tool:DrawingTool)=>void}){
 return <div className="drawing-tools" aria-label="PDF 注释工具">
  {([[null,'选择/移动',MousePointer2],['note','笔记注释',StickyNote],['text','新增文字',Type],['area','选择区域',SquareDashed],['ink','绘图',PenLine]] as const).map(([id,label,Icon])=>
   <button key={label} className="icon" title={label} aria-label={label} aria-pressed={value===id&&(id!==null||selecting)} onClick={()=>change(value===id?null:id)}><Icon size={17}/></button>)}
 </div>;
}
export function SelectionPalette({point,color,choose,annotate,task,word}:{point:{x:number;y:number};color:Mark['color'];choose:(kind:'highlight'|'underline',color:Mark['color'])=>void;annotate:()=>void;task?:()=>void;word?:{save:()=>void;busy:boolean}}){
 const [kind,setKind]=useState<'highlight'|'underline'>('highlight');
 return <div className="selection-palette" role="toolbar" aria-label="选区标注" style={{left:Math.max(12,Math.min(innerWidth-285,point.x)),top:Math.max(12,Math.min(innerHeight-102,point.y))}} onPointerDown={e=>e.preventDefault()}>
  <div className="selection-swatches">{Object.entries(colors).map(([id,[name,tone]])=><button key={id} aria-label={name+'标记选区'} title={name} style={{background:tone}} onClick={()=>choose(kind,id as Mark['color'])}/>)}</div>
  <div><button aria-label="选区高亮模式" aria-pressed={kind==='highlight'} onClick={()=>setKind('highlight')}><Highlighter size={16}/></button>
  <button aria-label="选区下划线模式" aria-pressed={kind==='underline'} onClick={()=>setKind('underline')}><Underline size={16}/></button>
  <button aria-label="给选区添加注释" title="添加注释" onClick={annotate}><StickyNote size={16}/></button>
  {word&&<button className="selection-word" aria-label="收录生词" title="保存选中的词和原文出处" disabled={word.busy} onClick={word.save}><BookPlus size={15}/><span>{word.busy?'保存中':'生词'}</span></button>}
  {task&&<button aria-label="从选区创建研究任务" title="创建研究任务" onClick={task}>待办</button>}
  </div>
 </div>;
}
type Props={marks:Mark[];page:number;tool:DrawingTool;color:Mark['color'];width:number;height:number;baseWidth:number;
 create:(mark:MarkDraft,point:{x:number;y:number})=>void;edit:(mark:Mark,point:{x:number;y:number})=>void;move:(mark:Mark)=>void};
type Gesture={mode:'new'|'move';start:{x:number;y:number};points:{x:number;y:number}[];mark?:Mark;draft:MarkDraft;moved:boolean};
export function AnnotationLayer({marks,page,tool,color,width,height,baseWidth,create,edit,move}:Props){
 const drag=useRef<Gesture|null>(null),[preview,setPreview]=useState<MarkDraft|null>(null);
 const factor=width/baseWidth;
 const point=(e:React.PointerEvent<SVGSVGElement>)=>{const box=e.currentTarget.getBoundingClientRect();return {x:Math.max(0,Math.min(.999,(e.clientX-box.left)/box.width)),y:Math.max(0,Math.min(.999,(e.clientY-box.top)/box.height))}};
 const beginMove=(e:React.PointerEvent,mark:Mark)=>{
  if(tool||e.button!==0)return;e.preventDefault();e.stopPropagation();
  const svg=e.currentTarget.closest('svg')!;const box=svg.getBoundingClientRect();const start={x:(e.clientX-box.left)/box.width,y:(e.clientY-box.top)/box.height};
  drag.current={mode:'move',start,points:[],mark,draft:mark,moved:false};svg.setPointerCapture(e.pointerId);
 };
 const update=(current:{x:number;y:number})=>{
  const g=drag.current;if(!g)return;
  if(g.mode==='move'&&g.mark){
   const r=g.mark.rects[0],dx=Math.max(-r.x,Math.min(1-r.x-r.w,current.x-g.start.x)),dy=Math.max(-r.y,Math.min(1-r.y-r.h,current.y-g.start.y));
   g.moved=g.moved||Math.hypot(dx*width,dy*height)>3;
   g.draft={...g.mark,rects:g.mark.rects.map(r=>({...r,x:r.x+dx,y:r.y+dy})),points:g.mark.points?.map(p=>({x:p.x+dx,y:p.y+dy}))};
  }else if(g.draft.kind==='ink'){
   if(g.points.length<10000&&Math.hypot((current.x-g.points.at(-1)!.x)*width,(current.y-g.points.at(-1)!.y)*height)>1)g.points.push(current);
   const xs=g.points.map(p=>p.x),ys=g.points.map(p=>p.y);g.draft={...g.draft,points:[...g.points],rects:[{x:Math.min(...xs),y:Math.min(...ys),w:Math.max(.001,Math.max(...xs)-Math.min(...xs)),h:Math.max(.001,Math.max(...ys)-Math.min(...ys))}]};
  }else if(g.draft.kind==='area'||g.draft.kind==='text'){
   g.draft={...g.draft,rects:[{x:Math.min(g.start.x,current.x),y:Math.min(g.start.y,current.y),w:Math.max(.002,Math.abs(current.x-g.start.x)),h:Math.max(.002,Math.abs(current.y-g.start.y))}]};
  }
  setPreview({...g.draft});
 };
 const visible=marks.filter(m=>['note','text','area','ink'].includes(m.kind)).map(m=>preview?.id===m.id?preview:m);
 if(preview&&!preview.id)visible.push(preview);
 return <svg className="annotation-layer" data-tool={tool||'select'} style={{pointerEvents:tool?'auto':'none',touchAction:tool?'none':undefined}} viewBox={'0 0 '+width+' '+height}
  onPointerDown={e=>{
   if(!tool||e.button!==0)return;e.preventDefault();e.stopPropagation();const p=point(e);
   const draft:MarkDraft={page,kind:tool,color,quote:'',comment:'',rects:[{x:p.x,y:p.y,w:Math.min(.25,1-p.x),h:Math.min(.08,1-p.y)}],points:tool==='ink'?[p]:[],size:14,width:2,revision:1};
   if(tool==='note')draft.rects=[{x:Math.min(.97,p.x),y:Math.min(.97,p.y),w:.025,h:.025}];
   drag.current={mode:'new',start:p,points:[p],draft,moved:false};setPreview(draft);e.currentTarget.setPointerCapture(e.pointerId);
  }}
  onPointerMove={e=>{if(drag.current){e.preventDefault();update(point(e))}}}
  onPointerUp={e=>{
   const g=drag.current;if(!g)return;e.preventDefault();e.stopPropagation();
   drag.current=null;setPreview(null);
   if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);
   if(g.mode==='move'){if(g.moved)move(g.draft as Mark);else edit(g.mark!,{x:e.clientX,y:e.clientY+12});return}
   if(g.draft.kind==='ink'&&(g.draft.points?.length||0)<2)return;
   const r=g.draft.rects[0];if(g.draft.kind==='area'&&(r.w*width<8||r.h*height<8))return;
   if(g.draft.kind==='text'&&(r.w*width<35||r.h*height<15))g.draft.rects=[{...r,w:Math.min(.25,1-r.x),h:Math.min(.08,1-r.y)}];
   create(g.draft,{x:e.clientX+12,y:e.clientY+12});
  }} onPointerCancel={()=>{drag.current=null;setPreview(null)}}>
  {visible.map((mark,i)=>{
   const r=mark.rects[0];if(!r)return null;const tone=colors[mark.color][1],key=mark.id||'draft'+i,handlers={onPointerDown:(e:React.PointerEvent)=>mark.id&&beginMove(e,mark as Mark)};
   return <g key={key} data-annotation={mark.id} data-kind={mark.kind} style={{pointerEvents:tool?'none':'auto'}} {...handlers}>
    {mark.kind==='ink'?<><polyline points={mark.points?.map(p=>p.x*width+','+p.y*height).join(' ')} fill="none" stroke={tone} strokeWidth={(mark.width||2)*factor} strokeLinecap="round" strokeLinejoin="round"/>
      <polyline points={mark.points?.map(p=>p.x*width+','+p.y*height).join(' ')} fill="none" stroke="transparent" strokeWidth={Math.max(10,(mark.width||2)*factor)} style={{pointerEvents:'stroke'}}/></>:
    mark.kind==='note'?<g transform={'translate('+r.x*width+','+r.y*height+')'}><rect width={22*factor} height={22*factor} rx={3*factor} fill={tone} stroke="#fff"/><text x={6*factor} y={16*factor} fontSize={15*factor} fill="#fff">✎</text></g>:
    mark.kind==='text'?<foreignObject x={r.x*width} y={r.y*height} width={r.w*width} height={r.h*height}>
      <div className="pdf-added-text" style={{fontSize:(mark.size||14)*factor,color:tone}}>{mark.content||'输入文字…'}</div></foreignObject>:
    <rect x={r.x*width} y={r.y*height} width={r.w*width} height={r.h*height} fill={tone+'12'} stroke={tone} strokeWidth={1.7} style={{pointerEvents:'stroke'}}/>}
   </g>;
  })}
 </svg>;
}
