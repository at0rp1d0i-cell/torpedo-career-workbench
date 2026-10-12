# 求职工作台模板目录 · Agent 指引

> 本文件供维护仓库的 Agent 使用，不是面向开源读者的项目介绍。顶层项目说明见 [`../../README.md`](../../README.md)，通用维护协议见 [`../../AGENTS.md`](../../AGENTS.md)。
> 模板规定操作边界；事实权威仍由各对象文件负责，不能把模板或研究简报当作事实源。

这不是第二套事实库。模板只规定一次操作需要收集什么、写到哪里、哪些内容不能越界。

## 操作总表

| 操作 | 触发条件 | 模板 | 规范输出 | 权威边界 |
|---|---|---|---|---|
| 收集素材 | 新增项目、奖项、教育或技能信息 | [`material-intake.md`](material-intake.md) | `private-notes/intake/` 草稿 → `INVENTORY.md` + `sources/` | 先入账，未核实必须标状态；不直接改简历 |
| 制作简历版本 | 面向岗位调整简历 | [`resume-version.md`](../../resume/templates/resume-version.md) | `private-notes/resume-versions/` 记录 → PDF / `releases/` | 只能引用 `INVENTORY.md` 中已核实且入选内容 |
| 约面建档（JD 草稿） | 招聘方明确邀请面试 | [`opportunity-record.md`](opportunity-record.md) + `new-opportunity --jd-file` | 主档 + 自动抽取草稿节（可选 `--rounds` / `--hc` / `--convert` 直填约面信息） | G1 建档；抽取只供校对，不替代人工判断 |
| 处理面试邀约 | 招聘方明确邀请面试 | [`opportunity-record.md`](opportunity-record.md) | `interview-prep/opportunities/<slug>/record.md` | G1 建档，并立即启动公司 / JD 岗位尽调与建模；不保存临时链接、会议 ID、私人联系方式 |
| 面试前速览 | 已定档，需要快速恢复上下文 | [`quick-brief.md`](quick-brief.md) | 岗位目录下 `quick-brief.md` | 只压缩主档，不新增判断 |
| 准备反向提问 | 面试前需要现场问题 | [`question-script.md`](question-script.md) | 岗位目录下 `question-script.md` | 技术面与 HR 面分层；不把猜测当事实 |
| 建立日历事件 | 日期、时间、形式已确认 | [`calendar-event.json`](calendar-event.json) | 本地私密输入 + Calendar.app | 默认 dry-run；写入需 `--confirm`；敏感信息不入库 |
| 面试后复盘 | 一场面试结束 | [`debrief.md`](debrief.md) | `interview-prep/debriefs/<date>-<slug>-<stage>.md` | 观察、回忆、推断、补答和影响决策分开 |
| 公司 / 岗位尽调 | G1 收到邀约立即启动；G3（全部技术面通过、进入 HR 谈薪 / Offer 决策）时追加雇佣核验 | [`due-diligence.md`](due-diligence.md) | 岗位目录下尽调文件 | G1 建立公司与 JD 岗位模型；G3 只追加合同、薪资、headcount、转正和稳定性证据 |
| 周期复盘 | 一个招聘周期结束、收尾清单已处理 | [`cycle-retro.md`](cycle-retro.md) + `new-retro --cycle` | `career-thinking/retros/<cycle>.md` | 快照是只读投影；只沉淀跨机会重复信号，不改写单个机会事实 |
| 子代理研究简报 | G1 尽调需要分模块并行收集时 | [`research-brief.md`](research-brief.md) | 每个证据面一份研究简报 → 主代理整合 | 只产出简报、来源、判断准则、冲突/缺口；不修改主档、不做总判断 |

## 使用顺序

```text
素材 → INVENTORY → 简历版本 → 投递
                         ↓ 真实人工邀约
       record.md + due-diligence（G1：公司 / JD 岗位建模；按研究量拆分）
                         ↓ 定档
       Calendar + quick-brief + question-script（G2）
                         ↓ 面试
       单场 debrief（每轮一份）→ 全部技术面通过后 HR 谈薪 / Offer 雇佣核验（G3）→ 关闭（G4）
```

## 元数据合同（frontmatter）

