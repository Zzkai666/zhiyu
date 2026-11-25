import {spawnSync} from 'node:child_process';
import {mkdirSync,copyFileSync,cpSync,existsSync,writeFileSync,statSync,readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
const root=resolve(import.meta.dirname,'..');
const build=join(tmpdir(),'researchdesk-island-'+createHash('sha256').update(root).digest('hex').slice(0,10));
const cargo=join(build,'cargo'),rustup=join(build,'rustup'),source=join(build,'source'),mingw=join(root,'.toolchain/mingw64/bin');
mkdirSync(build,{recursive:true});
for(const [from,to] of [['.toolchain/cargo',cargo],['.toolchain/rustup',rustup]]){
 if(!existsSync(to))cpSync(join(root,from),to,{recursive:true,filter:file=>!file.includes('stable-x86_64-pc-windows-msvc')});
}
cpSync(join(root,'components/daozai'),source,{recursive:true,preserveTimestamps:true,filter:(file,dest)=>{if(/(^|[\\/])(target|\.git)([\\/]|$)/.test(file))return false;if(statSync(file).isFile()&&existsSync(dest)&&statSync(file).size===statSync(dest).size&&readFileSync(file).equals(readFileSync(dest)))return false;return true;}});
const importLibrary=join(root,'.toolchain/mingw64/x86_64-w64-mingw32/lib/libwinsqlite3.a');
if(!existsSync(importLibrary)){
 const dump=spawnSync(join(mingw,'objdump.exe'),['-p','C:/Windows/System32/winsqlite3.dll'],{encoding:'utf8'});
 if(dump.status)throw Error('Cannot inspect Windows SQLite exports');
 const names=[...new Set([...dump.stdout.matchAll(/\b(sqlite3_[A-Za-z0-9_]+)\b/g)].map(m=>m[1]))];
 if(names.length<100)throw Error('Windows SQLite export list incomplete: '+names.length);
 const def=join(build,'winsqlite3.def');writeFileSync(def,'LIBRARY winsqlite3.dll\nEXPORTS\n'+names.join('\n')+'\n');
 const dlltool=spawnSync(join(mingw,'dlltool.exe'),['-d',def,'-l','libwinsqlite3.a','-D','winsqlite3.dll'],{cwd:resolve(importLibrary,'..'),stdio:'inherit'});
 if(dlltool.status)throw Error('Cannot generate Windows SQLite import library');
}
const env={...process.env,CARGO_HOME:cargo,RUSTUP_HOME:rustup,CARGO_BUILD_JOBS:'3',CARGO_TARGET_DIR:join(build,'target'),
 PATH:mingw+';'+join(cargo,'bin')+';'+process.env.PATH,CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER:join(mingw,'gcc.exe')};
const preview=process.argv.includes('--preview');
const nativeBuild=!preview&&!process.argv.includes('--check')&&!process.argv.includes('--test');
const mode=preview||nativeBuild?'rustc':process.argv.includes('--check')?'check':'test';
const args=['+stable-x86_64-pc-windows-gnu',mode,'--locked',...(mode==='check'?[]:['--release']),'--target','x86_64-pc-windows-gnu','--manifest-path',join(source,'Cargo.toml'),'--bin',preview?'researchdesk-preview':'daozai'];
if(preview)args.push('--features','record');
if(preview||nativeBuild)args.push('--','-C','lto=thin');
if(mode==='test')args.push('--','--test-threads=1');
writeFileSync(join(root,'test-results/island-build-path.json'),JSON.stringify({build,source,cargo,rustup}));
const r=spawnSync(join(cargo,'bin/cargo.exe'),args,{cwd:source,env,stdio:'inherit'});if(r.error)throw r.error;if(r.status)process.exit(r.status);
if(preview){mkdirSync(join(root,'test-results/island-native-0.6.0'),{recursive:true});copyFileSync(join(build,'target/x86_64-pc-windows-gnu/release/researchdesk-preview.exe'),join(root,'test-results/island-native-0.6.0/preview.exe'));}
if(nativeBuild){
 mkdirSync(join(root,'dist/bin'),{recursive:true});
 copyFileSync(join(build,'target/x86_64-pc-windows-gnu/release/daozai.exe'),join(root,'dist/bin/researchdesk-island.exe'));
 const queue=['researchdesk-island.exe'],done=new Set();
 while(queue.length){
  const file=queue.shift();if(done.has(file))continue;done.add(file);
  const inspect=file==='researchdesk-island.exe'?{cwd:join(build,'target/x86_64-pc-windows-gnu/release'),name:'daozai.exe'}:{cwd:mingw,name:file};
  const deps=spawnSync(join(mingw,'objdump.exe'),['-p',inspect.name],{cwd:inspect.cwd,encoding:'utf8'});
  if(deps.status)throw Error('Cannot inspect runtime dependencies: '+file);
  for(const m of deps.stdout.matchAll(/DLL Name:\s*(\S+\.dll)/gi)){
   if(existsSync(join(mingw,m[1]))){copyFileSync(join(mingw,m[1]),join(root,'dist/bin',m[1]));queue.push(m[1]);}
  }
 }
}
