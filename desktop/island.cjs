const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {join}=require('node:path');
const {existsSync}=require('node:fs');
const {mkdir,readFile,writeFile,rename}=require('node:fs/promises');
const {randomBytes}=require('node:crypto');

function installIsland({app,ipcMain,assertSender,coreRequest,resources,workspace,showMain,mainWindow}){
 let child=null,ready=false,stopping=false,timer=null,polling=false,sequence=Promise.resolve(),error='',lastSnapshot=null;
 let settings={enabled:true,keepRunning:true};
 const prefs=join(workspace,'desktop-settings.json'),profile=join(workspace,'island');
 const executable=join(resources,...(app.isPackaged?['bin']:['dist','bin']),'researchdesk-island.exe');
 const pending=new Map(),settingsRequests=new Map();let webOpen=false;
 const launcher=process.env.PORTABLE_EXECUTABLE_FILE||process.execPath;
 const loginArgs=app.isPackaged?[]:[app.getAppPath()];
 const autostart=()=>app.getLoginItemSettings({path:launcher,args:loginArgs}).openAtLogin;
 const send=value=>{if(child&&!child.killed&&child.stdin.writable)child.stdin.write(JSON.stringify(value)+'\n')};
 async function json(path,method='GET',body){
  const response=await coreRequest(path,{method,...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
  const result=await response.json();if(!response.ok)throw Error(result.error||'操作未完成');return result;
 }
 async function poll(){
  if(polling||!child||stopping)return;polling=true;
  try{const now=new Date(),day=[now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-');lastSnapshot=await json('/companion?day='+day);
   const pick=(value,keys)=>Object.fromEntries(keys.map(k=>[k,value[k]]));
   const planner=lastSnapshot.planner;
   const itemKeys=['id','title','day','start','deadline','milestone','repeat','done','revision','seriesId','occurrenceDay','seriesRevision'];
   const data={recent:lastSnapshot.recent&&pick(lastSnapshot.recent,['id','title','page']),tasks:lastSnapshot.tasks.map(a=>pick(a,['id','title','revision'])),focus:lastSnapshot.focus,planner:{day:planner.day,important:planner.important.map(a=>pick(a,itemKeys)),today:planner.today.map(a=>pick(a,itemKeys))},desktop:{enabled:settings.enabled,autostart:autostart()}};
   send({type:'snapshot',data});error='';}
  catch(e){error=e.message;send({type:'result',error:'工作台暂时无法读取，请打开工作台重试'});}
  finally{polling=false;}
 }
 function navigate(action,body){
  const target=mainWindow();if(!target||target.isDestroyed())throw Error('工作台窗口尚未就绪');
  if(action!=='prepare-exit')showMain();
  const id=randomBytes(16).toString('hex');
  return new Promise((resolve,reject)=>{
   const timeout=action==='prepare-exit'?null:setTimeout(()=>{pending.delete(id);reject(Error('工作台尚未响应，请稍后重试'));},12000);
   pending.set(id,{resolve,reject,timeout});target.webContents.send('workspace-action',{id,action,body});
  });
 }
 async function command(value){
  if(value?.type!=='command'||!/^[a-f0-9]{32}$/.test(value.requestId||''))throw Error('小岛命令格式无效');
  const b=value.body||{};let notice='';
  if(value.action==='desktop-autostart'){
   if(typeof b.enabled!=='boolean')throw Error('启动设置无效');
   app.setLoginItemSettings({openAtLogin:b.enabled,path:launcher,args:loginArgs,name:'ResearchDesk Next'});notice=b.enabled?'已启用开机启动':'已关闭开机启动';
  }else if(value.action==='planner-action'){
   await json('/planner/action','POST',{requestId:value.requestId,id:b.id,seriesId:b.seriesId||'',day:b.day||'',revision:b.revision||0,seriesRevision:b.seriesRevision||0,action:b.action});
   notice=b.action==='complete'?'已完成，可在已完成中重开':'已更新待办';
   const target=mainWindow();if(target&&!target.isDestroyed())target.webContents.send('planner-changed');
  }else if(value.action==='focus'){
   const allowed=new Set(['start','pause','resume','stop','finish']);
   if(!allowed.has(b.action))throw Error('不支持的专注操作');
   const payload={requestId:value.requestId,action:b.action,id:b.id,taskId:b.taskId||'',revision:b.revision||0,taskRevision:b.taskRevision||0,minutes:b.minutes||0,result:b.result||'',note:''};
   await json('/focus/command','POST',payload);
   notice=b.action==='finish'?'本次专注已保存':b.action==='start'?'专注已开始':'专注状态已更新';
  }else if(['open-paper','open-task','open-home','open-settings','open-planner'].includes(value.action)){
   if(['open-paper','open-task'].includes(value.action)&&!new RegExp(value.action==='open-paper'?'^[a-f0-9]{64}$':'^[a-f0-9]{32}$').test(b.id||''))throw Error('来源标识无效');
   await navigate(value.action,{id:b.id});
   notice='已在工作台打开';
  }else throw Error('不支持的小岛命令');
  await poll();return notice;
 }
 async function start(){
  if(child)return;if(!existsSync(executable)){error='桌面小岛组件缺失，请重新获取完整版本';return;}
  await mkdir(profile,{recursive:true});stopping=false;error='';
  const active=spawn(executable,[],{stdio:['pipe','pipe','pipe'],windowsHide:true,env:{...process.env,DAOZAI_RESEARCHDESK:'1',DAOZAI_DATA_DIR:profile}});
  child=active;ready=false;
  active.stdin.on('error',()=>{});
  active.stderr.setEncoding('utf8').on('data',s=>process.stderr.write('Island: '+s.slice(0,2000)));
  const lines=createInterface({input:active.stdout});
  lines.on('line',line=>{
   if(line.length>65536){error='小岛通信消息过大';void stop();return}
   let v;try{v=JSON.parse(line)}catch{return}
   if(v.type==='settings-api-result'){const item=settingsRequests.get(v.requestId);if(item){clearTimeout(item.timer);settingsRequests.delete(v.requestId);v.error?item.reject(Error(String(v.error).slice(0,600))):item.resolve(v.data)}return}
   if(v.type==='ready'&&v.protocol===1){ready=true;void poll();return}
   sequence=sequence.then(async()=>{
    try{send({type:'result',requestId:v.requestId,notice:await command(v)})}
    catch(e){send({type:'result',requestId:v.requestId,error:e.message})}
   });
  });
  active.on('error',e=>{error='小岛启动失败：'+e.message});
  active.on('exit',()=>{for(const item of settingsRequests.values()){clearTimeout(item.timer);item.reject(Error('小岛服务已断开，请重试连接'))}settingsRequests.clear();if(child!==active)return;child=null;ready=false;if(timer)clearInterval(timer);timer=null;
   if(!stopping){error='小岛已退出，可在设置中重新启动';showMain();}
  });
  timer=setInterval(()=>void poll(),1000);timer.unref();await poll();
 }
 async function stop(){
  if(!child)return;stopping=true;if(timer)clearInterval(timer);timer=null;
  const active=child;
  send({type:'shutdown'});active.stdin.end();
  await new Promise(resolve=>{if(active.exitCode!==null){resolve();return}const force=setTimeout(()=>{active.kill();resolve()},4000);active.once('exit',()=>{clearTimeout(force);resolve()})});
  if(child===active){child=null;ready=false;}
 }
 async function save(next){
  if(typeof next.enabled!=='boolean'||typeof next.keepRunning!=='boolean')throw Error('小岛设置无效');
  const temp=prefs+'.'+randomBytes(6).toString('hex')+'.tmp';
  await writeFile(temp,JSON.stringify(next),{flag:'wx'});await rename(temp,prefs);
  settings={enabled:next.enabled,keepRunning:next.keepRunning};
  if(settings.enabled)await start();else if(!webOpen)await stop();
  await poll();
  return status();
 }
 function status(){return{...settings,installed:existsSync(executable),running:!!child,ready,error,pid:child?.pid||null,version:'0.6.64-rd.4',snapshot:lastSnapshot};}
 const webActions=new Set(['open','snapshot','save','close','mail-connect','mail-test','mail-retest','mail-remove','mail-toggle','calendar-select','calendar-connect','calendar-sync','calendar-forget','calendar-import','quota-connect','quota-remove','quota-update','quota-options','quota-refresh','quota-discover','quota-cancel','notification-connect','notification-disconnect','notification-app','open-page','water-save','weather-search','weather-use','weather-add','weather-remove','weather-refresh']);
 ipcMain.handle('island-web',async(event,action,body={})=>{
  assertSender(event);
  if(action==='autostart'){if(typeof body.enabled!=='boolean')throw Error('启动设置无效');app.setLoginItemSettings({openAtLogin:body.enabled,path:launcher,args:loginArgs,name:'ResearchDesk Next'});return{enabled:autostart()}}
  if(action==='choose-quota-file'){const{dialog}=require('electron');const result=await dialog.showOpenDialog(mainWindow(),{title:'选择登录或用量记录',properties:['openFile'],filters:[{name:'JSON 文件',extensions:['json']}]});return result.canceled?null:result.filePaths[0]}
  if(!webActions.has(action)||!body||typeof body!=='object'||JSON.stringify(body).length>65536)throw Error('设置操作无效');
  if(action==='close'&&!child){webOpen=false;return null}
  if(!existsSync(executable))throw Error('未安装桌面小岛，请在安装包中勾选该组件');
  if(action==='open')webOpen=true;
  await start();
  const began=Date.now();while(!ready&&child&&Date.now()-began<15000)await new Promise(r=>setTimeout(r,50));
  if(!ready)throw Error('小岛服务未能连接，请重试');
  const id=randomBytes(16).toString('hex');
  const data=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{settingsRequests.delete(id);reject(Error('小岛设置响应超时，请重新连接'))},15000);settingsRequests.set(id,{resolve,reject,timer});send({type:'settings-api',requestId:id,action,body})});
  if(action==='close'){webOpen=false;if(!settings.enabled)await stop()}
  return{...data,desktop:{enabled:settings.enabled,keepRunning:settings.keepRunning,installed:true,autostart:autostart()}};
 });
 ipcMain.handle('island-restart',async event=>{assertSender(event);if(!settings.enabled)throw Error('请先启用小岛');await stop();await start();return status()});
 ipcMain.handle('island-status',event=>{assertSender(event);return status()});
 ipcMain.handle('island-settings',async(event,next)=>{assertSender(event);return save(next)});
 ipcMain.handle('island-open-settings',async event=>{assertSender(event);await navigate('open-settings',{});});
 ipcMain.on('workspace-action-result',(event,result)=>{
  assertSender(event);const item=pending.get(result?.id);if(!item)return;clearTimeout(item.timeout);pending.delete(result.id);
  result.error?item.reject(Object.assign(Error(String(result.error).slice(0,500)),{fromWorkspace:true})):item.resolve();
 });
 return{
  async boot(){try{const v=JSON.parse(await readFile(prefs,'utf8'));if(typeof v.enabled==='boolean'&&typeof v.keepRunning==='boolean')settings=v;}catch(e){if(e.code!=='ENOENT')error='小岛设置读取失败，使用本次默认值'}
   if(settings.enabled&&existsSync(executable))await start();
  },start,stop,status,prepareQuit:()=>navigate('prepare-exit',{}),
  shouldKeepRunning:()=>settings.enabled&&settings.keepRunning&&!!child,
  openSettings:async()=>{await navigate('open-settings',{})},
 };
}
module.exports={installIsland};
