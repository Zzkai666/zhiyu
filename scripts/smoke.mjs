import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const sample = process.env.RDNEXT_SAMPLE;
assert.ok(sample, 'Set RDNEXT_SAMPLE to the public Diffusion Policy PDF.');
const output = resolve(process.env.RDNEXT_RESULTS || 'test-results');
await mkdir(output, { recursive: true });
const root = await mkdtemp(join(output, 'isolated-'));
const selected = join(root, 'Diffusion Policy.pdf');
await copyFile(sample, selected);
const executablePath = process.env.RDNEXT_EXE;
const options = { args: [...(executablePath ? [] : ['.']), '--workspace=' + join(root, 'workspace')], ...(executablePath ? { executablePath } : {}) };
let app;
const errors = [];
async function launch() {
  app = await electron.launch(options);
  const page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', msg => { if (msg.type() === 'error') process.stderr.write('renderer: ' + msg.text() + '\n'); });
  await page.getByRole('heading', { name: '今日工作台' }).waitFor();
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  return page;
}

try {
  let page = await launch();
  await page.screenshot({ path: join(output, 'workbench.png') });
  await app.evaluate(({ dialog }, filename) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename, filename] });
  }, selected);
  await page.getByRole('button', { name: '导入 PDF', exact: true }).click();
  await page.getByText('文献库中已有相同 PDF', { exact: true }).waitFor();
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await page.screenshot({ path: join(output, 'library.png') });
  await page.locator('.library-page').evaluate(async element => {
    const [paper] = await fetch('/api/papers').then(r => r.json());
    const bytes = await fetch('/api/papers/' + paper.id + '/pdf').then(r => r.blob());
    const files = new DataTransfer();
    files.items.add(new File([bytes], '再次拖入.pdf', { type: 'application/pdf' }));
    element.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: files }));
  });
  await page.getByText('文献库中已有相同 PDF', { exact: true }).waitFor();
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await page.getByRole('button', { name: /Diffusion Policy/ }).click();
  const sheet = page.locator('.sheet');
  await sheet.locator('.textLayer span').first().waitFor({ state: 'attached', timeout: 30_000 });
  await page.getByRole('button', { name: '添加书签' }).click();
  await page.getByRole('button', { name: '移除书签' }).waitFor();
  await page.locator('.parse-block').first().waitFor();
  const resize = page.getByRole('separator', { name: '调整阅读侧栏宽度' });
  const priorWidth = Number(await resize.getAttribute('aria-valuenow'));
  await resize.press('ArrowLeft');
  assert.equal(Number(await resize.getAttribute('aria-valuenow')), priorWidth + 24);
  assert.match(await page.locator('.parse-list').textContent(), /Diffusion Policy/i);
  await page.getByRole('button', { name: '提取全文', exact: true }).click();
  await page.getByRole('button', { name: '全文已提取', exact: true }).waitFor({ timeout: 90_000 });
  assert.match(await page.locator('.parse-batch').innerText(), /19 \/ 19/);
  await page.getByRole('button', { name: '定位原文' }).first().click();
  await page.locator('.source-focus').waitFor();
  const pageNumber = page.getByRole('textbox', { name: '页码' });
  await pageNumber.fill('3');
  await pageNumber.press('Enter');
  await page.getByLabel('PDF 第 3 页').waitFor();
  await page.getByRole('combobox', { name: '识别方式' }).selectOption('layout-v2');
  await page.getByRole('button', { name: '提取本页' }).click();
  try {
    await page.getByRole('img', { name: /公式原图|图原图|表格原图/ }).first().waitFor({ timeout: 90_000 });
  } catch (err) {
    throw new Error('Layout did not render. ' + (await page.locator('.reading-pane').innerText()).slice(0, 1500), { cause: err });
  }
  const crops = await page.locator('.source-crop').count();
  assert.ok(crops > 0);
  const cropPixels = await page.locator('.source-crop').first().evaluate(canvas => {
    const bytes = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let ink = 0;
    for (let i = 0; i < bytes.length; i += 4) if (bytes[i + 3] && bytes[i] < 225) ink++;
    return ink;
  });
  assert.ok(cropPixels > 100);
  await page.getByRole('button', { name: '放大图', exact: true }).first().click();
  await page.getByRole('dialog', { name: '图原图' }).waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  const caption = await page.locator('.parse-block.caption').first().innerText();
  assert.match(caption, /Oₜ/u);
  assert.match(caption, /Figure 2/);
  const scripts = await page.locator('.parse-block sub, .parse-block sup').count();
  assert.ok(scripts > 0, 'Unmapped scripts rendered in HTML');
  await page.screenshot({ path: join(output, 'reader.png') });

  await pageNumber.fill('7');
  await pageNumber.press('Enter');
  await page.getByLabel('PDF 第 7 页').waitFor();
  await page.getByRole('button', { name: '提取本页' }).click();
  await page.locator('.parse-block.table .source-crop').first().waitFor({ timeout: 90_000 });
  const tables = await page.locator('.parse-block.table .source-crop').count();
  const prose = await page.locator('.parse-block.text, .parse-block.title').allTextContents();
  assert.ok(tables >= 2, 'Recognized distinct table regions');
  assert.ok(prose.some(line => /5\.2|Dexterous/.test(line)), 'Kept right-column text outside the tables');
  await page.screenshot({ path: join(output, 'tables.png') });
  await pageNumber.fill('3');
  await pageNumber.press('Enter');
  await page.getByLabel('PDF 第 3 页').waitFor();
  await page.getByRole('button', { name: '笔记', exact: true }).click();
  await page.getByRole('button', { name: '记本页笔记' }).click();
  await page.getByLabel('笔记内容').fill('公开样本第 3 页来源检查');
  await page.getByRole('button', { name: '保存笔记' }).click();
  await page.getByText('笔记已保存', { exact: true }).waitFor();
  await page.getByRole('button', { name: '返回文献库' }).click();
  await page.getByRole('button', { name: '目标与项目', exact: true }).click();
  await page.getByRole('button', { name: '新建项目' }).click();
  await page.getByLabel('项目名称').fill('公开样本对照');
  await page.getByRole('button', { name: '保存项目' }).click();
  await page.getByRole('button', { name: '添加项目任务' }).click();
  await page.getByLabel('标题').fill('核对第 3 页');
  await page.getByLabel('关联文献').selectOption({ label: 'Diffusion Policy' });
  await page.getByLabel('来源页码').fill('3');
  await page.getByRole('button', { name: '保存安排' }).click();
  await page.getByRole('button', { name: '任务日程', exact: true }).click();
  await page.getByRole('button', { name: '待安排', exact: true }).click();
  await page.getByRole('button', { name: '完成 核对第 3 页', exact: true }).click();
  await page.getByRole('button', { name: '重开 核对第 3 页', exact: true }).waitFor();
  await page.getByRole('button', { name: '课程学习', exact: true }).click();
  await page.getByRole('button', { name: '新建课程' }).click();
  await page.getByLabel('课程名称').fill('机器人学习');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('button', { name: '添加章节' }).click();
  await page.getByLabel('章节名称').fill('扩散策略');
  await page.getByLabel('关联 PDF').selectOption({label:'Diffusion Policy'});
  await page.getByLabel('原文页码').fill('3');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('button', { name: '记一次学习' }).click();
  await page.getByLabel('用时（分钟）').fill('25');
  await page.getByLabel('学习内容').fill('阅读方法部分');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByText('25 分钟', {exact:true}).waitFor();
  await page.getByRole('button', {name:'打开资料第 3 页'}).click();
  await page.getByLabel('PDF 第 3 页').waitFor();
  await page.getByRole('button', {name:'返回课程学习'}).click();
  await page.getByText('25 分钟', {exact:true}).waitFor();
  await page.screenshot({path:join(output,'study.png')});

  await page.getByRole('button', {name:'实验记录',exact:true}).click();
  await page.getByRole('button', {name:'新建实验'}).click();
  await page.getByLabel('实验名称').fill('公开指标核对');
  await page.getByRole('button', {name:'保存',exact:true}).click();
  for (const [title,value] of [['第一轮','0.83'],['第二轮','0.89']]) {
    await page.getByRole('button', {name:'登记运行'}).click();
    await page.getByLabel('运行名称').fill(title);
    await page.getByRole('button', {name:'添加指标'}).click();
    await page.getByLabel('指标',{exact:true}).fill('成功率');
    await page.getByLabel('数值').fill(value);
    await page.getByRole('button', {name:'保存',exact:true}).click();
    await page.getByRole('checkbox', {name:'对比 '+title}).check();
  }
  await page.getByRole('button', {name:'比较 2 次运行'}).click();
  await page.getByRole('cell',{name:'0.89'}).waitFor();
  await page.screenshot({path:join(output,'comparison.png')});
  await page.keyboard.press('Escape');

  await page.getByRole('button', {name:'运动与生活',exact:true}).click();
  await page.getByRole('button', {name:'记一瓶'}).click();
  await page.getByText('1 / 4 瓶',{exact:true}).waitFor();
  await page.getByRole('button', {name:'撤销一瓶'}).click();
  await page.getByText('0 / 4 瓶',{exact:true}).waitFor();
  await page.getByRole('button', {name:'新建记录'}).click();
  await page.getByLabel('记录名称').fill('短跑');
  await page.getByLabel('时长（分钟）').fill('20');
  await page.getByLabel('距离（公里）').fill('3.5');
  await page.getByRole('button', {name:'保存记录',exact:true}).click();
  await page.getByRole('button', {name:'短跑',exact:true}).waitFor();
  await page.getByRole('button', { name: '笔记中心', exact: true }).click();
  await page.getByRole('button', { name: '原文第 3 页' }).click();
  await page.getByLabel('PDF 第 3 页').waitFor();
  await app.close();
  app = undefined;

  page = await launch();
  await page.getByRole('button', { name: '打开论文' }).click();
  await page.getByLabel('PDF 第 3 页').waitFor();
  await page.getByRole('combobox', { name: '识别方式' }).selectOption('layout-v2');
  await page.locator('.source-crop').first().waitFor({ timeout: 20_000 });
  await page.getByRole('button', { name: '标记', exact: true }).click();
  await page.getByText('书签 · 第 1 页').waitFor();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 710));
  await page.getByRole('button', { name: '目录', exact: true }).click();
  await page.screenshot({ path: join(output, 'narrow.png') });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.getByRole('button', { name: '返回今日工作台', exact: true }).click();
  await page.getByRole('heading', { name: '今日工作台' }).waitFor();
  assert.deepEqual(errors, []);
  assert.ok((await stat(join(root, 'workspace', 'researchdesk-next.sqlite'))).size > 0);
  console.log(JSON.stringify({ imports: 1, duplicate: true, native: true, crops, cropPixels, tables, scripts, task: true, study: true, lab: true, life: true, sourceNote: true, restoredPage: 3, bookmark: true, root }));
} finally {
  if (app) await app.close();
}
