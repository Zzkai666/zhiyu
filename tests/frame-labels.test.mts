import assert from 'node:assert/strict';
import { test } from 'node:test';
import { frameLabels } from '../src/FrameLabels.ts';
import type { Located } from '../src/ReadingRegions.ts';
import type { Rect } from '../src/api.ts';

const width=400,height=400;
const paragraph:Rect={x:.1,y:.1,w:.8,h:.2};

function region(id:string,rect:Rect):Located {
  const region={id,kind:'text' as const,page:1,rect,text:'Paragraph',translate:true};
  return {region,group:{id,regions:[region],text:region.text,translate:true},part:0};
}

function place(ink:[number,number][],rects:Located[]) {
  const canvas={width,height,getContext:()=>({
    drawImage(){},
    getImageData(){
      const data=new Uint8ClampedArray(width*height*4).fill(255);
      for(const [x,y] of ink) data[(y*width+x)*4]=234;
      return {data};
    },
  })};
  const previous=Object.getOwnPropertyDescriptor(globalThis,'document');
  Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:()=>canvas}});
  try { return frameLabels(canvas as unknown as HTMLCanvasElement,width,height,rects); }
  finally {
    if(previous)Object.defineProperty(globalThis,'document',previous);
    else Reflect.deleteProperty(globalThis,'document');
  }
}

test('a full label stays at the lower-right corner when the paper is blank there',()=>{
  const badge=place([],[region('a',paragraph)]).get('a')!;
  assert.equal(badge.mode,'inside');
  assert.equal(Math.round(badge.x+badge.width),358);
  assert.equal(Math.round(badge.y+badge.height),118);
  assert.deepEqual(badge.frame,paragraph);
});

test('a glyph inside the corner moves the label into a clear strip below the frame',()=>{
  const badge=place([[340,110]],[region('a',paragraph)]).get('a')!;
  assert.equal(badge.mode,'tab');
  assert.ok(badge.y>120);
  assert.ok(badge.frame.h>paragraph.h);
});

test('a blocked corner uses a nearby blank patch within the frame',()=>{
  const badge=place([[340,110],[340,129]],[region('a',paragraph)]).get('a')!;
  assert.equal(badge.mode,'inset');
  assert.ok(badge.x+badge.width<340||badge.y+badge.height<110);
  assert.deepEqual(badge.frame,paragraph);
});

test('a clear strip is rejected when it would extend across the next region',()=>{
  const badge=place([[340,110]],[
    region('a',paragraph),region('b',{x:.1,y:.31,w:.8,h:.1}),
  ]).get('a')!;
  assert.equal(badge.mode,'inset');
  assert.deepEqual(badge.frame,paragraph);
});

test('a fully occupied corner uses a compact handle',()=>{
  const ink:[number,number][]=[];
  for(let x=41;x<360;x+=10){
    for(let y=80;y<=140;y+=10)ink.push([x,y]);
  }
  const badge=place(ink,[region('a',paragraph)]).get('a')!;
  assert.equal(badge.mode,'compact');
  assert.deepEqual(badge.frame,paragraph);
});

test('a region too small for a full label keeps a compact handle',()=>{
  const narrow={x:.1,y:.1,w:.08,h:.2};
  const badge=place([],[region('narrow',narrow)]).get('narrow')!;
  assert.equal(badge.mode,'compact');
  assert.deepEqual(badge.frame,narrow);
});
