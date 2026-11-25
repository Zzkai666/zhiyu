import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const results = resolve(process.env.RDNEXT_REGIONS_RESULTS || 'test-results/reader-0.9.11/regions');
await mkdir(results,{recursive:true});
const root = await mkdtemp(join(results,'isolated-'));
const sample = resolve('test-results/reader-0.2.1/2510.07077v1.pdf');
const regions = JSON.parse(await readFile('tests/fixtures/vla-legacy-regions.json','utf8'));
// Give just one fragment of a known cross-page paragraph a pending category check.
regions.find(region=>region.id==='p3-b14').labelUncertain=true;
const exe = process.env.RDNEXT_EXE;
const app = await electron.launch({
  ...(exe?{executablePath:exe}:{}),
  args:[...(exe?[]:['.']),'--workspace='+join(root,'workspace')],
  env:{...process.env,RDNEXT_TEST_HIDE:'1'},
});

const page = await app.firstWindow();
const errors=[];
page.on('pageerror',error=>errors.push(error.message));
const button = name => page.getByRole('button',{name,exact:true});
const frame = id => page.locator('.source-region[data-region="'+id+'"]');
const badge = id => page.locator('.region-label[data-region="'+id+'"]');
const list = page.getByRole('region',{name:'全文解析区块'});
const filter = page.getByLabel('全文区块类别');
const source = page.getByLabel('连续滚动 PDF 原文');
const card = id => list.locator('[data-card="'+id+'"]');
const pageInput = page.getByRole('textbox',{name:'页码'});

async function api(path,method='GET',payload) {
  return page.evaluate(async ({path,method,payload})=>{
    const r=await fetch('/api'+path,{method,...(payload===undefined?{}:{
      headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)
    })});
    const data=await r.json();
    if(!r.ok)throw Error(r.status+' '+JSON.stringify(data));
    return data;
  },{path,method,payload});
}
async function jump(n) {
  await pageInput.fill(String(n));
  await pageInput.press('Enter');
  await page.locator('[data-pdf-page="'+n+'"] canvas').waitFor();
}
async function cardVisible(id) {
  await page.waitForFunction(id=>{
    const list=document.querySelector('.region-list'), card=list?.querySelector('[data-card="'+CSS.escape(id)+'"]');
    if(!card||card.dataset.active!=='true')return false;
    const view=list.getBoundingClientRect(),box=card.getBoundingClientRect();
    return box.top>=view.top+22&&box.top+45<=view.bottom;
  },id,{timeout:10000});
}
const scrollTop = locator => locator.evaluate(el=>el.scrollTop);

