import {startPaperJobs,hasActivePaperJobs} from './PaperJobs';
import './paper-jobs.css';
import {BrandIcon} from './Brand';
import {SettingsPage} from './SettingsPage';
import {mergePaper} from './mergePaper';
import {allowRemarkLeave} from './LibraryControls';
import {HelpPage} from './WorkbenchSettings';
import {LiteratureGuide,markLiteratureGuideSeen,shouldOfferLiteratureGuide} from './LiteratureGuide';
import {DailyPlanner,HomeToday,PlannerEditor} from './DailyPlanner';
import {CompanionSettings,FocusDesk,type ResearchSource,type WorkspaceAction} from './Companion';
import { enrichMetadata } from './PaperMetadata';
import { ReadingColorSettings } from './ReadingColors';
import { Activity, ArrowRight, BookOpen, CalendarDays, CircleHelp, FlaskConical, FolderKanban, GraduationCap, House, LibraryBig, NotebookPen, Search, Settings2, SpellCheck, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api, message, type Note, type Paper, type Word } from './api';
import { Home, Library } from './Library';
import { blankNote, blankWord, NoteEditor, Notes, WordEditor, Words } from './Notes';
import { Reader } from './Reader';
import { AgendaEditor, AgendaRows, Planner, QuickTask, today, type AgendaItem, type Project } from './Agenda';
import { Modal } from './ui';
import { Projects } from './Projects';
import { PaperImport } from './PaperImport';
import { Study } from './Study';
import { Lab } from './Lab';
import { Life } from './Life';

const navigation = [
  { label: '工作台', entries: [{ key: 'home', label: '今日工作台', Icon: House }, { key: 'planner', label: '任务日程', Icon: CalendarDays }, { key: 'projects', label: '目标与项目', Icon: FolderKanban }] },
  { label: '阅读与研究', entries: [{ key: 'library', label: '文献库', Icon: LibraryBig }, { key: 'experiments', label: '实验记录', Icon: FlaskConical }] },
  { label: '学习与生活', entries: [{ key: 'courses', label: '课程学习', Icon: GraduationCap }, { key: 'words', label: '生词与复习', Icon: SpellCheck }, { key: 'life', label: '运动与生活', Icon: Activity }] },
] as const;
type Route = typeof navigation[number]['entries'][number]['key']|'help';

