import {test} from 'node:test';import assert from 'node:assert/strict';import {focusZoom} from '../src/ReaderFocus.ts';
test('large paragraphs fit inside both dimensions without enlarging already-readable text',()=>{
 const rect={x:.1,y:.2,w:.7,h:.65},view={width:600,height:480,base:560,aspect:1.414,zoom:200};
 const zoom=focusZoom(rect,view);assert.ok(rect.h*view.base*view.aspect*zoom/100<=view.height-64);assert.ok(rect.w*view.base*zoom/100<=view.width-48);
 assert.equal(focusZoom({x:.1,y:.1,w:.2,h:.1},{...view,zoom:80}),80);
});
