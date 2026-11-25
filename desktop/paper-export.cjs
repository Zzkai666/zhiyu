const {BrowserWindow,dialog,ipcMain,shell}=require('electron');
const {readFile,writeFile,rename,mkdir,rm,lstat,realpath}=require('node:fs/promises');
const {resolve,join,dirname,basename,extname,sep,isAbsolute}=require('node:path');
const {randomBytes,createHash}=require('node:crypto');
const {atomicWrite,writeMarkdownAssets}=require('./export-files.cjs');
function safeName(name){return Array.from(name).map(c=>c.codePointAt(0)<32||[60,62,58,34,47,92,124,63,42].includes(c.codePointAt(0))?'_':c).join('').trim().replace(/[. ]+$/g,'').slice(0,95)||'论文'}
function installExports({assertSender,coreRequest,parent,workspace,fontPath}){
 const jobs=new Map();let exporting=false;
 async function response(path,options){const r=await coreRequest(path,options);if(!r.ok){let error;try{error=(await r.json()).error}catch{}throw Error(error||'无法读取导出内容')}return r}
 const current=id=>{const job=jobs.get(id);if(!job||Date.now()-job.time>30*60*1000)throw Error('导出快照已过期，请重新打开导出窗口');return job};
 async function destination(path,extension,sourceID){
  if(!isAbsolute(path))throw Error('请选择完整的保存路径');
  if(!extname(path))path+='.'+extension;else if(extname(path).toLowerCase()!=='.'+extension)throw Error('请使用 .'+extension+' 扩展名保存该格式');
  const parentPath=await realpath(dirname(path)),base=await realpath(workspace),absolute=join(parentPath,basename(path));
  const under=(p,b)=>p.toLowerCase()===b.toLowerCase()||p.toLowerCase().startsWith(b.toLowerCase()+sep);
  if(under(absolute,base))throw Error('请导出到资料库以外的文件夹，以免覆盖原始资料');
  try{const info=await lstat(absolute);if(info.isSymbolicLink()||!info.isFile())throw Error('不能覆盖此路径');
   if(extension==='pdf'&&info.size<=200*1024*1024&&createHash('sha256').update(await readFile(absolute)).digest('hex')===sourceID)throw Error('请另存为新文件，保留导入时的原始 PDF');
  }catch(err){if(err.code!=='ENOENT')throw err}
  return absolute;
 }
 ipcMain.handle('prepare-paper-export',async(event,paper)=>{
  assertSender(event);if(typeof paper!=='string'||!/^[a-f0-9]{64}$/.test(paper))throw Error('文献标识无效');
  for(const[id,j]of jobs)if(Date.now()-j.time>30*60*1000)jobs.delete(id);
  if(jobs.size>=4)jobs.delete(jobs.keys().next().value);
  const snapshot=await(await response('/papers/'+paper+'/export')).json(),id=randomBytes(18).toString('hex');
  jobs.set(id,{snapshot,time:Date.now()});return{id,snapshot};
 });
 ipcMain.handle('release-paper-export',(event,id)=>{assertSender(event);jobs.delete(id)});
 ipcMain.handle('open-paper-export',async(event,id,folder)=>{
  assertSender(event);const job=current(id);if(!job.saved)throw Error('尚未导出文件');
  if(folder)shell.showItemInFolder(job.saved);else{const error=await shell.openPath(job.saved);if(error)throw Error(error)}
 });
 ipcMain.handle('export-paper',async(event,input)=>{
  assertSender(event);if(exporting)throw Error('正在完成上一次导出，请稍后重试');
  if(!input||!['pdf','docx','markdown','annotated-pdf'].includes(input.format))throw Error('导出格式无效');
  const job=current(input.id),snapshot=job.snapshot,annotated=input.format==='annotated-pdf',extension=annotated||input.format==='pdf'?'pdf':input.format==='markdown'?'md':'docx';
  if(!annotated&&(!snapshot.translated||snapshot.pending&&!input.includeUntranslated))throw Error('请完成翻译，或明确选择导出当前进度');
  exporting=true;let imageFolder;
  try{
  const selection=await dialog.showSaveDialog(parent(),{title:annotated?'导出带标注的 PDF':'导出论文译文',defaultPath:safeName(snapshot.paper.title)+(annotated?' - 标注':snapshot.pending?' - 当前译文进度':' - 译文')+'.'+extension,filters:[{name:extension==='md'?'Markdown':extension==='docx'?'Word 文档':'PDF 文档',extensions:[extension]}]});
  if(selection.canceled||!selection.filePath)return{canceled:true};
   const target=await destination(selection.filePath,extension,snapshot.paper.id);let bytes;
   if(annotated){
    const original=Buffer.from(await(await response('/papers/'+snapshot.paper.id+'/pdf')).arrayBuffer());
    if(createHash('sha256').update(original).digest('hex')!==snapshot.paper.id)throw Error('原始 PDF 与导出快照不一致，已停止导出');
    bytes=await require('./annotated-pdf.cjs').annotatePDF(original,snapshot.marks,await readFile(fontPath));
   }else{
    const assets=Array.isArray(input.assets)?input.assets:[];let count=0;
    const allowed=new Set(snapshot.plan.groups.filter(g=>g.regions.length&&['figure','table','formula'].includes(g.regions[0].kind)).map(g=>g.id));
    for(const a of assets){if(!a||!allowed.has(a.id)||typeof a.png!=='string'||a.png.length>30*1024*1024)throw Error('图片数据无效');count+=a.png.length}
    if(count>128*1024*1024)throw Error('导出图片过大');
    const prefix='ResearchDesk-assets-'+randomBytes(6).toString('hex'),renderFormat=input.format==='pdf'?'html':input.format;
    const rendered=await response('/exports/render/'+renderFormat,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({snapshot,assets,includeUntranslated:Boolean(input.includeUntranslated),assetPrefix:prefix})});
    if(input.format==='pdf'){
     job.html=await rendered.text();let printing;
     try{
      printing=new BrowserWindow({show:false,width:1000,height:900,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
      printing.webContents.setWindowOpenHandler(()=>({action:'deny'}));printing.webContents.on('will-navigate',e=>e.preventDefault());
      await printing.loadURL('rdnext://workspace/export-document/'+input.id);
      await printing.webContents.executeJavaScript('Promise.all([document.fonts.load(\'12px "ResearchDesk Export"\'),document.fonts.ready,...Array.from(document.images,img=>img.complete?Promise.resolve():new Promise((ok,bad)=>{img.onload=ok;img.onerror=()=>bad(new Error("导出图片加载失败"))}))])');
      bytes=await printing.webContents.printToPDF({printBackground:true,pageSize:'A4',preferCSSPageSize:true,generateTaggedPDF:true,generateDocumentOutline:true,displayHeaderFooter:true,headerTemplate:'<span></span>',footerTemplate:'<div style="font-size:8px;text-align:center;width:100%;color:#777"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',margins:{top:.78,bottom:.82,left:.74,right:.74}});
     }finally{delete job.html;if(printing&&!printing.isDestroyed())printing.destroy()}
    }else if(input.format==='docx')bytes=Buffer.from(await rendered.arrayBuffer());
    else{
     bytes=Buffer.from(await rendered.text(),'utf8');
     if(assets.length){
      imageFolder=await writeMarkdownAssets(dirname(target),prefix,assets);
     }
    }
   }
   await atomicWrite(target,bytes);job.saved=target;imageFolder=null;
   return{canceled:false,path:target,bytes:bytes.length};
  }finally{
   if(imageFolder)await rm(imageFolder,{recursive:true,force:true}).catch(()=>{});
   exporting=false;
  }
 });
 return{responseFor:async url=>{if(url.pathname==='/export-font.otf')return new Response(await readFile(fontPath),{headers:{'Content-Type':'font/otf','Access-Control-Allow-Origin':'*'}});const hit=url.pathname.match(/^\/export-document\/([a-f0-9]{36})$/);if(hit&&jobs.get(hit[1])?.html)return new Response(jobs.get(hit[1]).html,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}});return null}};
}
module.exports={installExports,safeName};
