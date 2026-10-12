---
name: interview-workbench-ops
description: 已建档面试机会的轻量机械维护；用于调整已有面试日期、时间、时长或提醒，并通过 reschedule 同步日历输入、主档、quick brief 和待反馈复盘。不要用于新机会尽调、岗位判断、结果或 Offer。
---

# 面试工作台轻量维护 Skill

## 触发

处理已建档机会的机械同步任务时使用，包括：

- 调整已有面试日期、时间或时长；
- 修正提醒、标题或面试形式；
- 同步结构化日历输入、Calendar.app、主档中的日期和待复盘入口。

不适用于新机会建档、公司 / JD 尽调、岗位价值判断、个人匹配、面试结果或 Offer 决策。

## 路由

纯日程调整优先使用：

```bash
node scripts/workbench.mjs reschedule \
  --slug SLUG \
  --stage STAGE \
  --start 2026-09-07T19:00:00+08:00
```

先 dry-run；确认影响范围后，只有需要写入时才追加 `--confirm`。若要更新 Calendar.app，显式使用 `--mode managed`；默认 `mirror-only` 不触碰 Calendar.app。

目标只能通过 `--stage` 或 `--event-id` 唯一确定。找不到事件、多于一个事件、目标复盘已存在或日历输入损坏时必须失败，不能静默新建或覆盖。

## 最小上下文

只读取：

1. 对应机会 `record.md`；
2. 对应 `private-notes/calendar/*.json`；
3. 需要随日期迁移的待反馈复盘和相关 quick brief。

不读取尽调、问题脚本、个人资料或外部网页，除非任务同时改变这些对象的事实或内容。

## 同步合同

- 日程的 `eventId` 是稳定身份；改期只修改 `start`、必要的结束时间派生字段、提醒和显式允许的展示字段。
- 主档 `next-action`、日期表格、设备检查时间和待反馈复盘日期必须同步。
- 已有复盘结果不因改期自动改变；只有 `待反馈` / `未知` 的复盘允许随同一 stage 改名迁移。
- 所有写入动作必须可回滚；Calendar.app 写入仍由底层 `calendar.mjs` 的显式确认和幂等 upsert 负责。
- 完成后运行 `node scripts/workbench.mjs validate`；不因纯数据变化启动浏览器。
