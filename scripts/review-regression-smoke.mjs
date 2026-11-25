import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import {join,resolve} from 'node:path';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';

const output=resolve(process.env.RDNEXT_REVIEW_RESULTS||'test-results/review-0.3.1');
await mkdir(output,{recursive:true});
const root=process.env.RDNEXT_REVIEW_ROOT||await mkdtemp(join(output,'isolated-review-'));
const exe=process.env.RDNEXT_EXE;
const app=await electron.launch({args:[...(exe?[]:['.']),'--workspace='+join(root,'workspace')],...(exe?{executablePath:exe}:{})});
let page;
try{
 page=await app.firstWindow();
 await page.getByRole('heading',{name:'今日工作台'}).waitFor();
 const papers=await page.evaluate(async()=>fetch('/api/papers').then(r=>r.json()));
 if(!papers.length){
  await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]})},resolve('test-results/reader-0.2.1/2510.07077v1.pdf'));
  await page.getByRole('button',{name:'导入 PDF',exact:true}).click();
  await page.getByRole('button',{name:'选择 PDF 文件'}).click();
  await page.getByRole('button',{name:'完成',exact:true}).click();
  await page.getByRole('button',{name:/2510\.07077v1/}).click();
 }else{
  await page.getByRole('button',{name:'打开论文',exact:true}).click();
 }
 await page.getByRole('button',{name:'解析框',exact:true}).click();
 await page.getByText('38 / 38 页',{exact:true}).waitFor({timeout:180000});
 const plan=await page.evaluate(async()=>{
  const [paper]=await fetch('/api/papers').then(r=>r.json());
  return fetch('/api/papers/'+paper.id+'/reading').then(r=>r.json());
 });
 await writeFile(join(output,process.env.RDNEXT_REVIEW_BASELINE?'before-plan.json':'after-plan.json'),JSON.stringify({root,plan},null,2));
 const first=plan.groups.find(g=>g.regions[0].page===1&&g.text.startsWith('The recent success'));
 assert.ok(first);
 if(!process.env.RDNEXT_REVIEW_BASELINE){
  assert.ok(!first.text.includes('arXiv:'),first.text);
  if(!papers.length){
   const stamp=plan.groups.flatMap(g=>g.regions).find(r=>r.page===1&&r.kind==='margin'&&r.text.startsWith('arXiv:'));
   assert.ok(stamp,'New parse did not retain the vertical stamp as a margin');
   assert.ok(stamp.rect.w<.05&&stamp.rect.h>.3,JSON.stringify(stamp.rect));
  }
  assert.ok(!plan.review.some(item=>first.regions.some(region=>region.id===item.first)), 'Complete first paragraph incorrectly proposed');
  for(const item of plan.review){
    const b=plan.groups.flatMap(g=>g.regions).find(r=>r.id===item.second);
    if(b)assert.ok(!/^(?:[(（]?[0-9]+[.)）]|[•●▪◦])\s/u.test(b.text.trim()),'List item proposed as continuation');
  }
 }
 await page.getByRole('button',{name:/^核对解析/}).click();
 if(plan.review.length){
  await page.locator('.review-jump').first().click();
  if(!process.env.RDNEXT_REVIEW_BASELINE){
   assert.equal(await page.locator('.review-excerpt-label').count(),plan.review.filter(item=>item.second).length*2+plan.review.filter(item=>!item.second).length);
  }
 }
 if(plan.review.length){
  const firstID=plan.review[0].first;
  const region=plan.groups.flatMap(g=>g.regions).find(r=>r.id===firstID);
  await page.locator('[data-pdf-page="'+region.page+'"] .page-bitmap canvas').waitFor({state:'attached'});
  await page.locator('[data-pdf-page="'+region.page+'"] .textLayer span').first().waitFor();
 }
 await page.screenshot({path:join(output,process.env.RDNEXT_REVIEW_BASELINE?'before.png':'after.png')});
 console.log(JSON.stringify({root,review:plan.review.length,firstText:first.text,firstID:first.regions[0].id,pages:plan.pages.length}));
}catch(err){if(page)await page.screenshot({path:join(output,'failure.png')}).catch(()=>{});throw err}
finally{await app.close()}
