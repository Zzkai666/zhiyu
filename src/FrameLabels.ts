import type { Rect } from './api.ts';
import { regionName, type Located } from './ReadingRegions.ts';

export type Badge = { x:number;y:number;mode:'inside'|'tab'|'inset'|'compact'; frame:Rect; width:number; height:number };

function blankSampler(canvas:HTMLCanvasElement,width:number,height:number) {
  const scratch=document.createElement('canvas');
  const scale=Math.min(1,1100/width,1550/height);
  scratch.width=Math.max(1,Math.round(width*scale));
  scratch.height=Math.max(1,Math.round(height*scale));
  const ctx=scratch.getContext('2d',{willReadFrequently:true});
  if(!ctx)return ()=>false;
  ctx.drawImage(canvas,0,0,scratch.width,scratch.height);
  const pixels=ctx.getImageData(0,0,scratch.width,scratch.height).data;
  const columns=scratch.width+1, rows=scratch.height+1;
  const integral=new Int32Array(columns*rows);
  for(let y=1;y<rows;y++) {
    let sum=0;
    for(let x=1;x<columns;x++) {
      const i=((y-1)*scratch.width+x-1)*4;
      if(pixels[i+3]>100&&(pixels[i]<238||pixels[i+1]<238||pixels[i+2]<238))sum++;
      integral[y*columns+x]=integral[(y-1)*columns+x]+sum;
    }
  }
  return (x:number,y:number,w:number,h:number)=>{
    // Leave a pixel of breathing room around glyphs and fine rules.
    const x1=Math.max(0,Math.floor((x-1)/width*scratch.width)),x2=Math.min(scratch.width,Math.ceil((x+w+1)/width*scratch.width));
    const y1=Math.max(0,Math.floor((y-1)/height*scratch.height)),y2=Math.min(scratch.height,Math.ceil((y+h+1)/height*scratch.height));
    if(x2<=x1||y2<=y1)return false;
    return integral[y2*columns+x2]-integral[y1*columns+x2]-integral[y2*columns+x1]+integral[y1*columns+x1]===0;
  };
}

function overlaps(a:Rect,b:Rect) {
  return Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x)>.00005 &&
    Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y)>.00005;
}

export function frameLabels(canvas:HTMLCanvasElement,width:number,height:number,regions:Located[]) {
  const blank=blankSampler(canvas,width,height);
  const result=new Map<string,Badge>();
  const extensions:Rect[]=[];
  const used:Rect[]=[];
  for(const item of regions) {
    const r=item.region.rect;
    const x=r.x*width,y=r.y*height,w=r.w*width,h=r.h*height;
    const bw=Math.min(103,Math.max(43,[...regionName(item)].length*9.5+24)),bh=16;
    const right=x+w-bw-2,bottom=y+h-bh-2;
    const badgeRect=(a:number,b:number):Rect=>({x:a/width,y:b/height,w:bw/width,h:bh/height});
    const fits=(a:number,b:number)=>a>=0&&b>=0&&a+bw<=width&&b+bh<=height&&
      !used.some(other=>overlaps(badgeRect(a,b),other));
    const fitsInside=w>=bw+3&&h>=bh+3&&fits(right,bottom);
    let spot:Badge|undefined;
    if(fitsInside&&blank(right,bottom,bw,bh)){
      spot={x:right,y:bottom,mode:'inside',frame:r,width:bw,height:bh};
    }else if(w>=bw+3){
      const below=y+h+1;
      const extra={x:r.x,y:r.y+r.h,w:r.w,h:(bh+3)/height};
      if(extra.y+extra.h<=1&&fits(right,below)&&blank(right,below,bw,bh)&&
          !regions.some(other=>other.region.id!==item.region.id&&overlaps(extra,other.region.rect))&&
          !extensions.some(other=>overlaps(extra,other))){
        extensions.push(extra);
        spot={x:right,y:below,mode:'tab',frame:{...r,h:r.h+extra.h},width:bw,height:bh};
      }
    }
    // Stay near the bottom-right even when the exact corner is occupied.
    if(!spot&&w>=bw+3&&h>=bh+3){
      const leftLimit=Math.max(x+2,right-bw*2);
      const topLimit=Math.max(y+2,bottom-24);
      for(let b=bottom;b>=topLimit&&!spot;b-=4){
        for(let a=right;a>=leftLimit;a-=4){
          if(fits(a,b)&&blank(a,b,bw,bh)){
            spot={x:a,y:b,mode:'inset',frame:r,width:bw,height:bh};
            break;
          }
        }
      }
    }
    if(spot)used.push(badgeRect(spot.x,spot.y));
    const compactW=Math.min(12,Math.max(1,w-1)),compactH=Math.min(12,Math.max(1,h-1));
    result.set(item.region.id,spot||{
      x:Math.max(x,x+w-compactW-.5),y:Math.max(y,y+h-compactH-.5),mode:'compact',frame:r,width:compactW,height:compactH,
    });
  }
  return result;
}