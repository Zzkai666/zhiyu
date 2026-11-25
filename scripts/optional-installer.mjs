import {readdir,readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {resolve,join,relative,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
const root=resolve(import.meta.dirname,'..'),version=JSON.parse(await readFile(join(root,'package.json'),'utf8')).version;
const payload=resolve(process.argv[2]||join(root,'release','portable-'+version+'-build','win-unpacked'));
const stage=join(root,'test-results','installer-build-'+version);await mkdir(stage,{recursive:true});
const files=[],folders=[];
async function walk(dir){for(const e of await readdir(dir,{withFileTypes:true})){const full=join(dir,e.name);if(e.isSymbolicLink())throw Error('Payload symlink refused');if(e.isDirectory()){folders.push(relative(payload,full));await walk(full)}else if(e.isFile())files.push(relative(payload,full));}}
await walk(payload);
const island='resources\\bin\\researchdesk-island.exe';if(!files.includes(island)||!files.includes('ResearchDesk Next.exe'))throw Error('Incomplete payload');
const esc=s=>s.replaceAll('$','$$').replaceAll('"','$\\"');
let last='',lines=[];
for(const f of files.filter(f=>f!==island).sort()){const dir=dirname(f);if(dir!==last){lines.push('SetOutPath "$INSTDIR'+(dir==='.'?'':'\\'+esc(dir))+'"');last=dir}lines.push('File "'+esc(join(payload,f))+'"')}
const removal=files.map(f=>'Delete "$INSTDIR\\'+esc(f)+'"').concat(folders.sort((a,b)=>b.split('\\').length-a.split('\\').length).map(d=>'RMDir "$INSTDIR\\'+esc(d)+'"'));
const core=join(stage,'core-files.nsh'),remove=join(stage,'remove-files.nsh');await writeFile(core,'\ufeff'+lines.join('\n'));await writeFile(remove,'\ufeff'+removal.join('\n'));
const source=join(root,'scripts','optional-installer.nsi');const nsi=join(stage,'installer.nsi');await writeFile(nsi,'\ufeff'+(await readFile(source,'utf8')).replace(/^\ufeff/,''));
const compiler=process.env.RESEARCHDESK_NSIS_COMPILER||join(process.env.LOCALAPPDATA,'electron-builder','Cache','nsis','nsis-3.0.4.1','Bin','makensis.exe');
const output=join(root,'release','知屿-'+version+'-Setup.exe');
const r=spawnSync(compiler,['/V2','/DAPP_ICON='+join(root,'assets','app.ico'),'/DVERSION='+version,'/DOUTPUT='+output,'/DCORE_FILES='+core,'/DREMOVE_FILES='+remove,'/DISLAND_FILE='+join(payload,island),nsi],{stdio:'inherit',windowsHide:true,env:process.env});
if(r.error)throw r.error;if(r.status)process.exit(r.status);
console.log(JSON.stringify({output,bytes:(await stat(output)).size,payloadFiles:files.length,islandOptional:true}));
