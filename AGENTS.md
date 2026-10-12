# 求职工作台 Agent 指引

本文件是本仓库的 Agent 工作协议。顶层 `README.md` 面向项目使用者和潜在开源读者；本文件及各子目录 README 面向维护仓库的 Agent。

## 1. 项目目标

维护一套可追溯的 AI infra（AI 基础设施）求职工作台，覆盖：

- 简历正文、版本和归档；
- 个人与项目素材证据；
- 投递索引；
- 真实面试机会、公司 / 岗位尽调、面试准备和单场复盘；
- 后续轮、Offer 雇佣核验和候选人决策；
- 受安全边界约束的表单与 Calendar.app 辅助脚本。

不要把仓库扩展成招聘网站、自动投递系统或投资研究系统。

本工作台长期维护素材与证据，求职按周期启用。入职后材料先按 [INTAKE.md](INTAKE.md) §7 核对公开、保密与归属边界；判断修订记录在 [career-thinking/decision-log.md](career-thinking/decision-log.md)。

## 2. 权威对象与所有权

| 对象 | 权威文件 / 目录 | 规则 |
|---|---|---|
| 个人与项目事实 | `INVENTORY.md` | 简历只能引用“已核实 + 入选”条目 |
| 素材准入 | `INTAKE.md` | 先入账，再核实，再决定是否进简历 |
| 原始证据 | `sources/` | 证据应可追溯；没有证据的口述必须标状态 |
| 投递索引 | BOSS 直聘（仓库外） | 投递与渠道状态在 BOSS 直聘跟踪；仓库从 G1 真实邀约开始 |
| 公司 × 岗位机会 | `interview-prep/opportunities/<slug>/record.md` | 一个公司 × 一个岗位只有一份 canonical opportunity record（规范机会主档） |
| 公司 / 岗位尽调 | 主档或同目录 `due-diligence.md` | G1 启动；研究量小可直接写主档，研究量大再拆文件 |
| 单场面试 | `interview-prep/debriefs/<date>-<slug>-<stage>.md` | 每场独立记录，不复制岗位事实 |
| 可跨机会复用的技术叙事 | `interview-prep/shared/` | 只放稳定、可复用且边界清楚的材料 |
| 简历版本 | `resume/templates/resume-version.md` 及 `private-notes/resume-versions/` | 记录投影、构建、投递和归档事实，不创造经历 |
| 会议隐私 | Calendar.app 与被忽略的 `private-notes/calendar/` | 仓库不保存会议链接、会议 ID、私人电话和私人邮箱 |

### 机会上下文加载（按任务风险分层）

涉及公司、岗位或机会的讨论、判断、准备、结果流转和事实修改时，Agent 在回复或修改前生成该机会的本地上下文清单：

```bash
node scripts/workbench.mjs context --match "公司或岗位文本"
# 已知规范标识时优先使用：
node scripts/workbench.mjs context --slug SLUG
```

纯机械的已建档日程维护（仅调整已有事件的日期、时间、时长、提醒或同步待复盘日期）使用 `.agents/skills/interview-workbench-ops/SKILL.md` 的轻量路径，不要求读取 `due-diligence.md`、`quick-brief.md` 或 `question-script.md`；仍必须读取对应 `record.md` 与私密日历输入，并通过受控命令完成写入。

- `context` 是动态 routing manifest（路由清单），不是新的事实源；状态与内容仍由 `record.md`、`due-diligence.md`、关联复盘和其他权威文件负责。
- 必须在回复用户前完整读取输出中的“必读文件”；不能只读 `interview-prep/README.md`、`quick-brief.md` 或搜索摘要。按需文件只在当前问题涉及其主题时读取。
- 输出为“默认禁止外部搜索”时，不得调用 Web Search、Browser 或外部研究子代理重复背调。只有用户明确要求刷新、现有材料明确记录且当前问题依赖关键缺口，或时效变化会影响当前面试 / Offer 决策时才可例外；例外前必须说明要补什么及原因。
- 已尽调材料中的“待确认”通常是面试官 / HR 核验项，不自动构成再次联网搜索的理由。仓库没有的信息应标为未知，不用外部猜测补齐。
- 输出为“需要补齐 G1 证据”时，先读主档并界定缺失证据面，再按第 4 节协议开展最小必要研究；不得重做已经存在的本地结论。

浏览器使用另遵守 `.agents/skills/browser-verification/SKILL.md`：需要显示或交互验证时，Agent 必须主动询问本次是否授权；未授权不得使用 relay、用户现有 Chrome 或共享浏览器，优先使用隔离实例。

上下文分为三个域，路由目录位于 `context/index.json`：

