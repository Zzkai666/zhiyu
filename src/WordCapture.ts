import type { Selection } from './api';
import type { Located } from './ReadingRegions';
import { sentenceBounds } from './SentenceText';

const termPattern = /^[\p{Script=Latin}\p{M}0-9]+(?:['’\-‐‑][\p{Script=Latin}\p{M}0-9]+)*$/u;
const compact = (text: string) => text.replace(/\s+/gu,' ').trim();

export function selectedTerm(text: string) {
  const term=compact(text).replace(/^[“”‘’"'([{]+|[“”‘’"')\]},.!?;:]+$/gu,'');
  const words=term.split(' ');
  return term.length<=90 && words.length<=8 && /\p{Script=Latin}/u.test(term) &&
    words.every(word=>termPattern.test(word))?term:'';
}

export function captureExcerpt(selection: Selection, term: string, regions: Located[]) {
  const firstRect=selection.rects[0];
  if(!firstRect)return term;
  const x=firstRect.x+firstRect.w/2;
  const y=firstRect.y+firstRect.h/2;
  const candidates=regions.filter(({region:{rect,text}})=>text&&
    x>=rect.x&&x<=rect.x+rect.w&&y>=rect.y&&y<=rect.y+rect.h);
  if(candidates.length!==1)return term;

  const text=compact(candidates[0].region.text);
  const start=text.indexOf(term);
  if(start<0||text.indexOf(term,start+term.length)>=0)return term;
  const end=start+term.length;
  if(/[\p{L}\p{N}]/u.test(text[start-1]||'')||/[\p{L}\p{N}]/u.test(text[end]||''))return term;
  const sentence=sentenceBounds(text).find(part=>part.start<=start&&part.end>=end);
  if(!sentence||sentence.end-sentence.start>1000)return term;
  return text.slice(sentence.start,sentence.end).trim();
}