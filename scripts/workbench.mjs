#!/usr/bin/env node
import { appendFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { analyzeJd, loadJdIntake, renderJdDraft } from './jd-intake.mjs';
import { parseInterviewProcess, parseRoundSpecification, validateInterviewProcess } from './interview-process.mjs';
import { buildDashboardPayload, renderDashboardHtml, renderTerminalDashboard } from './dashboard.mjs';
import { buildRetroPayload, renderMarkdownSnapshot, renderTerminalRetro } from './retro.mjs';
import { quickDebrief, synchronizedOutcome } from './debrief-workflow.mjs';
import {
  auditOpportunity,
  auditPayload,
  auditRepositoryConsistency,
  auditSeverityLabel,
  buildContextPayload,
  loadRepositoryAuditInputs,
  validateContextCatalog,
  validateRepositoryLinks,
  CONTEXT_SCOPES,
  DEBRIEF_RESULTS,
  defaultDate,
  deriveOpportunityRuntime,
  formatRuntime,
  GATE_LABELS,
  GATES,
  loadOpportunityRows,
  localDate,
  OPPORTUNITY_STATUSES,
  opportunityCalendarEvents,
  opportunityCalendarFile,
  opportunityDebriefs,
  opportunityDir,
  outputPath,
  parseAt,
  readFrontmatter,
  opportunityDocFlags,
  RECORD_FIELDS,
  renderRecordUpdate,
  repoRelative,
  requireOpportunity,
  runtimePriority,
  runtimeScheduleKey,
  updateDebriefResult,
  updateRecordField,
  validateDebriefFrontmatter,
  validateRecordFrontmatter,
  ROOT,
  renderTemplate
} from './workbench-data.mjs';

const execFileAsync = promisify(execFile);
const CALENDAR_SCRIPT = join(ROOT, 'scripts', 'calendar.mjs');
const args = process.argv.slice(2);
const command = args.shift() ?? 'help';

function option(name) {
  const index = args.lastIndexOf(name);
  const value = index >= 0 ? args[index + 1] : undefined;
  return value && !value.startsWith('--') ? value : undefined;
}
function has(name) { return args.includes(name); }
function fail(message) { throw new Error(message); }
function required(name) { const value = option(name); if (!value) fail(`缺少 ${name}`); return value; }
function validateSlug(slug) { if (!/^[a-z0-9][a-z0-9-]{2,80}$/.test(slug)) fail(`slug 无效: ${slug}`); return slug; }
function validateDate(value, field) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(`${field} 必须是 YYYY-MM-DD`);
  const [year, month, day] = value.split('-').map(Number); const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) fail(`${field} 必须是有效的 YYYY-MM-DD 日期`);
  return value;
}

const COMMANDS = new Set(['new-opportunity', 'set-process', 'new-brief', 'new-questions', 'new-due-diligence', 'new-research-brief', 'new-debrief', 'new-material', 'new-resume-version', 'new-offer', 'schedule', 'reschedule', 'validate', 'list', 'gate', 'context', 'audit', 'queue', 'dashboard', 'retro', 'new-retro', 'record-outcome', 'set-gate', 'set-status']);

function usage() {
  console.log(`用法：
  node scripts/workbench.mjs new-opportunity --slug SLUG --company NAME --role NAME [--type campus|internship|experienced] [--cycle YYYY-autumn|YYYY-spring] [--jd-file PATH | --jd "文本"] [--rounds "2 轮：技术面+HR 面"] [--hc "有/无/待确认"] [--convert "转正机制"]
  node scripts/workbench.mjs set-process --slug SLUG --type campus|internship|experienced [--cycle YYYY-autumn|YYYY-spring] --source SOURCE --as-of YYYY-MM-DD [--round ID|KIND|LABEL[|optional]] ... [--clear-rounds]
  node scripts/workbench.mjs schedule --slug SLUG --start ISO --mode managed|mirror-only [--duration-minutes N] [--stage STAGE] [--event-id ID] [--calendar NAME] [--title TITLE] [--location LOCATION] [--description TEXT] [--alarms "-86400,-1800"] [--next-action TEXT] [--confirm]
  node scripts/workbench.mjs reschedule --slug SLUG --start ISO [--stage STAGE | --event-id ID] [--mode managed|mirror-only] [--duration-minutes N] [--title TITLE] [--location LOCATION] [--description TEXT] [--alarms "-86400,-1800"] [--next-action TEXT] [--confirm]
  node scripts/workbench.mjs new-brief --slug SLUG [--company NAME] [--role NAME]
  node scripts/workbench.mjs new-questions --slug SLUG [--company NAME] [--role NAME]
  node scripts/workbench.mjs new-due-diligence --slug SLUG [--company NAME] [--role NAME] --as-of YYYY-MM-DD
  node scripts/workbench.mjs new-research-brief --slug SLUG [--company NAME] [--role NAME] --area AREA --date YYYY-MM-DD
  node scripts/workbench.mjs new-debrief --slug SLUG [--company NAME] [--role NAME] [--date YYYY-MM-DD] --stage STAGE [--quick --notes TEXT | --quick --notes-file PATH]
  node scripts/workbench.mjs new-material --slug SLUG --name NAME --category CATEGORY --date YYYY-MM-DD
  node scripts/workbench.mjs new-resume-version --id VERSION_ID --company NAME --role NAME --date YYYY-MM-DD
  node scripts/workbench.mjs new-offer --slug SLUG [--company NAME] [--role NAME] --date YYYY-MM-DD
  node scripts/workbench.mjs validate
  node scripts/workbench.mjs list [--gate G0-G4] [--at ISO]
  node scripts/workbench.mjs context [--scope opportunity|career|profile|all] [--slug SLUG | --match TEXT] [--at ISO] [--json]
  node scripts/workbench.mjs audit [--gate G0-G4] [--at ISO] [--json] [--strict]
  node scripts/workbench.mjs queue [--gate G0-G4] [--at ISO] [--json]
  node scripts/workbench.mjs dashboard [--at ISO] [--window-days N] [--json] [--html] [--output PATH]
  node scripts/workbench.mjs retro [--cycle YYYY-autumn|YYYY-spring] [--type campus|internship|experienced] [--at ISO] [--json]
  node scripts/workbench.mjs new-retro --cycle YYYY-autumn|YYYY-spring [--type campus|internship|experienced] [--date YYYY-MM-DD]
  node scripts/workbench.mjs record-outcome --slug SLUG [--stage STAGE] [--status STATUS] [--gate G0-G4] [--result RESULT] [--debrief FILE] [--next-action TEXT] [--sync]
  node scripts/workbench.mjs set-gate --slug SLUG --gate G0-G4
  node scripts/workbench.mjs set-status --slug SLUG --status STATUS

说明：
  - 文档脚手架默认拒绝覆盖已有文件；需要覆盖时显式追加 --force。
  - reschedule 只更新已有日程；默认 mirror-only，managed 必须显式指定并追加 --confirm；不会在找不到唯一旧事件时静默创建。
  - schedule 对已有相同 stage 的日程复用 eventId 和输入文件；新建日程有 stage 时使用 slug + stage 的稳定 eventId，无 stage 时才用 slug + 日期；已有日程调整请使用 reschedule 保留原身份。
  - dashboard 是只读投影，聚合预计流程、实际轮次、日程、复盘和审计结果，不修改事实。
  - retro 是只读周期复盘：聚合结果分布、轮次通过情况和未收尾事项；new-retro 生成 career-thinking/retros/<cycle>.md 草稿并嵌入当时快照。
  - record-outcome 只在显式参数或指定待反馈复盘记录结果，不自动推断招聘结论。
  - --at 仅用于按指定时刻查看历史状态，不会修改 record.md。`);
}

