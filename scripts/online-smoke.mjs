import { spawn } from 'node:child_process';
import {createInterface} from 'node:readline';
import {once} from 'node:events';
import {mkdir,mkdtemp} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';

const output=resolve('test-results');
await mkdir(output,{recursive:true});
const root=await mkdtemp(join(output,'isolated-online-'));
const child=spawn(resolve('dist/bin/researchdesk-core.exe'),['--data',root],{stdio:['pipe','pipe','inherit'],windowsHide:true});
const token='a'.repeat(64);
child.stdin.write(token+'\n');
try{
 const [line]=await once(createInterface({input:child.stdout}),'line');
 const {address}=JSON.parse(line);
 const request=async(path,payload)=>{
  const response=await fetch('http://'+address+path,{method:payload?'POST':'GET',
    headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(payload?{body:JSON.stringify(payload)}:{})});
  return {status:response.status,data:await response.json()};
 };
 const lookup=async query=>{
  const {status,data}=await request('/import/lookup',{query});
  const result={query,status,count:Array.isArray(data)?data.length:0,first:data[0]?.title,error:data.error};
  console.log(JSON.stringify(result));
  return {status,data};
 };
 if(process.env.RDNEXT_CHECK_CODEX==='1'){
  const {status,data}=await request('/translation/models');
  console.log(JSON.stringify({catalogStatus:status,models:Array.isArray(data)?data.length:0,withEffort:Array.isArray(data)?data.filter(m=>m.efforts.length).length:0,error:data.error}));
 }else {
  const trials=await Promise.all(['2303.04137','10.1038/nphys1170','Diffusion Policy Visuomotor Policy Learning via Action Diffusion','https://arxiv.org/pdf/2303.04137','https://arxiv.org/abs/2303.04137'].map(lookup));
  assert.ok(trials.every(trial=>trial.status===200&&trial.data.length>0));
  const direct=await lookup('https://openreview.net/pdf?id=su7nQNMMa8');
  const result=await request('/import/download',trials[0].data[0]);
  console.log(JSON.stringify({download:result.status,bytes:result.data.paper?.bytes,error:result.data.error,direct:direct.status,root}));
  assert.equal(result.status,201);
  assert.ok(result.data.paper.bytes>100000);
 }
}finally{child.stdin.end();await once(child,'close')}
