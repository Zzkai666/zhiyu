# 知屿 · 阿知

2026-11-14，用户选定 B 版二次元拟人角色。软件名称：知屿（Zhiyu）；角色名：阿知。

固定识别点：烟紫色蓬松发型、侧发辫与深紫蝴蝶结、奶油色书签发夹、琥珀色眼睛、深紫宽松针织开衫与浅色高领衬衣。头像保留托腮的小笑；独立角色图保留抱书、招手和坐垫。

内置 image_gen 基于已选 B 设计图精修，完整提示词与参考路径见 prompts.json。azhi-icon-source.png 与 azhi-mascot-source.png 为生成原图；azhi-1024.png 为高清头像；azhi.ico 包含 16/20/24/32/40/48/64/128/256px。build-icon.cjs 只做尺寸转换与 ICO 封装，未做创意性图像修改。

代码使用 src/assets/brand 的头像与透明角色图。页面标识、空首页与帮助页、窗口/托盘以及打包图标接入阿知。普通工作台配色和小岛原生主题保持。

品牌升级保留 local.researchdesk.next、ResearchDesk Next 内部 EXE 名、原安装组件身份与注册表键、开机启动键和资料目录；窗口/安装器/快捷方式显示知屿。默认资料显式固定为原 %APPDATA%/ResearchDesk Next。数据库仍 schema11，不因换名称迁移资料。