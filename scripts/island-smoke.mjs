import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile,stat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
const output=resolve(process.env.RDNEXT_ISLAND_RESULTS||'test-results/island-'+JSON.parse(await readFile('package.json','utf8')).version);await mkdir(output,{recursive:true});
const root=await mkdtemp(join(output,'isolated-')),workspace=join(root,'workspace'),exe=process.env.RDNEXT_EXE;
let app,page,islandPID;const errors=[],checks=[];
const call=(path,method='GET',body)=>page.evaluate(async({path,method,body})=>{const r=await fetch('/api'+path,{method,...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});const v=await r.json();if(!r.ok)throw Error(r.status+' '+JSON.stringify(v));return v},{path,method,body});
async function launch(){
 app=await electron.launch({args:[...(exe?[]:['.']),'--workspace='+workspace],...(exe?{executablePath:exe}:{}),env:{...process.env,RDNEXT_TEST_HIDE:'1'}});
 page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.getByRole('heading',{name:'今日工作台'}).waitFor();
 await page.evaluate(()=>localStorage.setItem('rdnext.metadata.disabled','true'));
}
async function until(fn,label,timeout=60000){let last;const start=Date.now();while(Date.now()-start<timeout){try{const v=await fn();if(v)return v;}catch(e){last=e}await new Promise(r=>setTimeout(r,100))}throw Error(label+': '+(last?.message||''))}
const btn=(name)=>page.getByRole('button',{name,exact:true});
async function action(action,id){return app.evaluate(({BrowserWindow,ipcMain},{action,id})=>new Promise(resolve=>{
 const ticket=String(Date.now()),win=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL()==='rdnext://workspace/');
 const handler=(_e,r)=>{if(r.id!==ticket)return;clearTimeout(timer);ipcMain.removeListener('workspace-action-result',handler);resolve(r)};
 const timer=setTimeout(()=>{ipcMain.removeListener('workspace-action-result',handler);resolve({error:'UI action timeout'})},12000);
 ipcMain.on('workspace-action-result',handler);win.webContents.send('workspace-action',{id:ticket,action,body:{id}});
}),{action,id})}
async function close(){if(app){await app.close();app=null}}
try{
 await launch();
 await until(async()=>{const s=await page.evaluate(()=>window.desktop.islandStatus());if(s.error)throw Error(s.error);if(s.ready){islandPID=s.pid;return true}},'native island not ready');
 const settings=await readFile(join(workspace,'island','settings.txt'),'utf8');assert.match(settings,/skin=glass_light/);checks.push('native child ready, separate profile, GlassLight default');
 await page.getByRole('textbox',{name:'快速记录今日事项'}).fill('核对结果表');await page.getByRole('textbox',{name:'快速记录今日事项'}).press('Enter');
 let task;await until(async()=>{task=(await call('/agenda'))[0];return task},'task not created');
 await until(()=>page.getByLabel('专注任务').count(),'focus selector');
 await page.getByLabel('专注分钟').fill('1');await btn('开始专注').click();await page.getByText('正在专注',{exact:true}).waitFor();
 await btn('暂停').click();await page.getByText('已暂停',{exact:true}).waitFor();
 await btn('继续计时').click();await page.getByText('正在专注',{exact:true}).waitFor();
 await btn('结束并确认').click();await page.getByLabel('本次专注成果').fill('核对数据来源，下次继续看附录');
 await btn('稍后继续').click();await page.getByText('最近专注',{exact:true}).waitFor();
 assert.equal((await call('/agenda'))[0].done,false);checks.push('focus pause/resume/explicit continue saves history without completing task');
 const sample=resolve('test-results/native-export-0.5.0/native.pdf');
 await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]})},sample);
 await btn('导入 PDF').click();await btn('选择 PDF 文件').click();await btn('完成').click();
 const paper=(await call('/papers'))[0];
 const mark=await call('/papers/'+paper.id+'/marks','POST',{kind:'note',color:'amber',page:2,quote:'Frozen original paragraph',comment:'核对这个方法的输入',rects:[{x:.15,y:.25,w:.15,h:.08}],size:14,width:2});
 await call('/papers/'+paper.id+'/position','PUT',{page:2,zoom:130});
 assert.ok(!(await action('open-paper',paper.id)).error);
 await page.locator('.reader').waitFor();await page.getByLabel('阅读侧栏',{exact:true}).click();

 await page.getByRole('button',{name:'创建研究任务',exact:true}).first().click();
 const dialog=page.getByRole('dialog',{name:'创建研究任务'});await dialog.getByLabel('研究任务标题').fill('核对批注的方法输入');
 await dialog.getByRole('button',{name:'保存研究任务'}).click();await dialog.waitFor({state:'hidden'});
 const tasks=await call('/agenda'),research=tasks.find(t=>t.title==='核对批注的方法输入');assert.ok(research);
 const source=await call('/research/tasks/'+research.id+'/source');assert.equal(source.markId,mark.id);assert.equal(source.quote,'Frozen original paragraph');
 const denied=await action('open-paper','0'.repeat(64));assert.ok(denied.error);
 assert.ok(!(await action('open-task',research.id)).error);await page.locator('.reader').waitFor();
 await until(async()=>Number(await page.getByLabel('页码',{exact:true}).inputValue())===2,'source page not restored');
 checks.push('annotation creates one authoritative source-linked task; island action opens same PDF page');
 assert.ok(!(await action('open-home')).error);await page.getByRole('heading',{name:'今日工作台'}).waitFor();
 await page.getByLabel('专注任务').selectOption(research.id);await page.getByLabel('专注分钟').fill('25');await btn('开始专注').click();await page.getByText('正在专注',{exact:true}).waitFor();
 await page.screenshot({path:join(output,'workbench-focus.png')});
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL()==='rdnext://workspace/').close());
 const hidden=await app.evaluate(({BrowserWindow})=>!BrowserWindow.getAllWindows().find(w=>w.webContents.getURL()==='rdnext://workspace/').isVisible());assert.equal(hidden,true);
 // Hidden acceptance keeps its window out of the user desktop.
 checks.push('closing workbench retains one island and core');
 await close();await launch();
 await page.getByText('上次专注已中断',{exact:true}).waitFor();let s=await call('/companion');assert.equal(s.focus.state,'interrupted');
 checks.push('restart preserves unfinished focus and requests explicit resume');
 await btn('结束并确认').click();await page.getByLabel('本次专注成果').fill('方法输入已核对');await btn('任务已完成').click();
 await until(async()=>(await call('/agenda')).find(t=>t.id===research.id)?.done,'task not completed');
 const saved=await call('/companion');assert.equal(saved.history[0].note,'方法输入已核对');checks.push('explicit done commits task and focus result together');
 assert.ok(!(await action('open-settings')).error);
 await page.getByRole('button',{name:'常规',exact:true}).click();const d=page.getByRole('region',{name:'工作台设置',exact:true});await d.getByLabel('启用桌面小岛').uncheck();await until(async()=>!(await page.evaluate(()=>window.desktop.islandStatus())).running,'island not disabled');
 await d.getByLabel('启用桌面小岛').check();await until(async()=>(await page.evaluate(()=>window.desktop.islandStatus())).ready,'island not enabled');
 await page.screenshot({path:join(output,'unified-settings.png')});checks.push('enable/disable native component from unified settings');
 assert.ok(!(await action('open-home')).error);await page.getByRole('heading',{name:'今日工作台'}).waitFor();assert.equal(await page.getByRole('region',{name:'工作台设置',exact:true}).count(),0);checks.push('island navigation leaves unified settings and shows requested workspace');
 await close();
 assert.deepEqual(errors,[]);
 await writeFile(join(output,'summary.json'),JSON.stringify({passed:true,root,workspace,checks,errors,firstIslandPID:islandPID},null,2));
}catch(e){await writeFile(join(output,'summary.json'),JSON.stringify({passed:false,root,checks,errors,error:e.stack},null,2));if(page)await page.screenshot({path:join(output,'failure.png')}).catch(()=>{});throw e}
finally{await close()}
