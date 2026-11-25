import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
const output=resolve('test-results/planner-settings-0.7.0');await mkdir(output,{recursive:true});
const root=await mkdtemp(join(output,'isolated-')),workspace=join(root,'workspace');let app,page;const checks=[],errors=[];
const until=async(fn,label)=>{const s=Date.now();let last;while(Date.now()-s<45000){try{const r=await fn();if(r)return r}catch(e){last=e}await new Promise(r=>setTimeout(r,150))}throw Error(label+' '+(last?.message||''))};
const btn=name=>page.getByRole('button',{name,exact:true});
const call=(path,method='GET',body)=>page.evaluate(async({path,method,body})=>{const r=await fetch('/api'+path,{method,...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});const data=await r.json();if(!r.ok)throw Error(r.status+' '+JSON.stringify(data));return data},{path,method,body});
try{
 app=await electron.launch({args:['.','--workspace='+workspace],env:{...process.env,RDNEXT_TEST_HIDE:'1'}});
 page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.getByRole('heading',{name:'今日工作台'}).waitFor();
 const day=await page.evaluate(()=>{const d=new Date();return[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')});
 await btn('任务日程').click();await btn('记重要日期').click();
 let d=page.getByRole('dialog');await d.getByLabel('事项名称').fill('高数期末考试');await d.getByLabel('事项日期').fill('2027-06-01');await d.getByRole('button',{name:'保存事项'}).click();await d.waitFor({state:'hidden'});
 await page.getByRole('region',{name:'重要日期',exact:true}).getByText('高数期末考试',{exact:true}).waitFor();
 await btn('添加待办').click();d=page.getByRole('dialog');await d.getByLabel('事项名称').fill('每天背单词');await d.getByLabel('重复方式').selectOption('daily');await d.getByRole('button',{name:'保存事项'}).click();await d.waitFor({state:'hidden'});
 await page.getByLabel('快速记录今日事项').fill('下午去图书馆');await page.getByLabel('快速记录今日事项').press('Enter');await btn('完成 下午去图书馆').waitFor();await btn('完成 每天背单词').click();await page.locator('.planner-fold summary').filter({hasText:'已完成 1 项'}).click();await btn('重开 每天背单词').waitFor();
 await btn('后一天').click();await btn('完成 每天背单词').waitFor();await page.getByRole('region',{name:'重要日期',exact:true}).getByText('高数期末考试',{exact:true}).waitFor();await btn('今天').click();await page.locator('.planner-fold summary').filter({hasText:'已完成 1 项'}).click();await btn('重开 每天背单词').waitFor();
 checks.push('future important always visible, daily completion independent, today quick entry persisted');
 let board=await call('/planner?day='+day);assert.equal(board.important.length,1);assert.equal(board.today.find(a=>a.title==='每天背单词').done,true);
 await until(async()=>{const s=await page.evaluate(()=>window.desktop.islandStatus());return s.snapshot?.planner?.today?.find(a=>a.title==='每天背单词')?.done},'native board did not receive same completion');
 await page.screenshot({path:join(output,'planner.png')});
 await btn('标记完成').click();await page.getByText('考试、作业截止、重要约定',{exact:true}).waitFor();await btn('全部事项').click();await page.getByRole('button',{name:/高数期末考试/}).click();
 await page.getByRole('dialog').getByLabel('事项已完成').uncheck();await page.getByRole('dialog').getByRole('button',{name:'保存事项'}).click();await page.getByRole('dialog').waitFor({state:'hidden'});await btn('清单').click();await page.getByRole('region',{name:'重要日期',exact:true}).getByText('高数期末考试',{exact:true}).waitFor();checks.push('completed important date can be reopened from all items');
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].showInactive());await btn('设置').click();await btn('桌面小岛').click();
 const attached=await until(async()=>{const s=await page.evaluate(()=>window.desktop.islandStatus());return s.host?.attached&&s.host?.visible?s:null},'native settings not hosted');
 const info=await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];const b=w.getNativeWindowHandle();return{handle:(b.length===8?b.readBigUInt64LE():BigInt(b.readUInt32LE())).toString()}});
 const probe=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-File',resolve('scripts/settings-host-inspect.ps1'),'-Handle',String(attached.host.handle),'-ParentHandle',info.handle],{encoding:'utf8',windowsHide:true}));assert.equal(probe.parentMatches,true);assert.equal(probe.visible,true);assert.equal(probe.childStyle,true);
 checks.push('original settings child is parented to workbench with WS_CHILD, no separate popup');
 const previous=attached.host.width;await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1320,850));
 await until(async()=>{const s=await page.evaluate(()=>window.desktop.islandStatus());return s.host.width!==previous},'settings resize not applied');
 await btn('常规').click();await until(async()=>!(await page.evaluate(()=>window.desktop.islandStatus())).host.visible,'native settings not hidden');
 await page.getByLabel('启用桌面小岛').uncheck();await until(async()=>!(await page.evaluate(()=>window.desktop.islandStatus())).running,'disable did not stop');
 await btn('桌面小岛').click();await until(async()=>{const s=await page.evaluate(()=>window.desktop.islandStatus());return s.host?.visible&&s.host.attached&&!s.enabled},'settings-only host failed');
 await btn('常规').click();await until(async()=>!(await page.evaluate(()=>window.desktop.islandStatus())).running,'settings-only process left alive');
 await page.getByLabel('启用桌面小岛').check();await until(async()=>(await page.evaluate(()=>window.desktop.islandStatus())).ready,'re-enable failed');
 await btn('返回工作台').click();await page.getByRole('heading',{name:'任务日程'}).waitFor();checks.push('resize, tab hide, disabled settings-only host, clean exit and re-enable');
 async function nativeGear(){const pid=(await page.evaluate(()=>window.desktop.islandStatus())).pid;await app.evaluate((_,pid)=>{const child=process._getActiveHandles().find(h=>h.pid===pid&&h.stdin);if(!child)throw Error('Owned child handle unavailable');child.stdin.write(JSON.stringify({type:'settings'})+'\n')},pid)}
 await nativeGear();await page.getByRole('region',{name:'工作台设置',exact:true}).waitFor();await until(async()=>(await page.evaluate(()=>window.desktop.islandStatus())).host.visible,'reopening settings from native island failed');
 await btn('常规').click();await nativeGear();await until(async()=>(await page.evaluate(()=>window.desktop.islandStatus())).host.visible,'native settings command did not switch workbench settings category');
 await btn('返回工作台').click();checks.push('native settings action reopens hosted page and selects island category after navigation');
 await app.close();app=null;
 app=await electron.launch({args:['.','--workspace='+workspace],env:{...process.env,RDNEXT_TEST_HIDE:'1'}});page=await app.firstWindow();await page.getByRole('heading',{name:'今日工作台'}).waitFor();
 board=await call('/planner?day='+day);assert.equal(board.important[0].title,'高数期末考试');assert.equal(board.today.find(a=>a.title==='每天背单词').done,true);checks.push('normal exit and reopen preserves milestones and occurrence completion');
 assert.deepEqual(errors,[]);await writeFile(join(output,'summary.json'),JSON.stringify({passed:true,root,checks,probe,errors},null,2));
}catch(e){await writeFile(join(output,'summary.json'),JSON.stringify({passed:false,root,checks,error:e.stack,errors},null,2));await page?.screenshot({path:join(output,'failure.png')}).catch(()=>{});throw e}
finally{await app?.close()}
