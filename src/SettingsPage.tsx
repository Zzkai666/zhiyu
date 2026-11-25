import{useEffect}from'react';
import{ArrowLeft,Settings2,BookOpen,Monitor,LayoutGrid,Music2,Timer,Bell,Mail,CalendarDays,Layers,Sun}from'lucide-react';
import{GeneralSettings,ReadingSettings}from'./WorkbenchSettings';
import{IslandSettings,islandTabs}from'./IslandSettings';
import'./settings.css';
const icons={appearance:Monitor,pages:LayoutGrid,music:Music2,health:Timer,notifications:Bell,mail:Mail,calendar:CalendarDays,quota:Layers,weather:Sun};
export function SettingsPage({close,initial='general',select}:{close:()=>void;initial?:string;select:(tab:string)=>void}){
 useEffect(()=>{document.querySelector('.settings-body')?.scrollTo(0,0)},[initial]);
 const island=initial.startsWith('island'),category=initial==='island'?'appearance':initial.replace('island-','');
 function leave(next:()=>void){if(document.querySelector('.island-settings[data-dirty="true"]')&&!confirm('离开会放弃尚未保存的设置或连接信息，继续吗？'))return;next()}
 return <section className="settings-page" aria-label="工作台设置"><header><button className="quiet" onClick={()=>leave(close)}><ArrowLeft size={18}/>返回工作台</button><h1>设置</h1></header><div className="settings-layout"><nav aria-label="设置分类"><small>工作台</small>{[['general','常规'],['reading','阅读']].map(([id,label])=>{const Icon=id==='general'?Settings2:BookOpen;return <button key={id} aria-current={initial===id?'page':undefined} onClick={()=>leave(()=>select(id))}><Icon size={17}/>{label}</button>})}<small>桌面小岛</small>{islandTabs.map(c=>{const id=c.id==='appearance'?'island':'island-'+c.id,Icon=icons[c.id as keyof typeof icons]||Monitor;return <button key={id} aria-current={initial===id?'page':undefined} onClick={()=>island?select(id):leave(()=>select(id))}><Icon size={17}/>{c.label}</button>})}</nav><div className="settings-body">{initial==='general'&&<GeneralSettings/>}{initial==='reading'&&<ReadingSettings/>}{island&&<IslandSettings category={category}/>}</div></div></section>
}