- `opportunity`：单个公司 × 岗位的主档、尽调、面试复盘和 Offer 材料；具体机会必须用 `--slug` 或 `--match`。
- `career`：个人对岗位整体质感、职业方向、偏好和选择标准；使用 `node scripts/workbench.mjs context --scope career`。
- `profile`：个人教育、技能、项目、奖项和证据边界；使用 `node scripts/workbench.mjs context --scope profile`。联系方式默认按需，不进入普通聊天上下文。
- 机会讨论若涉及“是否值得 / 岗位整体评价”，追加 `career`；若涉及“我是否匹配 / 如何介绍项目 / 简历表述”，追加 `profile`。不相关域不读取。
- 需要同时获得三个域的读取计划时，使用 `context --scope all --slug SLUG` 或 `--match TEXT`；它仍只输出索引，不自动读取全部文件。

索引只描述路径、章节、必要性、按需条件和事实所有权；任何域的事实都回到其 canonical owner（规范所有者），禁止把索引当作新的摘要事实源。

## 3. 机会 Gate 与正确时序

```text
G0 投递
  → G1 真实人工邀约：立即公司 / JD 尽调与岗位建模
  → G2 日期、时间、形式确认：Calendar + 面试执行材料
  → 单场 debrief（每一轮一份）
  → G3 全部技术面通过：HR 谈薪 / Offer 雇佣核验
  → G4 关闭
```

Gate 边界：G2 覆盖整段面试执行期（含技术面各轮与后续轮），**通过一轮不等于进入 G3**；只有全部非 HR 轮次均已通过、流程进入 HR 谈薪 / Offer 决策时才置 `G3`。`audit` 对提前置位的 G3 报 `gate-g3-premature`，不得靠改写措辞绕过。

### G0 · 投递

投递与初筛在 BOSS 直聘完成，不写入仓库。自动回执、简历被查看和进入人才库不算人工邀约；没有真实邀约不建机会主档，不做逐岗尽调。

### G1 · 面试前机会尽调

收到真实面试邀约后立即开始，不等待日期定档。通过公司背景和 JD 建模：

- 法律主体、品牌与招聘主体；
- 公司阶段、产品、技术资产、融资、商业化和团队；
- JD 的直接交付、技术栈、硬约束和加分项；
- 岗位真实工作对象、交付链路、岗位高价值 / 低价值版本；
- 与 `INVENTORY.md` 的匹配、缺口和不可声称边界；
- 是否值得投入面试、面试需要验证的关键假设和准备重点。

G1 判断的是“是否值得投入面试、岗位可能是什么”；不是 Offer 接受决定。

### G2 · 已定档

日期、时间和形式确认后才写入 Calendar.app，并补齐 quick brief、question script、项目准备和设备检查。G2 覆盖整段面试执行期（技术面各轮与后续轮到 HR 之前）；G2 不应成为首次岗位判断阶段。

### G3 · 全部技术面通过（HR 谈薪 / Offer 决策）

进入条件：`interview-process` 里所有非 `hr` 的必填轮次都已有「通过」结果，流程进入 HR 谈薪 / Offer 决策。技术面尚未全部通过时保持 G2，不用「进入下一轮」「初试通过」替代进入条件。

在 G1 已有模型上追加：合同主体、薪资结构、发薪、社保、公积金、headcount、转正 / 试用、导师、代码权限、工作强度、岗位稳定性和 Offer 决策门槛。不要重新抄录 G1 的公司背景和 JD。

### G4 · 关闭

记录结果、已知原因、未知原因和可复用反馈。单次结果不能直接改写职业方向；重复信号才回流 `career-thinking/`。

### 周期收尾

一个招聘周期告一段落时，先运行 `node scripts/workbench.mjs retro --cycle YYYY-autumn` 查看收尾清单（未关闭机会、待反馈复盘、缺 `offer-decision.md` 的 Offer、已关闭机会的未来日程），逐项用受控命令处理或写明保留理由；清单处理完再用 `new-retro --cycle` 生成 `career-thinking/retros/<cycle>.md`。周期复盘只沉淀至少两个机会出现的信号，回流位置仍是 `career-thinking/` 的对应文件。

## 4. 公司 / 岗位尽调协作协议

主代理先做实体消歧和问题定义，再按证据面并行派发子代理。根据问题规模选择 2–5 个模块，不固定启动全部模块：

1. **主体与官方事实**：法律主体、品牌关系、官网、地点、成立时间、管理团队、官方产品和招聘主体。
2. **业务、融资与组织状态**：融资、股东、收入 / 客户 / 订单、商业阶段、人员变化；区分公司自述和第三方材料。
3. **技术与产品**：产品形态、目标硬件 / 模型、技术路线、论文、专利、开源仓库、开发者材料、benchmark 和真实落地证据。
4. **JD 与岗位建模**：拆解工作对象、交付链路、技术栈、岗位上限 / 下限，并与候选人事实逐项匹配。
5. **风险与雇佣信号**：主体矛盾、招聘异常、诉讼 / 处罚、裁员 / 欠薪、工作强度、合同与发薪线索；匿名评价只能作为低置信线索。

