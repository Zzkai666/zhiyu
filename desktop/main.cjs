const { app, BrowserWindow, dialog, ipcMain, net, protocol, session, shell, Tray, Menu } = require('electron');
const { randomBytes } = require('node:crypto');
const { spawn } = require('node:child_process');
const { createReadStream, existsSync, statSync } = require('node:fs');
const { writeFile } = require('node:fs/promises');
const { resolve, join, basename, sep, isAbsolute } = require('node:path');
const { pathToFileURL } = require('node:url');
const { createInterface } = require('node:readline');
const { Worker } = require('node:worker_threads');
const { requestLoopback } = require('./core-transport.cjs');

protocol.registerSchemesAsPrivileged([{ scheme: 'rdnext', privileges: {
  standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true
} }]);

const base = 'rdnext://workspace';
const argument = process.argv.find(value => value.startsWith('--workspace='));
const isolated = argument ? resolve(argument.slice('--workspace='.length)) : null;
if (isolated && ['researchdesk.sqlite3', 'library.sqlite3'].some(file => existsSync(join(isolated, file)))) {
  process.stderr.write('请选择新版独立工作区。\n');
  app.exit(1);
  throw new Error('Previous workspace format');
}
// Keep the existing Electron identity and userData location for brand upgrades.
app.setName('ResearchDesk Next');
app.setPath('userData', isolated ? join(isolated, 'desktop-profile') : join(app.getPath('appData'), 'ResearchDesk Next'));
const hiddenTest = Boolean(isolated) && process.env.RDNEXT_TEST_HIDE === '1';
const data = isolated || join(app.getPath('userData'), 'library');

let window, core, endpoint, worker, pendingLayout, paperExports, island, tray;
let paperJobsActive=false;
function showMain(){if(hiddenTest)return;if(window&&!window.isDestroyed()){window.show();if(window.isMinimized())window.restore();window.focus();}}
let quitting = false, preparingQuit=false;
const auth = 'Bearer ' + randomBytes(32).toString('hex');
const resources = app.isPackaged ? process.resourcesPath : resolve(__dirname, '..');
const model = join(resources, 'models', 'pp-doclayoutv2.onnx');

async function bootCore() {
  const bin = join(resources, ...(app.isPackaged ? ['bin'] : ['dist', 'bin']),
    process.platform === 'win32' ? 'researchdesk-core.exe' : 'researchdesk-core');
  core = spawn(bin, ['--data', data], { stdio: ['pipe','pipe','pipe'], windowsHide: true });
  core.stdin.on('error', () => {});
  core.stderr.setEncoding('utf8').on('data', text => process.stderr.write(text));
  const lines = createInterface({ input: core.stdout });
  const address = await new Promise((fulfill, reject) => {
    const timer = setTimeout(() => reject(new Error('本地服务启动超时')), 15_000);
    const stop = err => { clearTimeout(timer); reject(err); };
    core.once('error', stop);
    core.once('exit', code => stop(new Error('本地服务退出，状态 ' + code)));
    lines.once('line', line => {
      clearTimeout(timer);
      try {
        const { address } = JSON.parse(line);
        if (!/^127\.0\.0\.1:[1-9]\d{0,4}$/.test(address)) throw new Error('本地服务地址无效');
        fulfill(address);
      } catch (err) { reject(err); }
    });
    core.stdin.write(auth.slice(7) + '\n');
  });
  endpoint = 'http://' + address;
  core.once('exit', () => {
    endpoint = null;
    if (!quitting && window && !window.isDestroyed()) {
      if(hiddenTest)return;
      dialog.showErrorBox('本地服务已退出', '请关闭知屿后重新打开。');
    }
  });
}

function assertSender(event) {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame ||
      new URL(event.senderFrame.url).protocol !== 'rdnext:' || new URL(event.senderFrame.url).hostname !== 'workspace') {
    throw new Error('桌面请求来源无效');
  }
}

function coreRequest(path, options = {}) {
  if (!endpoint) throw new Error('本地服务未连接');
  const headers = new Headers(options.headers);
  headers.set('Authorization', auth);
  return requestLoopback(new URL(endpoint + path), { ...options, headers });
}

function registerProtocol() {
  const ui = resolve(__dirname, '../dist/ui');
  protocol.handle('rdnext', async request => {
    const url = new URL(request.url);
    if (url.hostname !== 'workspace') return new Response(null, { status: 404 });
    const exportResponse=await paperExports?.responseFor(url);if(exportResponse)return exportResponse;
    if (url.pathname.startsWith('/api/')) {
      try {
        const headers = new Headers();
        for (const name of ['Content-Type','Range','If-Range','X-Paper-Title']) {
          const value = request.headers.get(name);
          if (value) headers.set(name, value);
        }
        const hasBody = !['GET','HEAD'].includes(request.method);
        return await coreRequest(url.pathname.slice(4) + url.search, {
          method: request.method, headers, signal: request.signal,
          ...(hasBody && request.body ? { body: request.body } : {}),
        });
      } catch {
        return Response.json({ error: '无法连接本地服务' }, { status: 503 });
      }
    }
    try {
      const relative = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
      const file = resolve(ui, '.' + relative);
      if (!file.startsWith(ui + sep)) return new Response(null, { status: 404 });
      return await net.fetch(pathToFileURL(file).href);
    } catch {
      return new Response(null, { status: 404 });
    }
  });
}

