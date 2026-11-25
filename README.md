# 知屿 · Zhiyu

独立的 Windows 桌面重构项目。当前体验版本 0.9.12。论文阅读器的「更多 → 翻译设置」支持 Codex、DeepSeek Harness、腾讯 Buddy（官方独立 CodeBuddy CLI，同账号积分）与 OpenAI 兼容的自定义 API。第一阶段以用户调整后的原版已交付功能对等为完成条件，当前进度见 [移植状态](./MIGRATION.md)。

品牌与素材说明见 [知屿与阿知](./BRANDING-0.8.2.md)。显示名称更新，原资料目录、安装身份和业务功能保持兼容；无需重新导入已有新版资料。

## 使用

开发阶段可直接运行 `release\知屿 0.9.12.exe` 体验和验收。现有统一安装包为 `release\知屿-0.8.3-Setup.exe`：工作台必选、小岛可选；可补装或移除组件，升级保留选择。安装与卸载已在本机隔离目录通过验收，自动更新、全新 Windows 及真实账号等完整分发验收仍待。

启动前正常退出旧版本。本版沿用 ResearchDesk Next 独立用户资料库，资料格式为 schema13。从更早的资料格式打开时，程序会先备份再升级。原 ResearchDesk 代码和资料库保持独立。开发模式可在本目录执行 npm start。

原生 Daozai 小岛保留原有主题、材质、动效与停靠方式，首次集成配置默认毛玻璃·浅。悬停展开可继续阅读、查看任务、围绕任务专注；私人待办仍保留。小岛默认在全屏应用中隐藏，沿用原组件设置。展开时两侧提供可整条点击的切换区，箭头居中，随面板高度适配，详见 [切换改进](./ISLAND-NAVIGATION-0.7.2.md)。

PDF 标注附近或选区工具条可创建带固定原文来源的研究任务。工作台保存一份权威任务，小岛展示并返回同一对象。专注结束后明确确认任务完成或稍后继续；首页可记录成果。关闭工作台窗口可保留小岛，系统托盘“退出 ResearchDesk”完整收尾。设置可启停、重启小岛。原生子窗口嵌入已替换为工作台 React 设置页，含外观、页面与常驻组件、通知及邮箱/日历/额度连接；小岛仍用原有主题。见 [当前交付](./RELEASE-0.8.3.md) 和 [修复说明](./REACT-SETTINGS-FIX-0.7.1.md)。

处理步骤见 [论文处理与 Codex](./PAPER-PIPELINE-0.8.3.md)：导入自动解析，条目内仅显示当前解析或翻译的单条进度，待核对时显示文字和入口，译完后收起处理状态；核对后一次点击后台全文翻译，完整退出后保留批次并由用户继续。

文献库支持本地 PDF、多选与拖放、arXiv、DOI、公开链接和标题查找。阅读器支持连续原页、高分辨率缩放、解析核对、跨段连接、Codex 批量翻译、连续双语、双向定位、引用跳转与返回、页面标注和就近评论。工具栏“导出”支持整篇译文 PDF、可编辑 Word、Markdown 与带标准批注的原文 PDF，见 [论文导出](./EXPORT-0.5.0.md)。

历史阅读说明：[核对解析](./READING-0.3.1.md)、[续段与宽度](./READING-0.3.2.md)、[批量翻译](./READING-0.3.3.md)、[断段补救](./READING-0.3.4.md)、[文献与标注](./READING-0.4.0.md)、[独立译文与批注](./READING-0.4.1.md)。旧交付文档保留历史说明，所引用旧 EXE 不再保证存在。

本轮实现、迁移与验收见 [0.8.1 说明](./LIBRARY-WORKFLOW-0.8.1.md)，设计功能的逐页完成度见 [27 页落实核对](./DESIGN-IMPLEMENTATION-0.8.1.md)。历史视觉框架见 [0.8.0 改版](./WORKBENCH-UI-0.8.0.md)。包括手帐式首页、日期导航、文件夹档案、文献详情栏、章节路线、词卡和设置即时预览；新增图表只汇总已保存记录。

## 运行结构

- Electron 负责沙箱渲染器、窄 preload、私有协议、系统文件对话框、托盘和组件生命周期。
- React、TypeScript、CSS、Radix Dialog 和 Lucide 构成工作台与阅读器；暖色仅沿用工作台，小岛由上游原主题绘制。
- Go 负责文献、阅读位置、标注、解析、译文、研究来源、专注、任务、项目、课程、生词、实验与生活记录。SQLite 位于用户数据目录的 library。可用 --workspace=<绝对路径> 指定隔离验收库。
- Rust + egui 小岛由主程序启动，通过继承管道获取最小摘要和受限命令；无额外监听端口、不传 Go 令牌、不自动发现 AI 客户端账号、不修改独立 Daozai 的资料与快捷方式。
- PDF.js 提取内嵌文字和字形，ONNX Runtime 独立线程运行 PP-DocLayoutV2；图、表、长公式按区域裁图。无 OCR、表格结构还原、整套 MinerU 或 Python 业务服务。

## 构建与验收

Windows x64。主程序需要 Node.js 24、npm 和 Go 1.26.5 或以上。Go 脚本优先使用 .toolchain/go。

本机小岛工具链为 Rust 1.100.0 stable-x86_64-pc-windows-gnu、WinLibs GCC16.2.0 / MinGW-w64 14.0.0，独立保存在 .toolchain，不改系统 PATH。scripts/island-build.mjs 使用 ASCII 临时构建缓存避开 GNU 中文路径兼容问题；普通界面构建可复用已生成的 dist/bin/researchdesk-island.exe。小岛源码位于 components/daozai，基础版本固定为上游 6eb33732f9b2150e02eef1b1f824b0c087a2c5f2。

```powershell
$env:ONNXRUNTIME_NODE_INSTALL_CUDA = 'skip'
npm ci
npm run build:island
npm test
npm run build
node scripts/check-product.mjs
npm start
```

npm run package:preview 生成开发阶段单文件体验版，npm run package:win 构建统一 NSIS 安装包；后者不能代替正式安装/卸载验收。两条入口均先构建两个组件并核对分发许可。

版面模型 models/pp-doclayoutv2.onnx 的来源与校验见 [模型说明](./models/README.md)。缺少模型仍能阅读和提取内嵌文字。

scripts/island-smoke.mjs 验证实际 Electron 联动、来源、专注和生命周期；设置 RDNEXT_EXE 可验收打包后的内部 EXE。scripts/portable-launch-smoke.mjs 验证最终单文件启动、设置保存、重复启动及退出清理；scripts/react-settings-smoke.mjs 验证实际设置表单、日期卡片编辑和取消退出，scripts/optional-installer-smoke.mjs 验证最终可选组件安装包。原生页面的软件渲染与模拟鼠标命中使用 --preview 构建与 scripts/island-native-harness.mjs；该验收不操作用户桌面。所有业务验收使用隔离库和公开/合成数据，不调用真实模型。
