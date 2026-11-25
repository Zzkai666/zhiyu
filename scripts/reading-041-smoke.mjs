import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';import {resolve,join} from 'node:path';
const output=resolve(process.env.RDNEXT_041_RESULTS||'test-results/reading-0.4.1');await mkdir(output,{recursive:true});
const root=await mkdtemp(join(output,'isolated-')),trace=join(root,'events.jsonl'),exe=process.env.RDNEXT_EXE;
let app,page;const errors=[],calls=[];
const call=(path,method='GET',data)=>page.evaluate(async({path,method,data})=>{const r=await fetch('/api'+path,{method,...(data===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})});const out=await r.json();if(!r.ok)throw Error(JSON.stringify(out));return out},{path,method,data});
async function until(fn,label,timeout=30000){const t=Date.now();while(Date.now()-t<timeout){if(await fn())return;await new Promise(r=>setTimeout(r,80))}throw Error(label)}
async function launch(){app=await electron.launch({args:[...(exe?[]:['.']),'--workspace='+join(root,'workspace')],...(exe?{executablePath:exe}:{}),env:{...process.env,RDNEXT_TEST_HIDE:'1',RDNEXT_CODEX:resolve('dist/bin/rdnext-test-codex.exe'),RDNEXT_CODEX_EVENTS:trace}});page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>calls.push(r.url()));await page.getByRole('heading',{name:'今日工作台'}).waitFor();assert.equal(await app.evaluate(({app})=>app.getVersion()),JSON.parse(await readFile('package.json','utf8')).version)}
try{
 await launch();await page.evaluate(()=>{localStorage.setItem('rdnext.metadata.disabled','true');localStorage.setItem('rdnext.translation.model','fixture-model');localStorage.setItem('rdnext.translation.effort','medium')});
 await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]})},resolve('test-results/reader-0.2.1/2510.07077v1.pdf'));
 await page.getByRole('button',{name:'导入 PDF',exact:true}).click();await page.getByRole('button',{name:'选择 PDF 文件'}).click();await page.getByRole('button',{name:'完成',exact:true}).click();
 let paper;await until(async()=>{[paper]=await call('/papers');return paper},'paper missing');
 const base='/papers/'+paper.id,regions=JSON.parse(await readFile('tests/fixtures/vla-legacy-regions.json','utf8'));
 for(let n=1;n<=38;n++)await call(base+'/reading/pages/'+n,'PUT',regions.filter(r=>r.page===n));
 let plan=await call(base+'/reading'),multi=plan.groups.find(g=>g.regions.length>1&&g.translate),body=plan.groups.find(g=>g.text.startsWith('The recent success'));assert.ok(multi,'multisource fixture');
 await call(base+'/reading/translate','POST',{groups:[multi.id,body.id],model:'fixture-model',effort:'medium'});
 await page.getByRole('button',{name:'阅读',exact:true}).click();await page.getByRole('button',{name:'双语对照',exact:true}).click();
 const article=page.getByRole('article',{name:'论文译文',exact:true});await article.waitFor();
 assert.equal(await page.getByLabel('阅读侧栏',{exact:true}).count(),1); // toggle button only
 const pdf=page.getByLabel('连续滚动 PDF 原文'),translation=page.getByRole('region',{name:'译文阅读区',exact:true});
 let pb=await pdf.boundingBox(),tb=await translation.boundingBox();assert.ok(Math.abs(pb.width-tb.width)<3,'default halves');
 await page.getByRole('button',{name:'阅读侧栏',exact:true}).click();await page.getByRole('complementary',{name:'阅读侧栏',exact:true}).waitFor();await article.waitFor();
 assert.ok((await translation.boundingBox()).width>200,'sidebar displaced translation');
 await page.screenshot({path:join(output,'bilingual-with-sidebar.png')});
 await page.getByRole('button',{name:'关闭阅读侧栏'}).click();await article.waitFor();
 const divider=page.getByRole('separator');const dividerBox=await divider.boundingBox();await page.mouse.move(dividerBox.x+3,dividerBox.y+100);await page.mouse.down();await page.mouse.move(dividerBox.x-85,dividerBox.y+100,{steps:5});await page.mouse.up();
 assert.ok((await translation.boundingBox()).width>tb.width+60,'split drag failed');await divider.dblclick({position:{x:3,y:100}});
 await page.getByRole('button',{name:'交换原文和译文位置'}).click();assert.ok((await translation.boundingBox()).x<(await pdf.boundingBox()).x);
 await page.getByRole('button',{name:'交换原文和译文位置'}).click();
 const multiCard=page.locator('[data-card="'+multi.id+'"]');await multiCard.locator('.translation-text').click({position:{x:12,y:12}});
 const sourceNav=multiCard.getByRole('navigation',{name:'对应原文'});await sourceNav.waitFor();assert.equal(await sourceNav.getByRole('button',{name:/查看第/}).count(),multi.regions.length);
 await sourceNav.getByRole('button',{name:'查看第 2 处原文',exact:true}).click();
 await page.locator('.source-focus[data-region="'+multi.regions[1].id+'"]').waitFor();assert.equal(await sourceNav.getByRole('button',{name:'查看第 2 处原文',exact:true}).getAttribute('aria-pressed'),'true');
 await page.screenshot({path:join(output,'local-source-parts.png')});
 const field=page.getByRole('textbox',{name:'页码'});await field.fill('1');await field.press('Enter');
 await page.locator('[data-pdf-page="1"] .textLayer span').first().waitFor();
 const sourcePoint=await page.locator('[data-pdf-page="1"] .textLayer').evaluate(layer=>{const span=[...layer.querySelectorAll('span')].find(el=>el.firstChild?.nodeType===Node.TEXT_NODE&&el.textContent.includes('The recent success'));const range=document.createRange();range.setStart(span.firstChild,2);range.setEnd(span.firstChild,3);const b=range.getBoundingClientRect();return{x:b.left+b.width/2,y:b.top+b.height/2}});
 await page.mouse.click(sourcePoint.x,sourcePoint.y);await page.locator('.source-focus[data-group="'+body.id+'"]').waitFor();
 assert.equal(await page.locator('[data-matched-sentence]').count(),0);assert.ok(!calls.some(url=>url.includes('/reading/align')));
 await page.getByRole('button',{name:'原文',exact:true}).click();assert.equal(await article.count(),0);
 await page.getByRole('button',{name:'双语对照',exact:true}).click();await article.waitFor();
 await field.fill('1');await field.press('Enter');
 const pop=()=>page.getByRole('form',{name:'标注评论',exact:true});
 async function selectText(){await page.evaluate(()=>{const layer=document.querySelector('[data-pdf-page="1"] .textLayer'),span=[...layer.querySelectorAll('span')].find(el=>el.firstChild?.nodeType===Node.TEXT_NODE&&el.textContent.includes('Amid growing'));const r=document.createRange();r.setStart(span.firstChild,0);r.setEnd(span.firstChild,45);getSelection().removeAllRanges();getSelection().addRange(r);layer.closest('.paper-surface').dispatchEvent(new PointerEvent('pointerup',{bubbles:true,button:0}))});await page.getByRole('toolbar',{name:'选区标注'}).waitFor()}
 async function saveComment(value){await pop().getByRole('textbox',{name:'评论',exact:true}).fill(value);await pop().getByRole('button',{name:'保存评论',exact:true}).click();await until(async()=>(await call(base+'/marks')).some(m=>m.comment===value),'comment not saved');await pop().getByRole('button',{name:'关闭标注评论'}).click()}
 await selectText();await page.getByRole('button',{name:'黄色标记选区',exact:true}).click();await pop().waitFor();await saveComment('高亮就近评论');
 await selectText();await page.getByRole('button',{name:'选区下划线模式',exact:true}).click();await page.getByRole('button',{name:'蓝色标记选区',exact:true}).click();await pop().waitFor();await saveComment('下划线就近评论');
 async function gesture(tool,a,b,steps=1){await page.getByRole('button',{name:tool,exact:true}).click();const box=await page.locator('[data-pdf-page="1"] .paper-surface').boundingBox();const at=p=>({x:box.x+box.width*p[0],y:box.y+box.height*p[1]});const from=at(a),to=at(b);await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps});await page.mouse.up();await pop().waitFor()}
 await gesture('笔记注释',[.12,.12],[.12,.12]);await pop().getByRole('textbox',{name:'评论',exact:true}).fill('笔记就近评论');await pop().getByRole('button',{name:'保存标注',exact:true}).click();await pop().getByText('已保存',{exact:true}).waitFor();
 await pop().getByRole('button',{name:'标注更多操作'}).click();await page.screenshot({path:join(output,'nearby-comment-menu.png')});await page.getByRole('menu',{name:'标注更多操作',exact:true}).getByRole('menuitemradio',{name:'绿色',exact:true}).click();await until(async()=>(await call(base+'/marks')).some(m=>m.kind==='note'&&m.color==='green'),'color update');
 await pop().getByRole('button',{name:'关闭标注评论'}).click();
 await gesture('新增文字',[.5,.18],[.82,.24],5);await pop().getByRole('textbox',{name:'文字内容',exact:true}).fill('PDF上的文字');await pop().getByRole('textbox',{name:'评论',exact:true}).fill('文字也有单独评论');
 await pop().getByRole('button',{name:'保存标注',exact:true}).click();await pop().getByText('已保存',{exact:true}).waitFor();await pop().getByRole('button',{name:'关闭标注评论'}).click();
 await gesture('选择区域',[.55,.28],[.8,.36],5);await saveComment('区域就近评论');
 await gesture('绘图',[.55,.4],[.75,.43],12);await saveComment('绘图就近评论');
 let marks=await call(base+'/marks');assert.equal(marks.length,6);for(const m of marks)assert.ok(m.comment,m.kind);assert.equal(marks.find(m=>m.kind==='text').content,'PDF上的文字');
 const noteNode=page.locator('[data-annotation="'+marks.find(m=>m.kind==='note').id+'"]');await noteNode.click();await pop().waitFor();await saveComment('再次编辑笔记评论');
 await page.getByRole('button',{name:'阅读侧栏',exact:true}).click();await page.getByRole('complementary',{name:'阅读侧栏',exact:true}).waitFor();await article.waitFor();
 const cards=page.getByRole('form',{name:'标注卡片',exact:true});assert.equal(await cards.count(),6);
 const textCard=cards.locator('[data-kind="text"]'); // below uses explicit data selector since locator matches descendants
 const text=page.locator('.annotation-records .annotation-card[data-kind="text"]');await text.getByRole('textbox',{name:'评论',exact:true}).fill('侧栏修改评论');await text.getByRole('button',{name:'保存评论',exact:true}).click();
 await until(async()=>(await call(base+'/marks')).some(m=>m.kind==='text'&&m.comment==='侧栏修改评论'&&m.content==='PDF上的文字'),'sidebar comment lost content');
 await page.screenshot({path:join(output,'annotation-sidebar.png')});
 const area=page.locator('.annotation-records .annotation-card[data-kind="area"]');await area.getByRole('button',{name:'标注更多操作'}).click();await page.getByRole('menu',{name:'标注更多操作',exact:true}).getByRole('menuitem',{name:'查看区域截图',exact:true}).click();await page.getByRole('dialog',{name:'区域截图',exact:true}).locator('img').waitFor();
 const png=join(root,'region.png');await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file})},png);await page.getByRole('button',{name:'保存 PNG',exact:true}).click();await until(async()=>{try{return (await readFile(png)).subarray(1,4).toString()==='PNG'}catch{return false}},'region PNG export');await page.getByRole('dialog',{name:'区域截图',exact:true}).getByRole('button',{name:'关闭对话框'}).click();
 page.on('dialog',dialog=>dialog.accept());const ink=page.locator('.annotation-records .annotation-card[data-kind="ink"]');await ink.getByRole('button',{name:'标注更多操作'}).click();await page.getByRole('menu',{name:'标注更多操作',exact:true}).getByRole('menuitem',{name:'删除标注',exact:true}).click();await until(async()=>(await call(base+'/marks')).length===5,'delete via ellipsis');
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(980,760));await until(async()=>await page.getByRole('complementary',{name:'阅读侧栏',exact:true}).evaluate(el=>getComputedStyle(el).position==='absolute'),'narrow sidebar');assert.ok((await translation.boundingBox()).width>350);await page.screenshot({path:join(output,'narrow-bilingual-sidebar.png')});await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1440,950));
 await page.getByRole('button',{name:'关闭阅读侧栏'}).click();await page.getByRole('button',{name:'返回文献库'}).click();await app.close();app=null;
 await launch();await page.getByRole('button',{name:'文献库',exact:true}).click();await page.getByRole('button',{name:'阅读',exact:true}).click();await page.getByRole('article',{name:'论文译文',exact:true}).waitFor();
 marks=await call(base+'/marks');assert.equal(marks.length,5);assert.equal(marks.find(m=>m.kind==='text').content,'PDF上的文字');assert.equal(marks.find(m=>m.kind==='text').comment,'侧栏修改评论');
 assert.ok(!calls.some(url=>url.includes('/reading/align')));assert.deepEqual(errors,[]);
 await writeFile(join(output,'summary.json'),JSON.stringify({passed:true,root,annotations:marks.map(m=>({kind:m.kind,comment:m.comment,content:m.content,color:m.color})),multiSources:multi.regions.length,sentenceMatchingRequests:0,errors},null,2));
 console.log(JSON.stringify({passed:true,output,root}));
}catch(err){console.error(err);if(page){await page.screenshot({path:join(output,'failure.png')}).catch(()=>{});console.log((await page.locator('body').innerText()).slice(-1600))}process.exitCode=1}
finally{if(app)await app.close()}
