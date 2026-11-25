import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';

const output=resolve(process.env.RDNEXT_RECALL_RESULTS||'test-results/recall-0.3.2');
await mkdir(output,{recursive:true});
const root=await mkdtemp(join(output,'isolated-recall-'));
const exe=process.env.RDNEXT_EXE;
let app,page;
const launch=async()=>{
 app=await electron.launch({args:[...(exe?[]:['.']),'--workspace='+join(root,'workspace')],...(exe?{executablePath:exe}:{})});
 page=await app.firstWindow();
 await page.getByRole('heading',{name:'今日工作台'}).waitFor();
};
const call=(path,method='GET',payload)=>page.evaluate(async({path,method,payload})=>{
 const response=await fetch('/api'+path,{method,...(payload===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})});
 const data=await response.json();if(!response.ok)throw Error(JSON.stringify(data));return data;
},{path,method,payload});
try{
 await launch();
 await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]})},resolve('test-results/reader-0.2.1/2510.07077v1.pdf'));
 await page.getByRole('button',{name:'导入 PDF',exact:true}).click();
 await page.getByRole('button',{name:'选择 PDF 文件'}).click();
 await page.getByRole('button',{name:'完成',exact:true}).click();
 const [paper]=await call('/papers'),base='/papers/'+paper.id;
 const regions=JSON.parse(await readFile('tests/fixtures/vla-legacy-regions.json','utf8'));
 for(let n=1;n<=38;n++)await call(base+'/reading/pages/'+n,'PUT',regions.filter(r=>r.page===n));
 const before=await call(base+'/reading');
 const edited=await call(base+'/reading','PATCH',{action:'join',first:'p3-b9',selected:['p3-b9','p3-b12'],revision:before.revision});
 const manual=edited.groups.find(g=>g.regions.some(r=>r.id==='p3-b9'));
 await page.getByRole('button',{name:/2510\.07077v1/}).click();
 if(await page.getByRole('button',{name:'解析框',exact:true}).getAttribute('aria-pressed')!=='true')await page.getByRole('button',{name:'解析框',exact:true}).click();
 await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='连接区块')?.disabled);
 const plan=await call(base+'/reading');
 const cases=[['p4-b4','p4-b5'],['p6-b9','p7-b3'],['p7-b9','p8-b8'],['p17-b5','p17-b6']];
 for(const [from,to] of cases){
  assert.ok(plan.review.some(item=>item.first===from&&item.second===to)||plan.groups.some(g=>g.regions.some(r=>r.id===from)&&g.regions.some(r=>r.id===to)),from+' -> '+to);
 }
 assert.ok(plan.otherReview.length>0);
 assert.ok(plan.groups.flatMap(g=>g.regions).some(r=>r.flow?.version===1));
 assert.equal(plan.revision,edited.revision);
 assert.equal(plan.groups.find(g=>g.regions.some(r=>r.id==='p3-b9')).id,manual.id,'line metadata changed manual group identity');
 const first=plan.groups.find(g=>g.text.startsWith('The recent success'));
 assert.ok(!plan.review.some(item=>first.regions.some(r=>r.id===item.first)));
 await writeFile(join(output,'plan.json'),JSON.stringify({root,plan},null,2));
 await page.getByRole('button',{name:/^核对解析/}).click();
 await page.getByRole('button',{name:/^其他接缝 /}).click();
 assert.equal(await page.locator('.review-item').count(),plan.otherReview.length);
 const other=plan.otherReview[0];
 await page.locator('.review-jump').first().click();
 await page.getByRole('button',{name:'保留划分',exact:true}).click();
 await page.getByRole('button',{name:/^已确认 /}).click();
 await page.locator('.review-jump').first().click();
 await page.getByRole('button',{name:'重新核对',exact:true}).click();
 assert.ok((await call(base+'/reading')).otherReview.some(item=>item.first===other.first&&item.second===other.second));
 await page.getByRole('button',{name:/^建议核对 /}).click();
 await page.locator('.review-jump').first().click();
 const active=page.locator('.source-region[data-picked="true"]').first();
 const targetPage=await active.evaluate(el=>el.closest('[data-pdf-page]').dataset.pdfPage);
 await page.locator('[data-pdf-page="'+targetPage+'"] .page-bitmap canvas').waitFor();
 await page.screenshot({path:join(output,'review.png')});

 await page.getByRole('button',{name:'双语对照',exact:true}).click();
 const pdf=page.getByLabel('连续滚动 PDF 原文');
 const divider=page.getByRole('separator',{name:'调整阅读侧栏宽度'});
 const sizes=async()=>[(await page.getByLabel('连续滚动 PDF 原文').boundingBox()).width,(await page.locator('#reading-pane').boundingBox()).width];
 const initial=await sizes();
 assert.ok(Math.abs(initial[0]-initial[1])<3,JSON.stringify(initial));
 async function drag(delta){
  const start=await sizes();
  const onLeft=await page.locator('.reader-body').getAttribute('data-translation-left')==='true';
  const bounds=await divider.boundingBox();
  await page.mouse.move(bounds.x+bounds.width/2,bounds.y+Math.min(150,bounds.height/2));
  await page.mouse.down();await page.mouse.move(bounds.x+bounds.width/2+delta,bounds.y+Math.min(150,bounds.height/2),{steps:6});await page.mouse.up();
  await page.waitForFunction(expected=>Math.abs(document.querySelector('#reading-pane').getBoundingClientRect().width-expected)<4,start[1]+delta*(onLeft?1:-1));
 }
 await drag(100);
 const right=await sizes();
 assert.ok(right[0]>initial[0]+70&&right[1]<initial[1]-70,JSON.stringify(right));
 await page.getByRole('button',{name:'交换原文和译文位置'}).click();
 await drag(90);
 const left=await sizes();
 assert.ok(left[1]>right[1]+60,JSON.stringify(left));
 await divider.dblclick();
 await page.waitForFunction(()=>Math.abs(document.querySelector('.continuous-scroll').getBoundingClientRect().width-document.querySelector('#reading-pane').getBoundingClientRect().width)<3);
 const reset=await sizes();
 assert.ok(Math.abs(reset[0]-reset[1])<3,JSON.stringify(reset));
 await drag(100);
 const remembered=await sizes();
 await page.screenshot({path:join(output,'resized-bilingual.png')});
 await app.close();app=undefined;
 await launch();
 await page.getByRole('button',{name:'打开论文',exact:true}).click();
 await page.getByRole('separator',{name:'调整阅读侧栏宽度'}).waitFor();
 const reopened=await sizes();
 assert.ok(Math.abs(reopened[1]-remembered[1])<4,JSON.stringify({remembered,reopened}));
 console.log(JSON.stringify({root,review:plan.review.length,other:plan.otherReview.length,seams:cases,initial,right,left,reset,remembered,reopened,manualPreserved:true}));
}catch(err){if(page)await page.screenshot({path:join(output,'failure.png')}).catch(()=>{});throw err}
finally{if(app)await app.close()}
