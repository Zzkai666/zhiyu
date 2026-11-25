import { _electron as electron } from 'playwright';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const output=resolve(process.env.RDNEXT_SESSION_RESULTS||'test-results/reader-0.9.12/sessions');
await mkdir(output,{recursive:true});
const root=await mkdtemp(join(output,'isolated-'));
const stub=resolve('dist/bin/rdnext-test-codex.exe');
const harness=join(root,'DeepSeek Harness');
const codexTrace=join(root,'codex.jsonl'),harnessTrace=join(root,'harness.jsonl');
await mkdir(join(harness,'resources'),{recursive:true});
await writeFile(join(harness,'resources','app.asar'),'fixture');
await copyFile(stub,join(harness,'DeepSeek Harness.exe'));

async function sample(name) {
  const pdf=await PDFDocument.create(), font=await pdf.embedFont(StandardFonts.Helvetica);
  for(let n=1;n<=4;n++){
    const sheet=pdf.addPage([600,800]);
    sheet.drawText(name+' page '+n,{x:50,y:720,size:13,font});
  }
  const path=join(root,name+'.pdf');
  await writeFile(path,await pdf.save());
  return path;
}

const exe=process.env.RDNEXT_EXE;
const app=await electron.launch({
  ...(exe?{executablePath:exe}:{}),
  args:[...(exe?[]:['.']),'--workspace='+join(root,'workspace')],
  env:{...process.env,RDNEXT_TEST_HIDE:'1',RDNEXT_CODEX:stub,RDNEXT_CODEX_EVENTS:codexTrace,
    RDNEXT_HARNESS_DIR:harness,RDNEXT_HARNESS_EVENTS:harnessTrace},
});
const page=await app.firstWindow();
const button=name=>page.getByRole('button',{name,exact:true});
const errors=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('dialog',dialog=>dialog.accept());
const api=(path,method='GET',body)=>page.evaluate(async({path,method,body})=>{
  const response=await fetch('/api'+path,{method,...(body===undefined?{}:{
    headers:{'Content-Type':'application/json'},body:JSON.stringify(body),
  })});
  if(!response.ok)throw Error(await response.text());
  return response.headers.get('content-type')?.includes('ndjson')?await response.text():await response.json();
},{path,method,body});
const commands=async file=>(await readFile(file,'utf8')).trim().split('\n').map(line=>JSON.parse(line));

async function translate(name,connection,model,effort){
  const file=await sample(name);
  await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]})},file);
  await button('导入 PDF').click();
  await button('选择 PDF 文件').click();
  await button('完成').click();
  const paper=(await api('/papers')).find(p=>p.title===name);
  assert.ok(paper);
  const base='/papers/'+paper.id+'/reading';
  for(let n=1;n<=4;n++){
    const rows=Array.from({length:17},(_,i)=>({
      kind:n===1&&i===0?'title':'heading',
      rect:{x:.08,y:.05+i*.05,w:.75,h:.03},
      text:n===1&&i===1?'Compare α² ≤ 4, architec- ture, Fig. 3 and [12].':name+' section '+n+'.'+(i+1)+'.',
    }));
    await api(base+'/pages/'+n,'PUT',rows);
  }
  const plan=await api(base);
  assert.equal(plan.groups.length,68);
  const stream=await api(base+'/translate-batches','POST',{scope:'paper',connection,model,effort,revision:plan.revision});
  const events=stream.trim().split('\n').map(line=>JSON.parse(line));
  assert.equal(events.at(-1).kind,'done',stream);
  assert.equal(events.at(-1).done,68);
  assert.equal((await api(base)).groups.filter(g=>g.translation).length,68);
}

try{
  await page.getByRole('heading',{name:'今日工作台'}).waitFor();
  await page.evaluate(()=>localStorage.setItem('rdnext.metadata.disabled','true'));
  await app.evaluate(({ipcMain})=>{
    ipcMain.removeHandler('layout-ready');
    ipcMain.handle('layout-ready',async()=>{await new Promise(resolve=>setTimeout(resolve,1200));return false});
  });
  await translate('Session Codex','codex','fixture-model','high');
  await translate('Session Harness','harness','fixture-harness','high');
  const codex=await commands(codexTrace), acp=await commands(harnessTrace);
  const codexTurns=codex.filter(e=>e.method==='turn/start');
  const acpTurns=acp.filter(e=>e.method==='session/prompt');
  assert.equal(codex.filter(e=>e.method==='thread/start').length,2);
  assert.equal(acp.filter(e=>e.method==='session/new').length,2);
  assert.equal(codexTurns.length,4);
  assert.equal(acpTurns.length,4);
  assert.equal(codexTurns[0].params.threadId,codexTurns[2].params.threadId);
  assert.equal(new Set(acpTurns.slice(0,3).map(turn=>turn.pid)).size,1);
  assert.notEqual(acpTurns[2].pid,acpTurns[3].pid);
  const first=JSON.parse(codexTurns[0].params.input[0].text);
  assert.ok(first.targets.some(r=>r.text==='Compare α² ≤ 4, architec-ture, Fig. 3 and [12].'));
  assert.deepEqual(Object.keys(JSON.parse(codexTurns[1].params.input[0].text)),['targets']);
  assert.deepEqual(Object.keys(JSON.parse(acpTurns[1].params.prompt[0].text)),['targets']);
  assert.deepEqual(errors,[]);
  await writeFile(join(output,'summary.json'),JSON.stringify({passed:true,root,sourceIntact:true,codexTurns:4,harnessTurns:4,boundedSessions:true},null,2));
  console.log('Codex and Harness session reuse passed');
}catch(error){
  await page.screenshot({path:join(output,'failure.png')}).catch(()=>{});
  await writeFile(join(output,'summary.json'),JSON.stringify({passed:false,root,error:error.stack},null,2));
  throw error;
}finally{
  await page.waitForFunction(async()=>{
    const jobs=await fetch('/api/paper-jobs').then(response=>response.json());
    return jobs.every(job=>job.state!=='queued'&&job.state!=='running');
  },null,{timeout:10000}).catch(()=>{});
  await page.evaluate(()=>window.desktop.islandSettings({enabled:true,keepRunning:false})).catch(()=>{});
  await app.close();
}
