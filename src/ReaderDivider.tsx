import { useRef, type KeyboardEvent, type PointerEvent } from 'react';

export const minPane = 275;
export const maxPane = 535;

export function ReaderDivider({ width, resize, left=false, minimum=minPane, maximum=maxPane, reset }: {
  width:number;left?:boolean;resize:(next:number)=>void;minimum?:number;maximum?:number;reset?:()=>void;
}) {
  const drag = useRef<{ x:number; width:number } | null>(null);
  function start(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x:event.clientX,width };
    document.body.classList.add('resizing');
  }
  function stop() {
    drag.current = null;
    document.body.classList.remove('resizing');
  }
  function key(event: KeyboardEvent<HTMLDivElement>) {
    const amount = event.shiftKey ? 64 : 24;
    const next = event.key === 'ArrowLeft' ? width + (left?-amount:amount) : event.key === 'ArrowRight' ? width + (left?amount:-amount) :
      event.key === 'Home' ? minimum : event.key === 'End' ? maximum : null;
    if (next === null) return;
    event.preventDefault();
    resize(next);
  }
  return <div className="reader-divider" role="separator" aria-orientation="vertical" aria-label="调整原文和译文宽度"
    aria-valuemin={Math.round(minimum)} aria-valuemax={Math.round(maximum)} aria-valuenow={width} aria-controls="translation-pane" tabIndex={0}
    title="拖动或用方向键调整，双击恢复默认宽度" onDoubleClick={reset} onKeyDown={key}
    onPointerDown={start} onPointerMove={event => { if (drag.current) resize(drag.current.width + (event.clientX-drag.current.x)*(left?1:-1)); }}
    onLostPointerCapture={stop}/>;
}
