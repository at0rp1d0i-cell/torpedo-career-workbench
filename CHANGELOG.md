# Changelog

## 0.2.0

- 新增 `retro` / `new-retro`：周期结果分布、轮次通过情况、收尾清单与周期复盘模板。
- 修复 `new-debrief` 未给 `--date` 时因缺少导入崩溃。
- `context --slug` 现在校验 slug，拒绝越界路径。
- `set-process` 未给 `--round` 时保留已有面试流程；新增 `--clear-rounds` 显式清空。
- `verify.sh` 补充 `jd-intake.mjs` 与 `retro.mjs` 语法检查；去除 CLI 内重复的工具函数。

## 0.1.0

- 初始开源模板：素材治理、简历、机会 Gate、面试复盘、上下文路由、CLI 和只读 Dashboard。
- 可选 macOS Calendar.app 集成；写入默认预览且需显式确认。
- 附虚构示例；不包含个人工作台历史、真实求职档案、照片或原始 PDF。
