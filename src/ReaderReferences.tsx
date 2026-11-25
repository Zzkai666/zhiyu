import { Fragment } from 'react';
import type { PDFPageProxy } from 'pdfjs-dist';
import { InlineMath } from './InlineMath';
import type { Rect } from './api';
import { visualKinds,type Group,type Located } from './ReadingRegions';

export type PDFDestination=string|unknown[];
export type ReferenceTarget={item:Located; rect:Rect};
export type NativeLink={rect:Rect; dest:PDFDestination};
const label=String.raw`(?:fig(?:ure)?s?\.?|tables?|tab\.?|eq(?:uation)?s?\.?|图|表|式)`;
const number=String.raw`\d{1,4}(?:[.-]\d{1,3})?`;
const numbered=String.raw`(?:${number}[a-z]?|[IVXLCDM]{1,7})`;
const year=String.raw`(?:19|20)\d{2}[a-z]?`;
const surname=String.raw`[\p{Lu}][\p{L}'’\-]{1,38}`;
const authorYear=new RegExp(String.raw`(${surname})(?:\s+et\s+al\.|\s+(?:and|&|和)\s+${surname})?(?:[,，]\s*|\s*[（(]\s*)(${year})[）)]?`,'gu');
const entry=new RegExp(String.raw`^(?:([0-9]{1,4})[.)]\s|[\[［]([0-9]{1,4})[\]］])`);
const citation=String.raw`[\[［]\s*\d{1,4}(?:\s*[,，;；–—-]\s*\d{1,4})*\s*[\]］]`;
const explicit=new RegExp(String.raw`(${label})\s*[（(]?\s*(${numbered})(?![a-z0-9])`,'giu');

function key(kind:string,n:string) {
  const k=kind.toLowerCase();
  const normalized=n.replace(/([0-9])[a-z]$/i,'$1').toUpperCase();
  return (/^(?:fig|图)/u.test(k)?'figure':/^(?:tab|表)/u.test(k)?'table':'formula')+':'+normalized;
}

function targets(text:string) {
  const pattern=new RegExp(String.raw`(?<![a-z0-9])${label}\s*[（(]?\s*${numbered}(?![a-z0-9])(?:[)）])?|${citation}`,'giu');
  const matches=Array.from(text.matchAll(pattern),match=>{
    const raw=match[0];
    const keys=raw.startsWith('[')||raw.startsWith('［')?
      Array.from(raw.matchAll(/\d{1,4}/g),part=>'reference:'+part[0]):
      Array.from(raw.matchAll(explicit),part=>key(part[1],part[2]));
    return {raw,start:match.index,keys:[...new Set(keys)]};
  });
  for(const m of text.matchAll(authorYear)){
    if(!matches.some(hit=>m.index<hit.start+hit.raw.length&&m.index+m[0].length>hit.start))
      matches.push({raw:m[0],start:m.index,keys:['author:'+m[1].toLowerCase()+':'+m[2]]});
  }
  return matches.sort((a,b)=>a.start-b.start);
}

function gap(a:Rect,b:Rect) {
  const dx=Math.max(0,a.x-b.x-b.w,b.x-a.x-a.w);
  const dy=Math.max(0,a.y-b.y-b.h,b.y-a.y-a.h);
  return dx*2+dy;
}

export function referenceIndex(groups:Group[]) {
  const located=groups.flatMap(group=>group.regions.map((region,part)=>({group,region,part})));
  const figures=new Map<number,Located[]>();
  for(const item of located) {
    if(!visualKinds.has(item.region.kind))continue;
    const page=figures.get(item.region.page)||[];
    page.push(item);figures.set(item.region.page,page);
  }
  const index=new Map<string,ReferenceTarget|null>();
  function add(id:string,item:Located) {
    const existing=index.get(id);
    if(existing===undefined)index.set(id,{item,rect:item.region.rect});
    else if(existing?.item.region.id!==item.region.id)index.set(id,null);
  }
  for(const item of located) {
    const {region}=item;
    const text=region.text.trim();
    if(region.kind==='reference') {
      const n=text.match(entry);
      if(n)add('reference:'+(n[1]||n[2]),item);
      else {
        const author=text.match(new RegExp(String.raw`^(${surname})(?:,|\s)`,'u'));
        const published=text.match(new RegExp(String.raw`\b${year}\b`,'u'));
        if(author&&published)add('author:'+author[1].toLowerCase()+':'+published[0],item);
      }
    }
    if(region.kind==='caption'||region.kind==='formula-number') {
      const m=region.kind==='caption'?text.match(new RegExp(String.raw`^(${label})\s*(${numbered})(?![a-z0-9])`,'iu')):
        text.match(new RegExp(String.raw`^\s*[（(](${number})[)）]`));
      if(!m)continue;
      const id=region.kind==='caption'?key(m[1],m[2]):'formula:'+m[1];
      const nearest=(figures.get(region.page)||[]).filter(area=>id.startsWith(area.region.kind+':'))
        .sort((a,b)=>gap(region.rect,a.region.rect)-gap(region.rect,b.region.rect))[0];
      add(id,nearest&&gap(region.rect,nearest.region.rect)<.13?nearest:item);
    }
  }
  return index;
}

export type ReferenceIndex=ReturnType<typeof referenceIndex>;

export function TranslationText({text,index,locate}:{text:string;index:ReferenceIndex;locate:(items:ReferenceTarget[],label:string)=>void}) {
  let offset=0;
  return <>{targets(text).map(match=>{
    const before=text.slice(offset,match.start);
    offset=match.start+match.raw.length;
    const links=match.keys.flatMap(id=>{const target=index.get(id);return target?[target]:[]});
    return <Fragment key={match.start}><InlineMath text={before}/>
      {links.length?<button type="button" className="citation-link" onClick={e=>{e.stopPropagation();locate(links,match.raw)}}>{match.raw}</button>:match.raw}
    </Fragment>;
  })}<InlineMath text={text.slice(offset)}/></>;
}

export function textReference(node:Node|null,index:number,refs:ReferenceIndex) {
  if(node?.nodeType!==Node.TEXT_NODE)return null;
  const text=node.textContent||'';
  const hit=targets(text).find(match=>index>=match.start&&index<match.start+match.raw.length);
  if(!hit)return null;
  const items=hit.keys.flatMap(id=>{const item=refs.get(id);return item?[item]:[]});
  return items.length?{items,label:hit.raw}:null;
}

export function inside(rect:Rect,x:number,y:number) {
  return x>=rect.x&&x<=rect.x+rect.w&&y>=rect.y&&y<=rect.y+rect.h;
}

export async function pdfLinks(page:PDFPageProxy):Promise<NativeLink[]> {
  const annotations=await page.getAnnotations({intent:'display'});
  const view=page.getViewport({scale:1});
  return annotations.flatMap(({subtype,dest,rect}: {subtype:string;dest?:PDFDestination;rect?:number[]})=>{
    if(subtype!=='Link'||!dest||!rect||rect.length!==4)return [];
    const [x1,y1]=view.convertToViewportPoint(rect[0],rect[1]);
    const [x2,y2]=view.convertToViewportPoint(rect[2],rect[3]);
    const x=Math.min(x1,x2)/view.width,y=Math.min(y1,y2)/view.height;
    return [{dest,rect:{x,y,w:Math.abs(x2-x1)/view.width,h:Math.abs(y2-y1)/view.height}}];
  });
}
