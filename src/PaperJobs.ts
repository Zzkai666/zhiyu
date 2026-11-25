import{useSyncExternalStore}from'react';
import{api,message,type Paper}from'./api';
import{loadPDF,pdfGlyphs,pageImage}from'./pdf';
import{recordPageCount}from'./PaperPreview';
import{readingRegions,isParagraph,type ReadingPlan,type Located}from'./ReadingRegions';
import{paragraphFlow}from'./layout';
import{translateStream}from'./TranslationStream';
import type {TranslationChoice} from './TranslationSettings';
export type PaperJob={paperId:string;title:string;stage:'parse'|'translate';state:'queued'|'running'|'paused'|'failed'|'done';done:number;total:number;message:string;payload:TranslationRequest;token?:string;revision:number;updatedAt:string};
export type TranslationRequest={scope:'paper'|'page'|'one';page:number;group?:string;model:string;effort:string;revision:number;reviewTotal?:number}&Partial<Pick<TranslationChoice,'connection'|'connectionRevision'>>;
let ready=false;
let snapshot:{jobs:PaperJob[];error:string}={jobs:[],error:''},timer:ReturnType<typeof setInterval>|undefined,polling=false;
const listeners=new Set<()=>void>(),workers=new Map<string,AbortController>();
const notify=()=>listeners.forEach(f=>f());
function publish(jobs:PaperJob[],error=''){snapshot={jobs,error};notify();void window.desktop.paperJobsActive(jobs.some(j=>j.state==='queued'||j.state==='running')).catch(()=>{});}
export function usePaperJobs(){return useSyncExternalStore(f=>{listeners.add(f);return()=>{listeners.delete(f)}},()=>snapshot)}
export function hasActivePaperJobs(){return snapshot.jobs.some(j=>j.state==='queued'||j.state==='running')}
const key=(j:PaperJob)=>j.paperId+'/'+j.stage;
async function action(j:Pick<PaperJob,'paperId'|'stage'>,body:unknown){const next=await api<PaperJob>('/papers/'+j.paperId+'/jobs/'+j.stage,'POST',body);publish([...snapshot.jobs.filter(v=>key(v)!==key(next)),next]);return next}
export async function controlPaperJob(j:PaperJob,which:'pause'|'resume'|'start'){
 for(let attempt=0;attempt<2;attempt++){const jobs=await api<PaperJob[]>('/paper-jobs'),latest=jobs.find(v=>key(v)===key(j))||j;
 try{const result=await action(latest,{action:which,revision:latest.revision});if(which==='pause')workers.get(key(j))?.abort();void poll();return result}catch(e){if(attempt||!(e instanceof Error)||!e.message.includes('状态已变化'))throw e}}
}
export async function startPaperTranslation(paperId:string,payload:TranslationRequest){const j=await action({paperId,stage:'translate'},{action:'start',payload});void poll();return j}
export async function retryPaperParse(paperId:string){const j=snapshot.jobs.find(j=>j.paperId===paperId&&j.stage==='parse');if(j&&(j.state==='failed'||j.state==='paused'))return controlPaperJob(j,'resume');const next=await action({paperId,stage:'parse'},{action:'start'});void poll();return next}
function check(signal:AbortSignal){if(signal.aborted)throw new DOMException('任务已暂停','AbortError')}
async function parse(j:PaperJob,signal:AbortSignal,progress:(done:number,total:number,note:string)=>Promise<void>){
 const papers=await api<Paper[]>('/papers'),paper=papers.find(p=>p.id===j.paperId&&!p.deleted);if(!paper)throw Error('论文已移入回收站');
 const base='/papers/'+paper.id,task=loadPDF(paper.id);task.onPassword=()=>{void task.destroy()};
 const cancel=()=>void task.destroy();signal.addEventListener('abort',cancel,{once:true});
 try{const doc=await task.promise;check(signal);await recordPageCount(paper,doc.numPages);let plan=await api<ReadingPlan>(base+'/reading');
 let author=paper.authors;if(!author)try{const m=await doc.getMetadata();const a=(m.info as{Author?:string}).Author;if(typeof a==='string')author=a}catch{}
 const layout=await window.desktop.layoutReady(),suffix=layout?'':' · 轻量文字解析（版面模型未配置）';
 await progress(plan.pages.length,doc.numPages,'正在解析'+suffix);
 for(let n=1;n<=doc.numPages;n++){check(signal);if(plan.pages.includes(n))continue;
 const source=await doc.getPage(n),glyphs=await pdfGlyphs(source);check(signal);
 const detections=layout?await window.desktop.detectLayout(await pageImage(source)):[];check(signal);
 const view=source.getViewport({scale:1});await api(base+'/reading/pages/'+n,'PUT',readingRegions(glyphs,detections,n,author,view.height/view.width),signal);plan.pages.push(n);await progress(plan.pages.length,doc.numPages,'正在解析 · '+plan.pages.length+' / '+doc.numPages+' 页'+suffix);
 await new Promise(r=>setTimeout(r,0));}
 plan=await api<ReadingPlan>(base+'/reading');const missing=new Map<number,Located['region'][]>();
 for(const g of plan.groups)for(const r of g.regions)if(isParagraph(r.kind)&&!r.flow){const rows=missing.get(r.page)||[];rows.push(r);missing.set(r.page,rows)}
 for(const[n,regions]of missing){check(signal);const source=await doc.getPage(n),glyphs=await pdfGlyphs(source),view=source.getViewport({scale:1});check(signal);
 await api(base+'/reading/pages/'+n+'/flow','PUT',regions.map(r=>({id:r.id,rect:r.rect,flow:paragraphFlow(glyphs,r.rect,view.height/view.width)})),signal);}
 check(signal);return{done:doc.numPages,total:doc.numPages,message:'解析完成，等待你核对'+suffix};
 }finally{signal.removeEventListener('abort',cancel);await task.destroy().catch(()=>{})}
}
async function run(initial:PaperJob){
 const controller=new AbortController(),id=key(initial);workers.set(id,controller);let j=initial,done=initial.done,total=initial.total;
 const progress=async(d:number,t:number,note:string)=>{check(controller.signal);done=d;total=t;j=await action(j,{action:'progress',token:j.token,done:d,total:t,message:note})};
 try{j=await action(j,{action:'claim'});check(controller.signal);
 if(j.stage==='parse'){const result=await parse(j,controller.signal,progress);await action(j,{action:'complete',token:j.token,...result})}
 else{await translateStream('/papers/'+j.paperId+'/reading/translate-batches',j.payload,controller.signal,async e=>{
  if(e.kind==='start')await progress(0,e.total,'正在翻译 · '+e.batches+' 批 / '+e.total+' 段');
  else if(e.kind==='batch'||e.kind==='done')await progress(e.done||0,e.total,e.kind==='done'?'翻译完成':'已保存 '+(e.done||0)+' / '+e.total+' 段 · '+e.batch+' / '+e.batches+' 批');
 });check(controller.signal);await action(j,{action:'complete',token:j.token,done,total,message:'翻译完成，已保存 '+done+' 段'})}
 }catch(e){if(!controller.signal.aborted&&j.token)await action(j,{action:'fail',token:j.token,done,total,message:message(e).slice(0,1800)}).catch(()=>{})}
 finally{workers.delete(id);void poll()}
}
async function poll(){if(!timer||polling||!ready)return;polling=true;try{const jobs=await api<PaperJob[]>('/paper-jobs');publish(jobs);
 for(const stage of['parse','translate']as const){if([...workers.keys()].some(k=>k.endsWith('/'+stage)))continue;const next=jobs.find(j=>j.stage===stage&&j.state==='queued');if(next)void run(next)}
 }catch(e){publish(snapshot.jobs,message(e))}finally{polling=false}}
export function startPaperJobs(){if(timer)return()=>{};const tick=async()=>{if(!ready){if(polling)return;polling=true;try{await api('/paper-jobs/recover','POST',{});ready=true}catch(e){publish(snapshot.jobs,message(e))}finally{polling=false}}if(timer)await poll()};timer=setInterval(()=>void tick(),1200);void tick();return()=>{clearInterval(timer);timer=undefined;ready=false;workers.forEach(c=>c.abort());workers.clear()}}
