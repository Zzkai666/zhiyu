import{readFile,writeFile,stat}from'node:fs/promises';import{resolve,join}from'node:path';import{createHash}from'node:crypto';import assert from'node:assert/strict';
const root=resolve(),version='0.8.1',load=async p=>JSON.parse((await readFile(p,'utf8')).replace(/^\uFEFF/,'')),sha=async p=>createHash('sha256').update(await readFile(p)).digest('hex');
const ui=await load('test-results/ui-workbench-0.8.1/summary.json'),source=await load('test-results/library-workflow-0.8.1/source-review.json'),payload=await load('test-results/library-workflow-0.8.1/payload-review.json'),art=await load('test-results/ui-workbench-0.8.1/art-check.json'),portable=await load('test-results/portable-launch-final-0.8.1/summary.json'),installer=await load('test-results/optional-installer-final-0.8.1/summary.json'),cleanup=await load('test-results/cleanup-summary-0.8.1.json');
const suites=['library-workflow-0.8.1','library-packaged-0.8.1','react-settings-0.8.1','reading-0.8.1','island-0.8.1','export-0.8.1'];
for(const s of[ui,source,payload,art,portable,installer])assert.ok(s.passed);for(const name of suites)assert.ok((await load('test-results/'+name+'/summary.json')).passed,name);
const files=['ResearchDesk Next 0.8.1.exe','ResearchDesk-Next-0.8.1-Setup.exe'],artifacts=[];for(const file of files){const path=join(root,'release',file);artifacts.push({file,bytes:(await stat(path)).size,sha256:await sha(path)})}assert.equal(artifacts[0].sha256,portable.sha256);assert.equal(artifacts[1].sha256,installer.sha256);assert.equal(portable.nativeSha256,'7458fa6c536a5aa545d2e9b8657732441b01b05f2cc65d2f43d38486feca3e81');
await writeFile('release/SHA256SUMS-0.8.1.txt',artifacts.map(x=>x.sha256+'  '+x.file).join('\n')+'\n');
const doc=['# ResearchDesk Next 0.8.1 · 论文首页与手帐细节','',
'2026-11-14，Windows x64 开发验收版。用户认可的手帐视觉继续落地，原 ResearchDesk 源码/资料保持独立。','',
'直接体验：release/ResearchDesk Next 0.8.1.exe。统一安装：release/ResearchDesk-Next-0.8.1-Setup.exe，工作台必选、小岛可选。请保存内容并从托盘完整退出旧版，再运行新版。','',
'本版：首页/文献库使用真实论文第一页；真实页数和阅读进度；首次保存阅读位置自动由待阅读改为阅读中，已读保持且可手动修改。去掉详情按钮，点击标题/封面查看资料；列表/卡片、标签、筛选计数、文献备注及草稿/冲突保护已接入。任务日程重要日期压缩为横向条带，不因日期导航隐藏远期事项。','',
'13 张独立透明水彩插画已放入实际页面，覆盖书本、日历、山路、项目、实验、词典、生活、课程、音乐、天气、设置、书架与枝叶；折角、胶带、装订孔、页签和纸纹由 CSS 呈现。小岛主题、材质、动效与原生二进制保持。','',
'迁移为 schema11：先自动备份，再加 paper_extras；一次性校正已有阅读位置但仍待阅读的文献。旧核心拒绝打开新格式，不能直接降级。备注独立修订，原 PDF 与已有译文/标注不因预览而修改。详见 LIBRARY-WORKFLOW-0.8.1.md。','',
'设计图并未全部实现：27 页逐项落实/缺项见 DESIGN-IMPLEMENTATION-0.8.1.md。课程完整管理、生词发音、项目活动/材料、实验曲线/附件、完整备份迁移等仍待，不把视觉相近当成功能完整。第一阶段仍未完成。','',
'验证：','',
'- npm run build 与完整 Go 测试、20 项 Node 单元通过；先复现阅读状态缺陷后修复，含 schema10 迁移备份、独立备注修订/重试/冲突、删除边界和前端乱序合并。',
'- 实际 Electron 与最终打包 EXE 的文献专项通过：38 页公开论文、首页预览/页数、编辑/标签/备注/草稿恢复、自动与手动状态、列表偏好、五个重要日期、宽窄窗口。',
'- 工作台 '+ui.screens.length+' 个宽窄截图通过；13 个插画实际透明像素检查通过。截图来自隔离样本，非用户数据。',
'- 阅读双栏/拖动/交换/多区域定位、六类标注与就近评论、完整译文 PDF/Word/Markdown 和带批注 PDF 导出、React 设置/日期编辑、小岛联动专项通过。',
'- 最终单文件 EXE 实际启动、API、原生小岛、设置、重复启动、正常退出和临时目录释放通过。',
'- 最终安装器 '+installer.checks.length+' 项：工作台单装、小岛补装/移除、升级保留组件选择、卸载保留独立数据库和额外文件、无关目录保护通过。',
'- 包内界面/桌面文件逐项哈希与最新构建一致；改动源文件比较及凭据模式扫描无发现。',
'',
'以上均为本机隔离验收，账号/模型用测试替身，不声称真实平台账号、全新 Windows 或所有复杂 PDF 全面验收。','',
'| 文件 | 字节数 | SHA-256 |','| --- | ---: | --- |',...artifacts.map(x=>'| '+x.file+' | '+x.bytes+' | '+x.sha256+' |'),'',
'清理本轮隔离库/profile、大导出和打包中间产物，旧版只在校验原哈希且无进程/系统锁时移除；原数据、模型、工具链、设计素材、源备份保持。回收 '+Math.round(cleanup.bytes/1048576)+' MiB；跳过 '+cleanup.skipped.length+' 项，详见 test-results/cleanup-summary-0.8.1.json。'];
await writeFile('RELEASE-0.8.1.md',doc.join('\n')+'\n');
await writeFile('release/使用说明-0.8.1.txt','ResearchDesk Next 0.8.1\n\n直接体验：ResearchDesk Next 0.8.1.exe\n统一安装：ResearchDesk-Next-0.8.1-Setup.exe（小岛可选）\n\n先保存并从托盘退出旧版，再启动新版。\n本版使用真实论文首页，修复阅读状态，优化重要日期与文献条目，补齐透明插画和手帐细节。\n资料格式 schema11 升级前自动备份，旧版不能直接打开升级后的资料；请勿同时运行两个版本。原 ResearchDesk 保持独立。\n\n本版仍是开发验收版。设计图功能缺项见项目 DESIGN-IMPLEMENTATION-0.8.1.md；当前验收及 SHA-256 见 RELEASE-0.8.1.md / SHA256SUMS-0.8.1.txt。\n');
await writeFile('test-results/delivery-0.8.1.json',JSON.stringify({passed:true,artifacts,screens:ui.screens.length,artAssets:art.assets.length,nativeSha256:portable.nativeSha256,sourceFiles:source.changed.length,cleanupSkipped:cleanup.skipped},null,2));console.log(JSON.stringify({passed:true,artifacts}));