import * as Dialog from '@radix-ui/react-dialog';
import { ArrowLeft, ArrowRight, BookOpen, FileDown, FileUp, Link2, Pause, Play, RotateCcw, ScanLine, SlidersHorizontal, Tags, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { LiteratureMotion } from './LiteratureMotion';
import './literature-guide.css';

const steps = [
  { name:'导入论文', icon:FileUp, title:'从一篇论文开始',
    description:'从首页或文献库点「导入 PDF」。可以选本地 PDF，也可以输入 arXiv 编号、DOI、论文链接或标题。' },
  { name:'后台解析', icon:ScanLine, title:'在文献条目看解析进度',
    description:'导入完成后知屿自动解析。可以去做别的事，回到文献库看到「待核对解析结果」后点「去核对」。' },
  { name:'核对标签', icon:Tags, title:'给区块改一个正确的标签',
    description:'在「标签」中选一项，左侧会定位到原文框。点「改标签」，选择正确类别和是否需要翻译，再保存。也可直接点任意原文框。' },
  { name:'核对断段', icon:Link2, title:'把跨页、跨栏的半段接起来',
    description:'展开疑点，对照前一块结尾与后一块开头。同一段就连接，原本分开的就保留划分。漏识别时可在原文手动选多个框连接。' },
  { name:'选择模型', icon:SlidersHorizontal, title:'先选好整篇论文用的模型',
    description:'打开阅读器「更多 → 翻译设置」。选择翻译连接、模型及可用的思考强度，可以先试译短句，再保存设置。' },
  { name:'全文翻译', icon:Play, title:'核对后，一次启动全文翻译',
    description:'处理完必核对项，点「翻译全文」。可以返回文献库查看进度，翻译会继续在后台进行。' },
  { name:'双语对照', icon:BookOpen, title:'译到哪，就能对到哪',
    description:'在「双语对照」模式下点译文段落，原文会定位并高亮。一个段落跨多个区块时，译文旁可以选择各处原文。' },
  { name:'批注与导出', icon:FileDown, title:'把读懂的地方留下来',
    description:'可选中原文做高亮、下划线、批注或收词。打开「更多 → 导出论文」，保存全文译文或带标注的 PDF。' },
] as const;

const seenKey = 'rdnext.literature-guide.seen';

export function shouldOfferLiteratureGuide() {
  try { return localStorage.getItem(seenKey) !== '1'; }
  catch { return false; }
}

export function markLiteratureGuideSeen() {
  try { localStorage.setItem(seenKey, '1'); }
  catch { /* The current session also remembers dismissal. */ }
}

function GuideScene({step}: {step:number}) {
  const [reduced,setReduced]=useState(()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [paused,setPaused]=useState(false);
  const [finished,setFinished]=useState(false);
  const [replay,setReplay]=useState(0);
  useEffect(()=>{
    const query=window.matchMedia('(prefers-reduced-motion: reduce)');
    const change=()=>{
      setReduced(query.matches);
      setPaused(false);
      setFinished(false);
      setReplay(value=>value+1);
    };
    query.addEventListener('change',change);
    return ()=>query.removeEventListener('change',change);
  },[]);
  return <div className="guide-scene" data-scene={step} data-motion={reduced?'reduced':finished?'finished':paused?'paused':'playing'}>
    <div key={replay} className="guide-viewport" data-paused={paused}>
      <LiteratureMotion step={step}/>
      {!reduced&&<span className="guide-progress-sweep" aria-hidden="true" onAnimationEnd={()=>setFinished(true)}/>}
    </div>
    <div className="guide-playback">
      <span>操作演示</span>
      {!reduced&&<div className="guide-motion-controls">
        <button className="guide-replay" type="button" disabled={finished} onClick={()=>setPaused(value=>!value)}>
          {paused?<Play size={13}/>:<Pause size={13}/>} {paused?'继续':'暂停'}
        </button>
        <button className="guide-replay" type="button" onClick={()=>{setReplay(value=>value+1);setPaused(false);setFinished(false)}}>
          <RotateCcw size={13}/>重播本步
        </button>
      </div>}
    </div>
  </div>;
}

export function LiteratureGuide({close,importPaper,restoreFocus}:{
  close:()=>void;
  importPaper:()=>void;
  restoreFocus:()=>void;
}) {
  const [index,setIndex]=useState(0);
  const heading=useRef<HTMLHeadingElement>(null);
  const step=steps[index];
  const last=index===steps.length-1;
  useEffect(()=>{ heading.current?.focus(); },[index]);

  return <Dialog.Root open onOpenChange={value=>{if(!value)close()}}>
    <Dialog.Portal>
      <Dialog.Overlay className="modal-overlay literature-guide-overlay"/>
      <Dialog.Content className="modal literature-guide"
        onOpenAutoFocus={event=>{event.preventDefault();heading.current?.focus()}}
        onCloseAutoFocus={event=>{event.preventDefault();restoreFocus()}}
        onPointerDownOutside={event=>event.preventDefault()}
        onKeyDown={event=>{
          if(event.altKey||event.ctrlKey||event.metaKey)return;
          if(event.key==='ArrowLeft'||event.key==='ArrowRight'){
            event.preventDefault();
            const delta=event.key==='ArrowLeft'?-1:1;
            setIndex(value=>Math.max(0,Math.min(steps.length-1,value+delta)));
          }
        }}>
        <header className="guide-header">
          <Dialog.Title>文献阅读引导</Dialog.Title>
          <Dialog.Close className="guide-skip"><span>{last?'关闭':'跳过'}</span><X size={16}/></Dialog.Close>
        </header>
        <Dialog.Description className="sr-only">演示从导入和解析到核对、翻译及阅读，可随时退出并从版本与帮助重看。</Dialog.Description>
        <div className="guide-layout">
          <GuideScene key={index} step={index}/>
          <section className="guide-copy">
            <p className="guide-counter">第 {index+1} 步，共 {steps.length} 步</p>
            <h2 ref={heading} tabIndex={-1}>{step.title}</h2>
            <p>{step.description}</p>
          </section>
        </div>
        <footer className="guide-footer">
          <nav className="guide-steps" aria-label="引导章节">
            {steps.map(({name,icon:Icon},position)=><button key={name} type="button" title={name}
              aria-current={position===index?'step':undefined} onClick={()=>setIndex(position)}><Icon size={16}/><span>{name}</span></button>)}
          </nav>
          <div className="guide-actions">
            {last ? <>
              <button className="secondary" onClick={close}>完成引导</button>
              <button className="primary" onClick={importPaper}>导入 PDF<ArrowRight size={15}/></button>
            </> : <>
              {index>0&&<button className="secondary" onClick={()=>setIndex(index-1)}><ArrowLeft size={15}/>上一步</button>}
              <button className="primary" onClick={()=>setIndex(index+1)}>下一步<ArrowRight size={15}/></button>
            </>}
          </div>
        </footer>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}