export function App() {
  useEffect(()=>startPaperJobs(),[]);
  const [route, setRoute] = useState<Route>('home');
  const [papers, setPapers] = useState<Paper[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [words, setWords] = useState<Word[]>([]);
  const [startReview,setStartReview]=useState(false);
  const [agenda,setAgenda] = useState<AgendaItem[]>([]);
  const [projects,setProjects] = useState<Project[]>([]);
  const [editingAgenda,setEditingAgenda] = useState<AgendaItem | null>(null);
  const [reader, setReader] = useState<{ id: string; page: number; review?:number; source?:ResearchSource&{token:number} }>();
  const [note, setNote] = useState<Note | null>(null);
  const [word, setWord] = useState<Word | null>(null);
  const [settings, setSettings] = useState(false);
  const [settingsTab,setSettingsTab]=useState('general');
  const help=route==='help';
  const [command, setCommand] = useState(false);
  const [notice, setNotice] = useState('');
  const [loadingError, setLoadingError] = useState('');
  const [workspaceReady,setWorkspaceReady]=useState(false);
  const [offerGuide,setOfferGuide]=useState(shouldOfferLiteratureGuide);
  const [guideOpen,setGuideOpen]=useState(false);
  const guideTrigger=useRef<HTMLElement|null>(null);
  const guideOpensImport=useRef(false);
  const [importing, setImporting] = useState(false);
  const [importOpen,setImportOpen] = useState(false);
  const [importResults, setImportResults] = useState<Awaited<ReturnType<Window['desktop']['importPDF']>> | null>(null);
  const metadataAttempts=useRef(new Set());
  const [metadataTick,setMetadataTick]=useState(0);
  useEffect(()=>{
    if(!papers.length||localStorage.getItem('rdnext.metadata.disabled')==='true')return;
    const pending=papers.find(p=>!p.deleted&&!p.metadata?.status&&!metadataAttempts.current.has(p.id));
    if(!pending)return;
    metadataAttempts.current.add(pending.id);
    void enrichMetadata(pending,localStorage.getItem('rdnext.metadata.offline')!=='true').then(updatePaper).catch(err=>setNotice('元数据提取未完成：'+message(err))).finally(()=>setMetadataTick(n=>n+1));
  },[papers,metadataTick]);
  const returnFocus = useRef<HTMLElement | null>(null);
  const readerPrepare=useRef<(()=>Promise<void>)|null>(null);
  const paper = papers.find(p => p.id === reader?.id);

  useEffect(()=>{const receive=(event:Event)=>{const {id,pages}=(event as CustomEvent<{id:string;pages:number}>).detail;setPapers(rows=>rows.map(p=>p.id===id?{...p,totalPages:pages}:p))};window.addEventListener('rdnext:paper-pages',receive);return()=>window.removeEventListener('rdnext:paper-pages',receive)},[]);

  async function refresh() {
    try {
      const [library, vocabulary, items, projectRows] = await Promise.all([api<Paper[]>('/papers'),api<Word[]>('/words'),api<AgendaItem[]>('/agenda'),api<Project[]>('/projects')]);
      setPapers(library); setWords(vocabulary); setAgenda(items); setProjects(projectRows); setLoadingError(''); setWorkspaceReady(true);
    } catch (err) { setLoadingError(message(err)); }
  }

  useEffect(() => { void refresh();const changed=()=>void refresh();window.addEventListener('workspace-data-changed',changed);return()=>window.removeEventListener('workspace-data-changed',changed); }, []);
  async function openTask(id:string){
    if(document.querySelector('.island-settings[data-dirty="true"],.paper-remark[data-dirty="true"],.annotation-card[data-dirty="true"],.annotation-card[data-busy="true"],.reader[data-busy="true"],.paper-remark[data-busy="true"]')||document.querySelector('[role="dialog"]'))throw Error('请先保存或关闭正在编辑的内容，再打开任务');
    await readerPrepare.current?.();
    const rows=await api<AgendaItem[]>('/agenda');setAgenda(rows);
    const item=rows.find(a=>a.id===id&&!a.deleted);if(!item)throw Error('任务不存在或已移入回收站');
    if(item.paperId){
      const source=await api<ResearchSource>('/research/tasks/'+id+'/source'),library=await api<Paper[]>('/papers');
      setPapers(library);const paper=library.find(p=>p.id===source.paperId&&!p.deleted);
      if(!paper)throw Error('来源论文已移入回收站，请先在文献库恢复');
      setReader({id:paper.id,page:source.page,source:{...source,token:Date.now()}});
      setNotice('任务：'+item.title);
    }else{setRoute('planner');setReader(undefined);setEditingAgenda(item);}
  }
  useEffect(()=>window.desktop.onWorkspaceAction(value=>{
    void (async()=>{
      try{
        if(value.action==='prepare-exit'){
          if(hasActivePaperJobs()&&!window.confirm('后台论文处理仍在进行。完整退出将暂停未完成部分；已保存结果保留。仍要退出知屿吗？'))throw Error('已取消退出，后台任务继续');
          if(document.querySelector('.annotation-card[data-dirty="true"],.annotation-card[data-busy="true"],.reader[data-busy="true"],.paper-remark[data-busy="true"]'))throw Error('请先保存当前编辑，或等待正在进行的操作结束，再退出软件');
          if(document.querySelector('[role="dialog"] form,.island-settings[data-dirty="true"],.paper-remark[data-dirty="true"]')&&!window.confirm('退出会关闭当前编辑窗口。确认已保存需要保留的内容，并退出知屿？'))throw Error('已取消退出，编辑内容仍保留');
          await readerPrepare.current?.();
        }else if(value.action==='open-task'){await openTask(value.body.id||'');}
        else{
          if(document.querySelector('.island-settings[data-dirty="true"],.paper-remark[data-dirty="true"],.annotation-card[data-dirty="true"],.annotation-card[data-busy="true"],.reader[data-busy="true"],.paper-remark[data-busy="true"],[role="dialog"]'))throw Error('请先保存或关闭正在编辑的内容，再从小岛切换');
          await readerPrepare.current?.();
          if(value.action==='open-paper'){
            const library=await api<Paper[]>('/papers');setPapers(library);
            const p=library.find(p=>p.id===value.body.id&&!p.deleted);if(!p)throw Error('论文已移入回收站或无法打开');open(p,p.page);
          }else if(value.action==='open-home'){setReader(undefined);setRoute('home');}
          else if(value.action==='open-settings'){setSettingsTab('island');setSettings(true);}
          else if(value.action==='open-planner'){setSettings(false);setReader(undefined);setRoute('planner');}
          else throw Error('不支持的工作台操作');
        }
        if(['open-task','open-paper','open-home','open-planner'].includes(value.action))setSettings(false);
        window.desktop.workspaceActionResult({id:value.id});
      }catch(err){window.desktop.workspaceActionResult({id:value.id,error:message(err)});setNotice(message(err))}
    })();
  }),[]);
  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && !note && !word && !settings && !editingAgenda && !importOpen && !importResults && !guideOpen) {
        event.preventDefault(); setCommand(value => !value);
      }
    }
    window.addEventListener('keydown',keydown);
    return () => window.removeEventListener('keydown',keydown);
  }, [note,word,settings,help,editingAgenda,importOpen,importResults,guideOpen]);
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(''),5500);
    return () => clearTimeout(id);
  }, [notice]);

  async function importPDF(files?: File[]) {
    if (importing) return false;
    setImporting(true);
    try {
      const results = files ? await importDropped(files) : await window.desktop.importPDF();
      if (results.length) {
        await refresh();
        setRoute('library');
        setImportResults(results);
        return true;
      }
      return false;
    } catch (err) {
      if (!files) throw err;
      setNotice(message(err)); return false;
    }
    finally { setImporting(false); }
  }

  function openGuide() {
    guideTrigger.current=document.activeElement instanceof HTMLElement?document.activeElement:null;
    guideOpensImport.current=false;
    setGuideOpen(true);
  }

  function closeGuide() {
    markLiteratureGuideSeen();
    setOfferGuide(false);
    setGuideOpen(false);
  }

  function afterGuide() {
    if(guideOpensImport.current){
      setImportOpen(true);
      return;
    }
    const trigger=guideTrigger.current;
    (trigger?.isConnected?trigger:document.getElementById('workspace-main'))?.focus();
  }

  function updatePaper(saved: Paper) {
    setPapers(items=>items.map(p=>p.id===saved.id?mergePaper(p,saved):p));
  }

  function updateWord(saved: Word) {
    setWords(previous => previous.some(word=>word.id===saved.id)
      ?previous.map(word=>word.id===saved.id&&word.revision<=saved.revision?saved:word)
      :[...previous,saved]);
  }

  function open(p: Paper, page = p.page, review=false) {
    if (!reader) returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setReader({ id: p.id, page,...(review?{review:Date.now()}:{}) });
  }

  function source(id: string, page: number) {
    const p = papers.find(candidate => candidate.id === id && !candidate.deleted);
    if (p) open(p,page);
    else setNotice('原文在回收站或已无法打开。');
  }

  function saveAgenda(saved:AgendaItem) {
    setAgenda(rows => rows.some(a => a.id === saved.id) ? rows.map(a => a.id === saved.id ? saved : a) : [...rows,saved]);
  }
  const date=today();
  const todayItems=agenda.filter(a=>!a.deleted&&!a.done&&(a.day===date||Boolean(a.deadline)&&a.deadline<=date))
    .toSorted((a,b)=>Number(Boolean(b.deadline)&&b.deadline<date)-Number(Boolean(a.deadline)&&a.deadline<date)||a.start.localeCompare(b.start));
  const dueCount=words.filter(v=>v.meaning.trim()&&Date.parse(v.dueAt)<=Date.now()).length;
  const recentNote=notes.find(n=>!n.deleted);
  const agendaActions = { projects, edit:setEditingAgenda, save:saveAgenda, source, report:setNotice };

  return <div className="app-shell">
    <aside className="app-nav" hidden={Boolean(reader)||settings}>
      <div className="brand"><div className="brand-icon"><BrandIcon/></div><div><strong>知屿</strong><small>阅读、学习与每日安排</small></div></div>
      <button className="nav-search" onClick={() => setCommand(true)}><Search size={16}/>搜索工作台 <kbd>Ctrl K</kbd></button>
      <nav>{navigation.map(group => <section className="nav-group" key={group.label}>
        <h2>{group.label}</h2>{group.entries.map(({ key, label, Icon }) => <button key={key} aria-current={!help && route === key ? 'page' : undefined}
          onClick={() => { if(!allowRemarkLeave())return;setStartReview(false); setRoute(key); setReader(undefined); }}><Icon size={17}/>{label}</button>)}</section>)}</nav>
      <div className="nav-bottom"><button onClick={() => {setSettingsTab('general');setSettings(true)}}><Settings2 size={17}/>设置</button><button aria-current={help?'page':undefined} onClick={() => {if(allowRemarkLeave())setRoute('help')}}><CircleHelp size={17}/>版本与帮助</button></div>
    </aside>
    <a className="skip-link" href="#workspace-main" onClick={event => { event.preventDefault(); document.getElementById('workspace-main')?.focus(); }}>跳到工作区</a>
    <main id="workspace-main" tabIndex={-1} className={settings?'main settings-main':reader ? 'main reader-main' : 'main'}>
      {loadingError && <div className="startup-error" role="alert">暂时无法读取资料库。{loadingError} <button className="secondary" onClick={() => void refresh()}>重新连接</button></div>}
      {!workspaceReady&&!settings&&!help&&!loadingError&&<div className="startup-error quiet-text" role="status">正在读取资料库…</div>}
      {settings&&<SettingsPage close={()=>setSettings(false)} initial={settingsTab} select={setSettingsTab}/>}
      <div hidden={settings} style={{height:reader?'100%':undefined}}>
      {paper && reader ? <Reader key={paper.id + '/' + reader.page} paper={paper} start={reader.page} backLabel={"返回" + navigation.flatMap(group => [...group.entries]).find(entry => entry.key === route)?.label} leave={() => { setReader(undefined); requestAnimationFrame(() => (returnFocus.current?.isConnected ? returnFocus.current : document.getElementById("workspace-main"))?.focus()); }}
        update={updatePaper} addWord={updateWord} report={setNotice} source={reader.source} reviewRequest={reader.review} prepare={readerPrepare}/> : null}
      {(workspaceReady||help)&&<div className="workspace-content" data-page={route} hidden={Boolean(reader)||settings}>
        {route === 'home' ? <HomeToday report={setNotice} open={()=>setRoute('planner')}>{({dates,tasks})=><Home papers={papers} open={open} navigate={()=>setRoute('library')} importPDF={()=>setImportOpen(true)} guide={workspaceReady&&offerGuide&&!papers.length&&!words.length&&!agenda.length&&!projects.length?openGuide:undefined} dates={dates} tasks={tasks} focus={<FocusDesk openTask={id=>void openTask(id).catch(err=>setNotice(message(err)))} report={setNotice}/>} shortcuts={<div className="home-shortcuts">{dueCount>0&&<button className="daily-action" onClick={()=>{setStartReview(true);setRoute('words')}}><SpellCheck size={17}/><span><small>今日复习</small><strong>{dueCount} 个词到期</strong></span><ArrowRight size={15}/></button>}</div>}/>}</HomeToday> :
        route === 'planner' ? <DailyPlanner report={setNotice}/> :
        route === 'projects' ? <Projects projects={projects} rows={agenda} papers={papers} notes={[]}
          openPaper={open} openNote={()=>{}} report={setNotice} editTask={setEditingAgenda} onSave={p => setProjects(rows => [p,...rows.filter(v => v.id !== p.id)])}/> :
        route === 'library' ? <Library papers={papers} open={open} onUpdate={updatePaper} importPDF={() => setImportOpen(true)} dropPDF={files => void importPDF(files)} importing={importing} report={setNotice}/> :
        route === 'words' ? <Words words={words} startReview={startReview} create={() => setWord(blankWord)} edit={setWord} source={source} reviewed={updateWord} report={setNotice}/> :
        route === 'courses' ? <Study papers={papers} source={source}/> :
        route === 'experiments' ? <Lab projects={projects}/> : route==='life'?<Life report={setNotice}/>:<HelpPage importPaper={()=>setImportOpen(true)} library={()=>setRoute('library')} planner={()=>setRoute('planner')} replayGuide={openGuide}/>}
      </div>}
    </div></main>
    {editingAgenda && <PlannerEditor initial={editingAgenda} close={() => setEditingAgenda(null)} saved={saved => {saveAgenda(saved);setEditingAgenda(null);setNotice('安排已保存')}}/>}
    {word && <WordEditor initial={word} close={() => setWord(null)} save={saved => { updateWord(saved); setWord(null); setNotice(word.id?'释义已保存':'生词已收录'); }}/>}
    {notice && <div className="toast" role="status">{notice}<button className="icon" aria-label="关闭通知" onClick={() => setNotice('')}><X size={16}/></button></div>}
    {guideOpen&&<LiteratureGuide close={closeGuide} restoreFocus={afterGuide} importPaper={()=>{
      guideOpensImport.current=true;
      closeGuide();
    }}/>}
    {importOpen && <PaperImport close={()=>setImportOpen(false)} local={()=>importPDF()} drop={files=>importPDF(files)} done={({paper,duplicate})=>{
      setImportOpen(false);setRoute('library');void refresh();
      setImportResults([{filename:paper.title,paper,duplicate}]);
    }}/>}
    {importResults && <Modal title="导入结果" close={() => setImportResults(null)}>
      <div className="import-results">{importResults.map((result,index) => <div key={index}><strong>{result.filename}</strong>
        <span className={result.error ? 'error' : ''}>{result.error || (result.duplicate ? '文献库中已有相同 PDF' : '已导入')}</span></div>)}</div>
      <div className="form-actions"><button className="primary" onClick={() => setImportResults(null)}>完成</button></div>
    </Modal>}
    {command && <Command papers={papers} notes={notes} words={words} close={() => setCommand(false)} open={p => { setCommand(false); open(p); }} edit={n => { setCommand(false); setNote(n); }} showWords={() => { setCommand(false); setReader(undefined); setRoute('words'); }}/>}
    

  </div>;
}

