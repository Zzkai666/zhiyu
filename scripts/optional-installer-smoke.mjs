import {_electron as electron} from 'playwright';
import assert from'node:assert/strict';
import{mkdtemp,mkdir,copyFile,readFile,writeFile,stat,open}from'node:fs/promises';
import{existsSync}from'node:fs';import{resolve,join}from'node:path';import{tmpdir}from'node:os';import{spawn,execFileSync}from'node:child_process';import{createHash}from'node:crypto';
const version=JSON.parse(await readFile('package.json','utf8')).version;
const out=resolve(process.env.RDNEXT_INSTALL_RESULTS||'test-results/optional-installer-'+version);await mkdir(out,{recursive:true});
const root=await mkdtemp(join(tmpdir(),'rdnext-installer-')),setup=join(root,'Setup.exe'),target=join(root,'application'),workspace=join(root,'workspace'),checks=[];
const source=resolve('release/知屿-'+version+'-Setup.exe');await copyFile(source,setup);
const hash=createHash('sha256').update(await readFile(setup)).digest('hex');
function run(exe,args){return new Promise((res,rej)=>{const c=spawn(exe,args,{windowsHide:true,stdio:'ignore'});const timer=setTimeout(()=>rej(Error('installer timed out')),180000);c.once('error',e=>{clearTimeout(timer);rej(e)});c.once('exit',code=>{clearTimeout(timer);res(code)})})}
async function unlocked(){const start=Date.now();let stable=0,last;while(Date.now()-start<45000){last=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-File',resolve('scripts/installer-wait-unlocked.ps1'),'-Target',target],{encoding:'utf8',windowsHide:true}));if(!last.active.length&&!last.locked.length){if(++stable===2)return}else stable=0;await new Promise(r=>setTimeout(r,150))}throw Error('Acceptance payload still in use: '+JSON.stringify(last))}
const install=async(choice)=>{await unlocked();return run(setup,['/S','/TEST=1','/SHORTCUTS=0',...(choice===undefined?[]:['/ISLAND='+choice]),'/D='+target]);};
const native=join(target,'resources/bin/researchdesk-island.exe');
let app;
async function launch(installed){
 app=await electron.launch({executablePath:join(target,'ResearchDesk Next.exe'),args:['--workspace='+workspace],env:{...process.env,RDNEXT_TEST_HIDE:'1'}});
 const page=await app.firstWindow();await page.getByRole('heading',{name:'今日工作台'}).waitFor();
 let s;const start=Date.now();do{s=await page.evaluate(()=>window.desktop.islandStatus());if(!installed||s.ready)break;await new Promise(r=>setTimeout(r,100))}while(Date.now()-start<40000);
 assert.equal(s.installed,installed);assert.equal(s.running,installed);if(installed)assert.equal(s.ready,true);else assert.equal(s.error,'');
 await page.getByRole('button',{name:'任务日程',exact:true}).click();await page.getByLabel('快速记录今日事项').fill('安装验收待办');await page.getByLabel('快速记录今日事项').press('Enter');await page.getByRole('button',{name:'完成 安装验收待办',exact:true}).last().waitFor();
 await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:'外观与停靠',exact:true}).click();if(!installed)await page.getByRole('heading',{name:'未安装桌面小岛'}).waitFor();
 await app.close();app=null;
}
try{
 assert.equal(await install(),0);assert.equal(existsSync(native),false);await launch(false);checks.push('core-only install boots without native process or missing-component error');
 assert.equal(await install(),0);assert.equal(existsSync(native),false);checks.push('upgrade preserves core-only selection');
 assert.equal(await install(1),0);assert.equal(existsSync(native),true);await launch(true);checks.push('same installer adds native island and existing workspace remains');
 assert.equal(await install(),0);assert.equal(existsSync(native),true);checks.push('upgrade preserves island selection');
 assert.equal(await install(0),0);assert.equal(existsSync(native),false);checks.push('same installer removes only optional component');
 const keep=join(target,'user-owned.txt');await writeFile(keep,'Keep personal files');const db=join(workspace,'researchdesk-next.sqlite'),before=createHash('sha256').update(await readFile(db)).digest('hex');
 await unlocked();assert.equal(await run(join(target,'Uninstall.exe'),['/S','_?='+target]),0);
 assert.equal(await readFile(keep,'utf8'),'Keep personal files');assert.equal(createHash('sha256').update(await readFile(db)).digest('hex'),before);assert.equal(existsSync(join(target,'ResearchDesk Next.exe')),false);
 checks.push('uninstaller removes frozen program files and preserves extra file and independent personal database');
 const invalid=join(root,'unrelated');await mkdir(invalid);await writeFile(join(invalid,'foreign.txt'),'Untouched');
 const bad=await run(setup,['/S','/TEST=1','/SHORTCUTS=0','/ISLAND=0','/D='+invalid]);assert.notEqual(bad,0);assert.equal(await readFile(join(invalid,'foreign.txt'),'utf8'),'Untouched');assert.equal(existsSync(join(invalid,'ResearchDesk Next.exe')),false);checks.push('unrecognized non-empty directory refused');
 await writeFile(join(out,'summary.json'),JSON.stringify({passed:true,source,sha256:hash,root,checks,personalDataPreserved:true},null,2));
 console.log(JSON.stringify({passed:true,checks:checks.length,root}));
}catch(e){await writeFile(join(out,'summary.json'),JSON.stringify({passed:false,source,sha256:hash,root,checks,error:e.stack},null,2));throw e}finally{await app?.close()}
