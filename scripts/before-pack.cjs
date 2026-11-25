const {execFileSync}=require('node:child_process');
const path=require('node:path');
module.exports=async()=>{
 const root=path.resolve(__dirname,'..');
 execFileSync(process.execPath,[path.join(root,'scripts/check-product.mjs')],{cwd:root,stdio:'inherit'});
};