async function importDropped(files:File[]) {
  if (files.length > 100) throw new Error('每批最多导入 100 份 PDF。请分批拖入。');
  const result: Awaited<ReturnType<Window['desktop']['importPDF']>> = [];
  for (const file of files) {
    const filename = file.name;
    try {
      if (!/\.pdf$/i.test(filename)) throw new Error('请选择 PDF 文件');
      if (file.size > 200 * 1024 * 1024) throw new Error('单份 PDF 最大支持 200 MiB');
      const response = await fetch('/api/papers/import', {
        method:'POST',body:file,headers:{ 'Content-Type':'application/pdf','X-Paper-Title':encodeURIComponent(filename) },
      });
      const saved = await response.json();
      if (!response.ok) throw new Error(saved.error || '导入失败');
      result.push({ filename,...saved });
    } catch (error) { result.push({ filename,error:message(error) }); }
  }
  return result;
}

function Command({ papers, notes, words, close, open, edit, showWords }: { papers: Paper[]; notes: Note[]; words: Word[]; close: () => void; open: (p: Paper) => void; edit: (n: Note) => void; showWords: () => void }) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const items = [
    ...papers.filter(p => !p.deleted).map(p => ({ id:p.id,label:p.title, type:'文献', hay:[p.title,p.authors,p.doi,...p.tags].join(' '), action:() => open(p) })),
    ...words.map(v => ({ id:v.id,label:v.term, type:'生词', hay:v.term + ' ' + v.meaning, action:showWords })),
  ].filter(item => q && item.hay.toLowerCase().includes(q)).slice(0,30);
  return <Modal title="搜索工作台" close={close}>
    <input className="command-input" placeholder="搜索文献或生词" aria-label="搜索工作台内容" autoFocus value={query} onChange={e => setQuery(e.target.value)}/>
    <div className="command-list">{items.map(item => <button key={item.id} onClick={item.action}><span>{item.label}</span><small>{item.type}</small></button>)}
      {!items.length && <p className="quiet-text">{q ? '没有匹配结果。' : '输入关键词开始查找。'}</p>}</div>
  </Modal>;
}
