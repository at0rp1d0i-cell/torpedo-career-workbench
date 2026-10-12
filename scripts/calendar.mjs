#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const args = process.argv.slice(2);
const command = args.shift() ?? 'help';

function has(flag) {
  return args.includes(flag);
}

function option(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function usage() {
  console.log(`用法：
  node scripts/calendar.mjs list-calendars
  node scripts/calendar.mjs list [--calendar NAME] [--from ISO] [--to ISO]
  node scripts/calendar.mjs show --uid UID [--calendar NAME]
  node scripts/calendar.mjs create --input PATH [--confirm]
  node scripts/calendar.mjs upsert --input PATH [--confirm]
  node scripts/calendar.mjs delete --calendar NAME --uid UID --confirm

说明：
  - create / upsert 默认只预览；写入必须显式传 --confirm。
  - upsert 依据 description 中的 eventId 标记幂等更新；提醒输入使用负秒数，写入 Calendar.app 前转换为分钟，并清理旧版本误按分钟写入的同值提醒。
  - delete 只允许按精确 calendar + uid 删除，不提供批量删除；实现使用 JXA 精确定位。
  - 输入合同见 interview-prep/templates/calendar-event.json。`);
}

function fail(message) {
  throw new Error(message);
}

function appleString(value) {
  return `"${String(value ?? '')
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('\r', '')
    .replaceAll('\n', '\\r')}"`;
}

function parseDate(value, path) {
  if (typeof value !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/.test(value)) {
    fail(`${path} 必须是带时区的 ISO 时间，例如 2026-09-02T18:00:00+08:00`);
  }
  const datePart = value.match(/^(\d{4})-(\d{2})-(\d{2})T/);
  if (!datePart) fail(`${path} 不是有效日期: ${value}`);
  const [, year, month, day] = datePart.map(Number);
  const civilDate = new Date(Date.UTC(year, month - 1, day));
  if (civilDate.getUTCFullYear() !== year || civilDate.getUTCMonth() !== month - 1 || civilDate.getUTCDate() !== day) {
    fail(`${path} 不是有效日期: ${value}`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) fail(`${path} 不是有效日期: ${value}`);
  return date;
}

function localParts(date) {
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    hour: date.getHours(),
    minute: date.getMinutes(),
    second: date.getSeconds()
  };
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

function appleDateExpression(date) {
  const parts = localParts(date);
  return `my makeCalendarDate(${parts.year}, ${MONTH_NAMES[parts.month - 1]}, ${parts.day}, ${parts.hour}, ${parts.minute}, ${parts.second})`;
}

function validateEvent(event) {
  if (!event || typeof event !== 'object') fail('日历事件必须是 JSON 对象');
  if (event.version !== 1) fail('日历事件当前只支持 version=1');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,120}$/.test(event.eventId ?? '')) {
    fail('eventId 必须是 3–121 位 ASCII slug，只能包含字母、数字、点、下划线和短横线');
  }
  if (typeof event.calendar !== 'string' || !event.calendar.trim()) fail('缺少 calendar');
  if (typeof event.title !== 'string' || !event.title.trim()) fail('缺少 title');
  const start = parseDate(event.start, 'start');
  const durationMinutes = event.durationMinutes ?? 60;
  if (!Number.isInteger(durationMinutes) || durationMinutes < 5 || durationMinutes > 24 * 60) {
    fail('durationMinutes 必须是 5–1440 的整数');
  }
  const description = event.description ?? '';
  if (typeof description !== 'string') fail('description 必须是字符串');
  const location = event.location ?? '';
  if (typeof location !== 'string') fail('location 必须是字符串');
  const alarms = event.alarms ?? [-86400, -1800];
  if (!Array.isArray(alarms) || alarms.length === 0 || alarms.some(value => !Number.isInteger(value) || value >= 0)) {
    fail('alarms 必须是至少一个负整数，单位为秒');
  }
  if (new Set(alarms).size !== alarms.length) fail('alarms 不能包含重复提醒');
  if (alarms.some(value => value % 60 !== 0)) fail('alarms 必须能整除 60；Calendar.app 的提醒粒度为分钟');
  return {
    ...event,
    startDate: start,
    endDate: new Date(start.getTime() + durationMinutes * 60 * 1000),
    durationMinutes,
    description,
    location,
    alarms,
    alarmMinutes: alarms.map(seconds => seconds / 60)
  };
}

