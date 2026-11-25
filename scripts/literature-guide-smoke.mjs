import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const output = resolve(process.env.RDNEXT_GUIDE_RESULTS || 'test-results/literature-guide');
await mkdir(output, { recursive: true });
const root = await mkdtemp(join(output, 'isolated-'));
const exe = process.env.RDNEXT_EXE;
const version = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version;
let app, page;
const errors = [];
const button = name => page.getByRole('button', { name, exact: true });
const dialog = () => page.getByRole('dialog', { name: '文献阅读引导', exact: true });
const chapter = name => dialog().getByRole('navigation', { name: '引导章节' }).getByRole('button', { name, exact: true });
const importDialog = () => page.getByRole('dialog', { name: '导入论文', exact: true });

async function launch() {
  app = await electron.launch({
    ...(exe ? { executablePath: exe } : {}),
    args: [...(exe ? [] : ['.']), '--workspace=' + join(root, 'workspace')],
    env: { ...process.env, RDNEXT_TEST_HIDE: '1' },
  });
  page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('heading', { name: '今日工作台' }).waitFor();
  assert.equal(await app.evaluate(({ app }) => app.getVersion()), version);
}
async function scene(name, title, index) {
  await dialog().getByRole('heading', { name: title, exact: true }).waitFor();
  assert.equal(await chapter(name).getAttribute('aria-current'), 'step');
  assert.equal(await dialog().locator('.guide-scene').getAttribute('data-scene'), String(index));
}
async function screenshot(name) {
  await dialog().evaluate(el => Promise.all(el.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {}))));
  await dialog().screenshot({ path: join(output, name + '.png') });
}

try {
  await launch();
  await button('观看文献引导').waitFor();
  assert.equal(await dialog().count(), 0, 'the welcome action does not block first launch');
  await button('观看文献引导').click();
  await scene('导入论文', '从一篇论文开始', 0);
  const animation=dialog().locator('.guide-progress-sweep');
  await animation.waitFor();
  const clock=()=>animation.evaluate(el=>Number(el.getAnimations()[0].currentTime));
  const initial=await clock();
  await page.waitForFunction(start=>Number(document.querySelector('.guide-progress-sweep').getAnimations()[0].currentTime)>start+120,initial);
  await button('暂停').click();
  await page.waitForFunction(()=>document.querySelector('.guide-progress-sweep').getAnimations()[0].playState==='paused');
  const paused=await clock();
  await page.waitForTimeout(190);
  assert.equal(await clock(),paused);
  await button('继续').click();
  await page.waitForFunction(start=>Number(document.querySelector('.guide-progress-sweep').getAnimations()[0].currentTime)>start+120,paused);
  await button('重播本步').click();
  assert.ok(await clock()<paused,'replay did not restart');
  assert.equal(await dialog().locator('img').count(),0);
  await screenshot('01-import');
  await page.keyboard.press('Control+k');
  assert.equal(await page.getByRole('dialog', { name: '搜索工作台' }).count(), 0);
  await button('下一步').click();
  await scene('后台解析', '在文献条目看解析进度', 1);
  const meter=dialog().locator('.motion-meter span');
  await meter.waitFor();
  await page.waitForFunction(()=>{
    const current=document.querySelector('.motion-meter span');
    const scale=new DOMMatrix(getComputedStyle(current).transform).a;
    return scale>.15&&scale<.7;
  });
  await screenshot('02-parse');
  await page.keyboard.press('ArrowRight');
  await scene('核对标签', '给区块改一个正确的标签', 2);
  await screenshot('03-label');
  await chapter('核对断段').click();
  await scene('核对断段', '把跨页、跨栏的半段接起来', 3);
  await chapter('选择模型').click();
  await scene('选择模型', '先选好整篇论文用的模型', 4);
  await chapter('全文翻译').click();
  await scene('全文翻译', '核对后，一次启动全文翻译', 5);
  await chapter('双语对照').click();
  await scene('双语对照', '译到哪，就能对到哪', 6);
  await chapter('批注与导出').click();
  await scene('批注与导出', '把读懂的地方留下来', 7);
  await screenshot('04-annotate');
  await page.keyboard.press('Escape');
  await dialog().waitFor({ state: 'hidden' });
  assert.equal(await button('观看文献引导').count(), 0);
  const empty = await page.evaluate(async () => Promise.all(['/papers', '/words'].map(path => fetch('/api' + path).then(r => r.json()))));
  assert.deepEqual(empty, [[], []], 'demo should not add papers or words');
  await app.close();
  app = null;

  await launch();
  await page.evaluate(async () => { await fetch('/api/papers'); });
  assert.equal(await button('观看文献引导').count(), 0, 'dismissal is remembered across restart');
  await button('版本与帮助').click();
  const replay = page.getByRole('button', { name: /^观看文献引导/ });
  await replay.click();
  await scene('导入论文', '从一篇论文开始', 0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(()=>document.querySelector('.guide-scene')?.dataset.motion==='reduced');
  assert.equal(await dialog().locator('.motion-file').evaluate(el => getComputedStyle(el).animationDuration), '0s');
  assert.equal(await dialog().locator('.guide-progress-sweep').count(),0);
  assert.equal(await dialog().getByRole('button',{name:'重播本步'}).count(),0);
  await page.setViewportSize({ width: 650, height: 730 });
  await chapter('双语对照').click();
  await scene('双语对照', '译到哪，就能对到哪', 6);
  assert.equal(await dialog().locator('.guide-layout').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length), 1);
  await screenshot('05-compact');
  await button('跳过').click();
  await dialog().waitFor({ state: 'hidden' });
  await replay.evaluate(el => {
    if(document.activeElement!==el)throw new Error('Guide focus was not restored');
  });
  await replay.click();
  await chapter('批注与导出').click();
  await button('完成引导').click();
  await dialog().waitFor({ state: 'hidden' });
  await replay.click();
  await chapter('批注与导出').click();
  await dialog().getByRole('button', { name: '导入 PDF', exact: true }).click();
  await importDialog().waitFor();
  await importDialog().getByRole('button', { name: '关闭对话框' }).click();
  await importDialog().waitFor({ state: 'hidden' });
  assert.deepEqual(errors, []);
  await writeFile(join(output, 'summary.json'), JSON.stringify({ passed: true, root, stages: 8, pauseAndResume: true, continuousProgress: true, persisted: true, reducedMotion: true, opensImport: true }, null, 2));
  console.log('Literature guide passed in ' + output);
} catch (error) {
  console.error(error);
  if (page) await page.screenshot({ path: join(output, 'failure.png') }).catch(() => {});
  process.exitCode = 1;
} finally {
  if (app) await app.close();
}

