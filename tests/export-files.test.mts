import {test}from'node:test';import assert from'node:assert/strict';import {mkdtemp,writeFile,readFile,mkdir,rm,readdir}from'node:fs/promises';import{tmpdir}from'node:os';import{join}from'node:path';import{createRequire}from'node:module';
const require=createRequire(import.meta.url),{atomicWrite,writeMarkdownAssets}=require('../desktop/export-files.cjs');
test('failed temporary-file creation preserves existing output and foreign temporary file',async()=>{
 const root=await mkdtemp(join(tmpdir(),'rd-export-files-'));try{
  const target=join(root,'paper.pdf'),temporary=join(root,'.rd-export-aaaaaaaaaaaaaaaa.tmp');
  await writeFile(target,'previous export');await writeFile(temporary,'foreign file');
  await assert.rejects(atomicWrite(target,Buffer.from('replacement'),()=> 'aaaaaaaaaaaaaaaa'));
  assert.equal(await readFile(target,'utf8'),'previous export');assert.equal(await readFile(temporary,'utf8'),'foreign file');
  await atomicWrite(target,Buffer.from('replacement'),()=> 'bbbbbbbbbbbbbbbb');assert.equal(await readFile(target,'utf8'),'replacement');assert.ok(!(await readdir(root)).includes('.rd-export-bbbbbbbbbbbbbbbb.tmp'));
 }finally{await rm(root,{recursive:true,force:true})}
});
test('Markdown attachment collision preserves pre-existing files and cleans only owned staging',async()=>{
 const root=await mkdtemp(join(tmpdir(),'rd-export-images-'));try{
  const prefix='ResearchDesk-assets-test',existing=join(root,prefix),temporary=join(root,'.'+prefix+'.tmp');await mkdir(existing);await writeFile(join(existing,'KEEP.txt'),'user file');
  await assert.rejects(writeMarkdownAssets(root,prefix,[{png:Buffer.from('new image').toString('base64')}]));
  assert.equal(await readFile(join(existing,'KEEP.txt'),'utf8'),'user file');assert.ok(!(await readdir(root)).includes('.'+prefix+'.tmp'));
  await mkdir(temporary);await writeFile(join(temporary,'foreign.txt'),'foreign staging');
  await assert.rejects(writeMarkdownAssets(root,prefix,[]));assert.equal(await readFile(join(temporary,'foreign.txt'),'utf8'),'foreign staging');
 }finally{await rm(root,{recursive:true,force:true})}
});
