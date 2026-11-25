import {useEffect,useRef,useState,type RefObject} from 'react';
import type {Rect} from './api';
import {inside} from './ReaderReferences';
import {isParagraph,type Located} from './ReadingRegions';
import {rangeRects} from './pdf';

import {sentenceBounds} from './SentenceText';

type Piece={node:Text;start:number;end:number};
export function SentenceHover({paper,enabled,regions,width,height}:{paper:RefObject<HTMLDivElement|null>;enabled:boolean;regions:Located[];width:number;height:number}){
  const [paint,setPaint]=useState<{rects:Rect[];text:string}|null>(null);
  const current=useRef('');
  useEffect(()=>{
    const sheet=paper.current,layer=sheet?.querySelector('.textLayer');
    if(!sheet||!layer||!enabled){setPaint(null);return}
    let frame=0,point:{x:number;y:number}|null=null;
    const cache=new Map<string,{pieces:Piece[];text:string;sentences:ReturnType<typeof sentenceBounds>}>();
    const clear=()=>{current.current='';setPaint(null)};
    const leave=()=>{clear()};
    const observer=new MutationObserver(()=>{cache.clear();clear()});observer.observe(layer,{childList:true,subtree:true,characterData:true});
    const model=(item:Located)=>{
      const key=item.group.id,cached=cache.get(key);if(cached)return cached;
      const areas=regions.filter(entry=>entry.group.id===key).map(entry=>entry.region.rect);
      const bounds=sheet.getBoundingClientRect(),walker=document.createTreeWalker(layer,NodeFilter.SHOW_TEXT);
      const pieces:Piece[]=[],chunks:Array<{node:Text;box:DOMRect}>=[];
      let node:Node|null;
      while((node=walker.nextNode())){
        if(!node.textContent?.trim())continue;
        const range=document.createRange();range.selectNodeContents(node);
        const box=range.getBoundingClientRect();
        if(areas.some(area=>inside(area,(box.left+box.width/2-bounds.left)/bounds.width,(box.top+box.height/2-bounds.top)/bounds.height)))chunks.push({node:node as Text,box});
      }
      // PDF content order may interleave columns; order each chosen region by visible text lines.
      const ordered=areas.flatMap(area=>chunks.filter(({box})=>inside(area,(box.left+box.width/2-bounds.left)/bounds.width,(box.top+box.height/2-bounds.top)/bounds.height))
        .sort((a,b)=>Math.abs(a.box.top-b.box.top)<Math.min(a.box.height,b.box.height)*.55?a.box.left-b.box.left:a.box.top-b.box.top));
      const seen=new Set<Text>();let text='';
      for(const chunk of ordered){if(seen.has(chunk.node))continue;seen.add(chunk.node);if(text)text+=' ';const start=text.length;text+=chunk.node.textContent||'';pieces.push({node:chunk.node,start,end:text.length})}
      const result={pieces,text,sentences:sentenceBounds(text)};cache.set(key,result);return result;
    };
    const update=()=>{
      frame=0;if(!point)return;
      const selection=window.getSelection();if(selection&&!selection.isCollapsed){clear();return}
      const bounds=sheet.getBoundingClientRect(),x=(point.x-bounds.left)/bounds.width,y=(point.y-bounds.top)/bounds.height;
      const item=regions.filter(entry=>isParagraph(entry.region.kind)&&inside(entry.region.rect,x,y)).sort((a,b)=>a.region.rect.w*a.region.rect.h-b.region.rect.w*b.region.rect.h)[0];
      const hit=document.caretPositionFromPoint(point.x,point.y);
      if(!item||!hit||hit.offsetNode.nodeType!==Node.TEXT_NODE||!layer.contains(hit.offsetNode)){clear();return}
      const data=model(item),piece=data.pieces.find(part=>part.node===hit.offsetNode);
      if(!piece){clear();return}
      const glyph=document.createRange(),length=piece.node.length;
      if(!length){clear();return}
      glyph.setStart(piece.node,Math.min(hit.offset,length-1));glyph.setEnd(piece.node,Math.min(length,hit.offset+1));
      const letter=glyph.getBoundingClientRect();
      if(point.y<letter.top-2||point.y>letter.bottom+2||point.x<letter.left-4||point.x>letter.right+4){clear();return}
      const offset=piece.start+hit.offset,sentence=data.sentences.find(part=>offset>=part.start&&offset<part.end);
      if(!sentence){clear();return}
      const key=item.group.id+':'+sentence.start+':'+sentence.end;if(current.current===key)return;
      const rects:Rect[]=[];
      for(const part of data.pieces){
        const from=Math.max(part.start,sentence.start),to=Math.min(part.end,sentence.end);if(from>=to)continue;
        const range=document.createRange();range.setStart(part.node,from-part.start);range.setEnd(part.node,to-part.start);rects.push(...rangeRects(range,sheet));
      }
      const text=data.text.slice(sentence.start,sentence.end).trim();current.current=key;setPaint({rects,text});
    };
    const move=(event:PointerEvent)=>{
      if(event.buttons||event.pointerType==='touch'){clear();return}
      point={x:event.clientX,y:event.clientY};if(!frame)frame=requestAnimationFrame(update);
    };
    sheet.addEventListener('pointermove',move);sheet.addEventListener('pointerleave',leave);
    document.addEventListener('selectionchange',clear);sheet.addEventListener('wheel',clear,{passive:true});
    return()=>{cancelAnimationFrame(frame);observer.disconnect();sheet.removeEventListener('pointermove',move);sheet.removeEventListener('pointerleave',leave);sheet.removeEventListener('wheel',clear);document.removeEventListener('selectionchange',clear);current.current=''};
  },[paper,enabled,regions,width,height]);
  return paint?<svg className="sentence-hover" aria-hidden="true" data-sentence={paint.text} viewBox="0 0 1 1" preserveAspectRatio="none">
    <path d={paint.rects.map(({x,y,w,h})=>'M'+x+' '+y+'h'+w+'v'+h+'h'+(-w)+'Z').join('')}/>
  </svg>:null;
}
