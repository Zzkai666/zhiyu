import {useEffect,useRef,useState} from 'react';
import {Download,FileText,FolderOpen,ExternalLink} from 'lucide-react';
import type {PDFDocumentProxy} from 'pdfjs-dist';
import type {Paper,Mark} from './api';
import type {ReadingPlan} from './ReadingRegions';
import {cropOriginal} from './ContinuousPDF';
import {message} from './api';
import {Modal} from './ui';
export type ExportSnapshot={paper:Paper;plan:ReadingPlan;marks:Mark[];savedAt:string;translated:number;pending:number};
export type PreparedExport={id:string;snapshot:ExportSnapshot};
type Format='pdf'|'docx'|'markdown'|'annotated-pdf';
export function PaperExport({paper,doc,close}:{paper:Paper;doc?:PDFDocumentProxy;close:()=>void}){
 const [prepared,setPrepared]=useState<PreparedExport>(),[format,setFormat]=useState<Format>('pdf'),[partial,setPartial]=useState(false),[busy,setBusy]=useState(false),[status,setStatus]=useState('正在核对已保存内容…'),[error,setError]=useState(''),[saved,setSaved]=useState<{path:string;bytes:number}>();
 const [retry,setRetry]=useState(0);
 const assetCache=useRef<{id:string;assets:{id:string;png:string}[]}|null>(null);
 useEffect(()=>{
  let gone=false,id='';setPrepared(undefined);setError('');setStatus('正在核对已保存内容…');
  void window.desktop.preparePaperExport(paper.id).then(result=>{id=result.id;if(gone){void window.desktop.releasePaperExport(id);return}setPrepared(result);setStatus('')}).catch(err=>{if(!gone){setError(message(err));setStatus('')}});
  return()=>{gone=true;if(id)void window.desktop.releasePaperExport(id)};
 },[paper.id,retry]);
 const snapshot=prepared?.snapshot,annotated=format==='annotated-pdf',visuals=snapshot?.plan.groups.filter(g=>g.regions.length&&['figure','table','formula'].includes(g.regions[0].kind))||[];
 const incomplete=Boolean(snapshot?.pending),pagesReady=Boolean(doc&&snapshot&&snapshot.plan.pages.length===doc.numPages);
 const ready=prepared&&(annotated||snapshot!.translated>0&&pagesReady&&(!incomplete||partial));
 async function run(){
  if(!prepared||!ready||busy)return;setBusy(true);setSaved(undefined);setError('');
  try{
   let assets:{id:string;png:string}[]=[];
   if(!annotated){if(!doc)throw Error('原文尚未打开，请稍后重试');
    if(assetCache.current?.id===prepared.id)assets=assetCache.current.assets;else{
    let total=0;for(const[index,group]of visuals.entries()){
     setStatus('正在准备图表与公式 '+(index+1)+' / '+visuals.length+'…');
     const source=group.regions[0],url=await cropOriginal(doc,source.page,source.rect),png=url.slice(url.indexOf(',')+1);total+=png.length;
     if(total>128*1024*1024)throw Error('导出图片超过支持的大小，未写入文件');assets.push({id:group.id,png});
    }
    assetCache.current={id:prepared.id,assets};}
   }
   setStatus('请选择保存位置，随后生成文件…');
   const result=await window.desktop.exportPaper({id:prepared.id,format,includeUntranslated:partial,assets});
   if(result.canceled)setStatus('已取消，没有写入导出文件。');else{setSaved({path:result.path!,bytes:result.bytes!});setStatus('导出完成。')}
  }catch(err){setError(message(err));setStatus('导出未完成，已保存的阅读资料保持。')}
  finally{setBusy(false)}
 }
 return <Modal title="导出论文" subtitle={paper.title} close={()=>{if(!busy)close()}} className="paper-export-modal">
  <div className="paper-export">
   <div className="export-formats" role="group" aria-label="导出格式">
    {([['pdf','译文 PDF','适合阅读、打印'],['docx','译文 Word','段落可编辑，图表内嵌'],['markdown','译文 Markdown','正文与图片文件夹'],['annotated-pdf','带标注的 PDF','保留原页与批注']] as const).map(([id,label,detail])=><button key={id} disabled={busy} aria-pressed={format===id} onClick={()=>{setFormat(id);setSaved(undefined);setError('');setStatus('')}}><FileText size={17}/><span><strong>{label}</strong><small>{detail}</small></span></button>)}
   </div>
   {snapshot&&<div className="export-summary">
    {annotated?<><strong>{snapshot.marks.filter(m=>m.kind!=='bookmark').length} 条页面标注 · {snapshot.marks.filter(m=>m.kind==='bookmark').length} 个书签</strong><p>保留原 PDF 的文字、页面和链接。高亮、下划线、注释、文字、区域及绘图连同评论导出；书签加入 PDF 目录。</p></>:
     <><strong>{snapshot.translated} 段已翻译 · {snapshot.pending} 段待翻译 · {visuals.length} 处图表与公式</strong><p>按保存后的完整段落导出；图表和独立公式保留原图，作者与参考文献保留原文。页眉页脚不进入译文正文。</p>
      {!pagesReady&&<p className="error">请等待整篇论文解析完成，再导出完整译文。</p>}
      {!snapshot.translated&&<p className="error">这篇论文还没有已保存的译文，请先翻译。</p>}
      {incomplete&&<label className="check-line"><input type="checkbox" checked={partial} disabled={busy} onChange={e=>setPartial(e.target.checked)}/>导出当前进度：未译段明确标记并保留原文</label>}
      {format==='markdown'&&<p>图片会保存到 Markdown 文件旁的独立文件夹。分享或移动时，请把两者一起带走。</p>}
     </>}
    <small>使用打开本窗口时的已保存快照，不调用 AI、不修改论文资料。重新打开可读取最新内容。</small>
   </div>}
   {error&&<p className="error" role="alert">{error}{!prepared&&<button className="quiet" onClick={()=>setRetry(n=>n+1)}>重新读取</button>}</p>}
   <p className="export-progress" role="status">{busy?<span className="export-spinner"/>:null}{status}</p>
   {saved&&<div className="export-saved"><p>{saved.path}</p><small>{(saved.bytes/1024/1024).toFixed(2)} MiB</small><div>
    <button className="secondary" onClick={()=>void window.desktop.openPaperExport(prepared!.id,false).catch(err=>setError(message(err)))}><ExternalLink size={15}/>打开文件</button>
    <button className="quiet" onClick={()=>void window.desktop.openPaperExport(prepared!.id,true).catch(err=>setError(message(err)))}><FolderOpen size={15}/>打开所在文件夹</button>
   </div></div>}
   <div className="form-actions"><button className="primary" disabled={!ready||busy} onClick={()=>void run()}><Download size={16}/>{busy?'正在导出…':annotated?'导出带标注 PDF':incomplete?'导出当前译文进度':'导出完整译文'}</button></div>
  </div>
 </Modal>;
}
