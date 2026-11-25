import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';import {resolve,join} from 'node:path';
const output=resolve(process.env.RDNEXT_040_RESULTS||'test-results/reading-0.4.0');await mkdir(output,{recursive:true});
const root=await mkdtemp(join(output,'isolated-')),exe=process.env.RDNEXT_EXE,trace=join(root,'events.jsonl');
let app,page;const errors=[];
async function launch(){app=await electron.launch({args:[...(exe?[]:['.']),'--workspace='+join(root,'workspace')],...(exe?{executablePath:exe}:{}),env:{...process.env,RDNEXT_CODEX:resolve('dist/bin/rdnext-test-codex.exe'),RDNEXT_CODEX_EVENTS:trace}});page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.url().includes('/metadata'))void r.text().then(t=>console.log('metadata response',r.status(),t.slice(0,1000)))});page.on('console',m=>{if(m.type()==='error')console.log('renderer',m.text())});await page.getByRole('heading',{name:'今日工作台'}).waitFor();assert.equal(await app.evaluate(({app})=>app.getVersion()),'0.4.0')}
const call=(path,method='GET',data)=>page.evaluate(async({path,method,data})=>{const r=await fetch('/api'+path,{method,...(data===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})});const out=await r.json();if(!r.ok)throw Error(JSON.stringify(out));return out},{path,method,data});
async function until(fn,label,timeout=30000){const start=Date.now();while(Date.now()-start<timeout){if(await fn())return;await new Promise(r=>setTimeout(r,90))}throw Error(label)}
try{
 await launch();assert.equal(await page.getByRole('button',{name:'笔记中心',exact:true}).count(),0);
 await page.evaluate(()=>{localStorage.setItem('rdnext.metadata.offline','true');localStorage.setItem('rdnext.translation.model','fixture-model');localStorage.setItem('rdnext.translation.effort','medium')});
 await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]})},resolve('test-results/reader-0.2.1/2510.07077v1.pdf'));
 await page.getByRole('button',{name:'导入 PDF',exact:true}).click();await page.getByRole('button',{name:'选择 PDF 文件'}).click();await page.getByRole('button',{name:'完成',exact:true}).click();
 let paper;await until(async()=>{[paper]=await call('/papers');return paper?.metadata?.status},'metadata not extracted');
 assert.ok(paper.title.includes('Vision'),paper.title);assert.notEqual(paper.title,'2510.07077v1');assert.equal(paper.metadata.arxiv,'2510.07077v1');
 await page.locator('.paper-identity').click();const details=page.getByRole('dialog',{name:'文献详情',exact:true});
 await details.getByText('2510.07077v1',{exact:true}).waitFor();await page.screenshot({path:join(output,'metadata.png')});
 await details.getByRole('button',{name:'关闭对话框',exact:true}).click();
 const base='/papers/'+paper.id,regions=JSON.parse(await readFile('tests/fixtures/vla-legacy-regions.json','utf8'));
 for(let n=1;n<=38;n++)await call(base+'/reading/pages/'+n,'PUT',regions.filter(r=>r.page===n));
 await page.getByRole('button',{name:'阅读',exact:true}).click();await page.getByRole('button',{name:'双语对照',exact:true}).click();
 await page.locator('.translation-article').waitFor();assert.equal(await page.getByRole('button',{name:'笔记',exact:true}).count(),0);
 assert.equal(await page.locator('.reading-status').count(),0);assert.equal(await page.locator('.translate-actions').count(),0);
 const indent=await page.locator('.article-block[data-kind="text"] .translation-text').first().evaluate(el=>getComputedStyle(el).textIndent);assert.ok(parseFloat(indent)>25,indent);
 const plan=await call(base+'/reading'),body=plan.groups.find(g=>g.text.startsWith('The recent success'));
 await until(async()=>!await page.getByRole('button',{name:'连接断段',exact:true}).isDisabled(),'analysis incomplete',60000);
 await call(base+'/reading/translate','POST',{groups:[body.id],model:'fixture-model',effort:'medium'});
 // Reopen to read the saved translation without sending another model request.
 await page.getByRole('button',{name:'返回文献库'}).click();await page.getByRole('button',{name:'阅读',exact:true}).click();await page.locator('.translation-article').waitFor();
 await page.locator('[data-pdf-page="1"] .page-bitmap canvas').waitFor();
 async function selectAbstract(palette=true){
  await page.evaluate(()=>{
   const layer=document.querySelector('[data-pdf-page="1"] .textLayer'),nodes=[...layer.querySelectorAll('span')].filter(el=>el.firstChild?.nodeType===Node.TEXT_NODE&&el.textContent.includes('Amid growing'));
   const node=nodes[0]?.firstChild;if(!node)throw Error('abstract text unavailable');
   const range=document.createRange();range.setStart(node,0);range.setEnd(node,Math.min(node.length,45));const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
   layer.closest('.paper-surface').dispatchEvent(new PointerEvent('pointerup',{bubbles:true,button:0}));
  });if(palette)await page.getByRole('toolbar',{name:'选区标注'}).waitFor();
 }
 await selectAbstract();await page.keyboard.press('Escape');await page.getByRole('toolbar',{name:'选区标注'}).waitFor({state:'hidden'});
 await selectAbstract();await page.evaluate(()=>getSelection().removeAllRanges());await page.getByRole('toolbar',{name:'选区标注'}).waitFor({state:'hidden'});
 await selectAbstract();await page.getByRole('button',{name:'黄色标记选区',exact:true}).click();
 await until(async()=>(await call(base+'/marks')).some(m=>m.kind==='highlight'),'highlight not saved');
 await selectAbstract();await page.getByRole('button',{name:'选区下划线模式'}).click();await page.getByRole('button',{name:'红色标记选区',exact:true}).click();
 await until(async()=>(await call(base+'/marks')).some(m=>m.kind==='underline'&&m.color==='red'),'underline not saved');
 await page.getByRole('button',{name:'高亮选区',exact:true}).click();
 await selectAbstract(false);await until(async()=>(await call(base+'/marks')).filter(m=>m.kind==='highlight').length===2,'first locked highlight');
 await selectAbstract(false);await until(async()=>(await call(base+'/marks')).filter(m=>m.kind==='highlight').length===3,'second locked highlight');
 assert.equal(await page.getByRole('button',{name:'高亮选区',exact:true}).getAttribute('aria-pressed'),'true');await page.getByRole('button',{name:'高亮选区',exact:true}).click();
 // Four geometry-based tools, with real pointer input.
 const surface=page.locator('[data-pdf-page="1"] .paper-surface');
 async function gesture(tool,a,b,steps=1){await page.getByRole('button',{name:tool,exact:true}).click();const box=await surface.boundingBox();const at=p=>({x:box.x+box.width*p[0],y:box.y+box.height*p[1]});const from=at(a),to=at(b);await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps});await page.mouse.up()}
 await gesture('笔记注释',[.12,.12],[.12,.12]);let editor=page.getByRole('dialog',{name:'添加 PDF 标注',exact:true});
 await editor.getByLabel('注释',{exact:true}).fill('留在 PDF 上的批注');await editor.getByRole('button',{name:'保存标注',exact:true}).click();
 await gesture('新增文字',[.5,.18],[.82,.24],5);editor=page.getByRole('dialog',{name:'添加 PDF 标注',exact:true});
 await editor.getByLabel('文字内容',{exact:true}).fill('新增文字验收');await editor.getByLabel('标注文字字号').fill('18');await editor.getByRole('button',{name:'保存标注',exact:true}).click();
 await gesture('选择区域',[.55,.28],[.8,.36],5);await until(async()=>(await call(base+'/marks')).some(m=>m.kind==='area'),'area not saved');
 await gesture('绘图',[.55,.4],[.75,.43],12);await until(async()=>(await call(base+'/marks')).some(m=>m.kind==='ink'),'ink not saved');
 await page.getByRole('button',{name:'选择/移动',exact:true}).click();
 let marks=await call(base+'/marks');for(const kind of ['highlight','underline','note','text','area','ink'])assert.ok(marks.some(m=>m.kind===kind),kind);
 const pin=marks.find(m=>m.kind==='note'),node=page.locator('[data-annotation="'+pin.id+'"]'),box=await node.boundingBox();
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+30,box.y+box.height/2+16,{steps:5});await page.mouse.up();
 await until(async()=>(await call(base+'/marks')).find(m=>m.id===pin.id).revision===2,'annotation move not saved');
 await page.screenshot({path:join(output,'pdf-tools.png')});
 // Sentence correspondence: a first click obtains verified quote pairs; a second click reuses them.
 const field=page.getByRole('textbox',{name:'页码'});await field.fill('1');await field.press('Enter');
 const sourcePoint=await page.locator('[data-pdf-page="1"] .textLayer').evaluate(layer=>{
  const span=[...layer.querySelectorAll('span')].find(el=>el.firstChild?.nodeType===Node.TEXT_NODE&&el.textContent.includes('The recent success'));
  const node=span.firstChild,range=document.createRange();range.setStart(node,2);range.setEnd(node,3);const box=range.getBoundingClientRect();return {x:box.left+box.width/2,y:box.top+box.height/2};
 });
 await page.mouse.move(sourcePoint.x,sourcePoint.y);await page.locator('.sentence-hover:not(.sentence-linked)').waitFor();await page.mouse.click(sourcePoint.x,sourcePoint.y);
 await page.locator('[data-matched-sentence]').waitFor({timeout:30000});assert.ok(await page.locator('.sentence-linked').count()>0);
 await page.screenshot({path:join(output,'sentence-pair.png')});
 const eventsBefore=(await readFile(trace,'utf8')).split('\n').filter(Boolean).map(JSON.parse).filter(e=>e.method==='turn/start').length;
 const translated=page.locator('[data-card="'+body.id+'"]');
 await field.fill('3');await field.press('Enter');
 const figureLink=page.locator('[data-pdf-page="3"] [data-destination="figure.2"]');await figureLink.waitFor();await figureLink.scrollIntoViewIfNeeded();
 const beforeJump=await page.getByLabel('连续滚动 PDF 原文').evaluate(el=>[el.scrollLeft,el.scrollTop]);const figureBox=await figureLink.boundingBox();await page.mouse.click(figureBox.x+figureBox.width/2,figureBox.y+figureBox.height/2);
 await page.locator('[data-pdf-page="4"] .reference-target').waitFor();await page.getByRole('button',{name:'返回阅读位置',exact:true}).click();
 assert.deepEqual(await page.getByLabel('连续滚动 PDF 原文').evaluate(el=>[el.scrollLeft,el.scrollTop]),beforeJump);
 await translated.getByRole('button',{name:'[1]',exact:true}).click();await page.locator('[data-pdf-page="26"] .reference-target').waitFor();await page.getByRole('button',{name:'返回阅读位置',exact:true}).click();
 assert.equal((await readFile(trace,'utf8')).split('\n').filter(Boolean).map(JSON.parse).filter(e=>e.method==='turn/start').length,eventsBefore,'reference clicks accidentally requested alignment');
 await translated.locator('.translation-text').click({position:{x:12,y:12}});
 await page.locator('.source-focus[data-group="'+body.id+'"]').waitFor();
 await page.getByRole('button',{name:'译文排版',exact:true}).click();await page.getByLabel('正文首行缩进').selectOption('0');await page.getByRole('button',{name:'完成',exact:true}).click();
 assert.equal(await translated.locator('.translation-text').evaluate(el=>getComputedStyle(el).textIndent),'0px');
 await page.getByRole('button',{name:'标注',exact:true}).click();
 assert.equal(await page.locator('.reader-records article').count(),8);
 page.on('dialog',dialog=>dialog.accept());
 const areaRow=page.locator('.reader-records article').filter({hasText:'区域标注'});
 await areaRow.getByRole('button',{name:'查看区域截图',exact:true}).click();
 await page.getByRole('dialog',{name:'区域截图',exact:true}).locator('img').waitFor();
 const imagePath=join(root,'selected-area.png');await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file})},imagePath);
 await page.getByRole('button',{name:'保存 PNG',exact:true}).click();await until(async()=>{try{return (await readFile(imagePath)).subarray(1,4).toString()==='PNG'}catch{return false}},'crop PNG export');
 await page.getByRole('dialog',{name:'区域截图',exact:true}).getByRole('button',{name:'关闭对话框'}).click();
 await areaRow.getByRole('button',{name:'移除',exact:true}).click();
 await until(async()=>(await call(base+'/marks')).length===7,'annotation deletion failed');
 await page.getByRole('button',{name:'返回文献库'}).click();await app.close();app=null;await launch();
 await page.getByRole('button',{name:'文献库',exact:true}).click();await page.getByRole('button',{name:'阅读',exact:true}).click();
 await page.locator('.translation-article').waitFor();marks=await call(base+'/marks');assert.equal(marks.length,7);
 assert.equal(marks.find(m=>m.kind==='note').revision,2);assert.ok(marks.some(m=>m.kind==='ink'&&m.points.length>2));
 const cacheBefore=(await readFile(trace,'utf8')).split('\n').filter(Boolean).length;
 await call(base+'/reading/align','POST',{group:body.id,model:''});
 const cacheAfter=(await readFile(trace,'utf8')).split('\n').filter(Boolean).length;assert.equal(cacheBefore,cacheAfter,'alignment cache called model again');
 assert.deepEqual(errors,[]);
 await writeFile(join(output,'summary.json'),JSON.stringify({passed:true,root,title:paper.title,metadata:paper.metadata,indent,annotationKinds:marks.map(m=>m.kind),alignmentsCached:true,eventsBefore,errors},null,2));
 console.log(JSON.stringify({passed:true,output,root}));
}catch(error){console.error(error);if(page){await page.screenshot({path:join(output,'failure.png')}).catch(()=>{});console.log((await page.locator('body').innerText()).slice(-1400))}process.exitCode=1}
finally{if(app)await app.close()}
