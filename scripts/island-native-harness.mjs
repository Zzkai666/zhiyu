import {spawn} from 'node:child_process';
import {mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createInterface} from 'node:readline';
const output=resolve('test-results/island-native-0.6.0');await mkdir(output,{recursive:true});
const profile=join(output,'profile');await mkdir(profile,{recursive:true});
const preview=process.env.RDNEXT_NATIVE_WINDOW!=='1';
for(const name of ['stop','ready.json','exit.json','events.json'])await rm(join(output,name),{force:true});
const child=spawn(resolve(preview?'test-results/island-native-0.6.0/preview.exe':'dist/bin/researchdesk-island.exe'),preview?[output]:[],{stdio:['pipe','pipe','pipe'],windowsHide:true,env:{...process.env,DAOZAI_DATA_DIR:profile,DAOZAI_RESEARCHDESK:'1'}});
const events=[];child.stdin.on('error',()=>{});
let snapshot={recent:{id:'a'.repeat(64),title:'Vision-Language-Action Models for Robotics',page:8},tasks:[{id:'b'.repeat(32),title:'核对方法部分的实验设置',revision:1},{id:'c'.repeat(32),title:'对照基线的训练数据',revision:1},{id:'d'.repeat(32),title:'复查图 3 的评估指标',revision:1}],focus:null,history:[]};
const send=v=>child.stdin.write(JSON.stringify(v)+'\n');
const lines=createInterface({input:child.stdout});
lines.on('line',async line=>{
 const v=JSON.parse(line);events.push(v);await writeFile(join(output,'events.json'),JSON.stringify(events,null,2));
 if(v.type==='ready'){send({type:'snapshot',data:snapshot});await writeFile(join(output,'ready.json'),JSON.stringify({pid:child.pid}));}
 if(v.type==='command'){
  if(v.action==='focus'&&v.body.action==='start')snapshot={...snapshot,focus:{id:'e'.repeat(32),taskId:v.body.taskId,title:'核对方法部分的实验设置',revision:1,plannedSeconds:1500,elapsedSeconds:0,state:'running'}};
  send({type:'snapshot',data:snapshot});send({type:'result',requestId:v.requestId,notice:'命令已通过私有管道送达'});
 }
});
const poll=setInterval(async()=>{
 try{await readFile(join(output,'stop'));clearInterval(poll);send({type:'shutdown'});child.stdin.end()}catch{}
},200);
child.on('exit',async code=>{clearInterval(poll);await writeFile(join(output,'exit.json'),JSON.stringify({code,events}));if(code===0&&preview){if(!events.some(e=>e.action==='open-paper')||!events.some(e=>e.action==='focus'))process.exitCode=1;else await writeFile(join(output,'summary.json'),JSON.stringify({passed:true,kind:'headless native egui input + pipe',events},null,2));}else process.exitCode=code||0});
setTimeout(()=>{send({type:'shutdown'});child.stdin.end()},45000).unref();
