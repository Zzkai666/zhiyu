import { ChevronDown } from 'lucide-react';
import { useEffect,useRef,useState } from 'react';
import type { Mark } from './api';

export const colors={amber:['黄色','#eeb120'],red:['红色','#e45e65'],purple:['紫色','#9a7add'],orange:['橙色','#e69b46'],gray:['灰色','#96999d'],green:['绿色','#48a976'],blue:['蓝色','#4b9fe0'],pink:['粉色','#dc6da4']} as const;

export function MarkColor({value,change}:{value:Mark['color'];change:(color:Mark['color'])=>void}) {
  const [open,setOpen]=useState(false);
  const root=useRef<HTMLDivElement>(null);
  const toggle=useRef<HTMLButtonElement>(null);
  useEffect(()=>{
    if(!open)return;
    const close=(event:PointerEvent)=>{if(event.target instanceof Node&&!root.current?.contains(event.target))setOpen(false)};
    document.addEventListener('pointerdown',close);
    return ()=>document.removeEventListener('pointerdown',close);
  },[open]);
  return <div className="mark-palette" ref={root} onKeyDown={e=>{
    if(e.key==='Escape'&&open){e.stopPropagation();setOpen(false);toggle.current?.focus()}
    if(open&&(e.key==='ArrowDown'||e.key==='ArrowUp')){
      e.preventDefault();
      const items=Array.from(root.current?.querySelectorAll<HTMLButtonElement>('[role=menuitemradio]')||[]);
      const current=items.indexOf(document.activeElement as HTMLButtonElement);
      items[(current+(e.key==='ArrowDown'?1:items.length-1))%items.length]?.focus();
    }
  }}>
    <button ref={toggle} className="mark-color-choice" title="标记颜色" aria-label={'标记颜色，'+colors[value][0]} aria-haspopup="menu"
      aria-expanded={open} onMouseDown={e=>e.preventDefault()} onClick={()=>setOpen(!open)}>
      <i style={{background:colors[value][1]}}/>{colors[value][0]}<ChevronDown size={13}/>
    </button>
    {open&&<div role="menu" aria-label="标记颜色" className="mark-color-menu">{Object.entries(colors).map(([id,[name,color]])=>
      <button type="button" role="menuitemradio" aria-checked={value===id} key={id} onMouseDown={e=>e.preventDefault()}
        onClick={()=>{change(id as Mark['color']);setOpen(false);toggle.current?.focus()}}>
        <i style={{background:color}}/>{name}{value===id&&<span aria-hidden="true">✓</span>}
      </button>)}</div>}
  </div>;
}

