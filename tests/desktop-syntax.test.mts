import {test} from 'node:test';import {execFileSync} from 'node:child_process';import {readdirSync} from 'node:fs';import {fileURLToPath} from 'node:url';
for(const name of readdirSync(fileURLToPath(new URL('../desktop/',import.meta.url))).filter(n=>n.endsWith('.cjs')))test('desktop '+name+' parses before an Electron window is opened',()=>{
 execFileSync(process.execPath,['--check',fileURLToPath(new URL('../desktop/'+name,import.meta.url))],{stdio:'pipe'});
});
