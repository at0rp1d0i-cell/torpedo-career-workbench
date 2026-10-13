# Torpedo Career Workbench · 证据驱动的个人职业工作台

Torpedo Career Workbench 是我在实际求职过程中使用并持续维护的个人职业工作台。它把经历与证据整理、简历维护、具体机会尽调、面试准备和复盘放在一个可版本化的本地仓库中，支持与 AI 助手协作。

工作台主要面向已经有较明确求职方向、希望围绕目标岗位持续准备的人。它侧重具体机会的判断和推进，不以广泛搜索岗位或批量投递为目标；公司与岗位研究通常从真实人工邀约开始。

项目主要在 **macOS** 上使用和验证。其他系统可以复用文档、模板与部分脚本，但日历集成、浏览器路径、字体和 PDF 构建等工具可能需要适配。

开源版本保留实际使用过的流程与工具，个人经历、真实面试记录和私密输入已移除或替换为明确标注的虚构示例。**这里的姓名、学校、项目与公司均为虚构示例，不代表作者经历。** 示例数字只用于演示记录格式，不能作为真实业绩引用。

仓库名为 `torpedo-career-workbench`，展示名为 **Torpedo Career Workbench**。

## 能做什么

- 素材先入账、核实，再选择进入简历，区分个人贡献与团队结果。
- 从真实人工邀约开始建立公司 × 岗位主档，管理 G1–G4 流程。
- 为每场面试保留独立复盘；全部技术面通过后再进入 HR / Offer 核验。
- CLI 输出状态、待办、审计、上下文读取清单和只读 Dashboard。
- 周期结束时输出结果分布与收尾清单，生成只沉淀跨机会信号的周期复盘。
- 固定双页 HTML 简历与 PDF 构建；macOS Calendar.app 日程辅助。

这是个人工作台，不提供自动投递或招聘表单最终提交。无需云端账户、数据库或第三方 Node.js 依赖。

## 如何采用

- **与 AI 助手协作**：助手负责整理、研究和机械维护；事实核实、投递、机会取舍与 Offer 决策由使用者负责。`AGENTS.md` 提供协作边界，具体助手及其数据处理方式由使用者选择。
- **按需复用**：可以先使用素材总账、简历、面试复盘或日程等需要的模块，再逐步建立自己的流程，无需一开始完整照搬。
- **长期维护**：求职结束后仍可积累项目证据、能力素材和职业判断，为下一次求职做准备。

## 快速开始

主要运行环境为 macOS，需要 Node.js 22 或更新版本、Bash。Calendar.app 集成仅支持 macOS。PDF 构建还需要 Python 3、Perl、Chrome / Chromium 和中文字体；布局在 macOS 上核验。CLI 的核心逻辑不依赖 Calendar.app，其他系统上的运行与测试环境需自行确认或适配。

```bash
bash scripts/verify.sh
node scripts/workbench.mjs list
node scripts/workbench.mjs dashboard --json
node scripts/workbench.mjs dashboard --html
node scripts/workbench.mjs context --scope all --slug example-infra
node scripts/workbench.mjs audit --strict
```

HTML 输出到 `private-notes/dashboard.html`，自行打开。仓库预置一个 G1 虚构机会，便于查看 CLI 和看板。

在建立自己的机会时：

```bash
node scripts/workbench.mjs new-opportunity --slug my-company-infra --company "公司" --role "岗位" --type internship
node scripts/workbench.mjs new-due-diligence --slug my-company-infra --as-of 2026-10-12
node scripts/workbench.mjs set-process --slug my-company-infra --type internship --source "招聘方口径" --as-of 2026-10-12 --round 'r1|technical|技术面' --round 'hr|hr|HR 面'
node scripts/workbench.mjs schedule --slug my-company-infra --stage r1 --start 2026-10-20T14:00:00+08:00 --mode mirror-only
```

最后一条只预览。核对后追加 `--confirm` 才写入私密日历输入与主档；`--mode managed --confirm` 才操作 Calendar.app。新建机会后人工填写主档、完成 G1 证据并维护面试索引，再运行审计。

求职告一段落时：

```bash
node scripts/workbench.mjs retro --cycle 2026-autumn
node scripts/workbench.mjs new-retro --cycle 2026-autumn
```

`retro` 列出未关闭机会、待反馈复盘、缺决策记录的 Offer 和已关闭机会的未来日程，并给出对应命令；处理完后 `new-retro` 生成 `career-thinking/retros/` 下的复盘草稿。

