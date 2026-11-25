import {useEffect, useRef, useState} from 'react';
import {api, message} from './api';
import {usePaperJobs, controlPaperJob, type PaperJob} from './PaperJobs';
import {translationStage, type StageSummary as Summary} from './paper-stage';

export function publishReadingSummary(paperId: string, plan: {
 revision: number;
 review: unknown[];
 confirmedReview: unknown[];
 groups: {translate: boolean; translation?: string}[];
}) {
 const translatable = plan.groups.filter(group => group.translate);
 window.dispatchEvent(new CustomEvent('rdnext:paper-summary', {detail: {
  paperId,
  summary: {
   revision: plan.revision,
   pending: (plan.review || []).length,
   confirmed: (plan.confirmedReview || []).length,
   total: translatable.length,
   saved: translatable.filter(group => group.translation).length,
  },
 }}));
}

function isActive(job: PaperJob) {
 return job.state === 'queued' || job.state === 'running';
}

export function PaperProcessingStatus({paperId, review}: {paperId: string; review: () => void}) {
 const {jobs} = usePaperJobs();
 const parse = jobs.find(job => job.paperId === paperId && job.stage === 'parse');
 const translate = jobs.find(job => job.paperId === paperId && job.stage === 'translate');
 const [summary, setSummary] = useState<Summary>();
 const [summaryError, setSummaryError] = useState('');
 const [controlError, setControlError] = useState('');
 const [busy, setBusy] = useState(false);
 const [visible, setVisible] = useState(false);
 const anchor = useRef<HTMLSpanElement>(null);

 useEffect(() => {
  const row = anchor.current?.closest('[data-paper-id]');
  if (!row) return;
  const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {rootMargin: '80px'});
  observer.observe(row);
  return () => observer.disconnect();
 }, []);

 useEffect(() => {
  const receive = (event: Event) => {
   const {paperId: id, summary: updated} = (event as CustomEvent<{paperId: string; summary: Summary}>).detail;
   if (id === paperId) setSummary(current => !current || updated.revision >= current.revision ? updated : current);
  };
  window.addEventListener('rdnext:paper-summary', receive);
  return () => window.removeEventListener('rdnext:paper-summary', receive);
 }, [paperId]);

 useEffect(() => {
  if (!visible || parse?.state !== 'done') return;
  const controller = new AbortController();
  void api<Summary>('/papers/' + paperId + '/stage-summary', 'GET', undefined, controller.signal)
   .then(updated => {
    if (controller.signal.aborted) return;
    setSummaryError('');
    setSummary(current => !current || updated.revision >= current.revision ? updated : current);
   })
   .catch(error => {
    if (!controller.signal.aborted) setSummaryError(message(error));
   });
  return () => controller.abort();
 }, [visible, parse?.state, parse?.revision, translate?.revision, paperId]);

 async function control(job: PaperJob, action: 'pause' | 'resume') {
  setBusy(true);
  setControlError('');
  try { await controlPaperJob(job, action); }
  catch (error) { setControlError(message(error)); }
  finally { setBusy(false); }
 }

 const translation = translationStage(summary, translate, parse?.state === 'done');
 const currentJob = translate && translate.state !== 'done' ? translate
  : parse && parse.state !== 'done' ? parse : undefined;
 let status;

 if (currentJob) {
  const translating = currentJob.stage === 'translate';
  const name = translating ? '翻译' : '解析';
  const active = isActive(currentJob);
  const failed = currentJob.state === 'failed';
  const total = translating && summary ? summary.total : currentJob.total;
  const done = translating && summary ? summary.saved : currentJob.done;
  const progress = total > 0 ? Math.min(100, done / total * 100) : undefined;
  const label = failed ? name + '未完成' : currentJob.state === 'paused' ? name + '已暂停'
   : currentJob.state === 'queued' ? '等待' + name : '正在' + name;
  status = <div className="paper-processing" data-state={currentJob.state}>
   <div className="paper-process-line">
    <span className="paper-process-label">{label}</span>
    {total > 0 && <span className="paper-process-count">{done} / {total} {translating ? '段' : '页'}</span>}
    {(total > 0 || currentJob.state === 'running') && <progress aria-label={name + '进度'} max={100} value={progress}/>}
    <button className="paper-process-action" disabled={busy} onClick={() => void control(currentJob, active ? 'pause' : 'resume')}>
     {(active ? '暂停' : failed ? '重试' : '继续') + name}
    </button>
   </div>
   {(controlError || failed) && <p className="paper-process-error" role="alert">{controlError || currentJob.message}</p>}
  </div>;
 } else if (!translation.complete && summary) {
  const verified = !summary.pending && Boolean(summary.confirmed || parse?.payload.reviewTotal);
  const needsMore = !summary.pending && Boolean(summary.saved || translate?.state === 'done');
  status = <div className="paper-processing" data-state="review">
   <div className="paper-process-line">
    <span className="paper-process-label">{needsMore ? '待补译' : verified ? '待翻译' : '待核对解析结果'}</span>
    {summary.pending > 0 && <span className="paper-process-count">{summary.pending} 项</span>}
    <button className="paper-process-action" onClick={review}>{verified || needsMore ? '去翻译' : '去核对'}</button>
   </div>
  </div>;
 } else if (!translation.complete && summaryError) {
  status = <div className="paper-processing" data-state="failed">
   <p className="paper-process-error" role="alert">无法读取处理状态。{summaryError}</p>
   <button className="paper-process-action" onClick={review}>查看解析</button>
  </div>;
 }

 return <><span ref={anchor} hidden/>{status}</>;
}
