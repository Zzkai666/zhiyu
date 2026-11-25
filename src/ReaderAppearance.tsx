import type { CSSProperties } from 'react';
import { Modal } from './ui';

const fontFamilies={
  system:'"Segoe UI", "Microsoft YaHei", sans-serif',
  sans:'"Microsoft YaHei", "Noto Sans CJK SC", sans-serif',
  serif:'"SimSun", "Noto Serif CJK SC", serif',
  mono:'"Cascadia Mono", "Microsoft YaHei", monospace',
};
export type Appearance={font:keyof typeof fontFamilies;size:number;leading:number;gap:number;measure:number;align:'start'|'justify';indent:number};
export const defaultAppearance:Appearance={font:'sans',size:18,leading:1.95,gap:.65,measure:38,align:'start',indent:2};
const storageKey='rdnext.reader.appearance';

export function loadAppearance():Appearance {
  try {
    const stored=JSON.parse(localStorage.getItem(storageKey)||'null') as (Partial<Appearance>&{format?:number})|null;
    if(stored&&stored.font&&Object.hasOwn(fontFamilies,stored.font)&&
       typeof stored.size==='number'&&stored.size>=12&&stored.size<=28&&
       typeof stored.leading==='number'&&stored.leading>=1.35&&stored.leading<=2.25) {
      return {font:stored.font,size:stored.size,leading:stored.leading,gap:stored.gap===1.1&&stored.format!==2?.65:typeof stored.gap==='number'&&stored.gap>=.4&&stored.gap<=2?stored.gap:.65,measure:typeof stored.measure==='number'&&stored.measure>=24&&stored.measure<=52?stored.measure:38,align:stored.align==='justify'?'justify':'start',indent:typeof stored.indent==='number'&&stored.indent>=0&&stored.indent<=3?stored.indent:2};
    }
  }catch{/* malformed preference */}
  return defaultAppearance;
}

export function saveAppearance(value:Appearance) {
  localStorage.setItem(storageKey,JSON.stringify({...value,format:2}));window.dispatchEvent(new Event('rdnext:reader-appearance'));
}

export function translationStyle(value:Appearance):CSSProperties {
  return {'--translation-font':fontFamilies[value.font],'--translation-size':value.size+'px','--translation-leading':value.leading,'--translation-gap':value.gap+'em','--translation-measure':value.measure+'em','--translation-align':value.align,'--translation-indent':value.indent+'em'} as CSSProperties;
}

export function AppearanceFields({value,onChange}:{value:Appearance;onChange:(value:Appearance)=>void}){return <>
      <label>字体<select aria-label="译文字体" value={value.font} onChange={e=>onChange({...value,font:e.target.value as Appearance['font']})}>
        <option value="system">系统默认</option><option value="sans">无衬线</option><option value="serif">宋体</option><option value="mono">等宽</option>
      </select></label>
      <label>字号 <span>{value.size} px</span>
        <input type="range" aria-label="译文字号" min="12" max="28" step="1" value={value.size} onChange={e=>onChange({...value,size:Number(e.target.value)})}/>
      </label>
      <label>行距 <span>{value.leading.toFixed(2)}</span>
        <input type="range" aria-label="译文行距" min="1.35" max="2.25" step=".05" value={value.leading} onChange={e=>onChange({...value,leading:Number(e.target.value)})}/>
      </label>
      <label>段间距 <span>{value.gap.toFixed(2)} em</span><input type="range" aria-label="译文段间距" min=".4" max="2" step=".05" value={value.gap} onChange={e=>onChange({...value,gap:Number(e.target.value)})}/></label>
      <label>行宽 <span>{value.measure} em</span><input type="range" aria-label="译文行宽" min="24" max="52" step="1" value={value.measure} onChange={e=>onChange({...value,measure:Number(e.target.value)})}/></label>
      <label>正文首行缩进<select aria-label="正文首行缩进" value={value.indent} onChange={e=>onChange({...value,indent:Number(e.target.value)})}><option value="0">不缩进</option><option value="1">1 字</option><option value="2">2 字</option><option value="3">3 字</option></select></label>
      <label>对齐<select aria-label="译文对齐" value={value.align} onChange={e=>onChange({...value,align:e.target.value as Appearance['align']})}><option value="start">左对齐</option><option value="justify">两端对齐</option></select></label>

</>}
export function ReaderAppearance({value,onChange,close}:{value:Appearance;onChange:(value:Appearance)=>void;close:()=>void}){
 return <Modal title="译文排版" close={close}><div className="reader-appearance form"><AppearanceFields value={value} onChange={onChange}/><p className="appearance-preview" style={translationStyle(value)}>在连续阅读中，清晰的字号和适当的行距能让长段落更易核对。点击译文仍可定位相应的原文。</p><div className="form-actions"><button className="secondary" onClick={()=>onChange(defaultAppearance)}>恢复默认</button><button className="primary" onClick={close}>完成</button></div></div></Modal>
}