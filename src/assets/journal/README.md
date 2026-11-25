# ResearchDesk 手帐插画

2026-11-14，内置 image_gen 生成，参考用户认可的 27 张设计图。原始生成文件保留在 Codex generated_images；项目使用本目录的独立副本。

13 个透明 PNG：books、calendar、mountains、project、lab、words、life、course、music、weather、settings、library、leaves，均为 r1。用于页头、设置预览、目标山路和枝叶点缀；实际 PDF 封面仍来自论文第一页。没有用图片替代真实按钮、文字或数据。

生成主题、参考图和源路径见 [提示词与素材清单](../../../test-results/library-workflow-0.8.1/journal-assets.json)。共同规格为细棕色铅笔/墨线、燕麦色/浅杏色/鼠尾草绿水彩、轻柔材质细节、真正透明背景，无文字、无水印、无界面。每个资产由单独内置调用生成，没有使用 CLI 或用户 API Key。

纸张折角、胶带、装订孔、标签与页签由 journal-detail.css 实现，装饰不接收指针事件。小岛自身皮肤不受影响。
