import { readFile, writeFile } from 'node:fs/promises';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const svg = await readFile(new URL('../assets/app.svg', import.meta.url));
const image = await loadImage(svg);
const sizes = [16, 32, 48, 64, 128, 256];
const header = Buffer.alloc(6 + sizes.length * 16);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
const pngs = [];
let offset = header.length;
for (const [index, side] of sizes.entries()) {
  const canvas = createCanvas(side, side);
  canvas.getContext('2d').drawImage(image, 0, 0, side, side);
  const png = canvas.toBuffer('image/png');
  const entry = 6 + index * 16;
  header[entry] = header[entry + 1] = side === 256 ? 0 : side;
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(png.length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += png.length;
  pngs.push(png);
}
await writeFile(new URL('../assets/app.ico', import.meta.url), Buffer.concat([header, ...pngs]));
