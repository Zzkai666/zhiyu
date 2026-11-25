import libraryArt from './assets/journal/library-r1.png';
import booksArt from './assets/journal/books-r1.png';
import calendarArt from './assets/journal/calendar-r1.png';
import projectArt from './assets/journal/project-r1.png';
import labArt from './assets/journal/lab-r1.png';
import courseArt from './assets/journal/course-r1.png';
import wordsArt from './assets/journal/words-r1.png';
import lifeArt from './assets/journal/life-r1.png';
import settingsArt from './assets/journal/settings-r1.png';
import musicArt from './assets/journal/music-r1.png';
import weatherArt from './assets/journal/weather-r1.png';
import{useEffect,useState}from'react';
export type ArtKind='books'|'calendar'|'project'|'lab'|'course'|'words'|'life'|'settings'|'music'|'weather'|'library';
const artFiles={library:libraryArt,books:booksArt,calendar:calendarArt,project:projectArt,lab:labArt,course:courseArt,words:wordsArt,life:lifeArt,settings:settingsArt,music:musicArt,weather:weatherArt};
export function DeskArt({kind='books',className=''}:{kind?:ArtKind;className?:string}){
 return <img className={'desk-art journal-art '+className} src={artFiles[kind]} data-art={kind} alt="" aria-hidden="true" draggable={false}/>;
}
export {PaperCover} from './PaperPreview';
export function localDay(d=new Date()){return[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')}
export function useToday(){const[day,setDay]=useState(localDay);useEffect(()=>{const t=setInterval(()=>setDay(localDay()),30000);return()=>clearInterval(t)},[]);return day}
export function DateStamp(){const day=useToday();return <time className="journal-date" dateTime={day}>{new Date(day+'T12:00:00').toLocaleDateString('zh-CN',{month:'long',day:'numeric',weekday:'long'})}</time>}
export function Rhythm({entries,title,unit='分钟'}:{entries:{day:string;value:number}[];title:string;unit?:string}){
 const day=useToday(),end=new Date(day+'T12:00:00');const days=Array.from({length:7},(_,i)=>{const d=new Date(end);d.setDate(d.getDate()-6+i);const id=localDay(d);const rows=entries.filter(r=>r.day===id);return{id,label:d.toLocaleDateString('zh-CN',{weekday:'short'}),value:rows.reduce((n,r)=>n+r.value,0),recorded:rows.length>0}});
 const max=Math.max(1,...days.map(x=>x.value)),total=days.reduce((n,d)=>n+d.value,0);
 return <section className="rhythm-panel" aria-label={title}><header><div><h3>{title}</h3><small>近 7 天 · 已保存记录</small></div><p><strong>{total}</strong> {unit}</p></header><div className="rhythm-bars">{days.map(d=><div key={d.id} data-today={d.id===day} title={d.id+' · '+(d.recorded?d.value+' '+unit:'未记录')}><span>{d.recorded?d.value:'—'}</span><i style={{height:(d.recorded?Math.max(3,d.value/max*50):3)+'px'}} data-empty={!d.recorded}/><small>{d.label}</small></div>)}</div></section>
}
export function MonthNavigator({selected,select}:{selected:string;select:(day:string)=>void}){
 const today=useToday(),[month,setMonth]=useState(selected.slice(0,7));useEffect(()=>setMonth(selected.slice(0,7)),[selected]);const first=new Date(month+'-01T12:00:00'),offset=(first.getDay()+6)%7,count=new Date(first.getFullYear(),first.getMonth()+1,0).getDate();
 function step(n:number){const d=new Date(first);d.setMonth(d.getMonth()+n);setMonth(localDay(d).slice(0,7))}
 return <aside className="month-navigator" aria-label="日期导航"><header><button className="icon" aria-label="上个月" onClick={()=>step(-1)}>‹</button><h3>{first.getFullYear()}年{first.getMonth()+1}月</h3><button className="icon" aria-label="下个月" onClick={()=>step(1)}>›</button></header><div className="month-grid">{['一','二','三','四','五','六','日'].map(d=><small key={d}>{d}</small>)}{Array.from({length:offset},(_,i)=><span key={'blank'+i}/>)}{Array.from({length:count},(_,i)=>{const day=month+'-'+String(i+1).padStart(2,'0');return <button key={day} aria-label={'查看'+day} aria-pressed={day===selected} data-today={day===today} onClick={()=>select(day)}>{i+1}</button>})}</div><button className="quiet" onClick={()=>select(today)}>回到今天</button><p>重要日期始终显示，切换日期只改变当日待办。</p></aside>
}
