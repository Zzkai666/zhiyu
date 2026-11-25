import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { isParagraph, kinds, visualKinds, type Kind, type Located } from './ReadingRegions';
import './region-correction.css';

export type RegionAction = {
  action: string;
  first: string;
  second?: string;
  selected?: string[];
  kind?: Kind;
  translate?: boolean;
};

type Viewport = RefObject<HTMLDivElement | null>;

export function RegionPopover({region, viewport, title, close, busy, focusOnOpen = false, children}: {
  region: string;
  viewport: Viewport;
  title: string;
  close: () => void;
  busy: boolean;
  focusOnOpen?: boolean;
  children: ReactNode;
}) {
  const panel = useRef<HTMLElement>(null);
  const latest = useRef({close,busy});
  latest.current = {close,busy};

  useLayoutEffect(() => {
    const surface = viewport.current;
    const popup = panel.current;
    if (!surface || !popup) return;
    let frame = 0;
    let focusPending = focusOnOpen;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const anchor = () => document.getElementById('region-'+region);
    function position() {
      const box = anchor()?.getBoundingClientRect();
      if (!surface || !popup) return;
      const visible = surface.getBoundingClientRect();
      if (!box || box.bottom < visible.top || box.top > visible.bottom ||
          box.left > visible.right || box.right < visible.left) {
        popup.style.visibility = 'hidden';
        return;
      }

      const gap = 8;
      const width = popup.offsetWidth;
      const height = popup.offsetHeight;
      const within = (value: number, low: number, high: number) => Math.max(low, Math.min(high,value));
      let x: number;
      let y: number;
      if (box.right + width + gap * 2 <= visible.right) {
        x = box.right + gap;
        y = box.top;
      } else if (box.left - width - gap * 2 >= visible.left) {
        x = box.left - width - gap;
        y = box.top;
      } else {
        x = box.right - width;
        const below = visible.bottom-box.bottom;
        const above = box.top-visible.top;
        y = below >= height+gap || below >= above ? box.bottom+gap : box.top-height-gap;
      }
      popup.style.left = within(x, Math.max(gap,visible.left+gap), Math.min(innerWidth,visible.right)-width-gap)+'px';
      popup.style.top = within(y,visible.top+gap,Math.min(innerHeight,visible.bottom)-height-gap)+'px';
      popup.style.visibility = 'visible';
      if (focusPending) {
        focusPending = false;
        (popup.querySelector<HTMLElement>('select:not(:disabled)') ?? popup).focus({preventScroll:true});
      }
    }
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(position);
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || latest.current.busy) return;
      if (popup.contains(document.activeElement) && opener?.isConnected) opener.focus({preventScroll:true});
      latest.current.close();
    };
    const onOutside = (event: PointerEvent) => {
      if (latest.current.busy || !(event.target instanceof Element)) return;
      if (!popup.contains(event.target) && !surface.contains(event.target) &&
          !event.target.closest('.review-correct')) latest.current.close();
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(popup);
    observer.observe(surface);
    surface.addEventListener('scroll',schedule);
    window.addEventListener('resize',schedule);
    document.addEventListener('keydown',onEscape);
    document.addEventListener('pointerdown',onOutside);
    schedule();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      surface.removeEventListener('scroll',schedule);
      window.removeEventListener('resize',schedule);
      document.removeEventListener('keydown',onEscape);
      document.removeEventListener('pointerdown',onOutside);
    };
  }, [region,viewport,focusOnOpen]);

  return <section ref={panel} className="region-popover" tabIndex={-1} role="region" aria-label={title}>
    <header><strong>{title}</strong><button type="button" className="icon" aria-label="关闭区块操作" disabled={busy} onClick={close}>×</button></header>
    {children}
  </section>;
}

function acceptsTranslation(kind: Kind) {
  return !visualKinds.has(kind) && kind !== 'margin' && kind !== 'formula-number';
}

const defaultsToTranslation = new Set<Kind>(['title','heading','abstract','text','caption']);

export function RegionCorrection({item, viewport, close, disabled, save, connect, suggestedKind}: {
  item: Located;
  suggestedKind?: Kind;
  viewport: Viewport;
  close: () => void;
  disabled: boolean;
  save: (action: RegionAction) => Promise<boolean>;
  connect: () => void;
}) {
  const {region, group, part} = item;
  const [kind,setKind] = useState(region.kind);
  const [translate,setTranslate] = useState(region.translate);
  const [busy,setBusy] = useState(false);
  const previous = group.regions[part-1];
  const next = group.regions[part+1];
  const kindChanged = kind !== region.kind;
  const changed = kindChanged || translate !== region.translate;

  async function apply() {
    if (!changed || disabled || busy) return;
    setBusy(true);
    try {
      const update: RegionAction = kindChanged
        ? {action:'correct-region',first:region.id,kind,translate}
        : {action:'region',first:region.id,translate};
      if (await save(update)) close();
    } finally { setBusy(false); }
  }

  async function split(neighbor: Located['region']) {
    if (disabled || busy) return;
    setBusy(true);
    try { await save({action:'split-edge',first:region.id,second:neighbor.id}); }
    finally { setBusy(false); }
  }

  return <RegionPopover region={region.id} viewport={viewport} title="更正区块" close={close} busy={busy} focusOnOpen>
    <form onSubmit={event=>{event.preventDefault();void apply()}}>
      <label className="region-correction-kind">类别
        <select value={kind} disabled={disabled||busy} onChange={event=>{
          const nextKind=event.target.value as Kind;
          setKind(nextKind);
          setTranslate(nextKind===region.kind?region.translate:defaultsToTranslation.has(nextKind));
        }}>
          {Object.entries(kinds).map(([value,label])=><option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      {suggestedKind&&suggestedKind!==kind&&<button type="button" className="quiet" disabled={disabled||busy} onClick={()=>{setKind(suggestedKind);setTranslate(defaultsToTranslation.has(suggestedKind));}}>选用建议类别 · {kinds[suggestedKind]}</button>}
      <label className="region-correction-translate">
        <input type="checkbox" checked={acceptsTranslation(kind)&&translate}
          disabled={disabled||busy||!acceptsTranslation(kind)||!region.text} onChange={event=>setTranslate(event.target.checked)}/>
        {!kindChanged&&group.regions.length>1?'整段需要翻译':'此区块需要翻译'}
      </label>
      {kindChanged&&group.regions.length>1&&<p>保存时会将这块从当前段落分离。</p>}
      <button className="primary" disabled={!changed||disabled||busy}>{busy?'正在保存…':'保存更正'}</button>
    </form>
    {(previous||next||isParagraph(region.kind))&&<div className="region-correction-links">
      {previous&&<button className="quiet" disabled={disabled||busy} onClick={()=>void split(previous)}>与前一块拆开</button>}
      {next&&<button className="quiet" disabled={disabled||busy} onClick={()=>void split(next)}>与后一块拆开</button>}
      {isParagraph(region.kind)&&isParagraph(kind)&&<button className="quiet" disabled={disabled||busy||changed} onClick={connect}>连接其他区块</button>}
    </div>}
  </RegionPopover>;
}