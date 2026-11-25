# ResearchDesk Next 0.4.0 免安装交付

日期：2026-11-12。仅修改 D:\APP\重构。原 D:\APP\ResearchDesk 保持 main@4791d4e，交付前 git status --short 为空。未启动或迁移用户正式资料库，所有验收均使用本轮独立临时资料库。

## 使用

完整解压 release/ResearchDesk Next 0.4.0 免安装版.zip，运行其中 ResearchDesk Next.exe。本机可直接运行同名目录中的 EXE。正常退出旧版后再启动本版；沿用 ResearchDesk Next 独立资料库，schema6→7 前自动备份，旧核心拒绝打开新格式。历史 0.3.x 包保留。

ZIP 大小：387794363 字节（约 369.8 MiB）。
SHA-256：f80f49500a22bf5084d2c983d11ebcde2da72bbdc8669aab2c4c417aa4a8c613
压缩后通过 7-Zip 完整性测试。

## 本轮交付

独立笔记模块及阅读器常驻译文头部移除；翻译/模型集中到顶栏，解析与核对归翻译准备。译文正文默认两字缩进，可调整。

六类 PDF 批注：高亮、下划线、笔记注释、新增文字、区域选择、绘图；选中文字浮出八色色板，可连续标记，支持移动/编辑/删除与重开恢复，区域截图可存 PNG。标注存独立资料库，未提供带全部标注的 PDF 导出。

点击原文句子可用 Codex 建立已有译文的语义句对，同色显示并缓存；不重写译文。首次需模型连接；分组或译文变化重新核对。无法准确核对时明确提示并保留段落定位。扫描页无逐句提示，真实模型语义质量仍需实际阅读体验。

点击原文或译文定位原文时，必要时缩小以显示当前整块。导入 PDF 自动提取并按 arXiv/DOI 核对元数据；文献库点击条目打开详情，阅读按钮独立打开论文。

用户截图中的 main.cjs:168 Invalid regular expression flags，来自本轮新增 PNG 保存的正则转义错误；已改为前缀和 PNG 文件签名校验。main/preload 语法检查加入测试与构建门槛，最终打包程序实际启动和退出重开通过。补齐 Esc 全局退出选区色板，原生 PDF 链接不误触句子匹配。

## 验收证据

- npm test：全部 Go 测试及 11 个 TypeScript/桌面语法用例通过。
- npm run build：主进程/preload 语法、TypeScript、Vite、Go 构建通过；既有大块 JS 体积提示保留。
- test-results/reading-0.4.0-final4/summary.json：源码 Electron 完整流程通过。
- test-results/portable-0.4.0-verified/summary.json：最终 EXE 实际导入、元数据改名/详情、笔记入口移除、缩进、六类批注、锁定连续标记、移动修订、区域 PNG、删除与重开恢复、句对和缓存通过；原文图引用及译文参考文献引用跳转/返回、无额外匹配调用通过，0 renderer pageerror。
- test-results/portable-0.4.0-focus-final/summary.json：230% 场景缩到107%，596px 高来源块完整位于677px原文窗口。
- test-results/batches-0.4.0-verified/summary.json：273 段/14批，部分140段停止后接续、已保存不重生、双栏/历史/排版/重开通过。
- test-results/reading-0.4.0-final2/live-metadata.json：实际 arXiv 核对200/verified。
- test-results/reading-0.4.0-cleanup.json：本轮18个隔离库已核进程/独占文件锁并清理；后续聚合清理见 release-cleanup-0.4.0.json。截图、summary、协议方法摘要保留，历史样本与交付不动。

模拟 Codex 仅验证调用协议、保存与缓存，0 真实模型调用。单次聚焦验收未注入夹具时，模型目录请求出现503；最终聚焦验收注入同一离线夹具后通过，未以此宣称真实登录环境验证。早期截图超时、Esc 色板及自动化直接点击文字层下的链接按钮失败记录保留；链接测试改为正常鼠标点击可见坐标，不强制绕过事件层。

详细实现/限制见 READING-0.4.0.md，整体移植状态见 MIGRATION.md。本次不代表原版全部功能移植完成。
