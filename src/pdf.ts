import { getDocument, GlobalWorkerOptions, TextLayer, Util, type PDFPageProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { Glyph } from './layout';
import type { Rect, Selection } from './api';
import 'pdfjs-dist/web/pdf_viewer.css';

GlobalWorkerOptions.workerSrc = workerUrl;
export { TextLayer };
export function loadPDF(id: string) {
  return getDocument({ url: '/api/papers/' + id + '/pdf', enableXfa: false,
    cMapUrl: '/pdfjs/cmaps/', cMapPacked: true,
    standardFontDataUrl: '/pdfjs/standard_fonts/', wasmUrl: '/pdfjs/wasm/', iccUrl: '/pdfjs/iccs/' });
}

function clamp(value: number) { return Math.max(0, Math.min(1, value)); }

export async function pdfGlyphs(page: PDFPageProxy): Promise<Glyph[]> {
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent({ disableNormalization: true });
  return content.items.flatMap(item => {
    if (!('str' in item) || !item.str) return [];
    const transform = Util.transform(viewport.transform, item.transform);
    const size=Math.hypot(transform[2],transform[3]);
    const advance=Math.hypot(transform[0],transform[1]);
    if(!size||!advance)return [];
    const ux=transform[0]/advance,uy=transform[1]/advance;
    const nx=transform[2]/size,ny=transform[3]/size;
    const top={x:transform[4]+nx*size*.86,y:transform[5]+ny*size*.86};
    const bottom={x:transform[4]-nx*size*.14,y:transform[5]-ny*size*.14};
    const xs=[top.x,bottom.x,top.x+ux*item.width,bottom.x+ux*item.width];
    const ys=[top.y,bottom.y,top.y+uy*item.width,bottom.y+uy*item.width];
    const x=clamp(Math.min(...xs)/viewport.width),y=clamp(Math.min(...ys)/viewport.height);
    const w=clamp(Math.max(...xs)/viewport.width)-x,h=clamp(Math.max(...ys)/viewport.height)-y;
    const rotation=Math.round(Math.atan2(uy,ux)*180/Math.PI);
    return w>0&&h>0?[{text:item.str,rect:{x,y,w,h},baseline:transform[5]/viewport.height,
      height:size/viewport.height,end:item.hasEOL,...(rotation?{rotation}:{})}]:[];
  });
}

export async function pageImage(page: PDFPageProxy) {
  const viewport = page.getViewport({ scale: 1 });
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 800;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('无法创建版面画布');
  await page.render({ canvas, canvasContext: ctx, viewport,
    transform: [800 / viewport.width, 0, 0, 800 / viewport.height, 0, 0] }).promise;
  return new Uint8Array(ctx.getImageData(0, 0, 800, 800).data.buffer);
}

export function selected(container: HTMLElement): Selection | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) return null;
  const rects=rangeRects(range,container);
  const text = selection.toString().trim();
  return text && rects.length ? { text, rects } : null;
}

export function rangeRects(range:Range,container:HTMLElement):Rect[] {
  const parent = container.getBoundingClientRect();
  const rects: Rect[] = [];
  for (const box of range.getClientRects()) {
    const x = clamp((box.left - parent.left) / parent.width), y = clamp((box.top - parent.top) / parent.height);
    const w = clamp((box.right - parent.left) / parent.width) - x, h = clamp((box.bottom - parent.top) / parent.height) - y;
    if (w > 0 && h > 0) rects.push({ x, y, w, h });
  }
  return rects;
}
