import {_electron as electron} from 'playwright';import{mkdir,mkdtemp,writeFile}from'node:fs/promises';import{resolve,join}from'node:path';import{execFileSync}from'node:child_process';
const out=resolve('test-results/native-settings-0.7.0');await mkdir(out,{recursive:true});const root=await mkdtemp(join(out,'isolated-'));let app;const checks=[];
try{
 app=await electron.launch({args:['.','--workspace='+root],env:{...process.env,RDNEXT_TEST_HIDE:'1'}});
 const page=await app.firstWindow();await page.getByRole('heading',{name:'今日工作台'}).waitFor();
 const parent=await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.setSize(1250,820);w.showInactive();return w.getNativeWindowHandle().readBigUInt64LE().toString()});
 await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:'桌面小岛',exact:true}).click();
 let s;for(let i=0;i<200;i++){s=await page.evaluate(()=>window.desktop.islandStatus());if(s.host?.attached&&s.host.visible)break;await new Promise(r=>setTimeout(r,100))}if(!s.host?.handle)throw Error('No settings HWND');
 async function click(x,y){execFileSync('powershell.exe',['-NoProfile','-File',resolve('scripts/native-settings-input.ps1'),'-Handle',String(s.host.handle),'-ParentHandle',parent,'-X',String(x),'-Y',String(y)],{windowsHide:true,encoding:'utf8'});await new Promise(r=>setTimeout(r,150));return(await page.evaluate(()=>window.desktop.islandStatus())).host.section}
 async function group(id){for(let pass=0;pass<2;pass++)for(let y=45;y<=440;y+=12){if(await click(75,y)===id){checks.push({section:id,x:75,y});return}}throw Error('Sidebar did not reach '+id)}
 async function subtab(id){for(let pass=0;pass<2;pass++)for(const y of [65,85])for(let x=265;x<=480;x+=20){if(await click(x,y)===id){checks.push({section:id,x,y});return}}throw Error('Subtab did not reach '+id)}
 await group(10);await group(6);await subtab(7);await subtab(8);await group(11);
 await writeFile(join(out,'summary.json'),JSON.stringify({passed:true,root,host:s.host,checks,method:'Native mouse-message input and actual section-change assertions; no credentials or real connections used',pixelReview:false},null,2));
}catch(e){await writeFile(join(out,'summary.json'),JSON.stringify({passed:false,root,checks,error:e.stack},null,2));throw e}finally{await app?.close()}
