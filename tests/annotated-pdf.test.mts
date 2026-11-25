import {test} from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),{PDFDocument,PDFName,PDFHexString,PDFDict,degrees}=require('pdf-lib'),{annotatePDF,geometry}=require('../desktop/annotated-pdf.cjs');
test('native PDF annotations preserve rotated/cropped pages, original links, comments and bookmark tree',async()=>{
 const source=await PDFDocument.create();const marks:any[]=[];
 for(let i=0;i<4;i++){
  const page=source.addPage([612,792]);page.setCropBox(32,47,400,600);page.setRotation(degrees(i*90));page.drawText('Original page '+(i+1),{x:80,y:550,size:14});
  const pageNo=i+1;let n=0;const base={page:pageNo,color:'blue',quote:'selected words',revision:1,size:14,width:3,comment:'中文评论 '+pageNo};
  for(const [kind,rects,extras]of [
   ['highlight',[{x:.1,y:.1,w:.5,h:.03},{x:.1,y:.14,w:.4,h:.03}],{}],
   ['underline',[{x:.1,y:.22,w:.5,h:.035}],{}],
   ['note',[{x:.75,y:.1,w:.025,h:.025}],{}],
   ['text',[{x:.2,y:.3,w:.6,h:.13}],{content:'中文标注 Aa 12',comment:'文字的独立评论'}],
   ['area',[{x:.1,y:.55,w:.45,h:.15}],{}],
   ['ink',[{x:.6,y:.55,w:.25,h:.12}],{points:[{x:.6,y:.55},{x:.7,y:.6},{x:.85,y:.67}]}],
  ]as any[])marks.push({...base,id:'m'+i+'-'+n++,kind,rects,...extras});
  marks.push({...base,id:'bookmark'+i,kind:'bookmark',rects:[]});
 }
 const c=source.context,link=c.register(c.obj({Type:'Annot',Subtype:'Link',Rect:[80,500,200,520],A:{Type:'Action',S:'URI',URI:require('pdf-lib').PDFString.of('https://example.org')}}));source.getPage(0).node.addAnnot(link);
 const outline=c.obj({Type:'Outlines',Count:1}),outlineRef=c.register(outline),entry=c.obj({Title:PDFHexString.fromText('Original outline'),Parent:outlineRef,Dest:[source.getPage(0).ref,'Fit']}),entryRef=c.register(entry);outline.set(PDFName.of('First'),entryRef);outline.set(PDFName.of('Last'),entryRef);source.catalog.set(PDFName.of('Outlines'),outlineRef);
 const original=await source.save(),output=await annotatePDF(original,marks,readFileSync(fileURLToPath(new URL('../assets/fonts/NotoSansCJKsc-Regular.otf',import.meta.url)))),doc=await PDFDocument.load(output);
 assert.equal(doc.getPageCount(),4);
 for(let i=0;i<4;i++){
  const page=doc.getPage(i);assert.equal(page.getRotation().angle,i*90);assert.deepEqual(page.getCropBox(),{x:32,y:47,width:400,height:600});
  const annots=page.node.Annots().asArray().map((ref:any)=>doc.context.lookup(ref,PDFDict));
  assert.equal(annots.filter((a:any)=>a.get(PDFName.of('NM'))?.decodeText().startsWith('ResearchDesk-')).length,7);
  const free=annots.find((a:any)=>a.get(PDFName.of('Subtype')).asString()==='/FreeText');assert.equal(free.get(PDFName.of('Contents')).decodeText(),'中文标注 Aa 12');
  const reply=annots.find((a:any)=>a.get(PDFName.of('IRT')));assert.equal(reply.get(PDFName.of('Contents')).decodeText(),'文字的独立评论');
  const highlight=annots.find((a:any)=>a.get(PDFName.of('Subtype')).asString()==='/Highlight');assert.equal(highlight.lookup(PDFName.of('QuadPoints'),require('pdf-lib').PDFArray).size(),16);
  assert.deepEqual(geometry(page).point(0,0),i===0?[32,647]:i===1?[32,47]:i===2?[432,47]:[432,647]);
 }
 assert.equal(doc.getPage(0).node.Annots().size(),8);
 const root=doc.catalog.lookup(PDFName.of('Outlines'),PDFDict),first=doc.context.lookup(root.get(PDFName.of('First')),PDFDict);assert.equal(first.get(PDFName.of('Title')).decodeText(),'Original outline');assert.ok(first.get(PDFName.of('Next')));
 const out=fileURLToPath(new URL('../test-results/native-export-0.5.0/',import.meta.url));mkdirSync(out,{recursive:true});writeFileSync(out+'native.pdf',output);
});
