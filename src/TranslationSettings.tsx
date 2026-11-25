import { useEffect, useState } from 'react';
import { api, message } from './api';
import { CodexConnectionSettings } from './CodexConnection';
import type { CodexModel } from './ReadingRegions';
import { Modal } from './ui';

export type TranslationChoice = { connection: string; connectionRevision: number; model: string; effort: string };
type Connection = {
  id: string; name: string; kind: 'codex' | 'harness' | 'buddy' | 'api';
  revision: number; baseURL?: string; hasKey?: boolean;
};
type APIForm = { id: string; name: string; baseURL: string; key: string; revision: number; clearKey: boolean };

const choiceKey = 'rdnext.translation.choice';
const connectionProfiles = 'rdnext.translation.connection-profiles';
const strength: Record<string,string> = { none:'无', minimal:'极低', low:'低', medium:'中', high:'高', xhigh:'很高', max:'最大', ultra:'极高' };

export function readTranslationChoice(): TranslationChoice {
  try {
    const saved = JSON.parse(localStorage.getItem(choiceKey) || 'null');
    if (saved && typeof saved.connection === 'string' && Number.isInteger(saved.connectionRevision) &&
      typeof saved.model === 'string' && typeof saved.effort === 'string') return saved;
    return {
      connection:'codex', connectionRevision:0, model:localStorage.getItem('rdnext.translation.model') || '',
      effort:localStorage.getItem('rdnext.translation.effort') || '',
    };
  } catch {
    return { connection:'codex', connectionRevision:0, model:'', effort:'' };
  }
}

function readSavedProfile(id: string): Pick<TranslationChoice,'model'|'effort'> | undefined {
  try {
    const profile=JSON.parse(localStorage.getItem(connectionProfiles) || '{}')[id];
    if(typeof profile?.model==='string' && typeof profile?.effort==='string')return profile;
  } catch { /* An invalid preference is replaced when a choice is saved. */ }
}

function connectionDraft(existing?: Connection): APIForm {
  return { id:existing?.id || '', name:existing?.name || '', baseURL:existing?.baseURL || '', key:'', clearKey:false, revision:existing?.revision || 0 };
}

