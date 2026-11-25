import type { Block, Detection, Rect } from './api.ts';
import { layoutBlocks, nativeBlocks, paragraphFlow, type Glyph,type ReadingFlow } from './layout.ts';

export type Kind = 'title' | 'author' | 'abstract' | 'heading' | 'text' | 'caption' | 'figure' | 'table' | 'formula' | 'formula-number' | 'reference' | 'margin';
export type Region = { id:string; page:number; kind:Kind; rect:Rect; text:string; uncertain?:boolean;labelUncertain?:boolean; translate:boolean;flow?:ReadingFlow };
export type Group = { id:string; regions:Region[]; text:string; translate:boolean; translation?:string; model?:string; auto?:boolean; priorTranslation?:string };
export type ReviewItem = { first:string; second?:string; reason:string;evidence?:string[];category?:'label';suggestedKind?:Kind };
export type ReadingPlan = { pages:number[]; revision:number; groups:Group[]; review:ReviewItem[];otherReview:ReviewItem[];confirmedReview:ReviewItem[] };
export type Located = { region:Region; group:Group; part:number };
export type LayoutRegion = Pick<Region,'kind'|'rect'|'text'|'uncertain'|'labelUncertain'|'flow'>;
export type CodexModel = { id:string; name:string; efforts:string[]; defaultEffort:string };
export const kinds:Record<Kind,string> = {
  title:'题目',author:'作者',abstract:'摘要',heading:'小标题',text:'正文段落',caption:'图表说明',
  figure:'图',table:'表',formula:'独立公式','formula-number':'公式编号',reference:'参考文献',margin:'页眉页脚',
};
export const visualKinds = new Set<Kind>(['figure','table','formula']);
export const isParagraph = (kind:Kind) => kind==='text'||kind==='abstract';
export const regionName = ({region,group,part}:Located) => group.regions.length>1 ?
  kinds[region.kind].replace('段落','')+' '+(part+1)+'/'+group.regions.length : kinds[region.kind];

function overlap(a:Rect,b:Rect) {
  return Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x))*
    Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y))/(a.w*a.h);
}

function namesLike(text:string,authorHint:string) {
  const textLower=text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu,' ');
  const known=authorHint.split(/[,;，；]/).map(name=>name.trim().toLowerCase()).filter(name=>name.length>5);
  if (known.some(name=>textLower.includes(name))) return true;
  if (/\b(?:university|institute|department|laboratory|robotics|college|abstract|introduction|correspondence)\b|https?:|@/i.test(text)) return false;
  const words=text.replace(/[_^]\{[^{}]+\}|[0-9*,†‡⁰-⁹¹²³]/g,'').trim().split(/\s+/);
  return words.length>=4 && words.length<=24 && (text.includes(',')||text.includes('  ')) &&
    words.filter(word=>/^\p{Lu}[\p{L}.'’-]*$/u.test(word)).length >= words.length*.72;
}

function semantic(block:Block, byRect:Map<Rect,Detection>):Kind {
  const label=byRect.get(block.rect)?.kind;
  if (label==='doc_title') return 'title';
  if (label==='paragraph_title'||block.kind==='title') return 'heading';
  if (label==='abstract') return 'abstract';
  if (label==='formula_number'||/^[（(][0-9]{1,4}[a-z]?(?:[.-][0-9]+)?[)）]$/i.test(block.text.trim())) return 'formula-number';
  if (label==='reference_content'||label==='reference') return 'reference';
  return block.kind;
}

export function readingRegions(glyphs:Glyph[], detected:Detection[], page:number, authorHint:string,aspect=1.414):LayoutRegion[] {
  const byRect=new Map(detected.map(d=>[d.rect,d]));
  const marginGlyphs=new Set(glyphs.filter(glyph=>Math.abs(glyph.rotation||0)>45&&
    (glyph.rect.x+glyph.rect.w<.09||glyph.rect.x>.91)));
  const content=glyphs.filter(glyph=>!marginGlyphs.has(glyph));
  const blocks=(detected.length?layoutBlocks(content,detected):nativeBlocks(content)).map(
    block=>{
      const detection=byRect.get(block.rect);
      return {...block,kind:semantic(block,byRect),...(!detected.length?{uncertain:true}:{}),
        ...(detection&&detection.score<.62?{labelUncertain:true}:{})};
    });
  if(page===1) {
    const title=blocks.find(b=>b.kind==='title');
    const boundary=blocks.find(b=>b.kind==='abstract'||/^abstract\b/i.test(b.text));
    if(title) {
      const bottom=title.rect.y+title.rect.h;
      const limit=Math.min(boundary?.rect.y??.34,bottom+.15);
      for(const block of blocks) {
        if(block.kind==='text'&&block.rect.y>=bottom-.006&&block.rect.y<limit&&block.rect.h<.075&&namesLike(block.text,authorHint)) {
          block.kind='author';
        }
      }
      const candidates=nativeBlocks(content).filter(line=>line.rect.y>=bottom-.004&&line.rect.y<limit&&namesLike(line.text,authorHint));
      if(candidates.length) {
        for(const line of candidates) {
          const existing=blocks.find(b=>!visualKinds.has(b.kind)&&b.kind!=='title'&&b.kind!=='abstract'&&overlap(line.rect,b.rect)>.68);
          if(existing&&overlap(existing.rect,line.rect)>.42) {
            existing.kind='author';
          } else if(!existing) {
            const insert=blocks.findIndex(b=>b.rect.y>line.rect.y);
            blocks.splice(insert<0?blocks.length:insert,0,{...line,kind:'author',uncertain:!authorHint});
          }
        }
      }
    }
  }
  blocks.push(...Array.from(marginGlyphs,glyph=>({kind:'margin' as Kind,rect:glyph.rect,text:glyph.text})));
  return blocks.filter(block=>block.rect.w>0&&block.rect.h>0&&!(block.uncertain&&/^[.,·\p{Cc}\s]+$/u.test(block.text.trim())))
    .map(block=>isParagraph(block.kind)?{...block,flow:paragraphFlow(content,block.rect,aspect)}:block);
}
