import{readFile,writeFile,stat}from'node:fs/promises';import{createHash}from'node:crypto';import assert from'node:assert/strict';const load=async p=>JSON.parse((await readFile(p,'utf8')).replace(/^\uFEFF/,''));const suites=['brand-0.8.2','brand-packaged-0.8.2','library-workflow-0.8.2','portable-launch-final-0.8.2','optional-installer-final-0.8.2','brand-upgrade-0.8.2'];for(const s of suites)assert.ok((await load('test-results/'+s+'/summary.json')).passed,s);const payload=await load('test-results/brand-0.8.2/payload-review.json');assert.ok(payload.passed);const portable=await load('test-results/portable-launch-final-0.8.2/summary.json'),installer=await load('test-results/optional-installer-final-0.8.2/summary.json'),cleanup=await load('test-results/cleanup-summary-0.8.2.json');const artifacts=[];for(const file of['知屿 0.8.2.exe','知屿-0.8.2-Setup.exe']){const p='release/'+file;artifacts.push({file,bytes:(await stat(p)).size,sha256:createHash('sha256').update(await readFile(p)).digest('hex')})}assert.equal(artifacts[0].sha256,portable.sha256);assert.equal(artifacts[1].sha256,installer.sha256);
await writeFile('release/SHA256SUMS-0.8.2.txt',artifacts.map(x=>x.sha256+'  '+x.file).join('\n')+'\n');
await writeFile('release/使用说明-0.8.2.txt','知屿 0.8.2 · 阿知\n\n直接体验：知屿 0.8.2.exe\n统一安装：知屿-0.8.2-Setup.exe（小岛可选）\n\n请先保存内容，从旧版托盘完整退出，再启动新版。\n显示名称与图标已更新，原 ResearchDesk Next 资料目录与安装身份保持，不需要重新导入已有新版资料。数据库仍 schema11。\n旧版本若仍被运行，本轮不会强停或删除。\n\n角色 B 已接入侧栏标识、空首页、帮助页和 Windows 图标。角色为静态插画，不提供对话或桌宠行为。开发版尚未签名，其他功能完成度见 MIGRATION.md。\n');
const doc=['# 知屿 0.8.2 · B 版角色阿知正式接入','',
'2026-11-14，Windows x64 开发验收版。用户选定 B：烟紫发、琥珀眼睛、宽松开衫与书签发夹。产品名知屿（Zhiyu），角色名阿知。','',
'直接运行 release/知屿 0.8.2.exe。统一安装包 release/知屿-0.8.2-Setup.exe，工作台必选，小岛可选。先保存并从托盘完整退出旧版，再启动新版。','',
'品牌接入：侧栏名称/头像、空首页与帮助页角色、标题/favicon、窗口与托盘、Windows 主 EXE/体验 EXE/安装卸载图标、安装显示名和快捷方式。素材与提示词见 assets/branding/azhi-v1，兼容与实现见 BRANDING-0.8.2.md。','',
'保持原 userData、package identity/appId、内部 EXE、安装组件/注册表/自启身份；数据库 schema11，无 SQL 或业务后端变更。原 ResearchDesk 保持独立；小岛二进制及原生主题不变。没有新增桌宠动画、聊天或配音。','',
'验证：','',
'- 构建、桌面语法及既有 20 项 Node 单元通过。',
'- 开发与实际打包程序的品牌宽/窄窗、帮助检查、保存与重启接续通过。',
'- PDF 首页、页数、自动/手动状态、标签/备注草稿与紧凑日期专项通过。',
'- '+payload.files.length+' 个包内界面/桌面/图标文件逐项哈希核对，九个图标尺寸实际嵌入主 EXE；源码凭据模式扫描无发现。',
'- 最终单文件 EXE 的实际启动、API、原生小岛、设置、重复启动、正常退出与临时目录清理通过。',
'- 可选组件安装器七项通过；实际 0.8.1 原位升级再核对：升级前后数据库字节一致、旧待办可读、可选组件选择保持、卸载保留个人库。',
'- 所有验收均使用隔离 workspace，无真实账号连接或模型生成。没有对用户资料进行验收写入。',
'',
'打包时中文路径的 rcedit 写资源失败已通过独立暂存修复并复验；不改系统安全设置。包当前未签名，新 Windows、真实账号与完整第一阶段验收仍待。','',
'| 文件 | 字节数 | SHA-256 |','| --- | ---: | --- |',...artifacts.map(x=>'| '+x.file+' | '+x.bytes+' | '+x.sha256+' |'),'',
'清理：回收本轮隔离库/profile、安装临时目录及打包中间产物；保留原数据、模型、源码回退副本、设计和诊断。回收 '+Math.round(cleanup.bytes/1048576)+' MiB，跳过 '+cleanup.skipped.length+' 项（含仍在运行或受系统锁保护的旧文件时保留），见 test-results/cleanup-summary-0.8.2.json。'];
await writeFile('RELEASE-0.8.2.md',doc.join('\n')+'\n');await writeFile('test-results/delivery-0.8.2.json',JSON.stringify({passed:true,artifacts,iconFrames:payload.icons,cleanupSkipped:cleanup.skipped},null,2));console.log(JSON.stringify({passed:true,artifacts}));