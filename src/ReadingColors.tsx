import {useEffect,useState,type CSSProperties} from 'react';
export type ReadingColors={match:string;matchOpacity:number;sentence:string;sentenceOpacity:number};
export const defaultReadingColors:ReadingColors={match:'#19aabd',matchOpacity:.12,sentence:'#ffc74a',sentenceOpacity:.25};
const key='rdnext.reader.colors',changed='rdnext:reading-colors';
const hex=/^#[a-f0-9]{6}$/i;
export function loadReadingColors():ReadingColors {
  try{
    const raw=JSON.parse(localStorage.getItem(key)||'null') as Partial<ReadingColors>|null;
    if(raw)return {match:typeof raw.match==='string'&&hex.test(raw.match)?raw.match:defaultReadingColors.match,
      sentence:typeof raw.sentence==='string'&&hex.test(raw.sentence)?raw.sentence:defaultReadingColors.sentence,
      matchOpacity:typeof raw.matchOpacity==='number'&&raw.matchOpacity>=.04&&raw.matchOpacity<=.35?raw.matchOpacity:defaultReadingColors.matchOpacity,
      sentenceOpacity:typeof raw.sentenceOpacity==='number'&&raw.sentenceOpacity>=.04&&raw.sentenceOpacity<=.45?raw.sentenceOpacity:defaultReadingColors.sentenceOpacity};
  }catch{/* Keep readable defaults for malformed stored preferences. */}
  return {...defaultReadingColors};
}
function rgba(color:string,alpha:number){
  return 'rgba('+[1,3,5].map(index=>parseInt(color.slice(index,index+2),16)).join(',')+','+alpha+')';
}
export function readingColorStyle(value:ReadingColors):CSSProperties{
  return {'--reading-match':value.match,'--reading-match-fill':rgba(value.match,value.matchOpacity),
    '--reading-sentence':value.sentence,'--reading-sentence-opacity':value.sentenceOpacity,
    '--reading-sentence-fill':rgba(value.sentence,value.sentenceOpacity)} as CSSProperties;
}
export function useReadingColors(){
  const [value,setValue]=useState(loadReadingColors);
  useEffect(()=>{
    const update=()=>setValue(loadReadingColors());
    window.addEventListener(changed,update);window.addEventListener('storage',update);
    return()=>{window.removeEventListener(changed,update);window.removeEventListener('storage',update)};
  },[]);
  return value;
}
const presets=[['青蓝','#19aabd'],['薄荷','#34ac83'],['金黄','#f2b83e'],['珊瑚','#ec795e'],['紫罗兰','#a47adf'],['天蓝','#559ee1']];
export function ReadingColorSettings(){
  const value=useReadingColors(),[error,setError]=useState('');
  function update(next:ReadingColors){
    try{localStorage.setItem(key,JSON.stringify(next));window.dispatchEvent(new Event(changed));setError('')}
    catch{setError('颜色暂未保存，请重试。')}
  }
  return <section className="reading-color-settings">
    <h3>阅读颜色</h3><p>对应框整块填色，原文与译文使用相同颜色。调整立即应用并保存在本机。</p>
    {(['match','sentence'] as const).map(type=>{
      const label=type==='match'?'对应框':'原文句子提示',opacity=type==='match'?'matchOpacity':'sentenceOpacity';
      return <div className="reading-color-field" key={type}>
        <label>{label}颜色<input type="color" aria-label={label+'颜色'} value={value[type]} onChange={e=>update({...value,[type]:e.target.value})}/></label>
        <div className="reading-color-presets" aria-label={label+'预设颜色'}>{presets.map(([name,color])=><button key={color} type="button" aria-label={label+' · '+name} aria-pressed={value[type].toLowerCase()===color} style={{background:color}} onClick={()=>update({...value,[type]:color})}/>)}</div>
        <label>填色深浅 <span>{Math.round(value[opacity]*100)}%</span><input type="range" aria-label={label+'填色深浅'} min="4" max={type==='match'?'35':'45'} step="1" value={Math.round(value[opacity]*100)} onChange={e=>update({...value,[opacity]:Number(e.target.value)/100})}/></label>
      </div>;
    })}
    <div className="reading-color-preview" style={readingColorStyle(value)}>
      <p>对应原文与译文的完整段落，框内整块铺色，文字仍然清楚。</p>
      <div><span>鼠标停在句子上时，用浅色显示这句话的范围。</span> 移开后提示消失。</div>
    </div>
    {error&&<p className="error" role="alert">{error}</p>}
    <button className="secondary" onClick={()=>update(defaultReadingColors)}>恢复默认颜色</button>
  </section>;
}