Calendar.app 的 upsert 在检测到历史版本误按分钟写入的旧提醒时，会在修改前失败，请先在 Calendar.app 中核对并清理旧提醒。脚本不会隐式删除、重建整个事件；正常事件按稳定 eventId 原地更新。

## 面试后的轻量路径

面试刚结束时先留几条现场证据，深度核验和补答可以稍后在同一文件补充：

```bash
node scripts/workbench.mjs new-debrief --slug my-company-infra --stage r1 --quick --notes "回忆：问了任务重试；回答了幂等性。未知：评价标准。"
# 没有该轮唯一已结束日程时，显式追加 --date YYYY-MM-DD。
# 多行记录可改用 --notes-file PATH。
```

快速记录默认结果为待反馈，自动补齐主档与面试工作区的索引。已有复盘拒绝覆盖；继续在原文件补充，不另建同场事实记录。

收到明确反馈后，可用一次调用回填结果与显式下一步：

```bash
node scripts/workbench.mjs record-outcome --slug my-company-infra --stage r1 --result 通过 --next-action "等待下一轮定档" --sync
```

`--sync` 同步复盘结果、主档显式字段、主档 / README 索引和速览 Gate。Gate / status 未提供就保留原值，结果不会自动升级 Gate；显式进入 G3 时要求全部必填非 HR 轮次都有明确通过结果。多文件写入失败会还原已写文件，原始叙事与手工内容保留。多个复盘候选需指定 `--debrief`，不猜测反馈属于哪场。

原有完整 `new-debrief` 与不带 `--sync` 的录入方式仍兼容。Agent 的轻量读取与操作边界见 [面试后维护 skill](.agents/skills/interview-aftercare/SKILL.md)。

## 简历

先填写 [素材总账](INVENTORY.md)，再修改 `resume/resume.html` 的身份字段和 `resume/resume-content.html` 的正文。

```bash
bash resume/build.sh
RESUME_NAME='你的姓名' bash resume/build.sh resume-content.html 目标岗位
# 自行在 resume/assets/my_photo.jpg 放入照片后：
bash resume/build.sh --photo
```

`RESUME_NAME` 只决定 PDF 文件名，页面身份字段仍需自行修改。输出在 `resume/dist/`，默认不入库；正文用唯一的 `<!-- PAGE 2 -->` 划分页。构建含溢出检测，正式投递前仍应人工检查每页布局、内容和数字。

## 目录与流程

| 位置 | 用途 |
|---|---|
| [AGENTS.md](AGENTS.md) | Agent 协作协议、受控字段、Gate 与检查要求 |
| [INTAKE.md](INTAKE.md) / [INVENTORY.md](INVENTORY.md) | 素材准入与事实总账 |
| [interview-prep/](interview-prep/README.md) | 机会、复盘、准备和尽调模板 |
| [career-thinking/](career-thinking/README.md) | 长期偏好、选择标准和判断修订 |
| `context/index.json` | 机会 / 职业 / 个人资料的读取路由 |
| `resume/` | 双页简历、样式、版本模板与构建脚本 |
| `scripts/` | 无第三方依赖的 CLI、Calendar 与测试 |
| [sources/](sources/README.md) | 演示证据；个人原始证据请留在私有仓库 |
| `private-notes/` | 被忽略的日历输入、草稿和运行产物 |

素材 → 核实 → 简历；真实邀约 → G1 尽调 → G2 面试执行 → 逐场复盘 → G3 HR / Offer → G4 关闭。通过一轮技术面仍在 G2。

## 用于自己的求职

推荐把这份项目当模板，建立**私有仓库**保存实际工作材料。替换虚构示例时同步 `INVENTORY.md`、简历、机会主档和 `interview-prep/README.md` 索引。`.gitignore` 只排除运行产物和部分私密输入，**不会自动忽略所有个人经历和面试文档**。

公开工具仓库只保留模板与虚构示例。不要在公开 fork 内填写真实身份、公司面试、薪资、内部项目或原始证据。更多边界见 [PRIVACY.md](PRIVACY.md)。

## 验证与贡献

`bash scripts/verify.sh` 包含语法检查、行为测试、上下文路径与 Markdown 链接验证。GitHub Actions 在 Linux / macOS 的 Node.js 22 / 24 上运行相同入口；该配置不代表云端 CI 已实际执行。Calendar 写入与 PDF 构建不在 CI 中运行。

贡献前阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。发现隐私问题请按 [SECURITY.md](SECURITY.md) 处理。项目采用 [MIT License](LICENSE)，许可仅覆盖本项目代码、模板和虚构示例；第三方材料及用户自行加入的数据不随之获得授权。
