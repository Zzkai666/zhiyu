import {useEffect,useRef,useState} from 'react';
import {api,message,type Paper} from './api';
export function ReadingProgress({paper}:{paper:Paper}){
 const total=paper.totalPages||0,percent=paper.status==='已读'?100:paper.readAt&&total?Math.round(Math.min(paper.page,total)/total*100):0;
 const text=paper.status==='已读'?'已标记读完':paper.readAt?'第 '+paper.page+(total?' / '+total:'')+' 页'+(total?' · '+percent+'%':''):total?'共 '+total+' 页 · 尚未开始':'尚未开始阅读';
 return <div className="paper-reading-progress"><span>{text}</span>{(total>0||paper.status==='已读')&&<progress aria-label={'阅读位置：'+paper.title} max={100} value={percent}/>}</div>
}
export function PaperState({paper,change,busy=false}:{paper:Paper;change:(p:Paper,patch:Partial<Paper>)=>Promise<unknown>;busy?:boolean}){
 return <select className="paper-state" aria-label={'阅读状态：'+paper.title} title="打开原文会自动进入阅读中；读完后可标记已读" disabled={busy||paper.deleted} value={paper.status} onChange={e=>void change(paper,{status:e.target.value as Paper['status']})}><option value="待阅读">待读</option><option value="阅读中">阅读中</option><option value="已读">已读</option></select>
}
export function allowRemarkLeave(){
 if(document.querySelector('.paper-remark[data-busy="true"]'))return false;
 return !document.querySelector('.paper-remark[data-dirty="true"]')||window.confirm('文献备注尚未保存。暂时离开并保留本机草稿？');
}
export function PaperRemark({paper,update}:{paper:Paper;update:(p:Paper)=>void}){
 const key='rdnext.paper-remark.'+paper.id;
 const initial=()=>{try{const row=JSON.parse(localStorage.getItem(key)||'null');if(row&&typeof row.text==='string'&&Number.isInteger(row.revision)&&row.text!==paper.remark)return row}catch{}return{text:paper.remark||'',revision:paper.remarkRevision||0}};
 const initialValue=useRef(initial()).current;
 const[text,setText]=useState<string>(initialValue.text),[base,setBase]=useState<number>(initialValue.revision),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[conflict,setConflict]=useState<Paper>();
 const dirty=text!==(paper.remark||'');
 useEffect(()=>{if(!dirty){setText(paper.remark||'');setBase(paper.remarkRevision||0)}},[paper.remark,paper.remarkRevision]);
 function edit(value:string){setText(value);setNotice('');try{localStorage.setItem(key,JSON.stringify({text:value,revision:base}))}catch{setError('草稿暂未保存到本机，请保存备注后再离开')}}
 async function save(){if(busy)return;setBusy(true);setError('');try{const result=await api<{remark:string;revision:number}>('/papers/'+paper.id+'/remark','PATCH',{remark:text,revision:base});setBase(result.revision);update({...paper,remark:result.remark,remarkRevision:result.revision});try{localStorage.removeItem(key)}catch{}setConflict(undefined);setNotice('备注已保存')}catch(e){setError(message(e));try{const rows=await api<Paper[]>('/papers');const latest=rows.find(p=>p.id===paper.id);if(latest&&(latest.remarkRevision||0)!==base)setConflict(latest)}catch{}}finally{setBusy(false)}}
 return <form className="paper-remark" aria-label="文献个人备注" data-dirty={dirty} data-busy={busy} onSubmit={e=>{e.preventDefault();void save()}}><label>个人备注<textarea aria-label="文献个人备注内容" rows={3} maxLength={4000} value={text} disabled={busy||paper.deleted} placeholder="记下这篇论文值得留意的地方…" onChange={e=>edit(e.target.value)}/></label>{conflict&&<div className="remark-conflict"><p>最新已保存内容：</p><blockquote>{conflict.remark||'（空）'}</blockquote><button type="button" className="secondary" onClick={()=>{setBase(conflict.remarkRevision||0);update(conflict);setConflict(undefined);setError('已核对最新版本，当前输入保留；点击保存才会覆盖')}}>保留我的输入，继续编辑</button></div>}{error&&<p className="error" role="alert">{error}</p>}{notice&&<p className="quiet-text" role="status">{notice}</p>}<div className="remark-actions"><small>{dirty?'尚未保存':'仅保存在本机'}</small>{dirty&&<button className="quiet" type="button" disabled={busy} onClick={()=>{setText(paper.remark||'');setBase(paper.remarkRevision||0);setConflict(undefined);setError('');localStorage.removeItem(key)}}>撤销修改</button>}<button className="secondary" disabled={!dirty||busy||paper.deleted}>{busy?'正在保存…':'保存备注'}</button></div></form>
}