export function TranslationSettings({initial, close, save}: {
  initial: TranslationChoice; close: () => void; save: (choice: TranslationChoice) => void;
}) {
  const [connections,setConnections] = useState<Connection[]>([]);
  const [choice,setChoice] = useState(initial);
  const [models,setModels] = useState<CodexModel[]>([]);
  const [manual,setManual] = useState(false);
  const [customEffort,setCustomEffort] = useState(false);
  const [editor,setEditor] = useState<APIForm>();
  const [busy,setBusy] = useState('');
  const [error,setError] = useState('');
  const [checked,setChecked] = useState<string|null>(null);
  const [loginOpened,setLoginOpened] = useState(false);
  const connected = connections.find(item => item.id === choice.connection);
  const model = models.find(item => item.id === choice.model);
  const efforts = model?.efforts.length ? model.efforts :
    (connected?.kind==='api' && customEffort || connected?.kind==='codex' && manual) ? Object.keys(strength) : [];

  async function readModels(next: TranslationChoice) {
    setBusy('正在读取模型…'); setError(''); setChecked(null); setLoginOpened(false);
    try {
      const query = new URLSearchParams({connection:next.connection, revision:String(next.connectionRevision), model:next.model});
      const rows = await api<CodexModel[]>('/translation/models?' + query);
      setModels(rows);
      const selected = rows.find(row => row.id === next.model) || (!next.model ? rows[0] : undefined);
      setManual(!selected && next.connection !== 'harness');
      const legacyManual = !selected && next.connection === 'codex';
      const keepEffort = next.connection.startsWith('api-') || legacyManual || selected?.efforts.includes(next.effort);
      setChoice({...next, model:selected?.id || next.model, effort:keepEffort ? next.effort : next.connection==='codex' ? selected?.defaultEffort || selected?.efforts[0] || '' : ''});
      if (next.connection==='codex') window.dispatchEvent(new Event('rdnext:codex-catalog'));
      if (!rows.length && next.connection==='harness') setError('Harness 没有返回可选模型，请检查模型配置。');
    } catch (err) {
      setModels([]); setManual(next.connection==='api'||next.connection==='codex'); setError(message(err));
    } finally { setBusy(''); }
  }

  useEffect(() => {
    void (async () => {
      setBusy('正在读取翻译连接…');
      try {
        const rows=await api<Connection[]>('/translation/connections');
        setConnections(rows);
        const selected=rows.find(item=>item.id===initial.connection) || rows[0];
        const next=selected.id===initial.connection ? {...initial,connectionRevision:selected.revision} :
          {connection:selected.id,connectionRevision:selected.revision,model:'',effort:''};
        setChoice(next);
        setCustomEffort(selected.kind==='api' && Boolean(next.effort));
        await readModels(next);
      } catch (err) { setError(message(err)); setBusy(''); }
    })();
  }, []);

  function selectConnection(value: string) {
    const next=connections.find(item=>item.id===value);
    if (!next) return;
    setEditor(undefined); setModels([]); setCustomEffort(false);
    const remembered=readSavedProfile(next.id);
    const selected=next.id===initial.connection?initial:remembered|| (next.id==='codex'?{
      model:localStorage.getItem('rdnext.translation.model') || '', effort:localStorage.getItem('rdnext.translation.effort') || '',
    }:{model:'',effort:''});
    const updated={...selected,connection:next.id,connectionRevision:next.revision};
    setChoice(updated);
    setCustomEffort(next.kind==='api' && Boolean(updated.effort));
    void readModels(updated);
  }

  function chooseModel(value: string) {
    const selected=models.find(row=>row.id===value);
    const effort=choice.connection==='codex'?selected?.defaultEffort || '':
      choice.connection==='buddy'&&selected?.efforts.includes(choice.effort)?choice.effort:'';
    const next={...choice,model:value,effort};
    setChecked(null); setChoice(next);
    if (choice.connection==='harness') void readModels(next);
  }

  async function saveAPI(value: APIForm) {
    setBusy('正在保存 API 连接…'); setError('');
    try {
      const saved=await api<Connection>('/translation/connections','POST',value);
      setConnections(previous=>[...previous.filter(item=>item.id!==saved.id),saved]);
      setEditor(undefined); setModels([]); setCustomEffort(false);
      const next={connection:saved.id,connectionRevision:saved.revision,model:saved.id===choice.connection?choice.model:'',effort:''};
      setChoice(next);
      await readModels(next);
    } catch (err) { setError(message(err)); setBusy(''); }
  }

  async function showBuddyLogin() {
    setBusy('正在打开腾讯登录…'); setError(''); setLoginOpened(false);
    try {
      await window.desktop.openBuddyLogin();
      setLoginOpened(true);
    } catch (err) { setError(message(err)); }
    finally { setBusy(''); }
  }

  async function test() {
    setBusy('正在检查模型连接…'); setError(''); setChecked(null);
    try {
      const query=new URLSearchParams({connection:choice.connection,revision:String(choice.connectionRevision),model:choice.model.trim()});
      const catalog=await api<CodexModel[]>('/translation/models?'+query);
      setModels(catalog);setLoginOpened(false);
      const available=catalog.some(option=>option.id===choice.model.trim());
      setChecked(available?'连接正常，已读取所选模型。':'连接可访问，所选模型未出现在返回的列表中。');
    } catch (err) { setError(message(err)); }
    finally { setBusy(''); }
  }

  function submit() {
    try {
      const next={...choice,model:choice.model.trim()};
      localStorage.setItem(choiceKey,JSON.stringify(next));
      const profiles=JSON.parse(localStorage.getItem(connectionProfiles) || '{}');
      localStorage.setItem(connectionProfiles,JSON.stringify({...profiles,[next.connection]:{model:next.model,effort:next.effort}}));
      if(next.connection==='codex'){
        localStorage.setItem('rdnext.translation.model',next.model);
        localStorage.setItem('rdnext.translation.effort',next.effort);
      }
      save(next);
    } catch(err){setError(message(err))}
  }
  const valid=Boolean(connected && choice.model.trim() && (model || manual) && !busy);

  return <Modal title="翻译设置" close={close}>
    <div className="form">
      <label>翻译连接<select aria-label="翻译连接" value={choice.connection} disabled={Boolean(busy)||!connections.length} onChange={e=>selectConnection(e.target.value)}>
        {connections.map(option=><option key={option.id} value={option.id}>{option.name}</option>)}
      </select></label>
      <div className="codex-connection-actions">
        <button className="secondary" type="button" disabled={Boolean(busy)} onClick={()=>{setEditor(connectionDraft());setError('');setChecked(null)}}>添加 API 连接</button>
        {connected?.kind==='api'&&<button className="quiet" type="button" disabled={Boolean(busy)} onClick={()=>setEditor(connectionDraft(connected))}>编辑 API 连接</button>}
      </div>
      {editor ? <form className="form codex-source" onSubmit={e=>{e.preventDefault();void saveAPI(editor)}}>
        <label>连接名称<input required maxLength={64} value={editor.name} onChange={e=>setEditor({...editor,name:e.target.value})}/></label>
        <label>API 基础地址<input required value={editor.baseURL} placeholder="https://api.example.com/v1" onChange={e=>setEditor({...editor,baseURL:e.target.value})}/></label>
        <label>API 密钥<input type="password" autoComplete="off" disabled={editor.clearKey} value={editor.key}
          placeholder={editor.id && connected?.hasKey?'留空保留已保存的密钥':'本机服务可留空'} onChange={e=>setEditor({...editor,key:e.target.value})}/></label>
        {editor.id && connected?.hasKey && <label className="codex-manual-toggle"><input type="checkbox" checked={editor.clearKey}
          onChange={e=>setEditor({...editor,clearKey:e.target.checked,key:''})}/>清除已保存的密钥</label>}
        <div className="form-actions">
          <button type="button" className="quiet" disabled={Boolean(busy)} onClick={()=>setEditor(undefined)}>取消</button>
          <button type="submit" className="primary" disabled={Boolean(busy)}>保存 API 连接</button>
        </div>
      </form> : <>
        {connected?.kind==='codex'&&<CodexConnectionSettings refresh={()=>void readModels(choice)}/>}
        {connected?.kind==='harness'&&<p className="quiet-text">使用本机 DeepSeek Harness 的 ACP 会话和已配置的模型。</p>}
        {connected?.kind==='buddy'&&<div className="codex-source">
          <small>{models.length?`已读取 CodeBuddy 的 ${models.length - 1} 个模型`:'使用与 WorkBuddy 相同的腾讯账号登录 CodeBuddy。'}</small>
          <div className="codex-connection-actions">
            <button className="secondary" type="button" disabled={Boolean(busy)} onClick={()=>void showBuddyLogin()}>打开登录终端</button>
            <button className="quiet" type="button" onClick={()=>void window.desktop.openExternal('https://www.codebuddy.cn/docs/cli/installation').catch(err=>setError(message(err)))}>官方安装说明</button>
          </div>
          {loginOpened&&<small role="status">在登录终端完成腾讯授权后，点击检查连接。</small>}
        </div>}
        {connected?.kind==='api'&&<p className="quiet-text">{connected.baseURL} · {connected.hasKey?'密钥已保存':'未配置密钥'}</p>}
        {connected && connected.kind!=='harness'&&(connected.kind!=='buddy'||models.length>0)&&<label className="codex-manual-toggle">
          <input type="checkbox" checked={manual} disabled={Boolean(busy)} onChange={e=>{setManual(e.target.checked);setChecked(null)}}/>手动填写模型 ID</label>}
        {manual ? <label>模型 ID<input aria-label="模型 ID" value={choice.model} maxLength={200} disabled={Boolean(busy)} onChange={e=>chooseModel(e.target.value)}/></label> :
          <label>模型<select aria-label="模型" value={choice.model} disabled={Boolean(busy)||!models.length} onChange={e=>chooseModel(e.target.value)}>
            <option value="" disabled>选择模型</option>{models.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}
          </select></label>}
        {connected?.kind==='api'&&<label className="codex-manual-toggle"><input type="checkbox" checked={customEffort} disabled={Boolean(busy)}
          onChange={e=>{setCustomEffort(e.target.checked);setChoice({...choice,effort:''});setChecked(null)}}/>此 API 支持思考强度参数</label>}
        <label>思考强度<select aria-label="思考强度" value={choice.effort} disabled={Boolean(busy)||!efforts.length} onChange={e=>{setChoice({...choice,effort:e.target.value});setChecked(null)}}>
          <option value="">模型默认</option>{efforts.map(value=><option key={value} value={value}>{strength[value]||value}</option>)}
        </select></label>
        {connected?.kind==='buddy'&&models.length>0&&!efforts.length&&<small className="quiet-text">{choice.model==='@default'?'选定具体模型后可查看支持的思考档位。':'CodeBuddy 暂未提供这个模型的思考档位。'}</small>}
        <div className="form-actions">
          <button className="secondary" type="button" disabled={Boolean(busy)||!connected} onClick={()=>void readModels(choice)}>{connected?.kind==='buddy'?'刷新模型列表':'重新读取'}</button>
          <button className="secondary" type="button" disabled={!valid} onClick={()=>void test()}>检查连接</button>
          <button className="primary" type="button" disabled={!valid} onClick={submit}>保存翻译设置</button>
        </div>
      </>}
      {busy&&<p className="quiet-text" role="status">{busy}</p>}
      {error&&<p className="error" role="alert">{error}</p>}
      {checked&&<p className="quiet-text" role="status">{checked}</p>}
    </div>
  </Modal>;
}
