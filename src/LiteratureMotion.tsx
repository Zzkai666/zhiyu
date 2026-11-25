import {
  ArrowDownToLine, ArrowRight, Check, ChevronDown, FileText, Highlighter, Link2,
  MessageSquare, MousePointer2, ScanLine, Sparkles, UploadCloud,
} from 'lucide-react';
import type { ReactNode } from 'react';
import './literature-motion.css';

function Paper({title,children,className=''}:{title:string;children?:ReactNode;className?:string}) {
  return <div className={'motion-paper '+className}>
    <div className="motion-paper-heading"><FileText/><b>{title}</b></div>
    {children}
  </div>;
}

function TextLines({short=false}:{short?:boolean}) {
  return <div className="motion-lines"><i/><i/><i className={short?'short':''}/></div>;
}

function ImportScene() {
  return <>
    <div className="motion-import-target">
      <div className="motion-import-prompt motion-before"><div className="motion-drop-ring"><UploadCloud/></div><b>导入论文</b><small>选择 PDF 文件</small></div>
      <div className="motion-import-synced motion-after"><div className="motion-drop-ring"><Check/></div><b>已加入文献库</b><small>示例论文.pdf</small></div>
    </div>
    <div className="motion-file">
      <FileText/><div><b>示例论文.pdf</b><small>学习与评估方法</small></div>
    </div>
  </>;
}

function ParseScene() {
  return <>
    <Paper title="论文原页" className="motion-source-sheet">
      <TextLines/><TextLines short/><TextLines/>
      <i className="motion-scan-line"/>
    </Paper>
    <div className="motion-process-card">
      <div className="motion-item-head"><ScanLine/><b>版面解析</b></div>
      <small>提取正文 · 识别区块</small>
      <div className="motion-meter"><span/></div>
      <div className="motion-state"><span className="motion-before">正在后台解析</span><span className="motion-after"><Check/> 待核对解析结果</span></div>
      <span className="motion-action motion-reveal">去核对 <ArrowRight/></span>
    </div>
  </>;
}

function LabelsScene() {
  return <>
    <Paper title="论文原页" className="motion-labelled-paper">
      <TextLines short/>
      <div className="motion-labelled-line">
        Correspondence to: author@example.org
        <span className="motion-chip motion-before">正文段落 · 译</span>
        <span className="motion-chip motion-after">作者 · 原</span>
      </div>
      <TextLines/>
    </Paper>
    <div className="motion-choice-card motion-label-choices">
      <b>改标签</b>
      <div className="motion-field">区块类别 <ChevronDown/></div>
      <div className="motion-options"><span>正文段落</span><span className="motion-option-selected">作者 <Check/></span><span>页眉页脚</span></div>
      <span className="motion-action">保存更正</span>
    </div>
  </>;
}

function SeamScene() {
  return <>
    <div className="motion-seam-top"><span>前一块结尾</span><p>We train on demonstrations</p></div>
    <div className="motion-seam-bottom"><span>后一块开头</span><p>and evaluate on unseen tasks.</p></div>
    <i className="motion-join-glow"/>
    <span className="motion-note motion-seam-note">
      <Link2/><span className="motion-before">连接两块</span><span className="motion-after">已连接为一段</span>
    </span>
  </>;
}

function ModelScene() {
  return <div className="motion-choice-card motion-model-choices">
    <b><Sparkles/> 翻译设置</b>
    <div className="motion-field">翻译连接 <strong>腾讯 Buddy</strong></div>
    <div className="motion-field">模型 <strong className="motion-model-name">DeepSeek-V4.1-Flash <ChevronDown/></strong></div>
    <div className="motion-options"><span>账号默认模型</span><span className="motion-option-selected">DeepSeek-V4.1-Flash <Check/></span></div>
    <div className="motion-field">思考强度 <strong className="motion-model-effort">低 <ChevronDown/></strong></div>
    <span className="motion-action motion-save-choice">
      <span className="motion-before">保存翻译设置</span><span className="motion-after"><Check/> 设置已保存</span>
    </span>
  </div>;
}

function TranslateScene() {
  return <>
    <div className="motion-translate-launch"><Sparkles/><b>翻译全文</b><span>核对已完成</span></div>
    <div className="motion-process-card motion-translate-card">
      <div className="motion-item-head"><FileText/><b>学习与评估方法</b></div>
      <div className="motion-state"><span className="motion-before">正在后台翻译</span><span className="motion-after"><Check/> 全文翻译完成</span></div>
      <div className="motion-meter"><span/></div>
    </div>
  </>;
}

function BilingualScene() {
  return <>
    <Paper title="原文" className="motion-original">
      <TextLines short/>
      <p className="motion-match motion-match-source">We learn from demonstrations and test the policy on unseen tasks.</p>
      <TextLines/>
    </Paper>
    <Paper title="译文" className="motion-translation">
      <TextLines short/>
      <p className="motion-match motion-match-target">我们从示范中学习，并在未见过的任务上评估策略。</p>
      <TextLines/>
    </Paper>
    <span className="motion-note motion-bilingual-note"><Link2/> 对应原文</span>
  </>;
}

function ExportScene() {
  return <>
    <Paper title="论文原页" className="motion-annotated">
      <TextLines short/>
      <p>Ablation reveals the role of the <mark>visual encoder</mark>.</p>
      <TextLines/>
    </Paper>
    <div className="motion-comment"><MessageSquare/><span>这段解释了视觉编码器的作用。</span></div>
    <span className="motion-note motion-export-note"><ArrowDownToLine/> 导出带标注的 PDF</span>
    <span className="motion-export-pen"><Highlighter/></span>
  </>;
}

const scenes = [ImportScene, ParseScene, LabelsScene, SeamScene, ModelScene, TranslateScene, BilingualScene, ExportScene];

export function LiteratureMotion({step}:{step:number}) {
  const Scene=scenes[step];
  return <div className="motion-stage" data-chapter={step} aria-hidden="true">
    <Scene/>
    <span className="motion-pointer"><MousePointer2/></span>
  </div>;
}
