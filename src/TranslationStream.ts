export type TranslationEvent={kind:'start'|'batch'|'done'|'error'|'heartbeat';done?:number;total:number;batch?:number;batches?:number;message?:string};
export async function translateStream(path:string,payload:unknown,signal:AbortSignal,progress:(event:TranslationEvent)=>Promise<void>) {
  const response=await fetch('/api'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal});
  if(!response.ok){const data=await response.json();throw new Error(data.error||'翻译未能开始')}
  if(!response.body)throw new Error('翻译连接未返回进度');
  const reader=response.body.getReader(),decoder=new TextDecoder();
  let buffer='',finished=false;
  try{
    while(true){
      const part=await reader.read();buffer+=decoder.decode(part.value,{stream:!part.done});
      const lines=buffer.split('\n');buffer=lines.pop()||'';
      if(part.done&&buffer.trim()){lines.push(buffer);buffer=''}
      for(const line of lines){
        if(!line.trim())continue;
        const event=JSON.parse(line) as TranslationEvent;
        if(event.kind==='heartbeat')continue;
        if(event.kind==='error')throw new Error(event.message||'本批翻译未完成，已保存批次仍可继续使用');
        await progress(event);if(event.kind==='done')finished=true;
      }
      if(part.done)break;
    }
    if(!finished)throw new Error('翻译连接已中断，已保存批次保留；可以继续翻译');
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock()}
}
