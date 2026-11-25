import {_electron as electron} from 'playwright';import assert from 'node:assert/strict';import {mkdir,mkdtemp,readFile,writeFile,readdir,copyFile,stat} from 'node:fs/promises';import {resolve,join} from 'node:path';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PDFDocument,PDFDict,PDFName}=require('pdf-lib');
const output=resolve(process.env.RDNEXT_EXPORT_RESULTS||'test-results/export-0.5.0');await mkdir(output,{recursive:true});const root=await mkdtemp(join(output,'isolated-')),folder=join(root,'exports'),events=join(root,'events.jsonl');await mkdir(folder);
const exe=process.env.RDNEXT_EXE;let app,page;const errors=[];const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),sample=resolve('test-results/reader-0.2.1/2510.07077v1.pdf');
const call=(path,method='GET',data)=>page.evaluate(async({path,method,data})=>{const r=await fetch('/api'+path,{method,...(data===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})});const value=await r.json();if(!r.ok)throw Error(JSON.stringify(value));return value},{path,method,data});
async function until(fn,label,timeout=60000){const begin=Date.now();while(Date.now()-begin<timeout){if(await fn())return;await new Promise(r=>setTimeout(r,100))}throw Error(label)}
const turns=async()=>{try{return(await readFile(events,'utf8')).split('\n').filter(Boolean).map(JSON.parse).filter(x=>x.method==='turn/start').length}catch{return 0}};
async function launch(){app=await electron.launch({args:[...(exe?[]:['.']),'--workspace='+join(root,'workspace')],...(exe?{executablePath:exe}:{}),env:{...process.env,RDNEXT_TEST_HIDE:'1',RDNEXT_CODEX:resolve('dist/bin/rdnext-test-codex.exe'),RDNEXT_CODEX_EVENTS:events}});page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.getByRole('heading',{name:'今日工作台'}).waitFor();assert.equal(await app.evaluate(({app})=>app.getVersion()),JSON.parse(await readFile('package.json','utf8')).version)}
const openDialog=()=>page.getByRole('dialog',{name:'导出论文',exact:true});
const chooseFile=async path=>app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>file?({canceled:false,filePath:file}):({canceled:true})},path);
try{
 await launch();await page.evaluate(()=>{localStorage.setItem('rdnext.metadata.disabled','true');localStorage.setItem('rdnext.translation.model','fixture-model');localStorage.setItem('rdnext.translation.effort','medium')});
 await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]})},sample);
 await page.getByRole('button',{name:'导入 PDF',exact:true}).click();await page.getByRole('button',{name:'选择 PDF 文件'}).click();await page.getByRole('button',{name:'完成',exact:true}).click();
 let paper;await until(async()=>{[paper]=await call('/papers');return paper},'paper not imported');const base='/papers/'+paper.id,regions=JSON.parse(await readFile('tests/fixtures/vla-legacy-regions.json','utf8'));
 for(let n=1;n<=38;n++)await call(base+'/reading/pages/'+n,'PUT',regions.filter(r=>r.page===n));
 const definitions=[
 {kind:'highlight',color:'amber',quote:'selected original',comment:'高亮中文评论',rects:[{x:.1,y:.55,w:.4,h:.02},{x:.1,y:.575,w:.3,h:.02}]},
 {kind:'underline',color:'red',quote:'underlined original',comment:'下划线中文评论',rects:[{x:.1,y:.62,w:.4,h:.02}]},
 {kind:'note',color:'green',comment:'页面笔记评论',rects:[{x:.1,y:.12,w:.025,h:.025}]},
 {kind:'text',color:'blue',content:'中文自由文字 Aa 12',comment:'文字独立评论',rects:[{x:.5,y:.19,w:.4,h:.05}],size:14},
 {kind:'area',color:'purple',comment:'区域截图评论',rects:[{x:.5,y:.7,w:.4,h:.12}]},
 {kind:'ink',color:'orange',comment:'绘图评论',rects:[{x:.55,y:.29,w:.3,h:.04}],points:[{x:.55,y:.29},{x:.65,y:.31},{x:.85,y:.33}],width:3},
 {kind:'bookmark',color:'amber',comment:'',rects:[]}
 ];
 for(const d of definitions){let saved=await call(base+'/marks','POST',{page:1,quote:'',size:14,width:2,...d});if(d.kind==='highlight'||d.kind==='underline')await call(base+'/marks/'+saved.id,'PUT',{...saved,comment:d.comment})}
 await page.getByRole('button',{name:'阅读',exact:true}).click();await until(async()=>(await call('/paper-jobs')).some(j=>j.paperId===paper.id&&j.stage==='parse'&&j.state==='done'),'analysis still running');
 let plan=await call(base+'/reading');const first=plan.groups.find(g=>g.translate&&g.regions[0].kind==='text');await call(base+'/reading/translate','POST',{groups:[first.id],model:'fixture-model',effort:'medium'});
 const beforeExports=await turns(),originalHash=sha(await readFile(sample));
 await page.getByRole('button',{name:'更多',exact:true}).click();
 await page.getByRole('button',{name:'导出论文',exact:true}).click();await openDialog().getByText(/段已翻译/).waitFor();assert.ok(await openDialog().getByRole('button',{name:'导出当前译文进度',exact:true}).isDisabled());
 await openDialog().getByRole('button',{name:'带标注的 PDF',exact:false}).click();await chooseFile(null);await openDialog().getByRole('button',{name:'导出带标注 PDF',exact:true}).click();await openDialog().getByText('已取消，没有写入导出文件。',{exact:true}).waitFor();assert.equal((await readdir(folder)).length,0);
 const native=join(folder,'annotated.pdf');await chooseFile(native);await openDialog().getByRole('button',{name:'导出带标注 PDF',exact:true}).click();await openDialog().getByText('导出完成。',{exact:true}).waitFor({timeout:180000});
 const savedNative=await PDFDocument.load(await readFile(native)),source=await PDFDocument.load(await readFile(sample));assert.equal(savedNative.getPageCount(),source.getPageCount());let comments=[];
 for(const pg of savedNative.getPages()){for(const ref of pg.node.Annots()?.asArray()||[]){const a=savedNative.context.lookup(ref,PDFDict),name=a.get(PDFName.of('NM'))?.decodeText();if(name?.startsWith('ResearchDesk-'))comments.push(a.get(PDFName.of('Contents'))?.decodeText())}}
 for(const text of ['高亮中文评论','下划线中文评论','页面笔记评论','中文自由文字 Aa 12','文字独立评论','区域截图评论','绘图评论'])assert.ok(comments.includes(text),text);
 const copy=join(folder,'original-copy.pdf');await copyFile(sample,copy);await chooseFile(copy);await openDialog().getByRole('button',{name:'导出带标注 PDF',exact:true}).click();await openDialog().getByRole('alert').filter({hasText:'原始 PDF'}).waitFor();assert.equal(sha(await readFile(copy)),originalHash);
 await chooseFile(join(root,'workspace','pdf',paper.id+'.pdf'));await openDialog().getByRole('button',{name:'导出带标注 PDF',exact:true}).click();await openDialog().getByRole('alert').filter({hasText:'资料库以外'}).waitFor();
 await openDialog().getByRole('button',{name:'译文 Markdown',exact:false}).click();await openDialog().getByRole('checkbox').check();const partial=join(folder,'partial.md');await chooseFile(partial);await openDialog().getByRole('button',{name:'导出当前译文进度',exact:true}).click();await openDialog().getByText('导出完成。',{exact:true}).waitFor({timeout:180000});assert.ok((await readFile(partial,'utf8')).includes('【未翻译，保留原文】'));assert.equal(await turns(),beforeExports,'export requested a model');
 await openDialog().getByRole('button',{name:'关闭对话框'}).click();
 plan=await call(base+'/reading');await call(base+'/reading','PATCH',{revision:plan.revision,action:'review-all',first:''});
 plan=await call(base+'/reading');const batch=await page.evaluate(async({base,revision})=>{const r=await fetch('/api'+base+'/reading/translate-batches',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scope:'paper',revision,model:'fixture-model',effort:'medium'})});return{status:r.status,text:await r.text()}},{base,revision:plan.revision});assert.equal(batch.status,200,batch.text.slice(-1000));assert.ok(batch.text.includes('"kind":"done"'),batch.text.slice(-1000));
 const frozenBefore=await call(base+'/export');assert.equal(frozenBefore.pending,0);const modelBefore=await turns();
 await page.getByRole('button',{name:'更多',exact:true}).click();
 await page.getByRole('button',{name:'导出论文',exact:true}).click();await openDialog().getByText(/0 段待翻译/).waitFor();
 const paths={pdf:join(folder,'translation.pdf'),docx:join(folder,'translation.docx'),markdown:join(folder,'translation.md')};
 for(const [format,label]of [['pdf','译文 PDF'],['docx','译文 Word'],['markdown','译文 Markdown']]){
  await openDialog().getByRole('button',{name:label,exact:false}).click();await chooseFile(paths[format]);await openDialog().getByRole('button',{name:'导出完整译文',exact:true}).click();await openDialog().getByText('导出完成。',{exact:true}).waitFor({timeout:180000});assert.ok((await stat(paths[format])).size>1000,format);await page.screenshot({path:join(output,'export-'+format+'.png')});
 }
 const images=[...(await readFile(paths.markdown,'utf8')).matchAll(/!\[.*?\]\(\.\/([^)]*)\)/g)];assert.equal(images.length,frozenBefore.plan.groups.filter(g=>['figure','table','formula'].includes(g.regions[0].kind)).length);for(const m of images)assert.ok((await stat(join(folder,m[1]))).size>0);
 const seven=resolve('.toolchain/builder-cache/7zip@1.0.0/7zip-win-x64-a34pt/bin/7za.exe'),xml=execFileSync(seven,['x','-so',paths.docx,'word/document.xml'],{encoding:'utf8',maxBuffer:30*1024*1024,windowsHide:true});
 const paragraphs=await page.evaluate(xml=>{const doc=new DOMParser().parseFromString(xml,'application/xml');if(doc.querySelector('parsererror'))throw Error('invalid Word XML');return[...doc.getElementsByTagNameNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main','p')].map(p=>p.textContent)},xml);
 const normalize=text=>text.replace(/[_^]\{([^{}\n]{1,30})\}/g,'$1').replace(/\s/g,''),expected=frozenBefore.plan.groups.filter(g=>g.regions[0].kind!=='margin'&&!['figure','table','formula'].includes(g.regions[0].kind)).map(g=>g.translate?g.translation:g.text).filter(t=>t.trim());
 const actual=paragraphs.filter(t=>t.trim()).slice(1);assert.deepEqual(actual.map(normalize),expected.map(normalize),'Word omitted or duplicated paragraph text');
 const after=await call(base+'/export');assert.equal(JSON.stringify(after.plan),JSON.stringify(frozenBefore.plan));assert.equal(JSON.stringify(after.marks),JSON.stringify(frozenBefore.marks));assert.equal(await turns(),modelBefore,'completed export requested a model');assert.equal(sha(await readFile(sample)),originalHash);assert.equal(sha(await readFile(join(root,'workspace','pdf',paper.id+'.pdf'))),paper.id);assert.deepEqual(errors,[]);
 await writeFile(join(output,'summary.json'),JSON.stringify({passed:true,root,folder,paths,native,translated:frozenBefore.translated,paragraphs:expected.length,images:images.length,nativeComments:comments,modelCallsDuringExports:0,cancelProtected:true,originalProtected:true,managedLibraryProtected:true,savedStateUnchanged:true,errors},null,2));
 await writeFile(join(output,'snapshot.json'),JSON.stringify(frozenBefore));console.log(JSON.stringify({passed:true,output,root,pdf:paths.pdf,native}));
}catch(err){console.error(err);if(page){await page.screenshot({path:join(output,'failure.png')}).catch(()=>{});console.log((await page.locator('body').innerText()).slice(-1500))}process.exitCode=1}
finally{if(app)await app.close()}
