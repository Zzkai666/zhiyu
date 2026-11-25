import {_electron as electron} from 'playwright';import assert from 'node:assert/strict';import {mkdir,mkdtemp,readFile} from 'node:fs/promises';import {resolve,join} from 'node:path';
const out=resolve(process.env.RDNEXT_FIT_RESULTS||'test-results/focus-0.4.0');await mkdir(out,{recursive:true});const root=await mkdtemp(join(out,'isolated-'));
const exe=process.env.RDNEXT_EXE;let app,page;
try{
 app=await electron.launch({args:[...(exe?[]:['.']),'--workspace='+join(root,'workspace')],...(exe?{executablePath:exe}:{}),env:{...process.env,RDNEXT_CODEX:resolve('dist/bin/rdnext-test-codex.exe')}});page=await app.firstWindow();await page.getByRole('heading',{name:'今日工作台'}).waitFor();
 await page.evaluate(()=>localStorage.setItem('rdnext.metadata.disabled','true'));
 await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]})},resolve('test-results/reader-0.2.1/2510.07077v1.pdf'));
 await page.getByRole('button',{name:'导入 PDF',exact:true}).click();await page.getByRole('button',{name:'选择 PDF 文件'}).click();await page.getByRole('button',{name:'完成',exact:true}).click();
 const call=(path,method='GET',data)=>page.evaluate(async({path,method,data})=>(await fetch('/api'+path,{method,...(data===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})})).json(),{path,method,data});
 const [paper]=await call('/papers'),base='/papers/'+paper.id,regions=JSON.parse(await readFile('tests/fixtures/vla-legacy-regions.json','utf8'));
 for(let n=1;n<=38;n++)await call(base+'/reading/pages/'+n,'PUT',regions.filter(r=>r.page===n));
 if(await page.getByRole('button',{name:'阅读',exact:true}).count())await page.getByRole('button',{name:'阅读',exact:true}).click();else await page.locator('.paper-identity').click();
 await page.getByRole('button',{name:'双语对照',exact:true}).click();await page.locator('.translation-article').waitFor();
 const plan=await call(base+'/reading'),target=plan.groups.filter(g=>g.regions.length===1&&g.regions[0].kind==='text').sort((a,b)=>b.regions[0].rect.h-a.regions[0].rect.h)[0];
 for(let n=0;n<13;n++)await page.getByRole('button',{name:'放大',exact:true}).click();
 await page.locator('[data-card="'+target.id+'"] .translation-text').click();
 await page.locator('.source-focus[data-group="'+target.id+'"]').waitFor();
 await page.waitForTimeout(250);
 const box=await page.locator('.source-focus[data-group="'+target.id+'"]').boundingBox(),view=await page.getByLabel('连续滚动 PDF 原文').boundingBox();
 console.log(JSON.stringify({box,view,zoom:await page.locator('.zoom-value').innerText()}));
 assert.ok(box.x>=view.x-2&&box.y>=view.y-2&&box.x+box.width<=view.x+view.width+2&&box.y+box.height<=view.y+view.height+2,'focused paragraph is clipped');
 await page.screenshot({path:join(out,'fit.png')});
 const {writeFile}=await import('node:fs/promises');await writeFile(join(out,'summary.json'),JSON.stringify({passed:true,root,box,view,zoom:await page.locator('.zoom-value').innerText()},null,2));
}catch(err){console.error(err);if(page)await page.screenshot({path:join(out,'failure.png')}).catch(()=>{});process.exitCode=1}finally{if(app)await app.close()}
