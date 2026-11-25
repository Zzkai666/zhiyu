import{readFile,writeFile,stat}from'node:fs/promises';import{resolve,join}from'node:path';import{createHash}from'node:crypto';import assert from'node:assert/strict';
const root=resolve(),version='0.8.0',load=async p=>JSON.parse(await readFile(p,'utf8')),sha=async p=>createHash('sha256').update(await readFile(p)).digest('hex');
const ui=await load('test-results/ui-workbench-0.8.0/summary.json'),source=await load('test-results/ui-workbench-0.8.0/source-review.json'),payload=await load('test-results/ui-workbench-0.8.0/payload-review.json'),portable=await load('test-results/portable-launch-final-0.8.0/summary.json'),installer=await load('test-results/optional-installer-final-0.8.0/summary.json'),cleanup=await load('test-results/cleanup-summary-0.8.0.json');
const suites=['react-settings-0.8.0','react-settings-packaged-0.8.0','reading-0.8.0','reader-ui-0.8.0','island-0.8.0','export-0.8.0'];
for(const s of [ui,source,payload,portable,installer])assert.ok(s.passed);for(const name of suites)assert.ok((await load('test-results/'+name+'/summary.json')).passed,name);
const files=['ResearchDesk Next 0.8.0.exe','ResearchDesk-Next-0.8.0-Setup.exe'],artifacts=[];for(const file of files){const path=join(root,'release',file);artifacts.push({file,bytes:(await stat(path)).size,sha256:await sha(path)})}assert.equal(artifacts[0].sha256,portable.sha256);assert.equal(artifacts[1].sha256,installer.sha256);
await writeFile('release/SHA256SUMS-0.8.0.txt',artifacts.map(x=>x.sha256+'  '+x.file).join('\n')+'\n');
const doc=['# ResearchDesk Next 0.8.0 · 已认可的工作台 UI','',
'2026-11-14，Windows x64 开发验收版本。工作台采用用户认可的暖色研究手帐方向，实际页面对应与范围说明见 WORKBENCH-UI-0.8.0.md。原 ResearchDesk 源码和正式资料不参与修改；schema10 保持。','',
'开发体验：release/ResearchDesk Next 0.8.0.exe，可直接运行。统一安装：release/ResearchDesk-Next-0.8.0-Setup.exe，工作台必选、小岛可选，后续可补装或移除，升级保留选择。先保存内容并从托盘完整退出旧版，再运行新版。','',
'已接入首页阅读与待办、重要日期和月历、重复安排、文件夹项目与目标路线、文献详情栏、课程章节路线和本章节律、词典卡与回忆卡、运动饮水与节律、导入、十一类设置以及完整帮助页。小岛原生主题与动效保持，不改成暖色；小封面是基于真实元数据的排版标识。','',
'新增真实交互包括月历日期选择、词条字母过滤、界面主题/密度、阅读排版即时预览、固定资料目录打开、设置组件拖动排序。既有保存协议、账号表单、PDF 阅读/标注/翻译/导出继续使用。完整第一阶段尚未完成；云同步、备份迁移、发音、实验训练执行、更多 AI 场景等不因概念图而视为已实现。','',
'验证：','',
'- npm run build 通过；既有 Go 测试与 18 项 Node/桌面/解析单元通过。最后界面增量按专项复验，未把局部检查称为全产品认证。',
'- '+ui.screens.length+' 个宽窄窗口截图、27 个主要页面实际截图索引，见 test-results/ui-workbench-0.8.0/index.html。核对长标题、作者、重要日期编辑、月份切换、章节选择、词卡键盘复习、导入和元数据编辑、偏好和原生排序保存。',
'- 设置源码与实际打包程序回归通过：空凭据表单验证、保存/版本冲突、停用后配置、日期编辑、取消退出无系统错误、重启保持。',
'- 阅读专项通过：默认等分/拖动/交换、多处原文入口、六类标注和就近评论/更多菜单、窄窗及重启保持；额外检查原文、解析和核对页面。句子匹配未恢复。',
'- 小岛八组联动检查通过，原生程序 SHA-256 与 0.7.2 一致。',
'- 完整论文译文 PDF/Word/Markdown、带标准批注的 PDF 导出通过，含中文评论、原文件/受管资料保护与取消；导出新增模型调用为零。',
'- 最终单文件 EXE 实际启动、核心 API、原生小岛、React 设置、重复启动、退出码 0 和临时运行目录清理通过。',
'- 最终安装器 '+installer.checks.length+' 项通过：仅工作台、保留组件选择、补装与移除小岛、升级、卸载保留独立数据库和额外文件、拒绝无关非空目录。',
'- '+source.changed.length+' 个界面/桌面改动文件与源备份比较，凭据模式扫描无发现；包内全部界面/桌面文件逐项哈希与最终构建一致。','',
'本轮测试使用隔离库、公开 PDF 和测试翻译替身，无真实账号连接或模型调用。早期验收的词条来源/饮水增量夹具与选择器按实际协议修正；长标题发现的封面字号覆盖、点击显示释义后的键盘焦点问题已修复并复验。','',
'| 文件 | 字节数 | SHA-256 |','| --- | ---: | --- |',...artifacts.map(x=>'| '+x.file+' | '+x.bytes+' | '+x.sha256+' |'),'',
'原生小岛 SHA-256：'+portable.nativeSha256+'。','',
'清理：回收本轮隔离库/profile、大导出、打包中间产物以及未被进程或系统锁占用的旧 0.7.2 交付。保留本轮小型 summary/诊断、界面截图、设计图和源备份。未改个人数据、模型、工具链、原 ResearchDesk。回收 '+Math.round(cleanup.bytes/1024/1024)+' MiB；跳过 '+cleanup.skipped.length+' 项，详见 test-results/cleanup-summary-0.8.0.json。','',
'本机结果不代表全新 Windows、所有邮箱/日历/额度服务和多屏场景均已完成验收。当前包未签名，自动更新与第一阶段其余移植继续待办。'];
await writeFile('RELEASE-0.8.0.md',doc.join('\n')+'\n');await writeFile('release/使用说明-0.8.0.txt','ResearchDesk Next 0.8.0\n\n直接体验：ResearchDesk Next 0.8.0.exe\n安装使用：ResearchDesk-Next-0.8.0-Setup.exe（工作台必选，小岛可选）\n\n请先保存内容，从托盘完整退出旧版，再运行新版。新版沿用 ResearchDesk Next 独立用户库；原 ResearchDesk 保持独立。\n\n本版接入已认可的暖色工作台 UI，小岛自身保持原有主题。设置中可调整工作台主题/密度及阅读排版。\n\n正式分发仍有全新 Windows、真实账号服务和签名/更新等验收待办。当前为开发体验版本。\n');
await writeFile('test-results/delivery-0.8.0.json',JSON.stringify({passed:true,artifacts,screens:ui.screens.length,nativeSha256:portable.nativeSha256,sourceFiles:source.changed.length,cleanupSkipped:cleanup.skipped},null,2));console.log(JSON.stringify({passed:true,artifacts}));
