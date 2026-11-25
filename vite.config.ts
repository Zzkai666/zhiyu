import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import {readFileSync} from 'node:fs';
const {version}=JSON.parse(readFileSync(new URL('./package.json',import.meta.url),'utf8'));
export default defineConfig({
  base: './',
  define:{'import.meta.env.APP_VERSION':JSON.stringify(version)},
  plugins: [react()],
  build: { outDir: 'dist/ui', emptyOutDir: true },
});
