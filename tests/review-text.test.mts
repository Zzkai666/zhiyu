import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutBlocks, type Glyph } from '../src/layout.ts';
import {readingRegions} from '../src/ReadingRegions.ts';

test('vertical margin text is not assigned to an overlapping body region',()=>{
  const glyphs:Glyph[]=[
    {text:'research systems [5]–[7].',rect:{x:.07,y:.68,w:.37,h:.016},baseline:.696,height:.016,end:true},
    {text:'arXiv:2510.07077v1 [cs.RO] 8 Oct 2025',rect:{x:.04,y:.12,w:.66,h:.022},baseline:.8,height:.022,end:true,rotation:90} as Glyph,
  ];
  const blocks=layoutBlocks(glyphs,[{kind:'text',score:.94,rect:{x:.06,y:.1,w:.4,h:.6}}]);
  assert.equal(blocks[0].text,'research systems [5]–[7].');
});

test('vertical edge stamp remains a separate margin block',()=>{
  const blocks=readingRegions([
    {text:'Body prose with a complete ending.',rect:{x:.07,y:.2,w:.38,h:.02},baseline:.22,height:.02,end:true},
    {text:'arXiv:2510.07077v1 [cs.RO] 8 Oct 2025',rect:{x:.025,y:.2,w:.03,h:.45},baseline:.65,height:.025,end:true,rotation:-90},
  ],[{kind:'text',score:.94,rect:{x:.06,y:.15,w:.4,h:.45}}],1,'');
  assert.equal(blocks.find(block=>block.kind==='text')?.text,'Body prose with a complete ending.');
  const stamp=blocks.find(block=>block.kind==='margin');
  assert.ok(stamp);
  assert.ok(stamp.rect.w<.05&&stamp.rect.h>.4);
});