function parseScheduleStart(value) {
  if (typeof value !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/.test(value)) fail('--start 必须是带时区的 ISO 时间，例如 2026-09-02T18:00:00+08:00');
  const match = value.match(/^(\d{4}-\d{2}-\d{2})T/); if (!match) fail(`--start 不是有效日期: ${value}`); validateDate(match[1], '--start 日期'); const date = new Date(value); if (Number.isNaN(date.getTime())) fail(`--start 不是有效日期: ${value}`);
  return { value, date: match[1], display: value.slice(0, 16).replace('T', ' ') };
}
function parseIntegerOption(name, fallback, min, max) { const raw = option(name); if (raw === undefined) return fallback; if (!/^\d+$/.test(raw)) fail(`${name} 必须是 ${min}–${max} 的整数`); const value = Number(raw); if (value < min || value > max) fail(`${name} 必须是 ${min}–${max} 的整数`); return value; }
function parseAlarmOffsets() { const alarms = (option('--alarms') ?? '-86400,-1800').split(',').map(value => Number(value.trim())); if (!alarms.length || alarms.some(value => !Number.isInteger(value) || value >= 0 || value % 60 !== 0)) fail('--alarms 必须是逗号分隔、可整除 60 的负整数秒数'); if (new Set(alarms).size !== alarms.length) fail('--alarms 不能包含重复提醒'); return alarms; }
function validateScheduleStage(value) { if (!/^[a-z0-9][a-z0-9-]{0,60}$/.test(value)) fail(`--stage 无效: ${value}`); return value; }
function validateScheduleEventId(value, slug) { if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,120}$/.test(value)) fail('--event-id 必须是 3–121 位 ASCII slug，只能包含字母、数字、点、下划线和短横线'); if (!value.startsWith(`${slug}-`)) fail(`--event-id 必须以 ${slug}- 开头，确保工作台能归属日程`); return value; }
function localMeetingParts(start, durationMinutes) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false }).formatToParts(start).reduce((result, part) => { if (part.type !== 'literal') result[part.type] = part.value; return result; }, {});
  return { date: `${parts.year}-${parts.month}-${parts.day}`, weekday: ({ Mon: '周一', Tue: '周二', Wed: '周三', Thu: '周四', Fri: '周五', Sat: '周六', Sun: '周日' })[parts.weekday] ?? parts.weekday, time: `${parts.hour}:${parts.minute}`, durationMinutes, start };
}
function meetingStartLabel(meeting) { return `${meeting.date}（${meeting.weekday}）${meeting.time}`; }
function meetingLabel(meeting) { const end = new Date(meeting.start.getTime() + meeting.durationMinutes * 60 * 1000); const endParts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(end).reduce((result, part) => { if (part.type !== 'literal') result[part.type] = part.value; return result; }, {}); return `${meetingStartLabel(meeting)}–${endParts.hour}:${endParts.minute}`; }
function syncEventDescription(description, meeting) {
  if (typeof description !== 'string' || !description) return `面试时间：${meetingStartLabel(meeting)}。`;
  return description.replace(/^面试日期：.*$/m, `面试日期：${meeting.date}（${meeting.weekday}）`).replace(/^面试时间：.*$/m, `面试时间：${meeting.time}（GMT+8）`);
}
function syncRecordBody(content, meeting, oldDebriefName = null, newDebriefName = null) {
  return content.split(/\r?\n/).map(line => {
    if (/^> 本次视频面试已(?:定于|调整至)/.test(line)) return `> 本次视频面试已调整至 ${meetingStartLabel(meeting)}（GMT+08:00）；结构化私密日历输入已同步。会议入口不写入本主档。`;
    if (/^\| 日期与时间 \|/.test(line)) return `| 日期与时间 | ${meetingLabel(meeting)}，GMT+8 |`;
    if (line.includes('**时间与设备**')) return line.replace(/(\*\*时间与设备\*\*：).*$/, `$1${meetingStartLabel(meeting)} 前至少 10 分钟打开 Calendar.app 中的面试事件；检查浏览器或面试客户端、摄像头、麦克风、网络、电源和共享屏幕；不从仓库寻找会议链接。`);
    if (oldDebriefName && newDebriefName) return line.replaceAll(oldDebriefName, newDebriefName);
    return line;
  }).join('\n');
}
function syncBriefBody(content, oldDate, meeting, oldDebriefName = null, newDebriefName = null) {
  return content.split(/\r?\n/).map(line => {
    if (/^> 更新时间：/.test(line)) line = `> 更新时间：${defaultDate()}`;
    if (/本场：/.test(line)) line = line.replace(/\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}/, `${meeting.date} ${meeting.time}`).replaceAll(oldDate, meeting.date);
    if (line.includes('时间与设备')) line = line.replaceAll(oldDate, meeting.date).replace(/\d{2}:\d{2}/, meeting.time);
    if (oldDebriefName && newDebriefName) line = line.replaceAll(oldDebriefName, newDebriefName);
    return line;
  }).join('\n');
}
function nextActionForSchedule(data, meeting) {
  const explicit = option('--next-action'); if (explicit) return explicit;
  const current = data['next-action'] ?? '';
  if (current && /\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/.test(current)) return current.replace(/\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/, `${meeting.date} ${meeting.time}`);
  if (current && /\d{1,2}月\d{1,2}日\s*\d{1,2}:\d{2}/.test(current)) { const [, month, day] = meeting.date.match(/^\d{4}-(\d{2})-(\d{2})$/); return current.replace(/\d{1,2}月\d{1,2}日\s*\d{1,2}:\d{2}/, `${Number(month)}月${Number(day)}日${meeting.time}`); }
  return current || `准备 ${meeting.date} ${meeting.time} 面试；面试后立即复盘`;
}
async function existingSchedule(slug, eventId, stage) {
  const calendar = await opportunityCalendarEvents(slug); if (calendar.warnings.length > 0) fail(`已有日历输入无法解析：${calendar.warnings.join('；')}`);
  const matches = calendar.events.filter(event => eventId ? event.eventId === eventId : stage ? event.stage === stage : false);
  if (matches.length > 1) fail(`找到多个匹配日程，请用 --event-id 精确指定：${matches.map(event => event.file).join('、')}`);
  return matches[0] ?? null;
}
async function pendingDebriefRename(slug, stage, oldDate, newDate) {
  if (!stage || oldDate === newDate) return null;
  const pending = (await opportunityDebriefs(slug)).filter(item => item.data.stage === stage && item.data.date === oldDate && ['待反馈', '未知'].includes(item.data.result));
  if (pending.length > 1) fail(`找到多份待处理复盘，无法随日程迁移：${pending.map(item => item.name).join('、')}`);
  if (pending.length === 0) return null;
  const oldName = pending[0].name; const newName = `${newDate}-${slug}-${stage}.md`; const oldPath = pending[0].path; const newPath = join(ROOT, 'interview-prep', 'debriefs', newName);
  try { await readFile(newPath, 'utf8'); fail(`目标复盘已存在，拒绝覆盖：${newName}`); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const oldContent = await readFile(oldPath, 'utf8'); const newContent = oldContent.replace(/^session-id: .*$/m, `session-id: ${newDate}-${slug}-${stage}`).replace(/^date: .*$/m, `date: ${newDate}`).replace(new RegExp(`^(# .* · )${oldDate}( · )`, 'm'), `$1${newDate}$2`);
  return { oldName, newName, oldPath, newPath, oldContent, newContent };
}

async function buildSchedulePlan() {
  const slug = validateSlug(required('--slug')); const mode = required('--mode');
  if (!['managed', 'mirror-only'].includes(mode)) fail('--mode 必须是 managed 或 mirror-only');
  const recordPath = await requireOpportunity(slug); const { content: recordContent, data } = await readFrontmatter(recordPath);
  if (data.gate === 'G0') fail('G0 尚未进入真实邀约，不能建立面试日程');
  if (data.gate === 'G4') fail('G4 机会已关闭，不能建立新日程');
  const start = parseScheduleStart(required('--start')); const durationMinutes = parseIntegerOption('--duration-minutes', 60, 5, 1440);
  const stage = option('--stage') ? validateScheduleStage(option('--stage')) : undefined; const process = parseInterviewProcess(data);
  if (stage && process.configured && !process.steps.some(step => step.id === stage)) fail(`--stage=${stage} 不在 interview-process 中；可用值：${process.steps.map(step => step.id).join('、')}`);
  const requestedEventId = option('--event-id'); if (requestedEventId) validateScheduleEventId(requestedEventId, slug);
  const existing = await existingSchedule(slug, requestedEventId, stage); let previousEventContent = null; let previousEvent = null;
  const eventPath = existing ? join(ROOT, 'private-notes', 'calendar', existing.file) : null;
  if (eventPath) {
    previousEventContent = await readFile(eventPath, 'utf8');
    try { previousEvent = JSON.parse(previousEventContent); } catch (error) { fail(`现有日历输入无法解析: ${repoRelative(eventPath)}: ${error.message}`); }
  }
  const eventId = validateScheduleEventId(requestedEventId ?? existing?.eventId ?? `${slug}-${stage ?? `interview-${start.date.replaceAll('-', '')}`}`, slug);
  const meeting = localMeetingParts(new Date(start.value), durationMinutes);
  const alarms = has('--alarms') ? parseAlarmOffsets() : previousEvent?.alarms ?? parseAlarmOffsets();
  const event = { ...(previousEvent ?? {}), version: 1, eventId, ...(stage ? { stage } : {}), calendar: option('--calendar') ?? previousEvent?.calendar ?? '工作', title: option('--title') ?? previousEvent?.title ?? `${data.company}｜${data.role}｜面试`, start: start.value, durationMinutes, location: option('--location') ?? previousEvent?.location ?? '视频面试', description: option('--description') ?? syncEventDescription(previousEvent?.description ?? '', meeting), alarms };
  const eventRelativePath = existing ? `private-notes/calendar/${existing.file}` : `private-notes/calendar/${eventId}.json`; const resolvedEventPath = eventPath ?? join(ROOT, eventRelativePath);
  if (previousEvent?.eventId && previousEvent.eventId !== eventId) fail(`现有日历输入 eventId 不一致: ${eventRelativePath}`);
  const nextGate = data.gate === 'G1' ? 'G2' : data.gate; const nextAction = nextActionForSchedule(data, meeting);
  const rendered = renderRecordUpdate(recordContent, data, { gate: nextGate, 'next-action': nextAction });
  const renderedRecord = { ...rendered, content: syncRecordBody(rendered.content, meeting) };
  return { slug, mode, event, eventPath: resolvedEventPath, eventRelativePath, previousEventContent, recordPath, recordRelativePath: `interview-prep/opportunities/${slug}/record.md`, recordContent, recordUpdates: { gate: nextGate, 'next-action': nextAction }, renderedRecord };
}
async function runCalendarUpsert(eventPath) { try { const result = await execFileAsync(process.execPath, [CALENDAR_SCRIPT, 'upsert', '--input', eventPath, '--confirm'], { cwd: ROOT, maxBuffer: 1024 * 1024 }); return JSON.parse(result.stdout); } catch (error) { throw new Error(`Calendar.app upsert 失败: ${String(error.stderr ?? error.message).trim()}`); } }
async function applySchedule(plan) { const eventContent = `${JSON.stringify(plan.event, null, 2)}\n`; await mkdir(dirname(plan.eventPath), { recursive: true }); try { await writeFile(plan.eventPath, eventContent); await writeFile(plan.recordPath, plan.renderedRecord.content); return plan.mode === 'managed' ? await runCalendarUpsert(plan.eventPath) : { action: 'mirror-only' }; } catch (error) { await Promise.allSettled([writeFile(plan.recordPath, plan.recordContent), plan.previousEventContent === null ? rm(plan.eventPath, { force: true }) : writeFile(plan.eventPath, plan.previousEventContent)]); throw error; } }
async function buildReschedulePlan() {
  const slug = validateSlug(required('--slug')); const recordPath = await requireOpportunity(slug); const { content: recordContent, data } = await readFrontmatter(recordPath);
  if (data.gate === 'G0' || data.gate === 'G4') fail(`${data.gate} 机会不能调整面试日程`);
  const stage = option('--stage') ? validateScheduleStage(option('--stage')) : undefined; const eventId = option('--event-id');
  if (!stage && !eventId) fail('reschedule 必须指定 --stage 或 --event-id');
  if (stage && eventId) fail('--stage 与 --event-id 只能指定一个');
  if (eventId) validateScheduleEventId(eventId, slug);
  const existing = await existingSchedule(slug, eventId, stage); if (!existing) fail('找不到唯一已有日程；reschedule 不会静默创建新事件');
  const eventPath = join(ROOT, 'private-notes', 'calendar', existing.file); let previousEventContent;
  try { previousEventContent = await readFile(eventPath, 'utf8'); } catch (error) { fail(`找不到日历输入文件：${existing.file}`); }
  let previousEvent; try { previousEvent = JSON.parse(previousEventContent); } catch (error) { fail(`现有日历输入无法解析：${existing.file}: ${error.message}`); }
  const start = parseScheduleStart(required('--start')); const durationMinutes = parseIntegerOption('--duration-minutes', previousEvent.durationMinutes ?? 60, 5, 1440);
  const mode = option('--mode') ?? 'mirror-only'; if (!['managed', 'mirror-only'].includes(mode)) fail('--mode 必须是 managed 或 mirror-only');
  const alarms = option('--alarms') === undefined ? (previousEvent.alarms ?? parseAlarmOffsets()) : parseAlarmOffsets(); const meeting = localMeetingParts(new Date(start.value), durationMinutes);
  const event = { ...previousEvent, version: 1, eventId: existing.eventId, start: start.value, durationMinutes, alarms, ...(option('--title') ? { title: option('--title') } : {}), ...(option('--location') ? { location: option('--location') } : {}) };
  event.description = option('--description') ?? syncEventDescription(previousEvent.description, meeting);
  const oldDate = localMeetingParts(new Date(previousEvent.start), previousEvent.durationMinutes ?? 60).date; const renamePlan = await pendingDebriefRename(slug, previousEvent.stage ?? stage, oldDate, meeting.date);
  const nextAction = nextActionForSchedule(data, meeting); const renderedRecord = renderRecordUpdate(syncRecordBody(recordContent, meeting, renamePlan?.oldName, renamePlan?.newName), data, { gate: data.gate === 'G1' ? 'G2' : data.gate, 'next-action': nextAction });
  const briefPath = join(opportunityDir(slug), 'quick-brief.md'); let briefContent = null;
  try { briefContent = await readFile(briefPath, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const renderedBrief = briefContent === null ? null : syncBriefBody(briefContent, oldDate, meeting, renamePlan?.oldName, renamePlan?.newName);
  return { slug, mode, event, eventPath, eventRelativePath: repoRelative(eventPath), previousEventContent, recordPath, recordContent, renderedRecord, briefPath, briefContent, renderedBrief, renamePlan, oldStart: previousEvent.start, newStart: event.start };
}
async function applyReschedule(plan) {
  const eventContent = `${JSON.stringify(plan.event, null, 2)}\n`;
  try {
    await writeFile(plan.eventPath, eventContent);
    await writeFile(plan.recordPath, plan.renderedRecord.content);
    if (plan.renderedBrief !== null) await writeFile(plan.briefPath, plan.renderedBrief);
    if (plan.renamePlan) { await writeFile(plan.renamePlan.newPath, plan.renamePlan.newContent); await rm(plan.renamePlan.oldPath); }
    return plan.mode === 'managed' ? await runCalendarUpsert(plan.eventPath) : { action: 'mirror-only' };
  } catch (error) {
    await Promise.allSettled([
      writeFile(plan.eventPath, plan.previousEventContent),
      writeFile(plan.recordPath, plan.recordContent),
      plan.briefContent === null ? rm(plan.briefPath, { force: true }) : writeFile(plan.briefPath, plan.briefContent),
      plan.renamePlan ? writeFile(plan.renamePlan.oldPath, plan.renamePlan.oldContent).then(() => rm(plan.renamePlan.newPath, { force: true })) : Promise.resolve()
    ]);
    throw error;
  }
}
async function findDebriefTarget(slug, requested, stage) { const linked = await opportunityDebriefs(slug); if (requested) { if (requested.includes('/') || requested.includes('\\')) fail('--debrief 只接受 debriefs 目录下的文件名'); const target = linked.find(debrief => debrief.name === requested); if (!target) fail(`找不到属于 ${slug} 的复盘: ${requested}`); return target; } const scoped = stage ? linked.filter(debrief => debrief.data.stage === stage) : linked; const pending = scoped.filter(debrief => debrief.data.result === '待反馈' || debrief.data.result === '未知'); if (pending.length !== 1) fail(`请用 --debrief 指定复盘文件（当前待处理复盘 ${pending.length} 份）`); return pending[0]; }

async function main() {
  if (command === 'help' || command === '--help' || command === '-h') return usage();
  if (command === 'reschedule') { const plan = await buildReschedulePlan(); if (!has('--confirm')) { console.log(JSON.stringify({ mode: 'dry-run', action: 'reschedule', scheduleMode: plan.mode, eventId: plan.event.eventId, calendarInput: { path: plan.eventRelativePath, event: plan.event }, oldStart: plan.oldStart, newStart: plan.newStart, record: { path: repoRelative(plan.recordPath), nextAction: plan.renderedRecord.data['next-action'] }, debrief: plan.renamePlan ? { from: plan.renamePlan.oldName, to: plan.renamePlan.newName } : null, next: '重新执行并追加 --confirm 才会更新已有日程及关联材料' }, null, 2)); return; } const calendar = await applyReschedule(plan); console.log(JSON.stringify({ mode: 'applied', action: 'reschedule', scheduleMode: plan.mode, eventId: plan.event.eventId, calendarInput: { path: plan.eventRelativePath }, oldStart: plan.oldStart, newStart: plan.newStart, record: { path: repoRelative(plan.recordPath), nextAction: plan.renderedRecord.data['next-action'], updatedAt: plan.renderedRecord.data['updated-at'] }, debrief: plan.renamePlan ? { from: plan.renamePlan.oldName, to: plan.renamePlan.newName } : null, calendar }, null, 2)); return; }
  if (!COMMANDS.has(command)) fail(`未知命令: ${command}`);
  if (command === 'schedule') { const plan = await buildSchedulePlan(); if (!has('--confirm')) { console.log(JSON.stringify({ mode: 'dry-run', action: 'schedule', scheduleMode: plan.mode, record: { path: plan.recordRelativePath, gate: plan.recordUpdates.gate, nextAction: plan.recordUpdates['next-action'] }, calendarInput: { path: plan.eventRelativePath, event: plan.event }, calendarAction: plan.mode === 'managed' ? 'upsert' : 'mirror-only', next: '重新执行并追加 --confirm 才会更新主档、结构化日历输入和所选 Calendar.app 策略' }, null, 2)); return; } const calendar = await applySchedule(plan); console.log(JSON.stringify({ mode: 'applied', action: 'schedule', scheduleMode: plan.mode, record: { path: plan.recordRelativePath, gate: plan.renderedRecord.data.gate, nextAction: plan.renderedRecord.data['next-action'], updatedAt: plan.renderedRecord.data['updated-at'] }, calendarInput: { path: plan.eventRelativePath, eventId: plan.event.eventId }, calendar }, null, 2)); return; }
  if (command === 'validate') {
    const errors = await validateContextCatalog();
    const root = join(ROOT, 'interview-prep', 'opportunities');
    const opportunitySlugs = new Set((await readdir(root, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name));
    const records = [];
    for (const slug of opportunitySlugs) {
      const recordPath = join(root, slug, 'record.md');
      try {
        const { data } = await readFrontmatter(recordPath);
        records.push({ slug, data });
        errors.push(...validateRecordFrontmatter(recordPath, data));
      } catch (error) {
        if (error.code === 'ENOENT') errors.push(`${recordPath}: 缺少 record.md`);
        else throw error;
      }
    }
    const debriefRoot = join(ROOT, 'interview-prep', 'debriefs');
    const debriefs = [];
    for (const entry of await readdir(debriefRoot)) {
      if (!entry.endsWith('.md')) continue;
      const path = join(debriefRoot, entry);
      const { data } = await readFrontmatter(path);
      debriefs.push(entry);
      errors.push(...validateDebriefFrontmatter(path, data, opportunitySlugs));
    }
    const links = await validateRepositoryLinks();
    errors.push(...links.errors);
    if (errors.length) {
      for (const error of errors) console.error(`✗ ${error}`);
      fail(`validate 失败：${errors.length} 处问题`);
    }
    console.log(`✓ ${records.length} 份机会主档、${debriefs.length} 份复盘、${links.files} 份文档相对链接校验通过`);
    return;
  }
  if (command === 'context') { const at = parseAt(option('--at')); const scope = option('--scope') ?? 'opportunity'; if (!CONTEXT_SCOPES.has(scope)) fail('--scope 必须是 opportunity、career、profile 或 all'); if (['career', 'profile'].includes(scope) && (option('--slug') || option('--match'))) fail(`--scope ${scope} 不接受 --slug 或 --match；具体机会请使用 --scope opportunity 或 --scope all`); const contextSlug = option('--slug') ? validateSlug(option('--slug')) : undefined; const payload = ['opportunity', 'all'].includes(scope) ? await buildContextPayload(scope, at, { slug: contextSlug, match: option('--match') }) : await buildContextPayload(scope, at); console.log(JSON.stringify(payload, null, 2)); return; }
  if (command === 'dashboard') { const at = parseAt(option('--at')); const windowDays = parseIntegerOption('--window-days', 14, 1, 90); const rows = await loadOpportunityRows(option('--gate'), at); const payload = buildDashboardPayload(rows.map(row => ({ ...row, issues: auditOpportunity(row) })), at, windowDays); if (has('--json')) console.log(JSON.stringify(payload, null, 2)); else process.stdout.write(renderTerminalDashboard(payload)); if (has('--html')) { const output = await outputPath('private-notes/dashboard.html', option('--output')); await mkdir(dirname(output), { recursive: true }); await writeFile(output, renderDashboardHtml(payload)); console.error(`✓ HTML 看板已生成: ${repoRelative(output)}`); } return; }
  if (command === 'retro' || command === 'new-retro') {
    const cycle = command === 'new-retro' ? required('--cycle') : option('--cycle'); const type = option('--type');
    if (cycle && !/^\d{4}-(spring|autumn)$/.test(cycle)) fail('--cycle 必须是 YYYY-spring 或 YYYY-autumn');
    if (type && !['campus', 'internship', 'experienced'].includes(type)) fail('--type 必须是 campus、internship 或 experienced');
    const at = parseAt(option('--at')); const payload = buildRetroPayload(await loadOpportunityRows(undefined, at), at, { cycle, type });
    if (command === 'retro') { if (has('--json')) console.log(JSON.stringify(payload, null, 2)); else process.stdout.write(renderTerminalRetro(payload)); return; }
    const retroDate = validateDate(option('--date') ?? defaultDate(), '--date'); const fileName = type ? `${cycle}-${type}.md` : `${cycle}.md`;
    await renderTemplate(join(ROOT, 'interview-prep', 'templates', 'cycle-retro.md'), join(ROOT, 'career-thinking', 'retros', fileName), { CYCLE: cycle, DATE: retroDate, SCOPE: type ? ` --type ${type}` : '', SNAPSHOT: renderMarkdownSnapshot(payload) }, has('--force'));
    if (payload.looseEnds.length) console.error(`⚠ 仍有 ${payload.looseEnds.length} 项未收尾；运行 retro --cycle ${cycle} 查看清单`);
    return;
  }
  if (command === 'list') { const at = parseAt(option('--at')); const rows = await loadOpportunityRows(option('--gate'), at); console.log(`=== 机会总览 · ${rows.length} 个 ===`); for (const { slug, data, flags, runtime } of rows) { const marker = ['quick-brief.md', 'question-script.md', 'due-diligence.md', 'offer-decision.md'].map(name => `${name.replace('.md', '')}${flags[name] ? '✓' : '–'}`).join(' '); console.log(`${data.gate} | ${data.status} | ${slug}`); console.log(`    ${data.company} · ${data.role}`); if (data['next-action']) console.log(`    next: ${data['next-action']}`); console.log(`    时间状态: ${formatRuntime(runtime)}`); if (runtime.schedule) console.log(`    日程: ${runtime.schedule.file} | ${runtime.schedule.start.toISOString()} → ${runtime.schedule.end.toISOString()}`); console.log(`    动态待办: ${runtime.nextAction}`); if (runtime.debriefCount > 0) console.log(`    复盘: ${runtime.debriefCount} 份`); for (const warning of runtime.warnings) console.error(`⚠ ${slug} 日程输入：${warning}`); console.log(`    文档: ${marker}`); const calendarFile = await opportunityCalendarFile(slug); console.log(`    日历: ${calendarFile ? `${calendarFile} ✓` : '–'}`); } return; }
  if (command === 'audit') { const at = parseAt(option('--at')); const rows = await loadOpportunityRows(option('--gate'), at); const repositoryIssues = auditRepositoryConsistency({ rows, ...(await loadRepositoryAuditInputs(rows.map(row => row.slug))) }); const payload = auditPayload(rows, at, repositoryIssues); if (has('--json')) console.log(JSON.stringify(payload, null, 2)); else { console.log(`=== 机会审计 · ${payload.total} 个 ===`); console.log(`统计：缺陷 ${payload.errors} · 注意 ${payload.warnings} · 提示 ${payload.infos}`); for (const opportunity of payload.opportunities) { const prefix = opportunity.issues.length ? opportunity.issues.map(issue => auditSeverityLabel(issue.severity)).join('、') : 'OK'; console.log(`[${prefix}] ${opportunity.slug} · ${opportunity.gate} · ${opportunity.status} · ${opportunity.timeState}`); for (const issue of opportunity.issues) console.log(`    - ${issue.message}`); } if (payload.repositoryIssues.length) { console.log('=== 仓库一致性 ==='); for (const issue of payload.repositoryIssues) console.log(`[${auditSeverityLabel(issue.severity)}] ${issue.code} · ${issue.message}`); } } if (has('--strict') && payload.errors > 0) process.exitCode = 2; return; }
  if (command === 'queue') { const at = parseAt(option('--at')); const rows = (await loadOpportunityRows(option('--gate'), at)).filter(row => row.runtime.timeState !== 'resolved').sort((a, b) => runtimePriority(a.runtime) - runtimePriority(b.runtime) || runtimeScheduleKey(a.runtime) - runtimeScheduleKey(b.runtime)); if (has('--json')) console.log(JSON.stringify(rows.map(row => ({ slug: row.slug, company: row.data.company, role: row.data.role, gate: row.data.gate, status: row.data.status, timeState: row.runtime.timeState, nextAction: row.runtime.nextAction, schedule: row.runtime.schedule ? { file: row.runtime.schedule.file, start: row.runtime.schedule.start.toISOString(), end: row.runtime.schedule.end.toISOString() } : null, issues: auditOpportunity(row) })), null, 2)); else { console.log(`=== 下一步队列 · ${rows.length} 个 ===`); rows.forEach((row, index) => { console.log(`${index + 1}. ${row.slug} · ${formatRuntime(row.runtime)}`); console.log(`   ${row.data.company} · ${row.data.role}`); console.log(`   动态待办: ${row.runtime.nextAction}`); const issues = auditOpportunity(row); if (issues.length) console.log(`   审计提示: ${issues.map(issue => issue.message).join('；')}`); }); } return; }
  if (command === 'gate') { const targetSlug = validateSlug(required('--slug')); const at = parseAt(option('--at')); const recordPath = await requireOpportunity(targetSlug); const { data } = await readFrontmatter(recordPath); const flags = await opportunityDocFlags(targetSlug); const runtime = await deriveOpportunityRuntime(data, at); console.log(targetSlug); for (const field of RECORD_FIELDS) if (data[field] !== undefined && data[field] !== '') console.log(`  ${field}: ${data[field]}`); console.log(`  时间状态: ${formatRuntime(runtime)}`); if (runtime.schedule) console.log(`  日程: ${runtime.schedule.file} | ${runtime.schedule.start.toISOString()} → ${runtime.schedule.end.toISOString()}`); console.log(`  动态待办: ${runtime.nextAction}`); for (const warning of runtime.warnings) console.error(`⚠ ${targetSlug} 日程输入：${warning}`); console.log(`  文档: ${['quick-brief.md', 'question-script.md', 'due-diligence.md', 'offer-decision.md'].map(name => `${name.replace('.md', flags[name] ? '✓' : '–')}`).join(' ')}`); const linked = await opportunityDebriefs(targetSlug); console.log(`  复盘: ${linked.length ? linked.map(item => item.name).join(', ') : '（无）'}`); console.log(`  日历: ${await opportunityCalendarFile(targetSlug) ?? '（未建）'}`); return; }
  if (command === 'record-outcome') { const targetSlug = validateSlug(required('--slug')); const recordPath = await requireOpportunity(targetSlug); const updates = {}; const gateValue = option('--gate'); const statusValue = option('--status'); const resultValue = option('--result'); const stageValue = option('--stage'); const nextAction = option('--next-action'); if (gateValue !== undefined) { if (!GATES.includes(gateValue)) fail(`--gate 必须是 ${GATES.join('|')} 之一`); updates.gate = gateValue; } if (statusValue !== undefined) { if (!OPPORTUNITY_STATUSES.includes(statusValue)) fail(`--status 必须是受控词表之一（${OPPORTUNITY_STATUSES.join(' / ')}）`); updates.status = statusValue; } if (nextAction !== undefined) updates['next-action'] = nextAction; if (!resultValue && option('--debrief')) fail('--debrief 只能与 --result 一起使用'); if (resultValue !== undefined && !DEBRIEF_RESULTS.includes(resultValue)) fail(`--result 必须是受控词表之一（${DEBRIEF_RESULTS.join(' / ')}）`); if (!Object.keys(updates).length && resultValue === undefined) fail('record-outcome 至少需要 --gate、--status、--next-action 或 --result'); let debriefTarget = null; if (resultValue !== undefined) { if (has('--sync') && stageValue && !option('--debrief')) { const linked = (await opportunityDebriefs(targetSlug)).filter(item => item.data.stage === stageValue); if (linked.length === 1) debriefTarget = linked[0]; else fail('该轮复盘不唯一，请用 --debrief 指定文件'); } else debriefTarget = await findDebriefTarget(targetSlug, option('--debrief'), stageValue); } if (has('--sync') && stageValue && debriefTarget && debriefTarget.data.stage !== stageValue) fail('--stage 与指定复盘不一致'); if (has('--sync')) { console.log(JSON.stringify(await synchronizedOutcome({ slug: targetSlug, updates, target: debriefTarget, result: resultValue }), null, 2)); return; } if (Object.keys(updates).length) await updateRecordField(recordPath, updates); if (debriefTarget) await updateDebriefResult(debriefTarget.path, resultValue); return; }
  if (command === 'set-process') { const targetSlug = validateSlug(required('--slug')); const recordPath = await requireOpportunity(targetSlug); const { content, data } = await readFrontmatter(recordPath); const type = option('--type') ?? option('--opportunity-type') ?? data['opportunity-type']; const cycle = option('--cycle') ?? option('--recruiting-cycle') ?? data['recruiting-cycle'] ?? ''; const source = option('--source') ?? data['interview-process-source']; const asOf = option('--as-of') ?? data['interview-process-as-of'] ?? defaultDate(); if (!type) fail('set-process 必须设置 --type'); if (!source) fail('set-process 必须设置 --source'); validateDate(asOf, '--as-of'); const rounds = []; for (let index = 0; index < args.length; index += 1) if (args[index] === '--round' && args[index + 1]) rounds.push(parseRoundSpecification(args[index + 1])); const nextData = { ...data, 'opportunity-type': type, 'recruiting-cycle': cycle, 'interview-process-source': source, 'interview-process-as-of': asOf, 'interview-process': rounds.length ? JSON.stringify(rounds) : has('--clear-rounds') ? '' : (data['interview-process'] ?? '') }; const errors = validateInterviewProcess(nextData); if (errors.length) fail(`面试流程无效：${errors.join('；')}`); const rendered = renderRecordUpdate(content, data, nextData); await writeFile(recordPath, rendered.content); const processIds = parseInterviewProcess(nextData).steps.map(step => step.id); console.log(`${recordPath}: interview-process=${processIds.join(' → ') || '待确认'}，updated-at=${rendered.data['updated-at']}`); return; }
  if (command === 'set-gate') { const targetSlug = validateSlug(required('--slug')); const recordPath = await requireOpportunity(targetSlug); const gateValue = required('--gate'); if (!GATES.includes(gateValue)) fail(`--gate 必须是 ${GATES.join('|')} 之一`); await updateRecordField(recordPath, { gate: gateValue }); return; }
  if (command === 'set-status') { const targetSlug = validateSlug(required('--slug')); const recordPath = await requireOpportunity(targetSlug); const statusValue = required('--status'); if (!OPPORTUNITY_STATUSES.includes(statusValue)) fail(`--status 必须是受控词表之一（${OPPORTUNITY_STATUSES.join(' / ')}）`); await updateRecordField(recordPath, { status: statusValue }); return; }
  const force = has('--force'); const templateDir = join(ROOT, 'interview-prep', 'templates'); const slug = option('--slug') ? validateSlug(option('--slug')) : undefined; const date = () => validateDate(option('--date') ?? defaultDate(), '--date');
  if (command === 'new-opportunity') { const opportunitySlug = validateSlug(required('--slug')); const company = required('--company'); const role = required('--role'); const recordPath = join(opportunityDir(opportunitySlug), 'record.md'); await renderTemplate(join(templateDir, 'opportunity-record.md'), recordPath, { COMPANY: company, ROLE: role, SLUG: opportunitySlug, DATE: defaultDate(), ROUNDS: option('--rounds'), HC: option('--hc'), CONVERT: option('--convert'), OPPORTUNITY_TYPE: option('--type') ?? option('--opportunity-type'), RECRUITING_CYCLE: option('--cycle') ?? option('--recruiting-cycle') }, force); const jdFile = option('--jd-file'); const jdInline = option('--jd'); if (jdFile && jdInline) fail('--jd 与 --jd-file 不能同时使用'); const jd = jdFile ? await readFile(resolve(ROOT, jdFile), 'utf8') : jdInline; if (jd && jd.trim()) { const { inventoryText, keywords } = await loadJdIntake(); const analysis = analyzeJd(jd, inventoryText, keywords); await appendFile(recordPath, renderJdDraft(analysis)); console.error(`✓ JD 抽取草稿已追加到 ${recordPath}（待人工校对，确认后删除草稿节）`); } return; }
  if (command === 'new-material') { const materialSlug = validateSlug(required('--slug')); const materialDate = date(); await renderTemplate(join(templateDir, 'material-intake.md'), await outputPath(`private-notes/intake/${materialDate}-${materialSlug}.md`, option('--output')), { DATE: materialDate, CATEGORY: required('--category'), MATERIAL_NAME: required('--name') }, force); return; }
  if (command === 'new-resume-version') { const versionId = validateSlug(required('--id')); const versionDate = date(); await renderTemplate(join(ROOT, 'resume', 'templates', 'resume-version.md'), await outputPath(`private-notes/resume-versions/${versionId}.md`, option('--output')), { VERSION_ID: versionId, COMPANY: required('--company'), ROLE: required('--role'), VARIANT: option('--variant') ?? '标准', DATE: versionDate, STATUS: option('--status') ?? '草稿' }, force); return; }
  const opportunitySlug = slug ?? validateSlug(required('--slug')); const opportunityRecordPath = await requireOpportunity(opportunitySlug); const { data: opportunityData } = await readFrontmatter(opportunityRecordPath); const company = option('--company') ?? opportunityData.company; const role = option('--role') ?? opportunityData.role; const recordPathRef = `interview-prep/opportunities/${opportunitySlug}/record.md`;
  if (command === 'new-brief') { await renderTemplate(join(templateDir, 'quick-brief.md'), join(opportunityDir(opportunitySlug), 'quick-brief.md'), { COMPANY: company, ROLE: role, RECORD_PATH: recordPathRef, GATE: option('--gate') ?? `${opportunityData.gate} · ${GATE_LABELS[opportunityData.gate] ?? '待补信息'}`, UPDATED_AT: option('--updated-at') ?? defaultDate() }, force); return; }
  if (command === 'new-questions') { await renderTemplate(join(templateDir, 'question-script.md'), join(opportunityDir(opportunitySlug), 'question-script.md'), { COMPANY: company, ROLE: role, RECORD_PATH: recordPathRef, STAGE: option('--stage') ?? '技术面 / HR 面' }, force); return; }
  if (command === 'new-due-diligence') { await renderTemplate(join(templateDir, 'due-diligence.md'), join(opportunityDir(opportunitySlug), 'due-diligence.md'), { COMPANY: company, ROLE: role, RECORD_PATH: recordPathRef, AS_OF_DATE: validateDate(option('--as-of') ?? defaultDate(), '--as-of') }, force); return; }
  if (command === 'new-research-brief') { const researchDate = date(); const area = required('--area'); const areaSlug = validateSlug(area); await renderTemplate(join(templateDir, 'research-brief.md'), join(opportunityDir(opportunitySlug), `research-${researchDate}-${areaSlug}.md`), { COMPANY: company, ROLE: role, RECORD_PATH: recordPathRef, AS_OF_DATE: researchDate, RESEARCH_AREA: area }, force); return; }
  if (command === 'new-debrief') {
    const stage = validateScheduleStage(required('--stage'));
    const flow = parseInterviewProcess(opportunityData);
    if (has('--quick') && flow.configured && !flow.steps.some(step => step.id === stage)) fail('快速记录的 --stage 必须是已配置的轮次 ID');
    const requestedDate = option('--date'); let debriefDate;
    if (requestedDate) debriefDate = validateDate(requestedDate, '--date');
    else if (has('--quick')) {
      const loaded = await opportunityCalendarEvents(opportunitySlug);
      if (loaded.warnings.length) fail('结构化日程损坏，请先核对后再记录');
      const candidates = loaded.events.filter(event => (!event.purpose || event.purpose === 'interview') && event.stage === stage);
      if (candidates.length !== 1 || candidates[0].end > new Date()) fail('无法从该轮唯一已结束日程推导日期；请显式提供 --date');
      debriefDate = localDate(candidates[0].start);
    } else {
      const runtime = await deriveOpportunityRuntime(opportunityData, new Date());
      if (!runtime.schedule || ['upcoming', 'in_progress'].includes(runtime.timeState)) fail('无法从已结束的结构化日程推导复盘日期；请显式提供 --date');
      debriefDate = localDate(runtime.schedule.start);
    }
    if (has('--quick')) {
      if (option('--notes') && option('--notes-file')) fail('--notes 与 --notes-file 不能同时使用');
      const notes = option('--notes-file') ? await readFile(resolve(ROOT, option('--notes-file')), 'utf8') : option('--notes');
      console.log(JSON.stringify(await quickDebrief({ slug: opportunitySlug, stage, date: debriefDate, notes, company, role, force }), null, 2)); return;
    }
    if (option('--notes') || option('--notes-file')) fail('--notes / --notes-file 需要 --quick');
    const sessionId = `${debriefDate}-${opportunitySlug}-${stage}`;
    await renderTemplate(join(templateDir, 'debrief.md'), join(ROOT, 'interview-prep', 'debriefs', `${sessionId}.md`), { COMPANY: company, ROLE: role, DATE: debriefDate, STAGE: stage, STAGE_SLUG: stage, SESSION_ID: sessionId, RECORD_PATH: recordPathRef, SLUG: opportunitySlug }, force); return;
  }
  if (command === 'new-offer') { const offerDate = date(); await renderTemplate(join(templateDir, 'offer-decision.md'), join(opportunityDir(opportunitySlug), 'offer-decision.md'), { COMPANY: company, ROLE: role, DATE: offerDate, RECORD_PATH: recordPathRef }, force); return; }
  fail(`未知命令: ${command}`);
}
main().catch(error => { console.error(`${error.name}: ${error.message}`); process.exitCode = 1; });
