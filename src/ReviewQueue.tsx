import { ChevronDown } from 'lucide-react';
import { kinds, type Located } from './ReadingRegions';
import { reviewExcerpt } from './ReviewText';
import type { ReviewChain } from './ReviewChains';
import type { RegionAction } from './RegionCorrection';
import './review-queue.css';

type Props = {
  items: ReviewChain[];
  located: Map<string, Located>;
  active: ReviewChain|null;
  confirmed: boolean;
  busy: boolean;
  empty: string;
  focus: (item: ReviewChain, part?: string) => void;
  collapse: () => void;
  correct: (item: ReviewChain, part: Located) => void;
  save: (action: RegionAction) => Promise<boolean>;
};

export function ReviewQueue({items,located,active,confirmed,busy,empty,focus,collapse,correct,save}: Props) {
  if (!items.length) return <p className="reading-empty quiet-text">{empty}</p>;
  return <div className="review-queue">
    {items.map(item=>{
      const fragments=item.parts.map(id=>located.get(id)).filter((part):part is Located=>Boolean(part));
      if(fragments.length!==item.parts.length) return null;
      const selected=active?.first===item.first&&active?.second===item.second;
      const first=fragments[0], last=fragments.at(-1)!;
      const label=item.category==='label';
      const linked=fragments.length>1;
      const pages=first.region.page===last.region.page?`第 ${first.region.page} 页`:`第 ${first.region.page}–${last.region.page} 页`;
      return <article key={item.first+'/'+(item.second||'')} className="review-item" data-selected={selected} data-category={label?'label':linked?'seam':'source'}>
        <button type="button" className="review-jump" aria-expanded={selected} onClick={()=>selected?collapse():focus(item)}>
          <span className="review-row-meta"><span>{label?'标签':linked?'段落衔接':'原文疑点'}</span>{pages}</span>
          <strong>{item.reason}</strong><ChevronDown size={15} aria-hidden="true"/>
        </button>
        {selected&&<div className="review-expanded">
          {label&&<p className="review-current-label">当前 <strong>{kinds[first.region.kind]}</strong>{item.suggestedKind&&<> <span aria-hidden="true">→</span> 建议 <strong>{kinds[item.suggestedKind]}</strong></>}</p>}
          <div className="review-excerpts">
            {fragments.map((part,index)=><div className="review-fragment-row" key={part.region.id}>
              <button className="review-fragment" aria-label={`定位第 ${index+1} 块原文 · 第 ${part.region.page} 页`} onClick={()=>focus(item,part.region.id)}>
                {linked&&<span className="review-excerpt-label">{index===0?'前一块结尾':index===fragments.length-1?'后一块开头':`中间区块 ${index+1}`} · 第 {part.region.page} 页</span>}
                <span>{part.region.text?reviewExcerpt(part.region.text,index===0&&linked,132):`查看原文中的${kinds[part.region.kind]}`}</span>
              </button>
              {linked&&<button className="quiet review-correct" aria-label={'更正第 '+(index+1)+' 块'} disabled={busy} onClick={()=>correct(item,part)}>改标签</button>}
            </div>)}
          </div>
          <div className="review-actions">
            {!confirmed&&(linked?<button className="secondary" disabled={busy} onClick={()=>void save({action:'join',first:item.first,selected:item.parts})}>
              连接{fragments.length===2?'两块':fragments.length+' 块'}
            </button>:<button className="secondary" disabled={busy} onClick={()=>correct(item,first)}>{label?'改标签':'更正区块'}</button>)}
            <button className="quiet" disabled={busy}
              onClick={()=>void save({action:confirmed?'recheck':'keep',first:item.first,second:item.second,selected:item.parts.length>2?item.parts:undefined})}>
              {confirmed?'重新核对':label?'标签正确':linked?'保留划分':'确认原文'}
            </button>
          </div>
          {!!item.evidence.length&&<details className="review-why"><summary>判断依据</summary>
            <ul className="review-evidence">{item.evidence.map(reason=><li key={reason}>{reason}</li>)}</ul>
          </details>}
        </div>}
      </article>;
    })}
  </div>;
}
