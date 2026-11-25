# ResearchDesk Next 0.3.0 · 日常工作流

## 这版怎么用

| 模块 | 常用路径 |
| --- | --- |
| 今日工作台 | 从上次论文页码继续。当天或已逾期的待办聚合到首屏，任务可就地记下。从同一屏继续最近一份笔记，或进入已到期的生词复习。 |
| 任务日程 | 日、周、月视图按各自周期前进和后退。周月清单按日期分组。可单独看逾期、待安排、待完成或已完成任务。快速添加仍写入同一任务清单。 |
| 目标与项目 | 同一工作区切换项目与独立目标。项目先显示下一项安排，文献、笔记和关联目标可直接打开。一个材料或目标可关联多个项目。三种目标衡量方式为数值、里程碑和自主评估，变更进展需要记录依据。超额进展显示实际比例，完成状态由用户决定。归档保留关联。 |
| 文献库 | 按待读、阅读中、已读、收藏、回收站和标签组合查找，保留上次状态筛选。 |
| 阅读与笔记 | 在阅读器「标记」页把既有高亮或下划线转成带页码的摘录笔记。笔记中心可按独立笔记、论文笔记过滤，并搜标题、正文和摘录。 |
| 生词与复习 | 从工作台直接进入到期队列。空格揭示释义，1 送到队尾，2 保存为已记住，按钮显示下一次间隔。 |
| 课程学习 | 记住选中的课程和章节。打开下一章材料，或就地标记学完、重新打开，进度按已完成章节计数。 |
| 运动与生活 | 饮水记录照常使用。每周查看运动天数、次数和实际分钟，可用上次运动名称再记一笔，时长和距离重新填写。 |
| 实验记录 | 搜运行条件或指标，复用上一条运行的条件和指标结构。对比时可指定基线，只有已结束且同名同单位的指标显示差值。 |

## 设计参考

- Linear 把项目资料、里程碑和工作入口集中在项目概览。新版采用独立目标、项目详情和就地材料跳转，目标进展仍按 ResearchDesk 原有口径。 [Linear 项目](https://linear.app/docs/projects) · [Linear 里程碑](https://linear.app/docs/project-milestones)
- Todoist 的 Quick Add 让标题足以开始记录，再按需要补细节。新版工作台和任务日程都使用快速记录。 [Todoist 快速添加](https://www.todoist.com/help/todoist/features/use-task-quick-add-in-todoist-va4Lhpzz)
- Zotero 将注释和引用带到笔记，并保留原页来源。新版复用已有标注、批注和页码生成摘录笔记。 [Zotero 阅读器与笔记](https://www.zotero.org/support/pdf_reader)
- Anki 的到期队列、先回想再揭晓和键盘复习适合每天短时间使用。新版采用两种反馈按钮，保留自己的复习间隔。 [Anki 复习说明](https://docs.ankiweb.net/studying.html)
- Canvas 按学习活动组织内容和进度，Strava 用按周回看帮助理解自己的运动。新版分别采用章节接续和周活动概况。 [Canvas 基础指南](https://community.canvaslms.com/html/assets/Canvas_Basics_Guide.pdf) · [Strava 训练日志](https://support.strava.com/en-us/articles/15402077-training-log)
- MLflow 把运行条件和指标放在同一对比流程。新版聚焦手工登记、复用条件和选择基线，差值不包含失败或缺失数据。 [MLflow Tracking](https://mlflow.org/docs/latest/tracking/)

## 升级与边界

新版工作区首次升级至数据库格式 6 时先生成 SQLite 备份，再增加目标、历史和项目关联表，以及项目领域与截止日期。既有项目和任务关联继续可用。手动核对后的论文分段、批注与译文沿用原记录。安装包可以使用同一个新版数据目录。

九个导航入口和全量移植范围继续保留。此版完成日常入口与目标管理的增量。任务重复规则与计时、完整课程学习闭环、多词义调度、实验附件与曲线、独立备份恢复等仍按移植清单推进。各版验收均在隔离库执行。

## 验收

- Go 与前端现有单元套件和生产构建通过。新增专项验证快速建任务重试只保存一项、目标并发冲突拒绝、修改进展依据、旧项目/任务关联迁移和材料解绑。
- Windows 安装版完成安装、三套隔离库测试与卸载。工作流测试覆盖九个入口，测试项目重开后保留一篇文献、一份笔记和 150% 的目标进展。两篇公开论文完成 19 页和 38 页阅读回归，覆盖表格/图/参考文献跳转、缩放、批注、断段校对与等宽双语。本轮翻译流程使用本地协议夹具。
- 三个隔离库均为 schema 6，SQLite quick_check 通过，外键检查无错误。原 ResearchDesk 只用于核对范围和读取公开测试 PDF。
- 过程问题包括「待读」与存储状态名不一致、迁移夹具缺必填字段及原打包目录出现占用。最终已修正筛选和夹具，并从独立目录打包。
- [目标进展](./test-results/workspace-0.3.0/verified-install/workspace/goal.png) · [项目详情](./test-results/workspace-0.3.0/verified-install/workspace/project.png) · [任务日程](./test-results/workspace-0.3.0/verified-install/workspace/agenda.png) · [实验基线](./test-results/workspace-0.3.0/verified-install/workspace/experiment.png)

安装包 SHA-256 为 `231b92751cbc93b4f14db96b1207b8922d7164bba295c8224adb5f64b3609087`。
## 免安装交付

提供完整 ZIP 和已解压文件夹，入口分别为 release/ResearchDesk Next 0.3.0 免安装版.zip，以及同名文件夹内的 ResearchDesk Next.exe。程序和模型随包提供，默认沿用 ResearchDesk Next 用户数据目录。

使用实际 ZIP 解压出的 EXE 完成 19 页论文解析、图表引用、缩放、退出重开和九模块工作流验收。测试使用独立资料库。ZIP 大小为 387699552 字节，SHA-256 为 `3fc60b5b6d39194755260def639e4c18443c8266211c7b45ffc1a0483b627fda`。