### 子代理输出合同

每个子代理只负责一个证据面，输出：

1. **简报**：3–8 条最影响面试投入或岗位判断的结论；每条标注 `已核实事实 / 公司自述 / 第三方说法 / 分析推断 / 待确认`。
2. **来源表**：只列实际打开和核对过的来源，包含标题、URL、来源类型、发布日期 / 数据日期、检索日期、支持的结论和边界。
3. **判断准则**：说明如何判断技术资产真实度、商业化强度、岗位研发含量、风险等级或匹配度；不替主代理做总判断。
4. **冲突与缺口**：记录来源矛盾、尚未找到的关键证据，以及需要面试官 / HR 确认的问题。

禁止：倒入原始搜索结果、罗列重复转载、只给链接不说明支持什么、把宣传写成事实、把相邻经验包装成已完成经历、修改主档或替主代理判断去留。

停止条件：问题已覆盖；关键结论已有足够等级来源或明确缺口；新增搜索只产生重复噪声；时效性结论已有发布日期 / 数据日期和检索日期。

### 主代理整合顺序

1. 检查实体一致性，合并同一来源的转载，分级来源并记录日期。
2. 分离已核实事实、公司自述、第三方说法、分析推断和待确认项；冲突保留，不强行平均。
3. 先写尽调证据与岗位模型，再把执行摘要、继续面试判断、匹配和待验证问题回填 `record.md`。
4. G2 从已整合模型生成准备材料；G3 只追加雇佣核验。

## 5. 受控词表与元数据合同

状态与标识字段以 `record.md` / `debrief.md` 顶部的 frontmatter 为唯一权威；正文只保留人读叙事，不承担状态权威。脚本只读 / 写 frontmatter，状态流转使用命令而非手改字段。

- `record.md` 字段：`slug` / `company` / `role` / `opportunity-type` / `recruiting-cycle` / `interview-process-source` / `interview-process-as-of` / `interview-process` / `gate` / `status` / `next-action` / `updated-at`。
- `opportunity-type` 只允许：`campus`（校招正式岗）/ `internship`（实习）/ `experienced`（其他正式岗）；`recruiting-cycle` 使用 `YYYY-spring` 或 `YYYY-autumn`。
- `interview-process` 是按顺序排列的预计面试轮次数组，每项有稳定 `id`、展示 `label`、`kind`，可用 `optional: true` 标记可能追加轮次；`interview-process-source` 与 `interview-process-as-of` 记录 HR / 招聘方口径来源和日期。预计轮次与实际轮次状态必须分离。
- `gate` 只允许：`G0` / `G1` / `G2` / `G3` / `G4`；`G3` 的进入条件是「全部非 HR 轮次均已通过」，由 `audit` 的 `gate-g3-premature` 拒绝提前置位；`schedule` / `reschedule` 只在 G1→G2 自动前进，之后的 Gate 流转一律显式。
- `status` 只允许受控词表：已投 / 自动测评 / 笔试待进行 / 面试邀约 / 面试中 / Offer / 感谢信 / 未通过 / 流程终止 / 无回复关闭 / 搁置 / 放弃 / 主动终止 / HC 取消；细节（如“HC 取消”“候选人主动终止”）写入正文，不另造状态值。
- `debrief.md` 字段：`session-id` / `opportunity` / `stage` / `date` / `result`；`opportunity` 必须对应已建档机会目录；`result` 只允许：通过 / 未通过 / 进入下一轮 / 待反馈 / 流程终止 / 未知。`stage` 与结构化日程使用面试流程稳定 ID；历史旧 stage 可兼容读取，但新记录使用流程 ID。
- 面试定档：优先使用 `node scripts/workbench.mjs schedule --slug SLUG --start ISO --stage STAGE --mode managed|mirror-only [--alarms "-86400,-1800"] [--confirm]`；一次更新 G2 frontmatter 与结构化日历输入。已有日程改期使用 `reschedule --slug SLUG --start ISO --stage STAGE|--event-id ID`，只更新唯一已有事件，不静默创建；默认 dry-run / mirror-only，`managed --confirm` 才更新 Calendar.app。
- `set-process` 用于把 HR 预计流程和机会类型写入主档；未给 `--round` 时保留已有流程，只有显式 `--clear-rounds` 才清空；`dashboard` 只读聚合预计流程、实际轮次、日程、复盘和审计结果，不修改事实。
- `set-gate` / `set-status` 只处理没有日程写入的人工状态修正；命令自动刷新 `updated-at`。`list` / `gate` / `audit` / `queue` 可读取带时区的私密日历输入推导时间状态，但不自动修改人工字段；`audit --strict` 只报告缺陷并以非零退出。`audit` 另输出「仓库一致性」段，覆盖手维护材料与主档状态的一致性——`interview-prep/README.md` 的岗位机会表 / 复盘索引 vs 实际目录、`quick-brief.md` 头部「当前 Gate」vs 主档 `gate`、旧模板主档缺 `opportunity-type` / `recruiting-cycle`；这些检查只报告，不自动修改任何文件。
- `audit` 的「面试材料 / 复盘」类检查（`missing-quick-brief`、`missing-question-script`、`missing-debrief`、`missing-closed-debrief`）只在机会确实存在**非笔试（`kind: assessment`）轮次**的活动（结构化日程或已建复盘）时触发。只排了笔试、尚未进入任何面试的机会——G2 常因笔试定档被 `schedule` 自动推进——不触发这些检查；`interview-process` 未配置时无法判定轮次类型，按「存在活动即要求」保守处理，避免漏报真实面试。笔试阶段的时间状态仍由 `next-action` 与 `queue` 表达，不靠审查告警。
- `retro` 只读聚合周期结果、轮次通过情况与收尾清单，不修改任何文件；`new-retro` 只生成带当时快照的复盘草稿，默认拒绝覆盖。
- `record-outcome` 仅按显式 `--gate` / `--status` / `--next-action` 和 `--result` 更新；可用 `--stage` 将结果绑定到具体轮次；复盘结果必须指定唯一待反馈复盘或显式文件名，不自动把“通过”升级为下一轮。
- 脚手架的 company / role 缺省时从对应 `record.md` frontmatter 读取；显式参数可覆盖生成文档标题，但不改变主档事实。
- 任何 Agent 修改机会或复盘文档后必须通过 `node scripts/workbench.mjs validate`；字段漂移、`context/index.json` 声明路径与文档间相对链接（`private-notes/` 等冻结归档除外）由校验器拒绝，不依赖措辞约定。