状态与标识字段的唯一权威、字段清单与受控词表（`record.md` / `debrief.md` frontmatter、`opportunity-type` / `recruiting-cycle` / `interview-process` / `gate` / `status`）见 [`../../AGENTS.md`](../../AGENTS.md) §5「受控词表与元数据合同」；本节只登记脚本入口，不重复字段表。脚本只读 / 写 frontmatter，状态流转用命令：

```bash
node scripts/workbench.mjs validate
node scripts/workbench.mjs set-process --slug SLUG --type campus|internship|experienced --source SOURCE --as-of YYYY-MM-DD [--cycle YYYY-autumn|YYYY-spring] [--round ID|KIND|LABEL[|optional]] ...
node scripts/workbench.mjs dashboard [--at ISO] [--window-days N] [--json] [--html] [--output PATH]
node scripts/workbench.mjs retro [--cycle YYYY-autumn|YYYY-spring] [--type campus|internship|experienced] [--json]
node scripts/workbench.mjs new-retro --cycle YYYY-autumn|YYYY-spring [--date YYYY-MM-DD]
```

- 轮次绑定：实际轮次由结构化日程的 `stage` 和复盘 frontmatter 的 `stage` 关联；历史未结构化阶段按轮次顺序兼容推导，Dashboard 会标明推导边界。
- Dashboard 展示：已关闭机会默认折叠，Offer 独立展示。
- 日历输入可用 `purpose` 声明事件用途：省略或写 `interview` 时按面试轮次处理（沿用上面的顺序推导）；写其他值（如 `onboarding`）表示该事件不属于面试轮次，既不参与 `stage` 绑定，也不会被推导成某个未发生轮次的日程。
- [`../../.agents/skills/interview-workbench-ops/SKILL.md`](../../.agents/skills/interview-workbench-ops/SKILL.md)：已建档机会的轻量日程维护；`reschedule` 只更新唯一已有事件及关联日期材料，不重载尽调上下文。
- [`../../.agents/skills/browser-verification/SKILL.md`](../../.agents/skills/browser-verification/SKILL.md)：显示 / 交互验证的浏览器授权与隔离规则；默认不使用 Browser relay 或用户现有 Chrome。

## 辅助脚本

### 新建工作台文档

机会主档在 G1 建立后，通常立即生成尽调工作区；研究量较小时也可以把同样字段直接填写在 `record.md`，不强制拆文件。素材、投递草稿和简历版本默认写入被忽略的 `private-notes/`，完成人工核对后再回填权威文件。

```bash
node scripts/workbench.mjs new-opportunity \
  --slug company-role --company "公司" --role "岗位"
node scripts/workbench.mjs new-due-diligence \
  --slug company-role --as-of 2026-09-02
node scripts/workbench.mjs new-research-brief \
  --slug company-role --area technical-product --date 2026-09-02
node scripts/workbench.mjs new-brief --slug company-role
node scripts/workbench.mjs new-questions --slug company-role
node scripts/workbench.mjs new-debrief \
  --slug company-role --date 2026-09-02 --stage technical-round
node scripts/workbench.mjs new-material \
  --slug paged-kv --name "Paged-KV 新证据" --category 项目 --date 2026-09-02
node scripts/workbench.mjs new-opportunity \
  --slug company-role --company "公司" --role "岗位" --jd-file /tmp/jd.txt
node scripts/workbench.mjs new-resume-version \
  --id inference-20260902 --company "公司" --role "岗位" --date 2026-09-02
node scripts/workbench.mjs new-offer \
  --slug company-role --date 2026-09-02
```
脚手架默认拒绝覆盖已有文件；需要覆盖时追加 `--force`。日期必须为真实有效的 `YYYY-MM-DD`；slug 和可选 `--output` 均受路径校验。机会目录下的 `new-brief`、`new-questions`、`new-due-diligence`、`new-research-brief`、`new-debrief`、`new-offer` 默认从 `record.md` frontmatter 读取 company / role，显式参数仅覆盖生成文档的标题或字段。CLI 提供的元数据会被替换，其他 `{{FIELD}}` 槽位会原样保留，供人工继续填写。脚手架只生成结构和元数据，不自动填入经历、公司结论、`INVENTORY.md` 或投递动作；`new-opportunity --jd-file` 只追加标注“待人工校对”的抽取草稿，不替代人工判断。

### 管理结构化日程与 Calendar.app

