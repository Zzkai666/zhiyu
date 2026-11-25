# 论文导出 0.5.0

2026-11-13，独立项目 D:\APP\重构。本次资料库格式保持 schema8；不修改原 ResearchDesk、不操作正式资料库。

## 使用

打开论文，点击阅读工具栏“导出”，选择：

- 译文 PDF：A4 连续排版、标题层级、中文字体嵌入、页码、图表/独立公式原图。正文保持可选文字。
- 译文 Word：可编辑段落、标题样式、首行缩进、上下标、内嵌 PNG 图片。
- 译文 Markdown：UTF-8 正文与文件旁的 ResearchDesk-assets-* 图片文件夹。移动或分享时两者一起带走。
- 带标注的 PDF：在原文 PDF 上写入标准 Highlight、Underline、Text、FreeText、Square、Ink 批注和评论，书签追加为目录。原页面文字、链接、原有目录保留。自由文字的内容与独立评论分别保留为正文和回复批注。

导出读取本窗口打开时的已保存内容。正在编辑的评论需先保存，重新打开导出窗口可读取最新状态。全部需要翻译的段落保存后可“导出完整译文”；尚未完成时默认不允许冒充完整译文，用户可明确勾选“导出当前进度”，未译段保留原文并标注。作者、参考文献及明确无需翻译的段落保留原文。页眉页脚默认省略，明确要求翻译的区域仍遵循人工设置。

导出不调用 AI、不重新解析、不写回原 PDF 或资料库。不能覆盖托管资料库路径及与当前原始 PDF 字节一致的文件；保存到新文件，失败时保留之前的导出。Markdown 附件先写独立临时目录，主文档成功后才完成；只清理本次确实创建的文件，不误删同名既有临时文件/目录。

## 实现

Go 在只读事务中读取论文、当前人工分组、已保存译文及标注，形成固定快照。合并段落按当前逻辑组导出一次，成员不重复；旧译文候选不自动代替当前译文。Go 生成 HTML、OOXML DOCX、Markdown；Electron 负责系统保存、A4 PDF 打印与原文 PDF 批注适配，PDF.js 从原始页裁取图表/公式。无 Python 业务或新的 Python 运行时。

原文 PDF 使用 pdf-lib 保持原页，按 PDF.js 阅读坐标反算 CropBox、Rotate、UserUnit，四种旋转方向均覆盖。字体采用随包分发的 Noto Sans CJK SC，PDF 子集嵌入。评论采用 Unicode 字符串；多行文字标记保留多个 QuadPoints。PDF 标准批注的外观和评论面板显示由打开文件的阅读器处理。

主进程/预加载及全部 desktop/*.cjs 均在构建前检查语法，维持沙箱、上下文隔离与窄 IPC。导出打印窗口无 Node、无 preload，模板转义论文文本、限制脚本和外部资源。

技术参考：[Electron printToPDF](https://www.electronjs.org/docs/latest/api/web-contents)、[pdf-lib](https://pdf-lib.js.org/docs/api/classes/pdfdocument)、[Noto CJK 与许可](https://github.com/notofonts/noto-cjk/tree/main/Sans)。

## 验证

- 全部 Go 测试和17个 TS/桌面用例通过；TypeScript/Vite/Go 构建通过。
- Go 验证合并正文只导出一次、保留参考文献/图片、未译保护、上下标、有效 OOXML 和图片关系、导出不改译文；模板转义不可信文字。
- 原页 PDF 的旋转0/90/180/270、非零裁切框、原链接与目录、六类批注、中文与回复评论均经过结构检查及 PDF.js 渲染。
- 完整38页公开论文：273个翻译组，导出718段文本和20处图片；Word 每段与固定快照逐项一致，Markdown 所有图片链接均存在。带标注 PDF 的评论、原页数和原文件 SHA 保持；取消、原文件覆盖保护与资料库保护通过。见 test-results/export-0.5.0-packaged/summary.json。
- 本机 Word 16 以只读方式实际打开 DOCX：739个段落（718段文本＋20个图片段落＋1段来源信息）、20张内嵌图、58页，原 DOCX 哈希未变。已导出渲染副本并检查首尾及图表页；见 test-results/export-0.5.0-final/word-native-review.json。
- 译文 PDF 52页，首尾和图表页已目视检查，中文无方框、图片清晰。PDF与Word字体和排版不同，页数无需一致。
- 六类就近评论、双语/辅助侧栏、分片定位、拖动/交换与重开回归通过。
- 最终包内部应用完成相同四格式验收；最终单文件 EXE 通过实际启动、本地API、重复启动及退出后临时目录清理。
- 导出期间0模型调用；准备测试译文使用本地 Codex 协议夹具，未调用真实模型，不把它作为翻译质量验收。

原版未移植功能继续见 MIGRATION.md；本轮不代表第一阶段全部完成。
