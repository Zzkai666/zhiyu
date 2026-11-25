import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import {join,resolve} from 'node:path';
import {mkdir,mkdtemp} from 'node:fs/promises';

const output=resolve(process.env.RDNEXT_UX_RESULTS||'test-results/reader-0.2.1');
await mkdir(output,{recursive:true});
const root=await mkdtemp(join(output,'isolated-ux-'));
const sample=resolve(process.env.RDNEXT_UX_SAMPLE||'test-results/reader-0.2.1/2510.07077v1.pdf');
const exe=process.env.RDNEXT_EXE;
const args=[...(exe?[]:['.']),'--workspace='+join(root,'workspace')];
const env={...process.env,RDNEXT_CODEX:resolve('dist/bin/rdnext-test-codex.exe'),RDNEXT_CODEX_TRACE:join(root,'codex.json')};
const app=await electron.launch({args,env,...(exe?{executablePath:exe}:{})});
let page;
try{
 page=await app.firstWindow();
 const errors=[];
 page.on('pageerror',err=>errors.push(err.message));
 await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]})},sample);
 await page.getByRole('button',{name:'导入 PDF',exact:true}).click();
 await page.getByRole('button',{name:'选择 PDF 文件'}).click();
 await page.getByRole('button',{name:'完成',exact:true}).click();
 await page.getByRole('button',{name:/2510\.07077v1/}).click();
 const pdf=page.getByLabel('连续滚动 PDF 原文');
 const first=page.locator('[data-pdf-page="1"] .page-bitmap canvas');
 await first.waitFor({state:'attached'});
 assert.equal(await page.locator('#reading-pane').count(),1);
 assert.equal(await page.getByRole('button',{name:'解析框',exact:true}).getAttribute('aria-pressed'),'true');
 const initialPixels=await first.evaluate(c=>c.width);
 await pdf.hover({position:{x:220,y:280}});
 await page.keyboard.down('Control');
 try{await page.mouse.wheel(0,-120)}finally{await page.keyboard.up('Control')}
 await page.getByRole('button',{name:'110%',exact:true}).waitFor();
 await page.waitForFunction(w=>document.querySelector('[data-pdf-page="1"] canvas')?.width>w*1.05,initialPixels);
 const largePixels=await first.evaluate(c=>c.width);
 await page.keyboard.down('Control');
 try{await page.mouse.wheel(0,120)}finally{await page.keyboard.up('Control')}
 await page.getByRole('button',{name:'100%',exact:true}).waitFor();
 await page.waitForFunction(w=>document.querySelector('[data-pdf-page="1"] canvas')?.width===w,initialPixels);
 if(await page.getByRole('button',{name:'解析框',exact:true}).getAttribute('aria-pressed')!=='true')await page.getByRole('button',{name:'解析框',exact:true}).click();
 const getPlan=()=>page.evaluate(async()=>{
  const [paper]=await fetch('/api/papers').then(r=>r.json());
  return fetch('/api/papers/'+paper.id+'/reading').then(r=>r.json());
 });
 await page.getByText('38 / 38 页',{exact:true}).waitFor({timeout:200000});
 const plan=await getPlan();
 const firstBody=plan.groups.find(g=>g.regions[0].page===1&&g.text.startsWith('The recent success'));
 assert.ok(firstBody);
 assert.ok(!firstBody.text.includes('arXiv:'));
 assert.ok(!plan.review.some(item=>firstBody.regions.some(r=>r.id===item.first)));
 assert.ok(plan.groups.some(g=>g.regions.some(r=>r.page===1&&r.kind==='margin'&&r.text.startsWith('arXiv:')&&r.rect.w<.05)));
 assert.ok(plan.review.length>0);
 assert.ok(plan.review.some(item=>item.second));
 await page.getByRole('button',{name:/^核对解析/}).click();
 const suggestion=page.locator('.review-jump').first();
 const firstReview=plan.review[0];
 await suggestion.click();
 await page.locator('#region-'+firstReview.first+'[data-picked="true"]').waitFor();
 await page.screenshot({path:join(output,'review.png')});
 await page.getByRole('button',{name:'保留划分',exact:true}).click();
 await page.waitForFunction(async item=>{
   const [paper]=await fetch('/api/papers').then(r=>r.json());
   const reading=await fetch('/api/papers/'+paper.id+'/reading').then(r=>r.json());
   return !reading.review.some(row=>row.first===item.first&&row.second===item.second);
 },firstReview);
 await page.getByRole('button',{name:'解析',exact:true}).click();
 const one=page.getByRole('textbox',{name:'页码'});
 await one.fill('1');await one.press('Enter');
 await first.waitFor({state:'attached'});
 const author=plan.groups.filter(g=>g.regions[0].page===1&&g.regions[0].kind==='author');
 assert.equal(author.length,5);
 assert.ok(author.every(g=>!g.translate));
 assert.ok(author.filter(g=>g.text.includes('Department of')).length===3);
 await page.locator('[data-pdf-page="1"] .region-label[data-kind="author"]').first().waitFor();
 await page.screenshot({path:join(output,'authors.png')});
 const labelAudit=await page.locator('[data-pdf-page="1"] .paper-surface').evaluate((sheet,regions)=>{
  const bounds=sheet.getBoundingClientRect();
  const byID=new Map(regions.map(r=>[r.id,r.rect]));
  const raw=[...byID];
  let extended=0,normal=0;
  for(const label of sheet.querySelectorAll('.region-label')){
   const frame=sheet.querySelector('#region-'+label.dataset.region);
   const r=byID.get(label.dataset.region);
   if(!frame||!r)continue;
   const a=label.getBoundingClientRect(),b=frame.getBoundingClientRect();
   if(a.right>b.right+1||a.bottom>b.bottom+1||a.left<b.left-1||a.top<b.top-1)throw Error('label outside frame '+label.dataset.region);
   if(label.dataset.mode!=='compact'){
    normal++;
    if(label.dataset.mode!=='inset'&&(b.right-a.right>4||b.bottom-a.bottom>5))throw Error('not bottom right '+label.dataset.region);
   }
   if(label.dataset.mode==='tab'){
    extended++;
    const top=r.y+r.h,end=(b.bottom-bounds.top)/bounds.height;
    for(const [id,other] of raw){
     if(id!==label.dataset.region&&Math.min(end,other.y+other.h)-Math.max(top,other.y)>.00006&&
        Math.min(r.x+r.w,other.x+other.w)-Math.max(r.x,other.x)>.00006)throw Error('expanded across '+id);
    }
   }
  }
  return {extended,normal};
 },plan.groups.flatMap(g=>g.regions).filter(r=>r.page===1));
 assert.ok(labelAudit.normal>3);
 const selectedText=await page.locator('[data-pdf-page="1"] .textLayer').evaluate(layer=>{
  const spans=[...layer.querySelectorAll('span')].filter(s=>s.firstChild?.nodeType===Node.TEXT_NODE&&s.textContent.trim().length>18);
  const i=spans.findIndex(s=>s.textContent.includes('VLA models aim'));
  const start=spans[i].firstChild,end=spans[i+3].firstChild;
  const range=document.createRange();range.setStart(start,0);range.setEnd(end,Math.min(34,end.length));
  const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
  layer.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,button:0}));
  return selection.toString();
 });
 assert.match(selectedText,/VLA models aim/);
 const overlay=page.locator('[data-pdf-page="1"] .live-selection path');
 await overlay.waitFor({state:'attached'});
 assert.equal(await overlay.count(),1);
 assert.ok((await overlay.getAttribute('d')).split('M').length>=4);
 assert.equal(await page.locator('[data-pdf-page="1"] .textLayer').evaluate(el=>getComputedStyle(el,'::selection').backgroundColor),'rgba(0, 0, 0, 0)');
 await page.screenshot({path:join(output,'selection.png')});
 await page.getByRole('button',{name:'高亮选区'}).click();
 await page.locator('[data-pdf-page="1"] .saved-highlights path').waitFor({state:'attached'});
 assert.equal(await page.locator('[data-pdf-page="1"] .saved-highlights path').count(),1);
 await page.getByRole('button',{name:'标记',exact:true}).click();
 await page.getByRole('button',{name:'添加批注',exact:true}).click();
 await page.getByRole('textbox',{name:'评论',exact:true}).fill('定义部分稍后再读');
 await page.screenshot({path:join(output,'comment.png')});
 await page.getByRole('button',{name:'保存批注',exact:true}).click();
 await page.getByText('定义部分稍后再读',{exact:true}).waitFor();
 await page.getByRole('button',{name:/标记颜色/}).click();
 const green=page.getByRole('menuitemradio',{name:'绿色',exact:true});
 assert.equal(await green.locator('i').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(72, 169, 118)');
 await green.click();
 await page.getByRole('button',{name:'下划线',exact:true}).click();
 assert.equal(await page.getByRole('button',{name:'下划线',exact:true}).getAttribute('aria-pressed'),'true');
 await page.locator('[data-pdf-page="1"] .textLayer').evaluate(layer=>{
  const span=[...layer.querySelectorAll('span')].find(s=>s.firstChild?.nodeType===Node.TEXT_NODE&&s.textContent.includes('VLA models aim'));
  const range=document.createRange();
  range.selectNodeContents(span);
  const sel=getSelection();sel.removeAllRanges();sel.addRange(range);
  layer.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,button:0}));
 });
 await page.locator('[data-pdf-page="1"] .underline.green').first().waitFor();
 assert.equal(await page.getByRole('button',{name:'下划线',exact:true}).getAttribute('aria-pressed'),'false');
 await page.getByRole('button',{name:'解析',exact:true}).click();
 async function go(n){
  const field=page.getByRole('textbox',{name:'页码'});
  await field.fill(String(n));await field.press('Enter');
  await page.locator('[data-pdf-page="'+n+'"] .page-bitmap canvas').waitFor({state:'attached'});
 }
 await go(3);
 const pdfLink=page.locator('[data-pdf-page="3"] [data-destination="figure.2"]');
 await pdfLink.scrollIntoViewIfNeeded();
 const beforeJump=await pdf.evaluate(el=>[el.scrollLeft,el.scrollTop]);
 const linkBounds=await pdfLink.boundingBox();
 assert.ok(linkBounds);
 await page.mouse.click(linkBounds.x+linkBounds.width/2,linkBounds.y+linkBounds.height/2);
 await page.locator('[data-pdf-page="4"] .reference-target').waitFor();
 await page.getByRole('button',{name:'返回阅读位置',exact:true}).click();
 const afterJump=await pdf.evaluate(el=>[el.scrollLeft,el.scrollTop]);
 assert.deepEqual(afterJump,beforeJump);
 const nativeCitation=page.locator('[data-pdf-page="3"] [data-destination="cite.chen2015cococaptions"]');
 await nativeCitation.scrollIntoViewIfNeeded();
 const citeBounds=await nativeCitation.boundingBox();
 await page.mouse.click(citeBounds.x+citeBounds.width/2,citeBounds.y+citeBounds.height/2);
 await page.locator('[data-pdf-page="26"] .reference-target').waitFor();
 await page.getByRole('button',{name:'返回阅读位置',exact:true}).click();
 const auto=plan.groups.find(g=>g.auto&&g.regions.some(r=>r.id==='p3-b9')&&g.regions.some(r=>r.id==='p3-b10'));
 assert.ok(auto);
 assert.match(auto.text,/fine-tune them for downstream tasks/);
 const pick=id=>page.locator('.region-label[data-region="'+id+'"]').click();
 await pick('p3-b9');
 await page.locator('[data-card="'+auto.id+'"]').getByRole('button',{name:'拆开连接'}).click();
 await page.waitForFunction(id=>!document.querySelector('[data-card="'+id+'"]'),auto.id);
 await page.getByRole('button',{name:'连接区块',exact:true}).click();
 for(const id of ['p3-b12','p3-b9','p3-b10']) await pick(id);
 await page.getByText('已选 3 组 · 3 个区块。',{exact:false}).waitFor();
 await page.getByRole('button',{name:'连接已选区块',exact:true}).click();
 await page.getByRole('button',{name:'连接已选区块',exact:true}).waitFor({state:'hidden'});
 const joined=(await getPlan()).groups.find(g=>g.regions.some(r=>r.id==='p3-b9'));
 assert.deepEqual(joined.regions.map(r=>r.id),['p3-b9','p3-b10','p3-b12']);
 await page.screenshot({path:join(output,'three-blocks.png')});
 await page.getByRole('button',{name:'双语对照',exact:true}).click();
 const split=[await pdf.boundingBox(),await page.locator('#reading-pane').boundingBox()];
 assert.ok(Math.abs(split[0].width-split[1].width)<3,JSON.stringify(split));
 assert.ok(await page.getByRole('button',{name:'翻译全文',exact:true}).isDisabled());
 await page.getByRole('button',{name:'选择 Codex 模型',exact:true}).click();
 await page.getByLabel('模型',{exact:true}).selectOption('fixture-model');
 await page.getByRole('button',{name:'保存翻译设置'}).click();
 const card=page.locator('[data-card="'+joined.id+'"]');
 await card.locator('.translation-text').click();
 await page.getByRole('button',{name:'翻译此段',exact:true}).click();
 await page.locator('[data-card="'+joined.id+'"][data-translated="true"]').waitFor();
 const currentPlan=await getPlan();
 const figureSource=currentPlan.groups.find(g=>g.translate&&g.text.includes('Fig. 2)'));
 assert.ok(figureSource);
 const figureCard=page.locator('[data-card="'+figureSource.id+'"]');
 if(!currentPlan.groups.find(g=>g.id===figureSource.id).translation){await figureCard.locator('.translation-text').click();await page.getByRole('button',{name:'翻译此段',exact:true}).click()}
 await figureCard.getByRole('button',{name:'图 2',exact:true}).click();
 await page.locator('[data-pdf-page="4"] .reference-target').waitFor();
 await page.getByRole('button',{name:'返回阅读位置',exact:true}).click();
 const bibliographySource=currentPlan.groups.find(g=>g.translate&&g.text.includes('COCO Captions [14]'));
 assert.ok(bibliographySource);
 const bibliographyCard=page.locator('[data-card="'+bibliographySource.id+'"]');
 if(!currentPlan.groups.find(g=>g.id===bibliographySource.id).translation){await bibliographyCard.locator('.translation-text').click();await page.getByRole('button',{name:'翻译此段',exact:true}).click()}
 await bibliographyCard.getByRole('button',{name:'[14]',exact:true}).click();
 await page.locator('[data-pdf-page="26"] .reference-target').waitFor();
 await page.getByRole('button',{name:'返回阅读位置',exact:true}).click();
 await page.getByRole('button',{name:'交换原文和译文位置'}).click();
 assert.ok((await page.locator('#reading-pane').boundingBox()).x<(await pdf.boundingBox()).x);
 await page.getByRole('button',{name:'译文排版',exact:true}).click();
 await page.getByLabel('译文字体',{exact:true}).selectOption('serif');
 await page.getByLabel('译文字号',{exact:true}).press('End');
 await page.getByLabel('译文行距',{exact:true}).press('End');
 await page.getByRole('button',{name:'完成',exact:true}).click();
 const style=await card.locator('.translation-text').evaluate(el=>{
  const {fontSize,lineHeight,fontFamily}=getComputedStyle(el);
  return {fontSize,lineHeight,fontFamily};
 });
 assert.equal(style.fontSize,'28px');
 assert.equal(style.lineHeight,'63px');
 assert.match(style.fontFamily,/SimSun/);
 await card.locator('.translation-text').click();
 await page.getByRole('navigation',{name:'选中段落的对应原文'}).getByRole('button',{name:'查看第 3 处原文'}).click();
 assert.equal(await page.getByRole('navigation',{name:'选中段落的对应原文'}).getByRole('button',{name:'查看第 3 处原文'}).getAttribute('aria-pressed'),'true');
 await page.screenshot({path:join(output,'bilingual-left.png')});
 await page.getByRole('button',{name:'翻译准备',exact:true}).click();
 page.once('dialog',dialog=>dialog.accept());
 await page.getByRole('button',{name:'保留其余划分',exact:true}).click();
 await page.getByText('建议项已核对 · ',{exact:false}).waitFor();
 assert.ok(await page.getByRole('button',{name:'翻译全文',exact:true}).isEnabled());
 const fullRequest=page.waitForRequest(req=>req.url().includes('/reading/translate')&&req.postDataJSON()?.scope==='paper');
 await page.getByRole('button',{name:'翻译全文',exact:true}).click();
 const full=await fullRequest;
 assert.equal(full.postDataJSON().scope,'paper');
 await page.getByRole('button',{name:'停止翻译',exact:true}).click();
 await page.getByRole('button',{name:'停止翻译',exact:true}).waitFor({state:'hidden'});
 await page.getByRole('button',{name:'原文',exact:true}).click();
 assert.equal(await page.locator('#reading-pane').count(),0);
 assert.equal(await page.locator('.region-layer').count(),0);
 await page.getByRole('button',{name:'双语对照',exact:true}).click();
 assert.ok((await page.locator('#reading-pane').boundingBox()).x<(await pdf.boundingBox()).x);
 assert.equal(await card.locator('.translation-text').evaluate(el=>getComputedStyle(el).fontSize),'28px');
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({root,pages:plan.pages.length,authorRegions:author.length,initialPixels,largePixels,labelAudit,reviewCount:plan.review.length,split:split.map(box=>box.width),nativeDestinations:[4,26],translatedDestinations:[4,26],auto:auto.regions.map(r=>r.id),manual:joined.regions.map(r=>r.id),style}));
}catch(err){if(page)await page.screenshot({path:join(output,'failure.png')}).catch(()=>{});throw err}
finally{await app.close()}
