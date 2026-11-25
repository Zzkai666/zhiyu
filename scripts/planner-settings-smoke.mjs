import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const output=resolve(process.env.RDNEXT_PLANNER_RESULTS || 'test-results/planner');await mkdir(output,{recursive:true});
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
 await app.close();app=null;
 app=await electron.launch({args:['.','--workspace='+workspace],env:{...process.env,RDNEXT_TEST_HIDE:'1'}});page=await app.firstWindow();await page.getByRole('heading',{name:'今日工作台'}).waitFor();
 board=await call('/planner?day='+day);assert.equal(board.important[0].title,'高数期末考试');assert.equal(board.today.find(a=>a.title==='每天背单词').done,true);checks.push('normal exit and reopen preserves milestones and occurrence completion');
 assert.deepEqual(errors,[]);await writeFile(join(output,'summary.json'),JSON.stringify({passed:true,root,checks,errors},null,2));
}catch(e){await writeFile(join(output,'summary.json'),JSON.stringify({passed:false,root,checks,error:e.stack,errors},null,2));await page?.screenshot({path:join(output,'failure.png')}).catch(()=>{});throw e}
finally{await app?.close()}
