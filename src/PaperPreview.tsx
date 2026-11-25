import {useEffect,useRef,useState} from 'react';
import {FileText} from 'lucide-react';
import {loadPDF} from './pdf';
import {api,type Paper} from './api';

type Preview={key:string;uri:string;pages:number;used:number};
const memory=new Map<string,Preview>(),running=new Map<string,Promise<Preview>>(),reported=new Map<string,Promise<void>>();
let database:Promise<IDBDatabase>|undefined,active=0;
const queue:(()=>void)[]=[];
function db(){return database??=new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open('rdnext-pdf-previews',1);request.onupgradeneeded=()=>request.result.createObjectStore('pages',{keyPath:'key'});request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);request.onblocked=()=>reject(Error('Preview cache busy'))})}
async function cached(key:string){try{const d=await db();return await new Promise<Preview|undefined>((resolve,reject)=>{const r=d.transaction('pages').objectStore('pages').get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}catch{return undefined}}
async function store(value:Preview){try{const d=await db();await new Promise<void>((resolve,reject)=>{const t=d.transaction('pages','readwrite');t.objectStore('pages').put(value);t.oncomplete=()=>resolve();t.onerror=()=>reject(t.error)});const t=d.transaction('pages','readwrite'),s=t.objectStore('pages'),r=s.getAll();r.onsuccess=()=>{const rows=(r.result as Preview[]).sort((a,b)=>b.used-a.used);rows.slice(128).forEach(v=>s.delete(v.key))}}catch{/* Cache failure never prevents reading. */}}
async function slot(){if(active>=2)await new Promise<void>(resolve=>queue.push(resolve));active++}
function release(){active--;queue.shift()?.()}
function remember(p:Preview){memory.delete(p.key);memory.set(p.key,p);if(memory.size>64)memory.delete(memory.keys().next().value!);return p}
function preview(paper:Paper){
 const key=paper.id+':'+paper.bytes+':page1-v1';
 if(memory.has(key))return Promise.resolve(remember(memory.get(key)!));
 if(running.has(key))return running.get(key)!;
 const request=(async()=>{const prior=await cached(key);if(prior)return remember(prior);await slot();const task=loadPDF(paper.id);
 try{task.onPassword=()=>{void task.destroy()};const doc=await task.promise,page=await doc.getPage(1),base=page.getViewport({scale:1});const scale=Math.min(320/base.width,640/base.height),v=page.getViewport({scale});const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.ceil(v.width));canvas.height=Math.max(1,Math.ceil(v.height));await page.render({canvas,viewport:v}).promise;const result={key,uri:canvas.toDataURL('image/webp',.88),pages:doc.numPages,used:Date.now()};void store(result);return remember(result)}finally{await task.destroy().catch(()=>{});release()}})();
 running.set(key,request);void request.finally(()=>running.delete(key)).catch(()=>{});return request
}
export function recordPageCount(paper:Paper,pages:number){
 if(paper.totalPages===pages||paper.deleted)return Promise.resolve();
 const key=paper.id+':'+pages;
 if(reported.has(key))return reported.get(key)!;
 const request=api<{pages:number}>('/papers/'+paper.id+'/preview-info','PUT',{pages}).then(value=>{window.dispatchEvent(new CustomEvent('rdnext:paper-pages',{detail:{id:paper.id,pages:value.pages}}))}).catch(e=>{reported.delete(key);throw e});
 reported.set(key,request);return request;
}
export function PaperCover({paper,large=false}:{paper:Paper;large?:boolean}){
 const node=useRef<HTMLDivElement>(null),[visible,setVisible]=useState(false),[value,setValue]=useState<Preview>(),[failed,setFailed]=useState(false);
 useEffect(()=>{const el=node.current;if(!el||paper.deleted)return;const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){setVisible(true);observer.disconnect()}},{rootMargin:'180px'});observer.observe(el);return()=>observer.disconnect()},[paper.id,paper.deleted]);
 useEffect(()=>{if(!visible||paper.deleted)return;let live=true;setFailed(false);void preview(paper).then(v=>{if(live)setValue(v);void recordPageCount(paper,v.pages).catch(()=>{})}).catch(()=>{if(live)setFailed(true)});return()=>{live=false}},[paper.id,paper.bytes,paper.deleted,visible]);
 return <div ref={node} className={'paper-cover pdf-preview'+(large?' large':'')} aria-hidden="true" data-preview={value?'ready':failed?'failed':'loading'}>{value?<img src={value.uri} alt="" draggable={false}/>:<div className="preview-placeholder"><FileText size={large?32:22}/><small>{paper.deleted?'已回收':failed?'预览不可用':'PDF 首页'}</small></div>}</div>
}
