import {DeskArt,type ArtKind} from './Journal';
import { useEffect, useState, type ReactNode } from 'react';
import { api, message } from './api';

export function useRows<T extends { id:string }>(path:string) {
  const [data,setData] = useState<{ path:string; rows:T[]; error:string }>();
  const [attempt,setAttempt] = useState(0);
  useEffect(() => {
    if (!path) return;
    let active=true;
    void api<T[]>(path).then(rows => { if (active) setData({path,rows,error:''}); })
      .catch(err => { if (active) setData({path,rows:[],error:message(err)}); });
    return () => { active=false; };
  },[path,attempt]);
  function update(row:T, keepOrder=false) {
    setData(current=>{
      const rows=current?.path===path?current.rows:[];
      if(keepOrder){
        const index=rows.findIndex(item=>item.id===row.id);
        return {path,error:'',rows:index<0?[...rows,row]:rows.map((item,i)=>i===index?row:item)};
      }
      return {path,error:'',rows:[row,...rows.filter(item=>item.id!==row.id)]};
    });
  }
  return { rows:data?.path===path ? data.rows : [], error:data?.path===path ? data.error : '',
    loading:Boolean(path && data?.path!==path), retry:()=>setAttempt(value=>value+1), update };
}

export function DataStatus({ error, loading, retry }: { error:string; loading:boolean; retry:()=>void }) {
  if (error) return <div className="data-status error" role="alert"><span>{error}</span><button className="secondary" onClick={retry}>重新载入</button></div>;
  if (loading) return <p className="data-status quiet-text" role="status">正在载入…</p>;
  return null;
}

export function DomainShell({ label, title, description, action, rail, children }: {
  label:string; title:string; description:string; action:ReactNode; rail?:ReactNode; children:ReactNode;
}) {
  const art:ArtKind=title==='课程学习'?'course':title==='实验记录'?'lab':title==='运动与生活'?'life':'books';
  return <div className={'workspace-page domain-page '+(title==='课程学习'?'study-page':title==='实验记录'?'lab-page':'life-page')}>
    <header className="page-heading"><div><p className="section-label">{label}</p><h1>{title}</h1><p>{description}</p></div><DeskArt kind={art}/>{action}</header>
    {rail ? <div className="domain-layout"><aside className="domain-rail">{rail}</aside><section className="domain-detail">{children}</section></div> : children}
  </div>;
}

export function SaveActions({ pending, error, label }: { pending:boolean; error:string; label:string }) {
  return <>{error && <p className="error" role="alert">{error}</p>}
    <div className="form-actions"><button className="primary" disabled={pending} type="submit">{pending ? '正在保存…' : label}</button></div></>;
}
