import type { Block, Detection, Rect } from './api.ts';

export type ReadingFlow = {version:number;lines:number;firstX:number;lastRight:number;left:number;right:number;fontX:number;step:number};
export type Glyph = { text: string; rect: Rect; baseline: number; height: number; end: boolean; rotation?:number };

const visual = new Map<string, Block['kind']>([
  ['image','figure'], ['chart','figure'], ['table','table'], ['display_formula','formula'],
]);
const title = new Set(['paragraph_title','doc_title']);
const secondary = new Set(['inline_formula','reference','formula_number','seal']);
const margins = new Set(['header','header_image','footer','footer_image','number']);
const superscript: Record<string,string> = { '0':'⁰', '1':'¹', '2':'²', '3':'³', '4':'⁴', '5':'⁵', '6':'⁶', '7':'⁷', '8':'⁸', '9':'⁹', '+':'⁺', '−':'⁻', '-':'⁻', 'n':'ⁿ', 'i':'ⁱ', 'k':'ᵏ', 't':'ᵗ', 'x':'ˣ' };
const subscript: Record<string,string> = { '0':'₀', '1':'₁', '2':'₂', '3':'₃', '4':'₄', '5':'₅', '6':'₆', '7':'₇', '8':'₈', '9':'₉', '+':'₊', '−':'₋', '-':'₋', 'i':'ᵢ', 'j':'ⱼ', 'n':'ₙ', 'x':'ₓ', 't':'ₜ', 'a':'ₐ', 'e':'ₑ', 'o':'ₒ', 'r':'ᵣ', 'u':'ᵤ', 'v':'ᵥ' };

function covered(inner: Rect, outer: Rect) {
  const w = Math.max(0, Math.min(inner.x + inner.w, outer.x + outer.w) - Math.max(inner.x, outer.x));
  const h = Math.max(0, Math.min(inner.y + inner.h, outer.y + outer.h) - Math.max(inner.y, outer.y));
  return w * h / (inner.w * inner.h);
}

function union(items: Glyph[]): Rect {
  const x = Math.min(...items.map(g => g.rect.x)), y = Math.min(...items.map(g => g.rect.y));
  return { x, y, w: Math.max(...items.map(g => g.rect.x + g.rect.w)) - x, h: Math.max(...items.map(g => g.rect.y + g.rect.h)) - y };
}

function scriptDirection(glyph: Glyph, base: Glyph | undefined) {
  if (!base || !glyph.text.trim() || glyph.height > base.height * .88 || glyph.height < base.height * .40 ||
      Math.abs(glyph.rect.x - base.rect.x - base.rect.w) > base.height * 1.1) return 0;
  const shift = (base.baseline - glyph.baseline) / base.height;
  if (shift > .14 && shift < .7) return 1;
  if (shift < -.11 && shift > -.57) return -1;
  return 0;
}

function symbolText(glyph: Glyph, base: Glyph | undefined) {
  const direction = scriptDirection(glyph, base);
  if (!direction) return glyph.text;
  const map = direction > 0 ? superscript : subscript;
  const str = glyph.text.trim();
  const chars = [...str];
  if (chars.every(char => map[char])) return chars.map(char => map[char]).join('');
  return (direction > 0 ? '^{' : '_{') + str + '}';
}

function lines(items: Glyph[]) {
  const groups: Glyph[][] = [];
  let base: Glyph | undefined;
  for (const glyph of items) {
    const line = groups.at(-1);
    const prev = line?.at(-1);
    const isScript = Boolean(scriptDirection(glyph, base));
    const reference = base || prev;
    const sameBand = reference && prev && Math.abs(reference.baseline - glyph.baseline) < Math.max(reference.height, glyph.height) * .58 &&
      glyph.rect.x + .025 >= prev.rect.x && glyph.rect.x - (prev.rect.x + prev.rect.w) < .12;
    const artificialEnd = prev && Boolean(scriptDirection(prev, base));
    if (line && (glyph.rotation||0)===(prev?.rotation||0) && (isScript || sameBand && (!prev?.end || artificialEnd))) line.push(glyph);
    else { groups.push([glyph]); base = undefined; }
    if (glyph.text.trim() && !isScript) base = glyph;
  }
  return groups;
}

function textOf(line: Glyph[]) {
  let result = '';
  let reference: Glyph | undefined;
  let previous: Glyph | undefined;
  for (const glyph of line) {
    const str = symbolText(glyph, reference);
    const script = str !== glyph.text;
    const gap = previous ? glyph.rect.x - previous.rect.x - previous.rect.w : 0;
    if (!script && gap > glyph.height * .27 && result && !/\s$/.test(result) && !/^\s/.test(str)) result += ' ';
    result += str;
    if (glyph.text.trim() && !script) reference = glyph;
    previous = glyph;
  }
  return result.trim();
}

