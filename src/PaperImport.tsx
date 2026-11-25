import { FileUp,LoaderCircle } from 'lucide-react';
import { useState } from 'react';
import { api,message,type Paper } from './api';
import { Modal } from './ui';

type Candidate={title:string;authors:string;doi:string;year:number;source:string;pdf:string};
type Result={paper:Paper;duplicate:boolean};
export function PaperImport({close,local,drop,done}:{close:()=>void;local:()=>Promise<boolean>;drop?:(files:File[])=>Promise<boolean>;done:(item:Result)=>void}) {
  const [query,setQuery]=useState('');
  const [candidates,setCandidates]=useState<Candidate[]|null>(null);
  const [active,setActive]=useState('');
  const [error,setError]=useState('');
  async function lookup(){
    if(!query.trim()||active)return;
    setActive('lookup');setError('');setCandidates(null);
    try{setCandidates(await api<Candidate[]>('/import/lookup','POST',{query:query.trim()}))}
    catch(err){setError(message(err))}
    finally{setActive('')}
  }
  async function download(candidate:Candidate,index:number){
    if(active)return;
    setActive('download'+index);setError('');
    try{done(await api<Result>('/import/download','POST',candidate))}
    catch(err){setError(message(err))}
    finally{setActive('')}
  }
  async function localFiles(files?:File[]){
    if(active)return;
    setActive('local');setError('');
    try{if(await (files&&drop?drop(files):local()))close()}
    catch(err){setError(message(err))}
    finally{setActive('')}
  }
  return <Modal title="导入论文" subtitle="arXiv 编号、DOI、论文页面或 PDF 链接、完整标题" close={()=>{if(!active)close()}} className="paper-import-modal">
    <form className="paper-import-query" onSubmit={e=>{e.preventDefault();void lookup()}}>
      <input autoFocus autoComplete="off" name="paper" aria-label="arXiv 编号、DOI、链接或完整标题" placeholder="例如 2401.01234 或 10.1145/…" value={query}
        disabled={Boolean(active)} onChange={e=>{setQuery(e.target.value);setCandidates(null);setError('')}}/>
      <button className="primary" disabled={Boolean(active)||!query.trim()} type="submit">
        {active==='lookup'?<><LoaderCircle size={16} className="wait-icon"/>查询中…</>:'导入'}
      </button>
    </form>
    {error&&<p role="alert" className="error import-feedback">{error}</p>}
    {candidates&&<div className="online-candidates" aria-label="论文候选">
      {candidates.length?candidates.map((candidate,index)=><article key={candidate.doi+'|'+candidate.source+'|'+index}>
        <div><strong>{candidate.title}</strong><small>{[candidate.authors,candidate.year||'',candidate.doi].filter(Boolean).join(' · ')}</small>
          {!candidate.pdf&&<small>此来源没有提供可直接导入的 PDF。</small>}</div>
        {candidate.pdf&&<button className="secondary" disabled={Boolean(active)} onClick={()=>void download(candidate,index)}>
          {active==='download'+index?'下载中…':'确认导入'}
        </button>}
      </article>):<p className="quiet-text">未找到匹配论文。可核对输入，或选择本地 PDF。</p>}
    </div>}
    <div className="paper-import-or" aria-hidden="true"><span/>或<span/></div>
    <div className="pdf-import-drop" onDragOver={e=>{if(e.dataTransfer.types.includes('Files'))e.preventDefault()}} onDrop={e=>{e.preventDefault();if(!active&&e.dataTransfer.files.length)void localFiles(Array.from(e.dataTransfer.files))}}><FileUp size={29} aria-hidden="true"/><div className="paper-import-options">
      <button className="secondary" disabled={Boolean(active)} onClick={()=>void localFiles()}><FileUp size={18}/>{active==='local'?'正在选择或导入…':'选择 PDF 文件'}</button>
    </div><p>也可以拖入一份或多份 PDF</p></div><p className="import-later-note">Zotero / EndNote 导入：后续支持</p>
  </Modal>;
}
