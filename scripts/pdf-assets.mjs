import { cp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
for (const directory of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  await cp(join(root, 'node_modules', 'pdfjs-dist', directory), join(root, 'dist', 'ui', 'pdfjs', directory), { recursive: true });
}
