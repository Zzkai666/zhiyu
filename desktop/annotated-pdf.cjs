const {PDFDocument,PDFName,PDFNumber,PDFDict,PDFHexString,PDFString}=require('pdf-lib');
const tones={amber:'#eeb120',red:'#e45e65',purple:'#9a7add',orange:'#e69b46',gray:'#96999d',green:'#48a976',blue:'#4b9fe0',pink:'#dc6da4'};
const num=n=>Number(n.toFixed(4));
function geometry(page){
 const box=page.getCropBox(),rotation=((page.getRotation().angle%360)+360)%360;
 if(![0,90,180,270].includes(rotation))throw Error('PDF 页面旋转角度不受支持');
 const unit=page.node.lookupMaybe(PDFName.of('UserUnit'),PDFNumber)?.asNumber()||1;
 const point=(u,v)=>rotation===90?[box.x+v*box.width,box.y+u*box.height]:rotation===180?[box.x+(1-u)*box.width,box.y+v*box.height]:rotation===270?[box.x+(1-v)*box.width,box.y+(1-u)*box.height]:[box.x+u*box.width,box.y+(1-v)*box.height];
 return{point,rotation,unit,viewWidth:rotation%180?box.height:box.width,viewHeight:rotation%180?box.width:box.height};
}
function bounds(points){const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);return[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)]}
function corners(rect,geo){return[geo.point(rect.x,rect.y),geo.point(rect.x+rect.w,rect.y),geo.point(rect.x,rect.y+rect.h),geo.point(rect.x+rect.w,rect.y+rect.h)]}
const matrices={0:[1,0,0,1,0,0],90:[0,1,-1,0,0,0],180:[-1,0,0,-1,0,0],270:[0,-1,1,0,0,0]};
function appearance(doc,box,commands,extra={}){
 const resources=doc.context.obj({ExtGState:{Shade:{Type:'ExtGState',ca:.4,CA:.4,BM:'Multiply'},Light:{Type:'ExtGState',ca:.07,CA:1}}});
 if(extra.font)resources.set(PDFName.of('Font'),doc.context.obj({[extra.fontName]:extra.font.ref}));
 return doc.context.register(doc.context.flateStream(Buffer.from(commands,'utf8'),{Type:'XObject',Subtype:'Form',FormType:1,BBox:box,Resources:resources,...(extra.matrix?{Matrix:extra.matrix}:{})}));
}
function wrapText(text,font,size,maxWidth){
 const lines=[];for(const paragraph of text.replace(/\r/g,'').split('\n')){
  let line='';for(const char of Array.from(paragraph)){if(line&&font.widthOfTextAtSize(line+char,size)>maxWidth){lines.push(line);line=''}line+=char}lines.push(line);
 }return lines;
}
function addBookmarks(doc,marks){
 const saved=marks.filter(m=>m.kind==='bookmark');if(!saved.length)return;
 const c=doc.context;let rootRef=doc.catalog.get(PDFName.of('Outlines')),root=rootRef?c.lookup(rootRef,PDFDict):null;
 if(!root){root=c.obj({Type:'Outlines',Count:0});rootRef=c.register(root);doc.catalog.set(PDFName.of('Outlines'),rootRef)}
 else if(!(rootRef?.objectNumber)){rootRef=c.register(root);doc.catalog.set(PDFName.of('Outlines'),rootRef)}
 const folder=c.obj({Title:PDFHexString.fromText('ResearchDesk 书签'),Parent:rootRef,Count:-saved.length}),folderRef=c.register(folder);
 const children=saved.map(m=>{const page=doc.getPage(m.page-1);const entry=c.obj({Title:PDFHexString.fromText('第 '+m.page+' 页'+(m.comment?' · '+m.comment:'')),Parent:folderRef,Dest:[page.ref,'Fit']});return{entry,ref:c.register(entry)}});
 children.forEach((v,i)=>{if(i)v.entry.set(PDFName.of('Prev'),children[i-1].ref);if(i+1<children.length)v.entry.set(PDFName.of('Next'),children[i+1].ref)});
 folder.set(PDFName.of('First'),children[0].ref);folder.set(PDFName.of('Last'),children.at(-1).ref);
 const oldLast=root.get(PDFName.of('Last'));if(oldLast){c.lookup(oldLast,PDFDict).set(PDFName.of('Next'),folderRef);folder.set(PDFName.of('Prev'),oldLast)}else root.set(PDFName.of('First'),folderRef);
 root.set(PDFName.of('Last'),folderRef);const count=root.lookupMaybe(PDFName.of('Count'),PDFNumber)?.asNumber()||0;root.set(PDFName.of('Count'),PDFNumber.of(count>=0?count+1:count-1));
}
async function annotatePDF(bytes,marks,fontBytes){
 let doc;try{doc=await PDFDocument.load(bytes,{updateMetadata:false})}catch(error){if(error.name==='EncryptedPDFError')throw Error('该 PDF 已加密，请先使用有权限的未加密副本导出。原文件未更改。');throw error}
 let font;const fontNames=new Map(),c=doc.context;
 for(const mark of marks){
  if(mark.page<1||mark.page>doc.getPageCount())throw Error('标注页码超出原 PDF，导出已停止');
  if(mark.kind==='bookmark')continue;
  if(!tones[mark.color]||!Array.isArray(mark.rects)||!mark.rects.length)throw Error('标注数据不完整');
  const page=doc.getPage(mark.page-1),geo=geometry(page),color=[1,3,5].map(i=>parseInt(tones[mark.color].slice(i,i+2),16)/255),paint=color.map(num).join(' '),r={...mark.rects[0]};
  if(mark.kind==='note'){r.w=Math.min(22/geo.unit/geo.viewWidth,1-r.x);r.h=Math.min(22/geo.unit/geo.viewHeight,1-r.y)}
  const all=(mark.kind==='highlight'||mark.kind==='underline'?mark.rects:[r]).map(rect=>corners(rect,geo)),box=bounds(all.flat());
  if(['ink','underline','area'].includes(mark.kind)){const pad=(mark.kind==='ink'?(mark.width||2)/2+1:1.2)/geo.unit;box[0]-=pad;box[1]-=pad;box[2]+=pad;box[3]+=pad}
  const width=box[2]-box[0],height=box[3]-box[1];
  if(width<=0||height<=0)throw Error('标注区域尺寸无效');
  const local=p=>[num(p[0]-box[0]),num(p[1]-box[1])],path=quad=>{const v=[quad[0],quad[1],quad[3],quad[2]].map(local);return v.map((p,i)=>p.join(' ')+(i?' l':' m')).join(' ')+' h'};
  let subtype,commands='q\n'+paint+' rg\n'+paint+' RG\n',ap,extra={};
  if(mark.kind==='highlight'){subtype='Highlight';commands+='/Shade gs\n'+all.map(q=>path(q)+' f').join('\n')}
  else if(mark.kind==='underline'){subtype='Underline';commands+=(1.2/geo.unit)+' w\n'+all.map(q=>local(q[2]).join(' ')+' m '+local(q[3]).join(' ')+' l S').join('\n')}
  else if(mark.kind==='area'){subtype='Square';commands+='q /Light gs '+path(all[0])+' f Q\n'+(1.7/geo.unit)+' w\n'+path(all[0])+' S';extra.IC=color}
  else if(mark.kind==='ink'){
   subtype='Ink';if(!mark.points||mark.points.length<2)throw Error('绘图轨迹不完整');
   const points=mark.points.map(p=>geo.point(p.x,p.y));extra.InkList=[points.flat().map(num)];
   commands+=(mark.width||2)/geo.unit+' w 1 J 1 j\n'+points.map((p,i)=>local(p).join(' ')+(i?' l':' m')).join(' ')+' S';
  }else if(mark.kind==='note'){
   subtype='Text';const w=r.w*geo.viewWidth,h=r.h*geo.viewHeight;
   commands='q '+paint+' rg 0 0 '+num(w)+' '+num(h)+' re f 1 1 1 RG 1 w 3 '+num(h-5)+' m '+num(w-3)+' '+num(h-5)+' l S 3 '+num(h-9)+' m '+num(w-5)+' '+num(h-9)+' l S Q';
   ap=appearance(doc,[0,0,w,h],commands,{matrix:matrices[geo.rotation]});extra.Name=PDFName.of('Comment');
  }else if(mark.kind==='text'){
   subtype='FreeText';
   if(!font){if(!fontBytes)throw Error('导出字体缺失，未保存 PDF');doc.registerFontkit(require('@pdf-lib/fontkit'));font=await doc.embedFont(fontBytes,{subset:true})}
   if(!fontNames.has(page))fontNames.set(page,page.node.newFontDictionary('RDExportFont',font.ref).asString().slice(1));
   const fontName=fontNames.get(page),w=r.w*geo.viewWidth,h=r.h*geo.viewHeight,size=(mark.size||14)/geo.unit;
   const lines=wrapText(mark.content||'',font,size,Math.max(size,w-2/geo.unit));commands='q 0 0 '+num(w)+' '+num(h)+' re W n\n'+paint+' rg\n';
   for(let i=0;i<lines.length;i++){const y=h-size-i*size*1.35;if(y < -size)break;commands+='BT /'+fontName+' '+num(size)+' Tf 1 '+num(y)+' Td '+font.encodeText(lines[i]).toString()+' Tj ET\n'}commands+='Q';
   ap=appearance(doc,[0,0,w,h],commands,{font,fontName,matrix:matrices[geo.rotation]});
   extra.DA=PDFString.of('/'+fontName+' '+num(size)+' Tf '+paint+' rg');extra.Q=0;
  }else throw Error('不支持的标注类型');
  if(!ap)ap=appearance(doc,[0,0,width,height],commands+'\nQ');
  const annotation=c.obj({Type:'Annot',Subtype:subtype,Rect:box.map(num),C:color,CA:mark.kind==='highlight'?.4:1,F:4,
   Contents:PDFHexString.fromText(mark.kind==='text'?(mark.content||''):(mark.comment||'')),T:PDFHexString.fromText('ResearchDesk'),NM:PDFString.of('ResearchDesk-'+mark.id),Subj:PDFHexString.fromText(mark.kind),
   M:PDFString.fromDate(new Date()),P:page.ref,Border:[0,0,0],AP:{N:ap},...extra});
  if(subtype==='Highlight'||subtype==='Underline')annotation.set(PDFName.of('QuadPoints'),c.obj(all.flatMap(q=>q.flat()).map(num)));
  const ref=c.register(annotation);page.node.addAnnot(ref);
  if(mark.kind==='text'&&mark.comment){
   const empty=appearance(doc,[0,0,1,1],'q Q');page.node.addAnnot(c.register(c.obj({Type:'Annot',Subtype:'Text',Rect:[box[0],box[1],box[0]+.01,box[1]+.01],Contents:PDFHexString.fromText(mark.comment),T:PDFHexString.fromText('ResearchDesk'),NM:PDFString.of('ResearchDesk-'+mark.id+'-comment'),Subj:PDFHexString.fromText('文字标注评论'),IRT:ref,RT:'R',P:page.ref,F:0,AP:{N:empty}})));
  }
 }
 addBookmarks(doc,marks);return Buffer.from(await doc.save({updateFieldAppearances:false}));
}
module.exports={annotatePDF,geometry};
