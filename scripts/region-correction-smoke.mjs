import { _electron as electron } from 'playwright';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const results = resolve(process.env.RDNEXT_CORRECTION_RESULTS || 'test-results/reader-0.8.6/correction');
await mkdir(results,{recursive:true});
const root = await mkdtemp(join(results,'isolated-'));
const pdf = join(root,'Research Review.pdf');
const body = (text,y) => ({
  kind:'text',text,rect:{x:.08,y,w:.42,h:.08},
  flow:{version:1,lines:3,firstX:.08,lastRight:.49,left:.08,right:.5,fontX:.013,step:.024},
});
const regions = [
  body('The benchmark measures the practical effect of', .20),
  body('using several models under otherwise identical', .29),
  body('experimental conditions on all tasks.', .38),
  {kind:'heading',text:'Other material',rect:{x:.08,y:.52,w:.42,h:.04}},
  body('The extracted word � cannot be read.', .58),
];
const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.Helvetica);
const sheet = doc.addPage([600,800]);
for (const region of regions) {
  sheet.drawText(region.text.replace('�','?'),{x:48,y:790-region.rect.y*800,size:12,font});
}
await writeFile(pdf,await doc.save());

let app,page;
const errors=[];
const checks=[];
const button = name => page.getByRole('button',{name,exact:true});
const shot = name => page.screenshot({path:join(results,name+'.png')});
async function api(path,method='GET',body) {
  return page.evaluate(async ({path,method,body})=>{
    const response=await fetch('/api'+path,{method,...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
    const data=await response.json();
    if(!response.ok)throw Error(response.status+' '+JSON.stringify(data));
    return data;
  },{path,method,body});
}
async function until(test,label) {
  const deadline=Date.now()+30000;
  while(Date.now()<deadline){
    if(await test())return;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw Error(label);
}

try {
  const executablePath=process.env.RDNEXT_EXE;
  app=await electron.launch({...(executablePath?{executablePath}:{}),args:[...(executablePath?[]:['.']),'--workspace='+root],env:{...process.env,RDNEXT_TEST_HIDE:'1'}});
  page=await app.firstWindow();
  page.on('pageerror',error=>errors.push(error.message));
  await page.getByRole('heading',{name:'今日工作台'}).waitFor();
  await page.evaluate(()=>localStorage.setItem('rdnext.metadata.disabled','true'));
  await app.evaluate(({ipcMain,dialog},pdf)=>{
    dialog.showOpenDialog=async()=>({canceled:false,filePaths:[pdf]});
    ipcMain.removeHandler('layout-run');
    ipcMain.handle('layout-run',async()=>{await new Promise(r=>setTimeout(r,3500));return []});
  },pdf);
  await button('导入 PDF').click();
  await button('选择 PDF 文件').click();
  await button('完成').click();
  const [paper]=await api('/papers');
  const base='/papers/'+paper.id+'/reading';
  await api(base+'/pages/1','PUT',regions);
  await until(async()=>(await api('/paper-jobs')).some(j=>j.paperId===paper.id&&j.stage==='parse'&&j.state==='done'),'fixture parse did not settle');
  assert.equal((await api(base)).review.length,3);
  await button('阅读').click();
  await button('核对解析 · 3 项').waitFor();
  assert.equal(await page.locator('.paper-stage-strip').count(),0);
  assert.equal(await button('翻译准备').count(),0);
  assert.equal(await button('翻译全文').count(),0);
  for(const label of ['笔记注释','新增文字','选择区域','绘图']){
    const tool=page.locator('.reader-tools').getByRole('button',{name:label,exact:true});
    await tool.click();
    assert.equal(await tool.getAttribute('aria-pressed'),'true');
    await page.keyboard.press('Escape');
  }
  checks.push('only one review action appears and every requested annotation tool remains directly clickable');
  await button('核对解析 · 3 项').click();
  let chain=page.locator('.review-item').filter({hasText:'3 块正文可能属于同一段'});
  await chain.locator('.review-jump').click();
  assert.equal(await chain.locator('.review-fragment').count(),3);
  await chain.locator('.review-fragment').nth(2).click();
  assert.equal(await page.locator('.source-region[data-picked=true]').count(),3);
  await shot('review-chain');
  await chain.getByRole('button',{name:'保留划分',exact:true}).click();
  await until(async()=>(await api(base)).confirmedReview.length===2,'keeping the full chain did not save both seams');
  await button('已确认 2').click();
  chain=page.locator('.review-item').filter({hasText:'3 块正文可能属于同一段'});
  await chain.locator('.review-jump').click();
  await chain.getByRole('button',{name:'重新核对',exact:true}).click();
  await until(async()=>(await api(base)).review.length===3,'group recheck did not restore both seams');
  await button('必核对 3').click();
  chain=page.locator('.review-item').filter({hasText:'3 块正文可能属于同一段'});
  await chain.locator('.review-jump').click();
  await chain.getByRole('button',{name:'连接3 块',exact:true}).click();
  await until(async()=>(await api(base)).groups.some(g=>g.regions.length===3),'three blocks did not become one paragraph');
  const correction=page.getByRole('region',{name:'更正区块',exact:true});
  const badge=(id)=>page.locator('.region-label[data-region="'+id+'"]');
  await badge('p1-b2').click();
  await correction.waitFor();
  assert.equal(await correction.getByLabel('类别').inputValue(),'text');
  await correction.getByRole('button',{name:'与前一块拆开',exact:true}).click();
  await until(async()=>(await api(base)).groups.some(g=>g.regions.map(r=>r.id).join(',')==='p1-b2,p1-b3'),'one edge was not split or other edge was lost');
  assert.equal(await correction.getByRole('button',{name:'与前一块拆开',exact:true}).count(),0);
  await correction.getByRole('button',{name:'与后一块拆开',exact:true}).waitFor();
  await correction.getByLabel('类别').selectOption('margin');
  assert.ok(await correction.getByLabel('此区块需要翻译').isDisabled());
  await shot('correction-near-source');
  await correction.getByRole('button',{name:'保存更正',exact:true}).click();
  await correction.waitFor({state:'hidden'});
  let plan=await api(base);
  let footer=plan.groups.find(g=>g.regions[0].id==='p1-b2');
  assert.equal(footer.regions.length,1);
  assert.equal(footer.regions[0].kind,'margin');
  assert.equal(footer.translate,false);
  await badge('p1-b1').click();
  await correction.getByRole('button',{name:'连接其他区块',exact:true}).click();
  const joinPanel=page.getByRole('region',{name:'连接区块',exact:true});
  await joinPanel.waitFor();
  await badge('p1-b3').click();
  await joinPanel.getByRole('button',{name:'连接已选区块',exact:true}).click();
  await until(async()=>(await api(base)).groups.some(g=>g.regions.map(r=>r.id).join(',')==='p1-b1,p1-b3'),'near-source confirmation did not connect only selected pieces');
  await button('核对解析').click();
  const quality=page.locator('.review-item').filter({hasText:'正文含无法提取的字形'});
  await quality.locator('.review-jump').click();
  await quality.getByRole('button',{name:'更正区块',exact:true}).click();
  await correction.waitFor();
  assert.equal(await correction.getByLabel('类别').inputValue(),'text');
  assert.ok(await page.locator('.source-region[data-region="p1-b5"]').getAttribute('data-active')==='true');
  await correction.getByRole('button',{name:'关闭区块操作',exact:true}).click();
  await correction.waitFor({state:'hidden'});
  await page.setViewportSize({width:840,height:780});
  await badge('p1-b2').click();
  await correction.waitFor();
  const bounds=await correction.boundingBox();
  assert.ok(bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=840&&bounds.y+bounds.height<=780);
  await shot('correction-narrow');
  await page.keyboard.press('Escape');
  await correction.waitFor({state:'hidden'});
  await page.reload();
  await page.getByRole('heading',{name:'今日工作台'}).waitFor();
  plan=await api(base);
  footer=plan.groups.find(g=>g.regions[0].id==='p1-b2');
  assert.equal(footer.regions[0].kind,'margin');
  assert.equal(footer.translate,false);
  assert.ok(plan.groups.some(g=>g.regions.map(r=>r.id).join(',')==='p1-b1,p1-b3'));
  checks.push('original frame and sidebar both open local correction; single split, atomic category correction, confirmed join and persisted decisions work');
  assert.deepEqual(errors,[]);
  checks.push('pane controls and contextual menu work at narrow width, with no renderer errors');
  await app.close();
  app=null;
  await writeFile(join(results,'summary.json'),JSON.stringify({passed:true,root,checks},null,2));
  console.log(JSON.stringify({passed:true,checks:checks.length}));
} catch(error) {
  await page?.screenshot({path:join(results,'failure.png')}).catch(()=>{});
  await writeFile(join(results,'summary.json'),JSON.stringify({passed:false,root,checks,errors,error:error.stack},null,2));
  throw error;
} finally {
  await app?.close();
}