function runLayout(pixels) {
  if (pendingLayout) throw new Error('正在识别上一页，请稍后再试');
  if (!(pixels instanceof Uint8Array) || pixels.byteLength !== 800 * 800 * 4) {
    throw new Error('版面模型输入无效');
  }
  if (!worker) {
    const active = new Worker(join(__dirname, 'layout-worker.cjs'), { workerData: { model } });
    worker = active;
    active.on('message', ({ result, error }) => {
      const current = pendingLayout;
      pendingLayout = null;
      if (error) current?.reject(new Error(error));
      else current?.resolve(result);
    });
    active.on('exit', () => {
      if (worker === active) worker = null;
      const current = pendingLayout;
      pendingLayout = null;
      current?.reject(new Error('版面进程已退出，请重试'));
    });
    active.on('error', error => process.stderr.write(error.message + '\n'));
  }
  return new Promise((resolve, reject) => {
    pendingLayout = { resolve, reject };
    worker.postMessage(pixels);
  });
}

function registerIPC() {
  paperExports=require('./paper-export.cjs').installExports({assertSender,coreRequest,parent:()=>window,workspace:data,fontPath:resolve(__dirname,'../assets/fonts/NotoSansCJKsc-Regular.otf')});
  ipcMain.handle('import-pdf', async event => {
    assertSender(event);
    const selection = await dialog.showOpenDialog(window, {
      title: '导入论文 PDF', properties: ['openFile','multiSelections'],
      filters: [{ name: 'PDF 文档', extensions: ['pdf'] }],
    });
    if (selection.filePaths.length > 100) throw new Error('每批最多导入 100 份 PDF');
    const result = [];
    for (const path of selection.filePaths) {
      const filename = basename(path);
      try {
        const info = statSync(path);
        if (!info.isFile() || info.size > 200 * 1024 * 1024) throw new Error('单份 PDF 最大支持 200 MiB');
        const stream = createReadStream(path);
        try {
          const response = await coreRequest('/papers/import', {
            method: 'POST', body: stream,
            headers: { 'Content-Type': 'application/pdf', 'X-Paper-Title': encodeURIComponent(filename) },
          });
          const body = await response.json();
          if (!response.ok) throw new Error(body.error || '无法导入 PDF');
          result.push({ filename, ...body });
        } finally { stream.destroy(); }
      } catch (err) {
        result.push({ filename, error: err.message });
      }
    }
    return result;
  });
  ipcMain.handle('save-png', async (event, filename, url) => {
    assertSender(event);
    const prefix = 'data:image/png;base64,';
    if (typeof filename !== 'string' || typeof url !== 'string' || !url.startsWith(prefix) || url.length > 30 * 1024 * 1024)
      throw new Error('截图内容无效');
    const bytes = Buffer.from(url.slice(prefix.length), 'base64');
    if (!bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error('PNG 格式无效');
    const safeName = Array.from(filename).map(char => {
      const code = char.codePointAt(0);
      return code < 32 || [60,62,58,34,47,92,124,63,42].includes(code) ? '_' : char;
    }).join('').slice(0, 90) || '论文区域';
    const result = await dialog.showSaveDialog(window, { defaultPath: safeName + '.png', filters: [{name:'PNG 图片', extensions:['png']}] });
    if (result.canceled) return false;
    await writeFile(result.filePath, bytes);
    return true;
  });
  ipcMain.handle('save-markdown', async (event, filename, contents) => {
    assertSender(event);
    if (typeof filename !== 'string' || typeof contents !== 'string' || Buffer.byteLength(contents) > 12 << 20)
      throw new Error('导出内容无效或超过 12 MiB');
    const result = await dialog.showSaveDialog(window, {
      defaultPath: (filename.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 90) || 'ResearchDesk') + '.md',
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (result.canceled) return false;
    await writeFile(result.filePath, contents, 'utf8');
    return true;
  });
  ipcMain.handle('open-external',async(event,url)=>{assertSender(event);if(typeof url!=='string'||url.length>2048)throw new Error('链接无效');const parsed=new URL(url);if(!['https:','http:'].includes(parsed.protocol)||parsed.username||parsed.password)throw new Error('不支持此链接');await shell.openExternal(parsed.href)});
  ipcMain.handle('workspace-info',event=>{assertSender(event);return{directory:data}});
  ipcMain.handle('buddy-login-open',async event=>{
    assertSender(event);
    if(process.platform!=='win32')throw Error('请在本机终端登录 CodeBuddy');
    const response=await coreRequest('/translation/buddy-login');
    const result=await response.json();
    if(!response.ok)throw Error(result.error||'无法打开 CodeBuddy 登录');
    const { command, directory }=result;
    if(typeof command!=='string'||typeof directory!=='string'||!isAbsolute(directory))throw Error('登录入口无效');
    const powershell=join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
    const encoded=Buffer.from(command,'utf16le').toString('base64');
    const quote=value=>"'"+value.replaceAll("'","''")+"'";
    const launch=Buffer.from("$ErrorActionPreference='Stop'; Start-Process -FilePath "+quote(powershell)+
      " -ArgumentList '-NoProfile','-NoExit','-EncodedCommand',"+quote(encoded)+
      " -WorkingDirectory "+quote(directory)+" -WindowStyle Normal",'utf16le').toString('base64');
    const launcher=spawn(powershell,['-NoProfile','-NonInteractive','-EncodedCommand',launch],{
      cwd:directory,windowsHide:true,stdio:'ignore',
    });
    await new Promise((resolve,reject)=>{
      const failed=()=>reject(Error('无法打开登录终端'));
      launcher.once('exit',code=>code===0?resolve():failed());
      launcher.once('error',failed);
    });
  });
  ipcMain.handle('workspace-open',async event=>{assertSender(event);const error=await shell.openPath(data);if(error)throw Error('无法打开目录：'+error);return true});
  ipcMain.handle('paper-jobs-active',(event,active)=>{assertSender(event);if(typeof active!=='boolean')throw Error('任务状态无效');paperJobsActive=active});
  ipcMain.handle('choose-codex',async event=>{assertSender(event);const result=await dialog.showOpenDialog(window,{title:'选择 Codex 程序',properties:['openFile'],filters:[{name:'Codex executable',extensions:['exe']}]});return result.canceled?null:result.filePaths[0]||null});
  ipcMain.handle('layout-ready', event => { assertSender(event); return existsSync(model); });
  ipcMain.handle('layout-run', (event, pixels) => { assertSender(event); return runLayout(pixels); });
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (window && !window.isDestroyed()) {
      if (window.isMinimized()) window.restore();
      window.focus();
    }
  });
  app.whenReady().then(async () => {
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, decide) => decide(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    registerProtocol();
    await bootCore();
    registerIPC();
    window = new BrowserWindow({
      show: !hiddenTest,
      width: 1440, height: 950, minWidth: 820, minHeight: 610,
      backgroundColor: '#f7f3ed', icon: resolve(__dirname, '../assets/app.ico'), autoHideMenuBar: true, title: '知屿',
      webPreferences: { backgroundThrottling: false, preload: join(__dirname, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    window.on('close',event=>{if(!quitting){event.preventDefault();if(paperJobsActive||island?.shouldKeepRunning()){window.hide();return}void coreRequest('/paper-jobs').then(async response=>{if(!response.ok)throw Error('任务状态读取失败');const jobs=await response.json();if(jobs.some(j=>j.state==='queued'||j.state==='running')){paperJobsActive=true;if(window&&!window.isDestroyed())window.hide()}else app.quit()}).catch(()=>app.quit());}});
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    await window.loadURL(base + '/');
    island=require('./island.cjs').installIsland({app,ipcMain,assertSender,coreRequest,resources,workspace:data,showMain,mainWindow:()=>window});
    tray=new Tray(resolve(__dirname,'../assets/app.ico'));tray.setToolTip('知屿 · 阅读、学习与每日安排');
    tray.setContextMenu(Menu.buildFromTemplate([
      {label:'打开工作台',click:showMain},
      {label:'小岛外观与功能',click:()=>void island.openSettings()},
      {type:'separator'},{label:'退出知屿',click:()=>app.quit()}
    ]));tray.on('double-click',showMain);
    await island.boot();
    if(hiddenTest){window.setTitle('知屿 · 隔离验收');window.showInactive()}
  }).catch(error => {
    if(hiddenTest)process.stderr.write('Test startup failed: '+error.message+'\n');else dialog.showErrorBox('知屿启动失败', error.message);
    app.quit();
  });
}

app.on('window-all-closed', () => {if(!island?.shouldKeepRunning())app.quit();});
app.on('before-quit', event => {
  if(quitting)return;
  event.preventDefault();
  if(preparingQuit)return;
  preparingQuit=true;
  (async()=>{
    try{
      if(window&&!window.isDestroyed())await island?.prepareQuit();
    }catch(error){
      preparingQuit=false;showMain();
      if(!error.fromWorkspace&&!hiddenTest)dialog.showErrorBox('请先处理未保存的内容',error.message);
      return false;
    }
    quitting=true;
    await island?.stop();
    tray?.destroy();
    await worker?.terminate();
    if(core&&core.exitCode===null&&core.signalCode===null){
      await new Promise(resolve=>{
        const timer=setTimeout(()=>{core.kill();resolve()},4500);
        core.once('close',()=>{clearTimeout(timer);resolve()});core.stdin.end();
      });
    }
    return true;
  })().then(done=>{if(done)app.quit()}).catch(error=>{
    process.stderr.write(error.message+'\n');quitting=true;app.quit();
  });
});
