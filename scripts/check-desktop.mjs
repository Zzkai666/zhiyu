import {readdirSync} from 'node:fs';import {execFileSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../desktop/',import.meta.url));for(const name of readdirSync(root).filter(n=>n.endsWith('.cjs')))execFileSync(process.execPath,['--check',root+name],{stdio:'inherit'});
