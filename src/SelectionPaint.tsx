import { useEffect,useState,type RefObject } from 'react';
import type { Mark,Rect } from './api';
import { rangeRects } from './pdf';

// One SVG path paints the union. Overlapping glyph boxes do not accumulate opacity.
function shape(rects:Rect[]) {
  return rects.map(({x,y,w,h})=>'M'+x+' '+y+'h'+w+'v'+h+'h'+(-w)+'Z').join('');
}

export function SelectionPaint({paper,enabled,width,height}:{paper:RefObject<HTMLDivElement|null>;enabled:boolean;width:number;height:number}) {
  const [path,setPath]=useState('');
  useEffect(()=>{
    if(!enabled){setPath('');return}
    let pending=0;
    const update=()=>{
      pending=0;
      const el=paper.current, selection=window.getSelection();
      if(!el||!selection||selection.isCollapsed||!selection.rangeCount){setPath('');return}
      const range=selection.getRangeAt(0), text=el.querySelector('.textLayer');
      if(!text||!range.intersectsNode(text)){setPath('');return}
      setPath(shape(rangeRects(range,el)));
    };
    const request=()=>{if(!pending)pending=requestAnimationFrame(update)};
    document.addEventListener('selectionchange',request);request();
    return ()=>{document.removeEventListener('selectionchange',request);cancelAnimationFrame(pending)};
  },[paper,enabled,width,height]);
  return path?<svg className="live-selection" aria-hidden="true" viewBox="0 0 1 1" preserveAspectRatio="none"><path d={path}/></svg>:null;
}

export function SavedHighlights({marks}:{marks:Mark[]}) {
  const byColor=new Map<string,Rect[]>();
  for(const mark of marks) {
    if(mark.kind!=='highlight')continue;
    if(!byColor.has(mark.color))byColor.set(mark.color,[]);
    byColor.get(mark.color)!.push(...mark.rects);
  }
  return byColor.size>0?<svg className="saved-highlights" aria-hidden="true" viewBox="0 0 1 1" preserveAspectRatio="none">
    {[...byColor].map(([color,rects])=><path key={color} className={color} d={shape(rects)}/>)}
  </svg>:null;
}