## 6. 文档边界

- `record.md` 是当前机会的压缩主档，不复制为每一轮面试文件。
- `due-diligence.md` 是较完整的 G1 证据工作区，不是只有 G3 才能创建的 Offer 文档。
- `debrief.md` 只记录一场面试的现场事实、回答表现、诊断、补答和影响边界。
- `quick-brief.md` 只压缩已整合的主档，不创造新事实。
- `question-script.md` 是现场交互工具，不是答案事实源。
- `offer-decision.md` 只在书面或明确口头 Offer 后使用。
- `career-thinking/` 只接收跨机会重复信号或足以改变职业方向的证据。

## 7. 隐私与脚本安全


- 不把会议链接、会议 ID、招聘方私人联系方式写入仓库。
- Calendar 创建 / 更新默认 dry-run；只有显式 `--confirm` 才写入。
- Calendar 删除必须精确指定日历和 UID，并显式 `--confirm`；禁止批量删除。
- `scripts/workbench.mjs` 默认拒绝覆盖，并校验 slug、日期和自定义输出路径。
- 不提供网申最终 `submit/apply`，不增加批量删除或无审计自动操作。
- 浏览器 relay 不提供可靠的 session 所有权查询，默认视为可能被其他 session 或用户使用；没有用户对本次浏览器验证的明确授权不得连接。
- 运行产物、私密身份信息和日历输入必须保持在 `.gitignore` 范围内。

## 8. 修改后验证

执行入口是 `bash scripts/verify.sh`（内容即下列命令；收尾闸与模型跑的是同一个文件）。代码修改至少执行对应的窄验证：

```bash
node --check scripts/workbench.mjs
node --check scripts/workbench-data.mjs
node --check scripts/interview-process.mjs
node --check scripts/dashboard.mjs
node --check scripts/calendar.mjs
node --check scripts/jd-intake.mjs
node --check scripts/retro.mjs
node --test scripts/workbench.test.mjs
node scripts/workbench.mjs validate
```

Calendar 行为修改需要实际验证 dry-run、写入、重复 upsert、回读提醒和精确删除；纯日程数据调整使用 `reschedule` 的 dry-run / 行为测试 / 结构化输入回读即可，不因数据变化启动浏览器。只有 Dashboard 的渲染或交互逻辑修改才需要实际打开 HTML；调用 Browser 前必须按 `.agents/skills/browser-verification/SKILL.md` 主动询问浏览器授权并使用隔离实例。文档修改需要检查内部链接和旧 Gate 文案。

## 9. 目录内说明

- `interview-prep/README.md`：面试工作区索引和归档规则。
- `interview-prep/templates/README.md`：模板注册表、脚本入口和字段边界。
- `interview-prep/templates/research-brief.md`：单个子代理的证据面任务单和输出合同。
- `career-thinking/README.md`：职业方向长期判断材料的维护规则。
- `career-thinking/retros/README.md`：周期复盘的生成方式与边界。