function unreadable(text: string) {
  return /[\uFFFD\uE000-\uF8FF]|\(cid:\d+\)/u.test(text);
}

export function nativeBlocks(glyphs: Glyph[]): Block[] {
  const blocks: Block[] = [];
  for (const line of lines(glyphs)) {
    const text = textOf(line);
    if (text) blocks.push({ kind: 'text', rect: union(line), text, ...(unreadable(text) ? { uncertain: true } : {}) });
  }
  return blocks;
}

export function layoutBlocks(glyphs: Glyph[], detections: Detection[]): Block[] {
  const candidates = detections.filter(region => !secondary.has(region.kind) && !margins.has(region.kind));
  const regions = candidates.filter((region, index) => {
    const kind = visual.get(region.kind);
    if (!kind) return true;
    return !candidates.some((other, j) => {
      if (j === index || visual.get(other.kind) !== kind || covered(region.rect, other.rect) < .88) return false;
      const area = region.rect.w * region.rect.h, otherArea = other.rect.w * other.rect.h;
      return (otherArea > area * 1.025 && other.score >= region.score - .22) ||
        (Math.abs(otherArea - area) <= area * .025 && (other.score > region.score || other.score === region.score && j < index));
    });
  });
  const furniture = detections.filter(region => margins.has(region.kind));
  const groups = regions.map(() => [] as Glyph[]);
  const remaining: Glyph[] = [];
  for (const glyph of glyphs) {
    let matched = -1;
    let quality = 0;
    let inVisual = false;
    regions.forEach((region, index) => {
      const coverage = covered(glyph.rect, region.rect);
      if (visual.has(region.kind)) {
        inVisual ||= coverage >= .85;
        return;
      }
      // Prefer an actual text region when a figure or table box overlaps it.
      const area = region.rect.w * region.rect.h;
      const score = coverage * 2 + region.score * .3 - area;
      if (Math.abs(glyph.rotation||0)<5 && coverage >= .55 && score > quality) { quality = score; matched = index; }
    });
    if (matched >= 0) groups[matched].push(glyph);
    else if (!inVisual && glyph.text.trim() && !furniture.some(region => covered(glyph.rect, region.rect) >= .73)) remaining.push(glyph);
  }
  const blocks = regions.flatMap((region, index): Block[] => {
    const kind = visual.get(region.kind);
    if (kind) {
      const overlapsText = regions.some((other, otherIndex) => otherIndex !== index && !visual.has(other.kind) &&
        groups[otherIndex].length > 0 && covered(other.rect, region.rect) > .25);
      return [{ kind, rect: region.rect, text: '', ...(overlapsText ? { uncertain: true } : {}) }];
    }
    const text = lines(groups[index]).map(textOf).filter(Boolean).reduce((paragraph,line)=>{
      if(!paragraph)return line;
      const continuesWord=/\p{L}[-‐]$/u.test(paragraph)&&/^\p{L}/u.test(line);
      return paragraph+(continuesWord?'':' ')+line;
    },'');
    if (!text) return [];
    return [{ kind: title.has(region.kind) ? 'title' : region.kind === 'figure_title' ? 'caption' : 'text',
      rect: region.rect, text, ...(unreadable(text) ? { uncertain: true } : {}) }];
  });
  return [...blocks, ...nativeBlocks(remaining).map(block => ({ ...block, uncertain: true }))];
}

export function paragraphFlow(glyphs:Glyph[],rect:Rect,aspect:number):ReadingFlow {
  const selected=glyphs.filter(g=>Math.abs(g.rotation||0)<5&&g.text.trim()&&covered(g.rect,rect)>=.55);
  const rows=nativeBlocks(selected).toSorted((a,b)=>a.rect.y-b.rect.y||a.rect.x-b.rect.x);
  if(!rows.length)return {version:1,lines:0,firstX:0,lastRight:0,left:0,right:0,fontX:0,step:0};
  const heights=selected.map(g=>g.height*aspect).sort((a,b)=>a-b);
  const distances=rows.slice(1).map((row,i)=>row.rect.y-rows[i].rect.y).filter(delta=>delta>.001).sort((a,b)=>a-b);
  return {version:1,lines:rows.length,firstX:rows[0].rect.x,
    lastRight:rows.at(-1)!.rect.x+rows.at(-1)!.rect.w,
    left:Math.min(...rows.map(row=>row.rect.x)),right:Math.max(...rows.map(row=>row.rect.x+row.rect.w)),
    fontX:heights[Math.floor(heights.length/2)]||0,step:distances[Math.floor(distances.length/2)]||0};
}