try{
  await page.getByRole('heading',{name:'今日工作台'}).waitFor();
  await page.evaluate(()=>localStorage.setItem('rdnext.metadata.disabled','true'));
  await app.evaluate(({ipcMain,dialog},sample)=>{
    dialog.showOpenDialog=async()=>({canceled:false,filePaths:[sample]});
    ipcMain.removeHandler('layout-run');
    ipcMain.handle('layout-run',async()=>[]);
  },sample);
  await button('导入 PDF').click();
  await button('选择 PDF 文件').click();
  await button('完成').click();
  const [paper]=await api('/papers');
  const base='/papers/'+paper.id+'/reading';
  for(let n=1;n<=38;n++)await api(base+'/pages/'+n,'PUT',regions.filter(region=>region.page===n));
  const plan=await api(base);
  assert.equal(plan.pages.length,38);
  assert.ok(plan.groups.length>250);
  const first=plan.groups.find(group=>group.text.startsWith('The recent success'));
  const required=plan.review[0];
  const pending=new Set([...plan.review,...plan.otherReview].flatMap(({first,second})=>second?[first,second]:[first]));
  const connected=plan.groups.find(group=>
    group.regions.some(withReview=>pending.has(withReview.id)&&group.regions.some(withoutReview=>
      !pending.has(withoutReview.id)&&withReview.page!==withoutReview.page)));
  const withReview=connected?.regions.find(region=>pending.has(region.id)&&connected.regions.some(other=>!pending.has(other.id)&&other.page!==region.page));
  const withoutReview=connected?.regions.find(region=>!pending.has(region.id)&&region.page!==withReview.page);
  const last=plan.groups.find(group=>group.regions[0].page===38&&group.regions[0].kind==='reference');
  assert.ok(first&&required&&withReview&&withoutReview&&last);

  await button('阅读').click();
  await page.getByRole('button',{name:/^核对解析 · /}).click({timeout:60000});
  const frameColors=id=>frame(id).evaluate(el=>{
    const css=getComputedStyle(el);
    return {border:css.borderTopColor,fill:css.backgroundColor};
  });
  const baseColors=await frameColors(first.regions[0].id);
  const linkedColors=await frameColors(withReview.id);
  assert.deepEqual(linkedColors,await frameColors(withoutReview.id));
  assert.notEqual(linkedColors.fill,baseColors.fill);

  await button('解析区块').click();
  await list.waitFor();
  assert.equal(await list.locator('.region-card').count(),plan.groups.length);
  assert.deepEqual(await list.locator('.region-page h3').allTextContents(),
    Array.from({length:38},(_,i)=>'第 '+(i+1)+' 页'));
  const initial=await scrollTop(source);
  await list.evaluate(el=>{el.scrollTop=el.scrollHeight});
  await page.waitForFunction(()=>{
    const list=document.querySelector('.region-list'),end=list?.lastElementChild;
    return end?.getBoundingClientRect().top<list.getBoundingClientRect().bottom;
  });
  assert.ok(Math.abs(await scrollTop(source)-initial)<2,'right scroll changed PDF position');

  await filter.selectOption('heading');
  assert.ok(await list.locator('.region-card').count()>1);
  assert.equal(await card(first.id).count(),0);
  await button('核对解析').click();
  await jump(first.regions[0].page);
  const wanted=first.regions[0];
  await frame(wanted.id).scrollIntoViewIfNeeded();
  const point=await frame(wanted.id).evaluate(el=>{
    const box=el.getBoundingClientRect();
    return {x:box.left+16,y:box.top+12};
  });
  const viewport=await source.boundingBox();
  assert.ok(point.y>=viewport.y&&point.y<=viewport.y+viewport.height,'test point not visible on PDF');
  const beforeClick=await scrollTop(source);
  await page.mouse.click(point.x,point.y);
  await cardVisible(first.id);
  assert.equal(await filter.inputValue(),'all');
  assert.ok(Math.abs(await scrollTop(source)-beforeClick)<2,'selecting a PDF block scrolled the PDF');
  assert.equal(await card(first.id).locator('.source-chip').getAttribute('aria-pressed'),'true');
  const activeColors=await frameColors(wanted.id);
  assert.equal(activeColors.fill,baseColors.fill);
  assert.notEqual(activeColors.border,baseColors.border);
  await page.screenshot({path:join(results,'original-to-regions.png')});

  await jump(38);
  await badge(last.regions[0].id).click();
  await cardVisible(last.id);
  await page.keyboard.press('Escape');
  await list.evaluate(el=>{el.scrollTop=0});
  assert.equal(await pageInput.inputValue(),'38');
  await card(first.id).locator('.region-text').click();
  await page.waitForFunction(()=>document.querySelector('input[aria-label="页码"]').value==='1');

  await jump(withoutReview.page);
  await badge(withoutReview.id).waitFor({state:'attached'});
  assert.doesNotMatch(await badge(withoutReview.id).getAttribute('aria-label'),/待核对|!/);

  await jump(withReview.page);
  await badge(withReview.id).waitFor({state:'attached'});
  assert.doesNotMatch(await badge(withReview.id).getAttribute('aria-label'),/待核对|!/);
  assert.doesNotMatch(await badge(withReview.id).getAttribute('title')||'',/待核对|!/);
  assert.doesNotMatch(await badge(withReview.id).textContent(),/待核对|!/);
  assert.equal(await card(connected.id).getByText('待核对',{exact:true}).count(),1);
  await badge(withReview.id).click();
  await cardVisible(connected.id);
  const selectedPart=card(connected.id).locator('.source-chip[aria-pressed="true"]');
  assert.equal((await selectedPart.textContent()).trim(),
    '原文 '+(connected.regions.indexOf(withReview)+1)+' · 第 '+withReview.page+' 页');
  assert.equal(await card(connected.id).count(),1);
  assert.deepEqual(await frameColors(withReview.id),await frameColors(withoutReview.id));
  assert.equal((await frameColors(withReview.id)).fill,linkedColors.fill);
  await page.keyboard.press('Escape');
  await page.screenshot({path:join(results,'cross-page-review.png')});
  await button('连接区块').click();
  await badge(withReview.id).click();
  const picked=await frameColors(withReview.id);
  assert.equal(picked.fill,linkedColors.fill);
  assert.equal(new Set([baseColors.border,linkedColors.border,activeColors.border,picked.border]).size,4);
  await page.keyboard.press('Escape');
  await jump(1);
  const compact=page.locator('[data-pdf-page="1"] .region-label[data-mode="compact"]').first();
  await compact.waitFor();
  const category=compact.locator('span');
  await category.waitFor({state:'hidden'});
  assert.match(await compact.locator('small').innerText(),/^[译原]$/);
  const size=await compact.boundingBox();
  await compact.hover();
  await category.waitFor();
  const expanded=await compact.boundingBox();
  assert.ok(expanded.width>size.width&&Math.abs(expanded.x+expanded.width-size.x-size.width)<2);
  assert.equal(await page.locator('.region-label-preview').count(),0);
  await page.screenshot({path:join(results,'label-expanded.png')});
  await button('显示解析框').hover();
  await category.waitFor({state:'hidden'});
  await page.keyboard.press('Tab');
  await compact.focus();
  await category.waitFor();
  await compact.press('Enter');
  await page.getByRole('region',{name:'更正区块',exact:true}).waitFor();
  assert.deepEqual(errors,[]);
  await writeFile(join(results,'summary.json'),JSON.stringify({
    passed:true, root, pages:plan.pages.length, groups:plan.groups.length, colors:[baseColors.border,linkedColors.border,activeColors.border,picked.border],
    continuous:true, independentScroll:true, bidirectional:true, selectionClearsFilter:true, crossPage:true, consistentGroupFill:true, sidebarOnlyReview:true, inlineCompactLabel:true,
  },null,2));
  console.log(JSON.stringify({passed:true,pages:plan.pages.length,groups:plan.groups.length}));
}catch(error){
  await page.screenshot({path:join(results,'failure.png')}).catch(()=>{});
  await writeFile(join(results,'summary.json'),JSON.stringify({passed:false,root,errors,error:error.stack},null,2));
  throw error;
}finally{
  await app.close();
}

