export type StageSummary={revision:number;pending:number;confirmed:number;total:number;saved:number};
type Job={state:string;done:number;total:number};
export function translationStage(summary:StageSummary|undefined,job:Job|undefined,parsed:boolean){
 const complete=parsed&&Boolean(summary&&summary.total>0&&summary.saved===summary.total);
 const progress=summary?.total?Math.min(100,Math.max(0,summary.saved/summary.total*100)):job?.total?Math.min(100,job.done/job.total*100):0;
 const label=complete?'已完成':job?.state==='paused'?'已暂停':job?.state==='failed'?'未完成':job?.state==='done'?'待补译':summary?.saved?summary.saved+' / '+summary.total+' 段':job?.total?job.done+' / '+job.total+' 段':job?'等待翻译':'未开始';
 return {complete,progress,label,state:complete?'done':job?.state==='done'?'review':job?.state||'waiting'};
}
