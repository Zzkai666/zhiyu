import { _electron as electron } from 'playwright';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { copyFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const output=resolve(process.env.RDNEXT_CONNECTION_RESULTS || 'test-results/translation-connections');
await mkdir(output,{recursive:true});
const root=await mkdtemp(join(output,'isolated-'));
const stub=resolve('dist/bin/rdnext-test-codex.exe');
const harness=join(root,'DeepSeek Harness');
const buddy=join(root,'codebuddy.exe');
const marker=join(harness,'resources','app.asar');
await mkdir(dirname(marker),{recursive:true});
await writeFile(marker,'Local translation fixture');
await copyFile(stub,join(harness,'DeepSeek Harness.exe'));
await copyFile(stub,buddy);
const file=join(root,'Test paper.pdf');
const pdf=await PDFDocument.create();
const font=await pdf.embedFont(StandardFonts.Helvetica);
const paperPage=pdf.addPage([600,800]);
paperPage.drawText('A complete study of demonstration data',{x:50,y:742,size:20,font});
paperPage.drawText('The model uses demonstrations and a separate evaluation dataset [1].',{x:50,y:665,size:11,font});
await writeFile(file,await pdf.save());

const key='test-local-api-secret';
const requests=[];
let rejectRetranslation=false;
let omitCitationParagraph=false;
const mock=createServer(async(req,res)=>{
  if(req.headers.authorization!=='Bearer '+key){res.writeHead(401).end();return}
  res.setHeader('Content-Type','application/json');
  if(req.url==='/v1/models'){
    res.end(JSON.stringify({data:[{id:'fixture-bilingual'}]}));return;
  }
  if(req.url!=='/v1/chat/completions'){res.writeHead(404).end();return}
  let text='';
  for await(const chunk of req){text+=chunk}
  const body=JSON.parse(text);
  const batch=JSON.parse(body.messages[1].content);
  requests.push({model:body.model,ids:batch.targets.map(item=>item.id)});
  const translations=rejectRetranslation?[]:batch.targets.filter(item=>!omitCitationParagraph||!item.text.includes('[1]'))
    .map(item=>({id:item.id,text:'第 '+requests.length+' 次验收译文：'+item.text}));
  res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({translations})}}]}));
});
await new Promise(resolve=>mock.listen(0,'127.0.0.1',resolve));
const baseURL='http://127.0.0.1:'+mock.address().port+'/v1';
const exe=process.env.RDNEXT_EXE;
let app,page;
const errors=[];
const button=name=>page.getByRole('button',{name,exact:true});
const config=()=>page.getByRole('dialog',{name:'翻译设置',exact:true});
const read=path=>page.evaluate(async path=>{
  const r=await fetch('/api'+path);
  if(!r.ok)throw new Error('API '+r.status);
  return r.json();
},path);
async function until(check,message){
  const deadline=Date.now()+30000;
  while(Date.now()<deadline){
    if(await check())return;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw Error(message);
}
try{
  app=await electron.launch({
    ...(exe?{executablePath:exe}:{}),args:[...(exe?[]:['.']),'--workspace='+join(root,'workspace')],
    env:{...process.env,RDNEXT_TEST_HIDE:'1',RDNEXT_CODEX:stub,RDNEXT_HARNESS_DIR:harness,RDNEXT_CODEBUDDY:buddy,RDNEXT_BUDDY_ROOT:join(root,'buddy-config'),CODEBUDDY_API_KEY:'fixture-inherited-key',CODEBUDDY_AUTH_TOKEN:'fixture-inherited-token',CODEBUDDY_BASE_URL:'fixture-inherited-url'},
  });
  page=await app.firstWindow();
  page.on('pageerror',error=>errors.push(error.message));
  await page.getByRole('heading',{name:'今日工作台'}).waitFor();
  await page.evaluate(()=>localStorage.setItem('rdnext.metadata.disabled','true'));
  await app.evaluate(({dialog,ipcMain},fixture)=>{
    dialog.showOpenDialog=async()=>({canceled:false,filePaths:[fixture]});
    ipcMain.removeHandler('layout-ready');
    ipcMain.handle('layout-ready',()=>false);
  },file);
  await button('导入 PDF').click();
  await button('选择 PDF 文件').click();
  await button('完成').click();
  const [{id}]=await read('/papers');
  await until(async()=>(await read('/paper-jobs')).some(job=>job.paperId===id&&job.stage==='parse'&&job.state==='done'),'PDF did not parse');
  await button('阅读').click();
  await button('更多').click();
  await button('翻译设置').click();
  await until(async()=>await config().getByLabel('模型',{exact:true}).inputValue()==='fixture-model','legacy Codex models did not load');
  const source=config().getByLabel('翻译连接',{exact:true});
  for(const expected of ['codex','harness','buddy'])assert.equal(await source.locator('option[value="'+expected+'"]').count(),1);
  assert.equal(await source.locator('option[value="zcode"]').count(),0);
  await source.selectOption('harness');
  await until(async()=>await config().getByLabel('模型',{exact:true}).inputValue()==='fixture-harness','Harness models did not load');
  await config().getByLabel('思考强度',{exact:true}).selectOption('high');
  await button('检查连接').click();
  await config().getByText('连接正常，已读取所选模型。',{exact:true}).waitFor();
  await source.selectOption('buddy');
  await until(async()=>await config().getByLabel('模型',{exact:true}).inputValue()==='@default','WorkBuddy model option did not load');
  const buddyModels=config().getByLabel('模型',{exact:true});
  assert.equal(await buddyModels.locator('option[value="fixture-buddy"]').count(),1);
  await buddyModels.getByRole('option',{name:'Buddy Flash · fixture-buddy',exact:true}).waitFor({state:'attached'});
  await buddyModels.getByRole('option',{name:'Buddy Flash · fixture-buddy-free',exact:true}).waitFor({state:'attached'});
  const buddyEffort=config().getByLabel('思考强度',{exact:true});
  assert.ok(await buddyEffort.isDisabled());
  assert.ok(await config().getByText('选定具体模型后可查看支持的思考档位。').isVisible());
  await buddyModels.selectOption('fixture-buddy');
  const listEfforts=()=>buddyEffort.locator('option').evaluateAll(rows=>rows.map(row=>row.value));
  assert.deepEqual(await listEfforts(),['','low','high','max']);
  await buddyEffort.selectOption('low');
  await buddyModels.selectOption('fixture-buddy-free');
  assert.deepEqual(await listEfforts(),['','high']);
  assert.equal(await buddyEffort.inputValue(),'');
  await buddyModels.selectOption('fixture-buddy');
  await buddyEffort.selectOption('low');
  await button('刷新模型列表').click();
  await until(async()=>!await buddyModels.isDisabled(),'Buddy catalog refresh did not complete');
  assert.equal(await buddyModels.inputValue(),'fixture-buddy');
  assert.equal(await buddyEffort.inputValue(),'low');
  const mismatch=await page.evaluate(async()=>{
    const response=await fetch('/api/translation/test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({connection:'buddy',model:'fixture-buddy',effort:'medium'})});
    return {status:response.status,data:await response.json()};
  });
  assert.equal(mismatch.status,422);
  assert.match(mismatch.data.error,/刷新模型列表/);
  await button('检查连接').click();
  await config().getByText('连接正常，已读取所选模型。',{exact:true}).waitFor();
  const login=await read('/translation/buddy-login');
  assert.ok(login.command.includes(buddy) && login.command.includes('CODEBUDDY_CONFIG_DIR'));
  assert.ok(await config().getByRole('button',{name:'打开登录终端'}).isEnabled());
  await button('添加 API 连接').click();
  await config().getByLabel('连接名称').fill('测试 API');
  await config().getByLabel('API 基础地址').fill(baseURL);
  await config().getByLabel('API 密钥').fill(key);
  await button('保存 API 连接').click();
  await until(async()=>await config().getByLabel('模型',{exact:true}).inputValue()==='fixture-bilingual','API models did not load');
  await button('检查连接').click();
  await config().getByText('连接正常，已读取所选模型。',{exact:true}).waitFor();
  assert.equal(requests.length,0);
  const connections=await read('/translation/connections');
  const saved=connections.find(entry=>entry.kind==='api');
  assert.ok(saved?.hasKey);
  assert.ok(!JSON.stringify(connections).includes(key));
  await config().screenshot({path:join(output,'translation-connections.png')});
  await button('保存翻译设置').click();
  await button('更多').click();
  omitCitationParagraph=true;
  await button('翻译本页').click();
  await until(async()=>(await read('/paper-jobs')).some(job=>job.paperId===id&&job.stage==='translate'&&job.state==='failed'),'missing paragraph was not reported');
  const failed=(await read('/paper-jobs')).find(job=>job.paperId===id&&job.stage==='translate');
  assert.match(failed.message,/第 1 页「The model uses demonstrations/);
  assert.equal(failed.done,1);
  const partial=(await read('/papers/'+id+'/reading')).groups.find(group=>group.translation);
  assert.ok(partial);
  assert.ok(requests.length>1&&requests.slice(1).every(call=>!call.ids.includes(partial.id)));
  omitCitationParagraph=false;
  await button('重试翻译').click();
  await until(async()=>(await read('/paper-jobs')).some(job=>job.paperId===id&&job.stage==='translate'&&job.state==='done'),'linked API did not persist translation');
  assert.equal((await read('/papers/'+id+'/reading')).groups.find(group=>group.id===partial.id).translation,partial.translation);
  const job=(await read('/paper-jobs')).find(job=>job.paperId===id&&job.stage==='translate');
  assert.equal(job.payload.connection,saved.id);
  assert.equal(job.payload.connectionRevision,saved.revision);
  assert.ok(!JSON.stringify(job).includes(key));
  const plan=await read('/papers/'+id+'/reading');
  const translated=plan.groups.filter(group=>group.translation);
  assert.ok(translated.length>=1);
  assert.ok(translated.some(group=>group.translation.includes('[1]')));
  const translatedGroup=translated.find(group=>group.translation.includes('[1]'));
  const article=page.locator('.article-block[data-card="'+translatedGroup.id+'"]');
  await article.locator('.translation-text').waitFor();
  const before=await article.locator('.translation-text').boundingBox();
  await article.hover();
  const retry=article.getByRole('button',{name:'重翻此段'});
  const placement=await retry.boundingBox();
  assert.ok(placement.x>=before.x+before.width-1&&Math.abs(placement.y-before.y)<3);
  const hovered=await article.locator('.translation-text').boundingBox();
  assert.equal(hovered.height,before.height);
  rejectRetranslation=true;
  await retry.click();
  await page.getByText(/重翻未完成，原译文保留/).waitFor();
  assert.equal((await read('/papers/'+id+'/reading')).groups.find(group=>group.id===translatedGroup.id).translation,translatedGroup.translation);
  rejectRetranslation=false;
  await retry.click();
  await page.getByText('此段译文已更新',{exact:true}).waitFor();
  const updated=await read('/papers/'+id+'/reading');
  assert.notEqual(updated.groups.find(group=>group.id===translatedGroup.id).translation,translatedGroup.translation);
  assert.deepEqual(requests.at(-1).ids,[translatedGroup.id]);
  await page.screenshot({path:join(output,'paragraph-retranslation.png')});

  assert.deepEqual(errors,[]);
  await writeFile(join(output,'summary.json'),JSON.stringify({passed:true,root,harnessFixture:true,buddyFixture:true,partialRetry:true,singleRetranslation:true,translated:translated.length,requests},null,2));
  console.log('Translation connections passed');
}catch(error){
  console.error(error);
  if(page)await page.screenshot({path:join(output,'failure.png')}).catch(()=>{});
  process.exitCode=1;
}finally{
  if(app)await app.close();
  await new Promise(resolve=>mock.close(resolve));
}
