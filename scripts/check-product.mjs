import {readFileSync,statSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..'),pkg=JSON.parse(readFileSync(resolve(root,'package.json')));
for(const file of ['dist/bin/researchdesk-core.exe','dist/bin/researchdesk-island.exe']){
 const path=resolve(root,file);if(!existsSync(path)||statSync(path).size<1000000||readFileSync(path).subarray(0,2).toString()!=='MZ')throw Error('统一产品组件缺失或无效：'+file);
}
for(const file of ['components/daozai/LICENSE','components/daozai/THIRD_PARTY_NOTICES.txt','assets/licenses/GCC-Runtime-Exception.txt','assets/fonts/LICENSE-NotoSansCJK.txt']){
 if(!existsSync(resolve(root,file)))throw Error('分发许可缺失：'+file);
}
if(!pkg.build.extraResources[0].filter.includes('researchdesk-island.exe'))throw Error('小岛未进入统一打包清单');
console.log('统一产品组件与许可检查通过，版本 '+pkg.version);
