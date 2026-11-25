import {api,type Paper} from './api';
import {loadPDF,pdfGlyphs} from './pdf';
export async function enrichMetadata(paper:Paper,online=true):Promise<Paper>{
 const task=loadPDF(paper.id);
 try{
  const doc=await task.promise,metadata=await doc.getMetadata(),info=metadata.info as {Title?:string;Author?:string;Keywords?:string;CreationDate?:string};
  const first=await doc.getPage(1),glyphs=await pdfGlyphs(first);
  const candidates=glyphs.filter(g=>g.rect.y<.35&&g.rect.y>.025&&g.rect.w>.02&&Math.abs(g.rotation||0)<20);
  const largest=Math.max(...candidates.map(g=>g.height||g.rect.h),0);
  const title=candidates.filter(g=>(g.height||g.rect.h)>=largest*.85).sort((a,b)=>a.rect.y-b.rect.y||a.rect.x-b.rect.x).map(g=>g.text).join(' ').trim();
  const embedded=info.Title?.trim()||'';
  const usable=embedded.length>10&&!/^(?:untitled|microsoft word|latex|template|document)/i.test(embedded);
  let text=glyphs.map(g=>g.text).join(' ');
  if(doc.numPages>1){const second=await doc.getPage(2);text+=' '+(await second.getTextContent()).items.flatMap(item=>'str' in item?[item.str]:[]).join(' ')}
  const date=info.CreationDate?.match(/(?:D:)?(20\d{2}|19\d{2})/);
  return await api<Paper>('/papers/'+paper.id+'/metadata','POST',{revision:paper.revision,title:usable?embedded:title,authors:info.Author||'',year:date?Number(date[1]):0,keywords:info.Keywords||'',text:text.slice(0,50000),online});
 }finally{await task.destroy().catch(()=>{})}
}