async function loadEvent(path) {
  if (!path) fail('必须指定 --input PATH');
  const raw = path === '-' ? await readStdin() : await readFile(path, 'utf8');
  let event;
  try {
    event = JSON.parse(raw);
  } catch (error) {
    fail(`无法解析日历 JSON: ${error.message}`);
  }
  return validateEvent(event);
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

function marker(eventId) {
  return `[resume-workbench-event-id:${eventId}]`;
}

function descriptionWithMarker(event) {
  const eventMarker = marker(event.eventId);
  if (event.description.includes(eventMarker)) return event.description;
  return `${eventMarker}\n${event.description}`;
}

function createOrUpdateAppleScript(event, mode) {
  const calendar = appleString(event.calendar);
  const title = appleString(event.title);
  const description = appleString(descriptionWithMarker(event));
  const location = appleString(event.location);
  const start = appleDateExpression(event.startDate);
  const end = appleDateExpression(event.endDate);
  const eventMarker = appleString(marker(event.eventId));
  const createAlarmStatements = event.alarmMinutes
    .map(minutes => `make new display alarm at end with properties {trigger interval:${minutes}}`)
    .join('\n          ');
  const updateAlarmStatements = event.alarmMinutes
    .map(minutes => `if ${minutes} is not in alarmIntervals then make new display alarm at end with properties {trigger interval:${minutes}}`)
    .join('\n          ');
  const updateExisting = mode === 'upsert';
  const lookupStatements = updateExisting ? `repeat with candidate in every event
        if (description of candidate contains ${eventMarker}) then
          set targetEvent to contents of candidate
          exit repeat
        end if
      end repeat` : '';
  return `on run
  tell application "Calendar"
    if not (exists calendar ${calendar}) then error "找不到日历: ${event.calendar}"
    tell calendar ${calendar}
      set targetEvent to missing value
      ${lookupStatements}
      if targetEvent is missing value then
        set startAt to ${start}
        set endAt to ${end}
        set targetEvent to make new event at end with properties {summary:${title}, start date:startAt, end date:endAt, description:${description}, location:${location}}
        tell targetEvent
          ${createAlarmStatements}
        end tell
        return "created|" & (uid of targetEvent)
      else
        set summary of targetEvent to ${title}
        set startAt to ${start}
        set endAt to ${end}
        if startAt is greater than or equal to (end date of targetEvent) then
          set end date of targetEvent to endAt
          set start date of targetEvent to startAt
        else
          set start date of targetEvent to startAt
          set end date of targetEvent to endAt
        end if
        set description of targetEvent to ${description}
        set location of targetEvent to ${location}
        set alarmIntervals to {}
        repeat with alarmItem in display alarms of targetEvent
          set end of alarmIntervals to trigger interval of alarmItem
        end repeat
        tell targetEvent
          ${updateAlarmStatements}
        end tell
        return "updated|" & (uid of targetEvent)
      end if
    end tell
  end tell
end run

on makeCalendarDate(y, m, d, h, min, s)
  set value to current date
  set year of value to y
  set month of value to m
  set day of value to d
  set time of value to (h * hours + min * minutes + s)
  return value
end makeCalendarDate`;
}

function deleteJxaSource(calendarName, uid) {
  return `const Calendar = Application("Calendar");
const calendarName = ${JSON.stringify(calendarName)};
const uid = ${JSON.stringify(uid)};
const calendar = Calendar.calendars().find(item => item.name() === calendarName);
if (!calendar) throw new Error("找不到日历: " + calendarName);
const event = calendar.events().find(item => item.uid() === uid);
if (!event) throw new Error("找不到 UID 对应的事件: " + uid);
event.delete();
JSON.stringify("deleted");`;
}
function migrateLegacyAlarmsJxaSource(event) {
  const calendarName = JSON.stringify(event.calendar);
  const eventMarker = JSON.stringify(marker(event.eventId));
  const legacyIntervals = JSON.stringify(event.alarms);
  const desiredIntervals = JSON.stringify(event.alarmMinutes);
  return `const Calendar = Application("Calendar");
const calendarName = ${calendarName};
const eventMarker = ${eventMarker};
const legacyIntervals = ${legacyIntervals};
const desiredIntervals = ${desiredIntervals};
const calendar = Calendar.calendars().find(item => item.name() === calendarName);
if (!calendar) throw new Error("找不到日历: " + calendarName);
const event = calendar.events().find(item => (item.description() || "").includes(eventMarker));
let result = { action: "none", preservedAlarmMinutes: [] };
if (event) {
  const intervals = event.displayAlarms().map(alarm => alarm.triggerInterval());
  const legacyFound = intervals.filter(interval => legacyIntervals.includes(interval));
  if (legacyFound.length > 0) {
    const preservedAlarmMinutes = [...new Set(intervals.filter(interval => !legacyIntervals.includes(interval) && !desiredIntervals.includes(interval)))];
    const previousUid = event.uid();
    event.delete();
    result = { action: "recreate", previousUid, removedLegacyAlarmMinutes: legacyFound, preservedAlarmMinutes };
  }
}
JSON.stringify(result);`;
}


async function runAppleScript(source) {
  const result = await execFileAsync('osascript', ['-e', source], { maxBuffer: 1024 * 1024 });
  return result.stdout.trim();
}

function jxaSource(action, options = {}) {
  const calendarName = JSON.stringify(options.calendar ?? '');
  const uid = JSON.stringify(options.uid ?? '');
  const from = options.from ? JSON.stringify(parseDate(options.from, '--from').toISOString()) : 'null';
  const to = options.to ? JSON.stringify(parseDate(options.to, '--to').toISOString()) : 'null';
  return `const Calendar = Application("Calendar");
const calendarName = ${calendarName};
const targetCalendar = calendarName ? Calendar.calendars().find(c => c.name() === calendarName) : null;
if (calendarName && !targetCalendar) throw new Error("找不到日历: " + calendarName);
const calendars = targetCalendar ? [targetCalendar] : Calendar.calendars();
const from = ${from} ? new Date(${from}) : null;
const to = ${to} ? new Date(${to}) : null;
function eventData(event, name) {
  const start = event.startDate();
  const end = event.endDate();
  return {
    uid: event.uid(),
    calendar: name,
    title: event.summary(),
    start: start.toISOString(),
    end: end.toISOString(),
    location: event.location() || "",
    description: event.description() || "",
    alarms: event.displayAlarms().map(alarm => alarm.triggerInterval())
  };
}
let output = [];
for (const calendar of calendars) {
  const name = calendar.name();
  for (const event of calendar.events()) {
    const data = eventData(event, name);
    if (${JSON.stringify(action)} === "show" && data.uid !== ${uid}) continue;
    if (from && new Date(data.start) < from) continue;
    if (to && new Date(data.start) > to) continue;
    output.push(data);
  }
}
JSON.stringify(output);`;
}

async function runJxa(source) {
  const result = await execFileAsync('osascript', ['-l', 'JavaScript', '-e', source], { maxBuffer: 4 * 1024 * 1024 });
  return JSON.parse(result.stdout.trim() || '[]');
}

function printPreview(event, mode) {
  console.log(JSON.stringify({
    mode: 'dry-run',
    action: mode,
    event: {
      eventId: event.eventId,
      calendar: event.calendar,
      title: event.title,
      start: event.start,
      end: event.endDate.toISOString(),
      durationMinutes: event.durationMinutes,
      location: event.location,
      alarms: event.alarms,
      alarmOffsetsMinutes: event.alarmMinutes,
      description: event.description
    },
    next: `重新执行并追加 --confirm 才会${mode === 'upsert' ? '创建或更新' : '创建'} Calendar.app 事件`
  }, null, 2));
}

try {
  if (command === 'help' || command === '--help' || command === '-h') {
    usage();
  } else if (command === 'list-calendars') {
    console.log(JSON.stringify(await runJxa('const Calendar = Application("Calendar"); JSON.stringify(Calendar.calendars().map(c => c.name()));'), null, 2));
  } else if (command === 'list') {
    const calendars = option('--calendar');
    const events = await runJxa(jxaSource('list', {
      calendar: calendars,
      from: option('--from'),
      to: option('--to')
    }));
    console.log(JSON.stringify(events, null, 2));
  } else if (command === 'show') {
    const uid = option('--uid');
    if (!uid) fail('show 必须指定 --uid UID');
    const events = await runJxa(jxaSource('show', { calendar: option('--calendar'), uid }));
    if (events.length === 0) fail(`找不到事件 UID: ${uid}`);
    console.log(JSON.stringify(events[0], null, 2));
  } else if (command === 'create' || command === 'upsert') {
    const event = await loadEvent(option('--input'));
    if (!has('--confirm')) {
      printPreview(event, command);
    } else {
      let alarmMigration = { action: 'none', preservedAlarmMinutes: [] };
      let appliedEvent = event;
      if (command === 'upsert') {
        alarmMigration = await runJxa(migrateLegacyAlarmsJxaSource(event));
        if (alarmMigration.action === 'recreate') {
          appliedEvent = {
            ...event,
            alarmMinutes: [...new Set([...event.alarmMinutes, ...alarmMigration.preservedAlarmMinutes])]
          };
        }
      }
      const result = await runAppleScript(createOrUpdateAppleScript(appliedEvent, command));
      const [action, uid] = result.split('|');
      console.log(JSON.stringify({ mode: 'applied', action, eventId: event.eventId, calendar: event.calendar, uid, alarmMigration }, null, 2));
    }
  } else if (command === 'delete') {
    const calendar = option('--calendar');
    const uid = option('--uid');
    if (!calendar || !uid) fail('delete 必须同时指定 --calendar NAME 和 --uid UID');
    if (!has('--confirm')) fail('delete 是破坏性操作，必须显式追加 --confirm');
    const result = await runJxa(deleteJxaSource(calendar, uid));
    console.log(JSON.stringify({ mode: 'applied', action: result, calendar, uid }, null, 2));
  } else {
    fail(`未知命令: ${command}`);
  }
} catch (error) {
  console.error(`${error.name}: ${error.message}`);
  process.exitCode = 1;
}
