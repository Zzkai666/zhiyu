const {writeFile,rename,rm,mkdir}=require('node:fs/promises');
const {join,dirname,resolve}=require('node:path');
const {randomBytes}=require('node:crypto');
async function atomicWrite(target,bytes,token=()=>randomBytes(8).toString('hex')){
 const key=token();if(!/^[a-f0-9]{16}$/.test(key))throw Error('临时文件标识无效');
 const temporary=join(dirname(target),'.rd-export-'+key+'.tmp');let created=false;
 try{await writeFile(temporary,bytes,{flag:'wx'});created=true;await rename(temporary,target)}finally{if(created)await rm(temporary,{force:true}).catch(()=>{})}
}
async function writeMarkdownAssets(parent,prefix,assets){
 if(!/^ResearchDesk-assets-[A-Za-z0-9_-]{1,50}$/.test(prefix))throw Error('图片文件夹标识无效');
 const directory=resolve(parent),final=join(directory,prefix),temporary=join(directory,'.'+prefix+'.tmp');let created=false;
 try{
  await mkdir(temporary);created=true;
  for(let i=0;i<assets.length;i++)await writeFile(join(temporary,'image-'+String(i+1).padStart(3,'0')+'.png'),Buffer.from(assets[i].png,'base64'),{flag:'wx'});
  await rename(temporary,final);created=false;return final;
 }finally{if(created)await rm(temporary,{recursive:true,force:true}).catch(()=>{})}
}
module.exports={atomicWrite,writeMarkdownAssets};
