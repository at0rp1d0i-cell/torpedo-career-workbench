---
name: interview-aftercare
description: 面试后仅按明确事实快速留证据或录入招聘方结果，使用 new-debrief --quick 和 record-outcome --sync；不用于岗位判断、技术补答、Offer 决策或推断招聘结果。
---

# 轻量面试后维护

## 最小上下文

读取对应 record.md、相关轮次日程和目标复盘。纯现场记录或明确反馈回填无需加载尽调、历史研究、全部其他轮复盘或个人项目总账。涉及技术核验、岗位评价或职业判断时回到完整 context 路径。

## 面试刚结束

用原话或标注为回忆的几条记录先保存，允许未知项留空。轮次或日期不能唯一确定时，只补问这些关键信息。不要把准备稿或未发生面试写成现场证据。

```bash
node scripts/workbench.mjs new-debrief --slug SLUG --stage r1 --quick --notes-file PATH
```

有该轮唯一已结束日程时可省略日期；否则提供 `--date YYYY-MM-DD`。只建立一份 canonical debrief，并补齐主档和工作区索引链接。已有文件继续补充，不运行 --force 覆盖。

## 收到结果

只使用用户明确提供的反馈，结果和主档状态分别表达；`通过` 不自动等于进入 G3。

```bash
node scripts/workbench.mjs record-outcome --slug SLUG --stage r1 --result 通过 --next-action "等待下一轮定档" --sync
```

同一次调用同步复盘结果、显式主档字段、主档 / README 索引与速览的 Gate 投影。Gate / status 只有明确参数才修改；G3 要求必填非 HR 轮次均有明确通过结果。多个复盘候选时显式选文件，不猜测。

## 之后按需深挖

在原复盘中补关键问题、技术核验、正式补答或后续动作；不另建同场事实记录。不因模板有空白就要求全部填满，不把单次结果直接回流职业方向。

## 安全与收尾

会议入口、会议 ID 和招聘方私人联系方式放在私密输入中，不写进复盘。一次明确授权内的机械同步直接完成；只在事实歧义或需要判断时提问。写入后运行 `node scripts/workbench.mjs validate`，不操作 Calendar.app，不启动浏览器。
