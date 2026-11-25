import { _electron as electron } from 'playwright';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const output = resolve(process.env.RDNEXT_WORD_RESULTS || 'test-results/word-capture');
await mkdir(output, { recursive: true });
const root = await mkdtemp(join(output, 'isolated-'));
const file = join(root, 'Words in context.pdf');
const title = 'Words in Context';
const sentence = 'An instantiation of the model gives useful evidence.';
const meaning = '实例化；这里指模型的一个具体实例。';
const pdf = await PDFDocument.create();
const font = await pdf.embedFont(StandardFonts.Helvetica);
const pdfPage = pdf.addPage([600, 800]);
pdfPage.drawText(title, { x: 55, y: 735, size: 20, font });
pdfPage.drawText(sentence + ' The next example is independent.', { x: 55, y: 650, size: 11, font });
await writeFile(file, await pdf.save());

let app, page;
const errors = [];
const button = name => page.getByRole('button', { name, exact: true });
const toolbar = () => page.getByRole('toolbar', { name: '选区标注' });
const dialog = () => page.getByRole('dialog', { name: '补充释义', exact: true });
const pdfView = () => page.getByLabel('连续滚动 PDF 原文');
const api = (path, method = 'GET', body) => page.evaluate(async ({ path, method, body }) => {
  const response = await fetch('/api' + path, { method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  return { status: response.status, data: await response.json() };
}, { path, method, body });
async function until(check, message) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(message);
}
async function launch() {
  const exe = process.env.RDNEXT_EXE;
  app = await electron.launch({
    ...(exe ? { executablePath: exe } : {}),
    args: [...(exe ? [] : ['.']), '--workspace=' + join(root, 'workspace')],
    env: { ...process.env, RDNEXT_TEST_HIDE: '1' },
  });
  page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await button('文献库').waitFor();
}
async function selectText(text) {
  const layer = page.locator('[data-pdf-page="1"] .textLayer');
  await layer.getByText(sentence, { exact: false }).waitFor();
  await layer.evaluate((node, selected) => {
    const span = [...node.querySelectorAll('span')].find(el =>
      el.firstChild?.nodeType === Node.TEXT_NODE && el.textContent.includes(selected));
    const range = document.createRange();
    const offset = span.textContent.indexOf(selected);
    range.setStart(span.firstChild, offset);
    range.setEnd(span.firstChild, offset + selected.length);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    node.closest('.paper-surface').dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 }));
  }, text);
  await toolbar().waitFor();
}

try {
  await launch();
  await page.evaluate(() => localStorage.setItem('rdnext.metadata.disabled', 'true'));
  await app.evaluate(({ dialog }, pdfFile) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [pdfFile] });
  }, file);
  await button('导入 PDF').click();
  await button('选择 PDF 文件').click();
  await button('完成').click();
  const [{ id }] = (await api('/papers')).data;
  await until(async () => (await api('/paper-jobs')).data.some(job => job.paperId === id && job.stage === 'parse' && job.state === 'done'), 'PDF parse did not finish');
  await button('阅读').click();
  const term = 'instantiation';
  await selectText(term);
  const before = await pdfView().evaluate(el => [el.scrollTop, el.scrollLeft]);
  await page.screenshot({ path: join(output, 'selection-word.png') });
  await toolbar().getByRole('button', { name: '收录生词', exact: true }).click();
  await page.getByText('已收录「instantiation」', { exact: true }).waitFor();
  assert.equal(await page.getByRole('dialog').count(), 0);
  assert.deepEqual(await pdfView().evaluate(el => [el.scrollTop, el.scrollLeft]), before);
  const [word] = (await api('/words')).data;
  assert.deepEqual([word.term, word.quote, word.paperId, word.page, word.meaning], [term, sentence, id, 1, '']);
  await selectText(term);
  await toolbar().getByRole('button', { name: '收录生词', exact: true }).click();
  await page.getByText('这个词已从此处收录', { exact: true }).waitFor();
  assert.deepEqual((await api('/words')).data, [word]);
  assert.equal((await api('/words/' + word.id, 'PATCH', { known: true, revision: word.revision })).status, 400);

  await button('返回文献库').click();
  await button('生词与复习').click();
  await button('待复习 0').waitFor();
  await button('待补释义 1').click();
  await page.screenshot({ path: join(output, 'word-inbox.png') });
  await button('补充释义').click();
  await dialog().getByLabel('释义', { exact: true }).fill(meaning);
  await dialog().getByRole('button', { name: '保存释义', exact: true }).click();
  await button('待复习 1').click();
  await button('显示释义 空格').click();
  await page.getByText(meaning, { exact: true }).waitFor();
  await button('原文第 1 页').click();
  await pdfView().waitFor();
  assert.equal(await page.getByRole('textbox', { name: '页码', exact: true }).inputValue(), '1');

  await app.close();
  app = null;
  await launch();
  const [saved] = (await api('/words')).data;
  assert.deepEqual(saved, { ...word, meaning, revision: word.revision + 1 });
  assert.equal((await api('/words/' + word.id + '/meaning', 'PUT', { meaning: '旧编辑', revision: word.revision })).status, 409);
  assert.deepEqual(errors, []);
  await writeFile(join(output, 'summary.json'), JSON.stringify({ passed: true, root, word: saved, errors }, null, 2));
  console.log('Word capture passed in ' + output);
} catch (error) {
  console.error(error);
  if (page) await page.screenshot({ path: join(output, 'failure.png') }).catch(() => {});
  process.exitCode = 1;
} finally {
  if (app) await app.close();
}
