const { createHash } = require('node:crypto');
const { createReadStream } = require('node:fs');
const { parentPort, workerData } = require('node:worker_threads');
const { InferenceSession, Tensor } = require('onnxruntime-node');

const expected = 'cd540dc296ff3115fe78efa65b68501e6a8dc74b198acc9834a725ffaa095aac';
const side = 800;
const labels = [
  'abstract','algorithm','aside_text','chart','content','display_formula','doc_title',
  'figure_title','footer','footer_image','footnote','formula_number','header','header_image',
  'image','inline_formula','number','paragraph_title','reference','reference_content',
  'seal','table','text','vertical_text','vision_footnote'
];
const reduced = new Set([5,6,15,17,22,23]);
let session;

async function loadSession() {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(workerData.model)) hash.update(chunk);
  if (hash.digest('hex') !== expected) throw new Error('PP-DocLayoutV2 模型校验失败');
  return InferenceSession.create(workerData.model, {
    executionProviders: ['cpu'], intraOpNumThreads: 3, interOpNumThreads: 1,
  });
}

function decode(raw) {
  if (raw.dims.length !== 2 || raw.dims[1] !== 8) throw new Error('版面模型输出格式无效');
  const rows = [];
  const maxScores = new Map();
  for (let i = 0; i < raw.data.length; i += 8) {
    const row = Array.from(raw.data.subarray(i, i + 8));
    const key = row.slice(2).join(',');
    const existing = maxScores.get(key);
    if (!existing || row[1] > existing[1] || row[1] === existing[1] && row[0] < existing[0]) maxScores.set(key, row);
    rows.push({ row, key });
  }
  const threshold = label => reduced.has(label) ? .4 : label === 20 ? .45 : .5;
  const limit = value => Math.max(0, Math.min(1, value / side));
  const result = [];
  const ordered = rows.filter(({ row, key }) => {
    const primary = maxScores.get(key);
    return labels[row[0]] && primary[1] >= threshold(primary[0]) && row[1] >= threshold(row[0]);
  }).sort((a, b) => a.row[6] - b.row[6] || b.row[7] - a.row[7] || b.row[1] - a.row[1]);
  for (const { row: [label, score, x1, y1, x2, y2], key } of ordered) {
    if (label !== maxScores.get(key)[0]) continue;
    const x = limit(x1), y = limit(y1), w = limit(x2) - x, h = limit(y2) - y;
    if (w > 0 && h > 0) result.push({ kind: labels[label], score, rect: { x, y, w, h } });
  }
  return result;
}

parentPort.on('message', async pixels => {
  try {
    session ??= await loadSession();
    const area = side * side;
    const chw = new Float32Array(area * 3);
    for (let channel = 0; channel < 3; channel++) {
      for (let index = 0; index < area; index++) chw[area * channel + index] = pixels[index * 4 + channel] / 255;
    }
    const feed = { image: new Tensor('float32', chw, [1, 3, side, side]) };
    if (session.inputNames.includes('scale_factor')) feed.scale_factor = new Tensor('float32', [1, 1], [1, 2]);
    if (session.inputNames.includes('im_shape')) feed.im_shape = new Tensor('float32', [side, side], [1, 2]);
    const outputs = await session.run(feed);
    parentPort.postMessage({ result: decode(outputs[session.outputNames[0]]) });
  } catch (error) {
    parentPort.postMessage({ error: '版面识别失败。' + error.message });
  }
});