```bash
# 默认仅预览；确认后生成私密 JSON，并幂等创建或更新 Calendar.app 事件
node scripts/workbench.mjs schedule \
  --slug company-role --start 2026-09-03T19:00:00+08:00 \
  --duration-minutes 60 --mode managed --alarms "-86400,-1800"
node scripts/workbench.mjs schedule \
  --slug company-role --start 2026-09-03T19:00:00+08:00 \
  --duration-minutes 60 --mode managed --alarms "-86400,-1800" --confirm

# 邮件或外部 Calendar 事件已存在：只建立工作台可读取的镜像，不重复创建事件
node scripts/workbench.mjs schedule \
  --slug company-role --start 2026-09-03T19:00:00+08:00 \
  --duration-minutes 60 --mode mirror-only --confirm

# 已有面试改期：只更新唯一已有事件，默认不触碰 Calendar.app
node scripts/workbench.mjs reschedule \
  --slug company-role --stage r1 --start 2026-09-04T19:00:00+08:00
node scripts/workbench.mjs reschedule \
  --slug company-role --stage r1 --start 2026-09-04T19:00:00+08:00 \
  --mode managed --confirm

# Calendar.app 底层查询、回读与精确删除
node scripts/calendar.mjs list-calendars
node scripts/calendar.mjs list --calendar 工作 --from 2026-09-01T00:00:00+08:00
node scripts/calendar.mjs show --calendar 工作 --uid EVENT_UID
node scripts/calendar.mjs delete --calendar 工作 --uid EVENT_UID --confirm
```

`schedule` 的 `--alarms` 是逗号分隔的负秒数，必须能整除 60；默认 `-86400,-1800`，即提前 1 天和提前 30 分钟。Calendar.app 的 AppleScript 接口使用分钟，脚本负责换算。`managed` 会调用 Calendar.app 幂等 upsert；`mirror-only` 只写入 `private-notes/calendar/<slug>-*.json`。两种模式均默认 dry-run，只有 `--confirm` 才修改主档和私密输入。

**旧提醒兼容边界**：upsert 检测到历史版本把秒值误写成分钟的提醒时，会在修改事件前失败，要求先在 Calendar.app 中核对并清理旧提醒。脚本不会自动删除或重建整个事件，避免丢失参与人、重复规则或其他未输入字段；正常事件仍原地幂等更新。

**日历后端**：managed 模式通过 Calendar.app 写入指定日历。账户同步行为取决于用户配置，不附私人账户或日历标识。

**UID 不是稳定标识**：日历迁移可能改变 UID。修改通过稳定 eventId 匹配，精确删除前现场回读日历与 UID。

`new-*` 脚手架只生成“下一步要填写的空白工作对象”，不替代人工事实核验；`schedule` 只投影调用方显式提供的定档事实，不从主档正文猜测日期、时长、形式或会议入口：

- `new-opportunity` 只在真实人工邀约后使用，并先建立唯一 `record.md`。
- `new-due-diligence` 生成 G1 公司 / JD 机会建模工作区；`new-research-brief` 生成一个证据面的子代理任务单。二者都要求对应机会主档已存在。
- `new-brief`、`new-questions`、`new-debrief` 都要求对应机会主档已存在。
- `new-material` 完成后人工把事实和来源核验结果回填 `INVENTORY.md`；`new-opportunity --jd-file` 的抽取草稿确认后吸收进主档并删除草稿节。
- `new-resume-version` 只记录简历投影、构建和归档证据；`new-offer` 只在书面或明确口头 Offer 后使用。

**已取消 / 未举行的面试日程输入不删除**：把对应 JSON 从 `private-notes/calendar/` 顶层移入 `private-notes/calendar/cancelled/` 归档即可。日历读取只非递归扫描 `calendar/` 顶层、且只接受 `<slug>-*.json`，所以归档目录既不参与 `stage` 轮次推导，也不进入 `list` / `audit` / `dashboard`。


## 文档边界

各工作台文档的边界定义（`record.md` / `due-diligence.md` / `debrief.md` / `quick-brief.md` / `question-script.md` / `offer-decision.md`）见 [`../../AGENTS.md`](../../AGENTS.md) §6「文档边界」，本节不再逐条重述。本目录额外纪律只有一条：`offer-decision.md` 是候选人决策材料，不把公司宣传直接当事实。
