import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveInterviewPipeline, normalizeInterviewEvents, validateInterviewProcess } from './interview-process.mjs';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const CONTEXT_CATALOG = join(ROOT, 'context', 'index.json');
export const GATES = ['G0', 'G1', 'G2', 'G3', 'G4'];
export const GATE_LABELS = { G0: '投递', G1: '真实邀约', G2: '已定档', G3: 'HR 谈薪 / Offer', G4: '关闭' };
export const OPPORTUNITY_STATUSES = ['已投', '自动测评', '笔试待进行', '面试邀约', '面试中', 'Offer', '感谢信', '未通过', '流程终止', '无回复关闭', '搁置', '放弃', '主动终止', 'HC 取消'];
export const DEBRIEF_RESULTS = ['通过', '未通过', '进入下一轮', '待反馈', '流程终止', '未知'];
export const RECORD_FIELDS = ['slug', 'company', 'role', 'opportunity-type', 'recruiting-cycle', 'interview-process-source', 'interview-process-as-of', 'interview-process', 'gate', 'status', 'next-action', 'updated-at'];
export const DEBRIEF_FIELDS = ['session-id', 'opportunity', 'stage', 'date', 'result'];
export const TERMINAL_STATUSES = new Set(['Offer', '感谢信', '未通过', '流程终止', '无回复关闭', '搁置', '放弃', '主动终止', 'HC 取消']);
export const CONTEXT_SCOPES = new Set(['opportunity', 'career', 'profile', 'all']);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const G1_PLACEHOLDER_VALUES = new Set(['法律主体、品牌、母子公司、招聘主体是否一致。', '成立时间、团队/组织来源、产品成熟度和公开规模信号。', '卖什么、服务谁、处于原型/量产/交付哪个阶段。', '论文、专利、开源代码、开发文档、benchmark、监管披露或真实产品。', '融资、收入、客户、订单、runway（生存周期）和经营风险。', '与技术路线、商业化或直属培养有关的履历。', '实际工作对象、交付链路、技术栈、岗位上限/下限和个人匹配。', '主体矛盾、业务不确定性、招聘异常、诉讼/处罚、裁员/欠薪或来源冲突。', '当前是否值得投入，以及需要通过面试验证的关键假设。', '本场必须准备的项目、知识缺口和反向提问。']);

function defaultDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match) return null;
  const data = {};
  for (const line of match[1].split(/\r?\n/)) {
    const index = line.indexOf(':');
    if (index === -1) continue;
    const key = line.slice(0, index).trim();
    if (key) data[key] = line.slice(index + 1).trim();
  }
  return data;
}

export function serializeFrontmatter(data, fields) {
  const lines = ['---'];
  for (const field of fields) lines.push(data[field] === undefined || data[field] === '' ? `${field}:` : `${field}: ${data[field]}`);
  lines.push('---');
  return lines.join('\n');
}

export function renderRecordUpdate(content, data, updates) {
  const nextData = { ...data, ...updates, 'updated-at': defaultDate() };
  const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
  return { content: `${serializeFrontmatter(nextData, RECORD_FIELDS)}\n${body}`, data: nextData };
}

export async function readFrontmatter(filePath) {
  const content = await readFile(filePath, 'utf8');
  return { content, data: parseFrontmatter(content) };
}

export function validateRecordFrontmatter(filePath, data) {
  const errors = [];
  if (!data) return [`${filePath}: 缺少 frontmatter（文件必须以 --- 元数据块开头）`];
  if (!data.slug) errors.push(`${filePath}: slug 缺失`);
  if (!data.company) errors.push(`${filePath}: company 缺失`);
  if (!data.role) errors.push(`${filePath}: role 缺失`);
  if (!GATES.includes(data.gate)) errors.push(`${filePath}: gate="${data.gate ?? ''}" 不在词表 (${GATES.join('|')})`);
  if (!OPPORTUNITY_STATUSES.includes(data.status)) errors.push(`${filePath}: status="${data.status ?? ''}" 不在词表 (${OPPORTUNITY_STATUSES.join('|')})`);
  if (!DATE_RE.test(data['updated-at'] ?? '')) errors.push(`${filePath}: updated-at 缺失或不是 YYYY-MM-DD`);
  errors.push(...validateInterviewProcess(data).map(error => `${filePath}: ${error}`));
  return errors;
}

export function validateDebriefFrontmatter(filePath, data, opportunitySlugs) {
  const errors = [];
  if (!data) return [`${filePath}: 缺少 frontmatter（文件必须以 --- 元数据块开头）`];
  if (!data['session-id']) errors.push(`${filePath}: session-id 缺失`);
  if (!data.opportunity || !opportunitySlugs.has(data.opportunity)) errors.push(`${filePath}: opportunity="${data.opportunity ?? ''}" 不是已建档机会`);
  if (!data.stage) errors.push(`${filePath}: stage 缺失`);
  if (!DATE_RE.test(data.date ?? '')) errors.push(`${filePath}: date 缺失或不是 YYYY-MM-DD`);
  if (!DEBRIEF_RESULTS.includes(data.result)) errors.push(`${filePath}: result="${data.result ?? ''}" 不在词表 (${DEBRIEF_RESULTS.join('|')})`);
  return errors;
}

export async function updateRecordField(recordPath, updates) {
  const { content, data } = await readFrontmatter(recordPath);
  if (!data) throw new Error(`缺少 frontmatter: ${recordPath}`);
  const rendered = renderRecordUpdate(content, data, updates);
  await writeFile(recordPath, rendered.content);
  console.log(`${recordPath}: ${Object.entries(updates).map(([key, value]) => `${key}=${value}`).join(', ')}，updated-at=${rendered.data['updated-at']}`);
}

export async function updateDebriefResult(debriefPath, result) {
  const { content, data } = await readFrontmatter(debriefPath);
  if (!data) throw new Error(`缺少 frontmatter: ${debriefPath}`);
  data.result = result;
  const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
  await writeFile(debriefPath, `${serializeFrontmatter(data, DEBRIEF_FIELDS)}\n${body}`);
  console.log(`${debriefPath}: result=${result}`);
}

export function opportunityDir(slug) { return join(ROOT, 'interview-prep', 'opportunities', slug); }

export async function requireOpportunity(slug) {
  const recordPath = join(opportunityDir(slug), 'record.md');
  try { await access(recordPath, constants.F_OK); }
  catch (error) { if (error.code === 'ENOENT') throw new Error(`找不到机会主档: ${recordPath}；请先运行 new-opportunity`); throw error; }
  return recordPath;
}

export async function opportunityDocFlags(slug) {
  const dir = opportunityDir(slug); const flags = {};
  for (const name of ['quick-brief.md', 'question-script.md', 'due-diligence.md', 'offer-decision.md']) {
    try { await access(join(dir, name), constants.F_OK); flags[name] = true; }
    catch (error) { if (error.code !== 'ENOENT') throw error; flags[name] = false; }
  }
  return flags;
}

export async function opportunityCalendarFile(slug) {
  try {
    const entries = await readdir(join(ROOT, 'private-notes', 'calendar'));
    return entries.find(entry => entry.startsWith(`${slug}-`) && entry.endsWith('.json')) ?? null;
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export async function opportunityCalendarEvents(slug) {
  let entries;
  try { entries = await readdir(join(ROOT, 'private-notes', 'calendar')); }
  catch (error) { if (error.code === 'ENOENT') return { events: [], warnings: [] }; throw error; }
  const events = []; const warnings = [];
  for (const name of entries.filter(entry => entry.startsWith(`${slug}-`) && entry.endsWith('.json')).sort()) {
    try {
      const raw = JSON.parse(await readFile(join(ROOT, 'private-notes', 'calendar', name), 'utf8'));
      if (typeof raw.start !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/.test(raw.start)) throw new Error('start 必须是带时区的 ISO 时间');
      const start = new Date(raw.start); const durationMinutes = raw.durationMinutes ?? 60;
      if (Number.isNaN(start.getTime()) || !Number.isInteger(durationMinutes) || durationMinutes < 5 || durationMinutes > 1440) throw new Error('start 或 durationMinutes 无效');
      events.push({ file: name, eventId: raw.eventId ?? name.replace(/\.json$/, ''), stage: raw.stage ?? null, purpose: raw.purpose ?? null, title: raw.title ?? '', start, end: new Date(start.getTime() + durationMinutes * 60000), durationMinutes });
    } catch (error) { warnings.push(`${name}: ${error.message}`); }
  }
  events.sort((a, b) => a.start - b.start);
  return { events, warnings };
}

export async function opportunityDebriefs(slug) {
  let entries;
  try { entries = await readdir(join(ROOT, 'interview-prep', 'debriefs')); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const debriefs = [];
  for (const name of entries.filter(entry => entry.endsWith('.md')).sort()) {
    const path = join(ROOT, 'interview-prep', 'debriefs', name); const { data } = await readFrontmatter(path);
    if (data?.opportunity === slug) debriefs.push({ name, path, data });
  }
  return debriefs;
}

export function parseAt(value) {
  if (!value) return new Date();
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(value)) throw new Error('--at 必须是带时区的 ISO 时间');
  const parsed = new Date(value); if (Number.isNaN(parsed.getTime())) throw new Error(`--at 不是有效的 ISO 时间: ${value}`); return parsed;
}

export function localDate(date) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date).reduce((result, part) => { if (part.type !== 'literal') result[part.type] = part.value; return result; }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function selectSchedule(events, now) { return events.find(event => event.start <= now && now < event.end) ?? events.find(event => now < event.start) ?? events.at(-1) ?? null; }

export async function deriveOpportunityRuntime(data, now, providedCalendar = null, providedDebriefs = null) {
  const { events, warnings } = providedCalendar ?? await opportunityCalendarEvents(data.slug); const debriefs = providedDebriefs ?? await opportunityDebriefs(data.slug);
  if (data.gate === 'G4' || TERMINAL_STATUSES.has(data.status)) return { timeState: 'resolved', nextAction: '无时间驱动动作（人工结果已记录）', schedule: null, debriefCount: debriefs.length, warnings };
  if (events.length === 0) return { timeState: data.gate === 'G1' ? 'unscheduled' : 'unknown', nextAction: data.gate === 'G1' ? '等待确认面试日期、时间和形式' : '缺少结构化日程，无法按时间推导', schedule: null, debriefCount: debriefs.length, warnings };
  const schedule = selectSchedule(events, now);
  if (now < schedule.start) return { timeState: 'upcoming', nextAction: '准备面试并按 Calendar.app 到场', schedule, debriefCount: debriefs.length, warnings };
  if (now < schedule.end) return { timeState: 'in_progress', nextAction: '面试进行中', schedule, debriefCount: debriefs.length, warnings };
  const linkedDebriefs = debriefs.filter(debrief => debrief.data.date === localDate(schedule.start));
  if (linkedDebriefs.length > 0) {
    const results = [...new Set(linkedDebriefs.map(debrief => debrief.data.result).filter(Boolean))];
    if (results.some(result => result === '待反馈' || result === '未知') || results.length === 0) return { timeState: 'waiting_feedback', nextAction: data['next-action'] || '等待招聘方反馈；若通过，手动确认下一轮', schedule, debriefCount: debriefs.length, warnings };
    return { timeState: 'outcome_recorded', nextAction: `已记录面试结果：${results.join('、')}；人工确认后更新主档状态`, schedule, debriefCount: debriefs.length, warnings };
  }
  return { timeState: 'elapsed_needs_debrief', nextAction: '建立单场面试复盘', schedule, debriefCount: debriefs.length, warnings };
}

export function formatRuntime(runtime) {
  const labels = { resolved: '已有人工结果', unscheduled: '尚未定档', unknown: '无法推导', upcoming: '即将开始', in_progress: '进行中', elapsed_needs_debrief: '预计已结束，待复盘', waiting_feedback: '已结束，等待反馈', outcome_recorded: '已有面试结果，待人工流转' };
  return `${runtime.timeState}（${labels[runtime.timeState] ?? '未知'}）`;
}

export async function loadOpportunityRows(gateFilter, at) {
  const root = join(ROOT, 'interview-prep', 'opportunities');
  const slugs = (await readdir(root, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name).sort(); const rows = [];
  for (const slug of slugs) {
    const recordPath = join(root, slug, 'record.md'); let content; let data;
    try { ({ content, data } = await readFrontmatter(recordPath)); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (!data || (gateFilter && data.gate !== gateFilter)) continue;
    const flags = await opportunityDocFlags(slug); const calendar = await opportunityCalendarEvents(slug); const debriefs = await opportunityDebriefs(slug); const events = normalizeInterviewEvents(data, calendar.events); const normalizedCalendar = { ...calendar, events };
    const runtime = await deriveOpportunityRuntime(data, at, normalizedCalendar, debriefs); const pipeline = deriveInterviewPipeline(data, events, debriefs, at);
    rows.push({ slug, recordPath, content, data, flags, runtime, pipeline, events, debriefs });
  }
  return rows;
}

export function hasFilledG1Summary(content) {
  const match = content.match(/^## G1[^\n]*\n([\s\S]*)/m); if (!match) return false; const nextHeading = match[1].search(/^## /m); const section = nextHeading >= 0 ? match[1].slice(0, nextHeading) : match[1];
  return section.split(/\r?\n/).some(line => { if (line.includes('{{')) return false; const field = line.match(/(?:主体真实性|公司阶段|核心产品|技术证据|资金与商业化|核心团队|重大风险|面试决策|准备影响)[^：:]*[：:]\s*(.+)$/); return Boolean(field?.[1]?.trim() && !G1_PLACEHOLDER_VALUES.has(field[1].trim())); });
}

export function hasFilledDueDiligence(content) {
  if (!content) return false; const match = content.match(/^## 1\.[^\n]*\n([\s\S]*)/m); if (!match) return false; const nextHeading = match[1].search(/^## /m); const section = nextHeading >= 0 ? match[1].slice(0, nextHeading) : match[1];
  const filled = ['公司当前判断', '岗位当前判断', '继续面试的理由', '主要风险'].filter(label => { const line = section.split(/\r?\n/).find(candidate => candidate.includes(label)); if (!line || line.includes('{{')) return false; const index = Math.max(line.indexOf('：'), line.indexOf(':')); return index >= 0 && line.slice(index + 1).replace(/\*\*/g, '').trim().length > 0; });
  return filled.length >= 2;
}

export function repoRelative(path) { return relative(ROOT, path).split('\\').join('/'); }
export function auditIssue(severity, code, message) { return { severity, code, message }; }
export function auditOpportunity(row) {
  const { data, flags, runtime, content, pipeline } = row; const issues = [];
  // quick-brief / question-script / 单场复盘都是「面试」产物：只有确实存在非笔试（assessment）轮次的活动——
  // 日程事件或已建复盘——才要求它们。只排了笔试、尚未进入任何面试的机会（G2 常因笔试定档而自动前进）不触发。
  // pipeline 未配置时无法判定轮次类型，按「存在活动即要求」保守处理，避免漏报真实面试。
  const stepKindById = new Map((pipeline?.steps ?? []).map(step => [step.id, step.kind]));
  const hasInterviewActivity = (row.events ?? []).some(event => stepKindById.get(event.stage) !== 'assessment')
    || (row.debriefs ?? []).some(debrief => stepKindById.get(debrief.data.stage) !== 'assessment');
  if (data.gate !== 'G4' && !data['next-action']) issues.push(auditIssue('warning', 'missing-next-action', '未设置主档 next-action；请保留人工下一步或依赖动态待办'));
  if (data.gate === 'G1' && !flags['due-diligence.md'] && !hasFilledG1Summary(content)) issues.push(auditIssue('error', 'missing-g1-evidence', 'G1 没有独立尽调文件，也没有可识别的主档尽调摘要'));
  if (data.gate === 'G2') {
    if (hasInterviewActivity && !flags['quick-brief.md']) issues.push(auditIssue('warning', 'missing-quick-brief', 'G2 缺少 quick-brief.md'));
    if (hasInterviewActivity && !flags['question-script.md']) issues.push(auditIssue('warning', 'missing-question-script', 'G2 缺少 question-script.md'));
    if (runtime.timeState === 'unknown') issues.push(auditIssue('warning', 'missing-schedule', 'G2 没有可解析的结构化日程，无法按时间推导'));
    if (hasInterviewActivity && runtime.timeState === 'elapsed_needs_debrief') issues.push(auditIssue('error', 'missing-debrief', '日程已结束但尚未建立单场复盘'));
  }
  if (data.gate === 'G3') {
    if (!pipeline?.configured) issues.push(auditIssue('warning', 'gate-g3-unverifiable', 'G3 要求全部技术面通过后才进入 HR 谈薪，但缺少 interview-process，无法核验轮次'));
    else {
      const pending = pipeline.steps.filter(step => !step.optional && step.kind !== 'hr' && step.status !== 'passed');
      if (pending.length > 0) issues.push(auditIssue('error', 'gate-g3-premature', `G3 要求全部技术面通过后才进入 HR 谈薪；未通过：${pending.map(step => `${step.label}（${step.statusLabel}）`).join('、')}`));
    }
  }
  if (data.status === 'Offer' && !flags['offer-decision.md']) issues.push(auditIssue('warning', 'missing-offer-decision', '已记录 Offer，但缺少 offer-decision.md'));
  if (data.gate === 'G4' && runtime.debriefCount === 0 && hasInterviewActivity) issues.push(auditIssue('warning', 'missing-closed-debrief', '流程已关闭、有面试轮次活动但没有关联复盘'));
  if (data.status === '面试邀约' && ['in_progress', 'elapsed_needs_debrief', 'waiting_feedback', 'outcome_recorded'].includes(runtime.timeState)) issues.push(auditIssue('info', 'stale-human-status', '人工 status 仍为“面试邀约”；时间状态已变化，需有招聘事实后再手动流转'));
  if (data.status === '面试中' && runtime.timeState === 'upcoming') issues.push(auditIssue('info', 'early-human-status', '人工 status 已是“面试中”，但结构化日程尚未开始；不自动修改'));
  for (const warning of runtime.warnings) issues.push(auditIssue('error', 'invalid-calendar-input', warning));
  return issues;
}
export function auditSeverityLabel(severity) { return { error: '缺陷', warning: '注意', info: '提示' }[severity] ?? severity; }
export function runtimePriority(runtime) { return { elapsed_needs_debrief: 0, outcome_recorded: 1, in_progress: 2, upcoming: 3, waiting_feedback: 4, unscheduled: 5, unknown: 6, resolved: 99 }[runtime.timeState] ?? 50; }
export function runtimeScheduleKey(runtime) { return runtime.schedule?.start?.getTime() ?? Number.MAX_SAFE_INTEGER; }
export function auditPayload(rows, at, repositoryIssues = []) {
  const opportunities = rows.map(row => ({ slug: row.slug, company: row.data.company, role: row.data.role, gate: row.data.gate, status: row.data.status, timeState: row.runtime.timeState, debriefCount: row.runtime.debriefCount, issues: auditOpportunity(row), schedule: row.runtime.schedule ? { file: row.runtime.schedule.file, start: row.runtime.schedule.start.toISOString(), end: row.runtime.schedule.end.toISOString() } : null }));
  const issues = [...opportunities.flatMap(opportunity => opportunity.issues), ...repositoryIssues];
  return { at: at.toISOString(), total: opportunities.length, errors: issues.filter(issue => issue.severity === 'error').length, warnings: issues.filter(issue => issue.severity === 'warning').length, infos: issues.filter(issue => issue.severity === 'info').length, opportunities, repositoryIssues };
}

async function loadContextCatalog() { return JSON.parse(await readFile(CONTEXT_CATALOG, 'utf8')); }
export async function validateContextCatalog(catalog = null) {
  const errors = [];
  try { catalog = catalog ?? await loadContextCatalog(); } catch (error) { return [`${CONTEXT_CATALOG}: 无法解析 JSON: ${error.message}`]; }
  if (catalog.version !== 1) errors.push(`${CONTEXT_CATALOG}: version 必须是 1`);
  if (!catalog.scopes || typeof catalog.scopes !== 'object') return [`${CONTEXT_CATALOG}: 缺少 scopes 对象`];
  for (const scope of ['opportunity', 'career', 'profile']) {
    const metadata = catalog.scopes[scope];
    if (!metadata || typeof metadata !== 'object') { errors.push(`${CONTEXT_CATALOG}: 缺少 scopes.${scope}`); continue; }
    if (!metadata.label) errors.push(`${CONTEXT_CATALOG}: scopes.${scope}.label 缺失`);
    for (const section of ['required', 'onDemand']) {
      if (metadata[section] !== undefined && !Array.isArray(metadata[section])) errors.push(`${CONTEXT_CATALOG}: scopes.${scope}.${section} 必须是数组`);
      for (const [index, item] of (metadata[section] ?? []).entries()) {
        const prefix = `${CONTEXT_CATALOG}: scopes.${scope}.${section}[${index}]`;
        if (!item || typeof item.path !== 'string' || !item.path) errors.push(`${prefix}.path 缺失`);
        else if (!item.path.includes('<')) {
          try { await access(join(ROOT, item.path), constants.F_OK); }
          catch { errors.push(`${prefix}.path 在磁盘上不存在: ${item.path}`); }
        }
        if (!item || typeof item.reason !== 'string' || !item.reason) errors.push(`${prefix}.reason 缺失`);
      }
    }
  }
  return errors;
}
const LINK_SCAN_SKIP_DIRS = new Set(['.git', 'node_modules', 'private-notes', 'dist', 'releases']);
const README_INDEX_PATH = 'interview-prep/README.md';

// 抽取需要落盘校验的相对链接；外部协议、纯锚点、含 `<placeholder>` 或模板槽位的目标不检查。
export function relativeLinkTargets(text) {
  const targets = [];
  for (const match of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    const link = match[1];
    if (/^[a-z][a-z0-9+.-]*:/i.test(link)) continue;
    const [target] = link.split('#');
    if (!target || /[<{]/.test(target)) continue;
    targets.push(target);
  }
  return targets;
}

async function markdownFiles(dir, acc = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) { if (!LINK_SCAN_SKIP_DIRS.has(entry.name)) await markdownFiles(join(dir, entry.name), acc); }
    else if (entry.name.endsWith('.md')) acc.push(join(dir, entry.name));
  }
  return acc;
}

// 文档间的相对链接是硬不变量：断了就是错了，所以放在 validate 而不是 audit。
export async function validateRepositoryLinks(root = ROOT) {
  const errors = [];
  const files = await markdownFiles(root);
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    for (const target of relativeLinkTargets(text)) {
      const absolute = target.startsWith('/') ? join(root, target) : resolve(dirname(file), target);
      try { await access(absolute, constants.F_OK); }
      catch { errors.push(`${repoRelative(file)}: 相对链接指向不存在的路径 ${target}`); }
    }
  }
  return { files: files.length, errors };
}

export function extractQuickBriefGate(text) {
  const match = text.match(/^\s*>\s*当前 Gate[：:]\s*(.+)$/m);
  return match ? match[1].trim() : null;
}

// README 是人工入口索引，只取「指向主档 / 复盘」两类链接，避免把材料列当成索引行。
export function readmeIndexLinks(text) {
  const opportunities = new Set(); const debriefs = new Set();
  for (const target of relativeLinkTargets(text)) {
    const opportunity = target.match(/(?:^|\/)opportunities\/([a-z0-9-]+)\/record\.md$/);
    if (opportunity) opportunities.add(opportunity[1]);
    const debrief = target.match(/(?:^|\/)debriefs\/([^/]+\.md)$/);
    if (debrief) debriefs.add(debrief[1]);
  }
  return { opportunities, debriefs };
}

// 仓库级一致性：手维护的散文约束里唯一能被机械判定的那一部分。
export function auditRepositoryConsistency({ rows, readmeText, debriefNames, quickBriefGates = {} }) {
  const issues = [];
  for (const row of rows) {
    const gateLine = quickBriefGates[row.slug];
    if (gateLine && !gateLine.includes(row.data.gate)) issues.push(auditIssue('error', 'quick-brief-gate-drift', `${row.slug}: quick-brief.md「当前 Gate」写「${gateLine}」，与主档 ${row.data.gate} 不一致`));
  }
  const indexed = readmeIndexLinks(readmeText);
  const slugs = new Set(rows.map(row => row.slug));
  const missingIndex = rows.filter(row => !indexed.opportunities.has(row.slug)).map(row => row.slug);
  if (missingIndex.length) issues.push(auditIssue('warning', 'readme-opportunity-missing', `${README_INDEX_PATH} 岗位机会表缺 ${missingIndex.length} 个机会行：${missingIndex.join('、')}`));
  const staleIndex = [...indexed.opportunities].filter(slug => !slugs.has(slug));
  if (staleIndex.length) issues.push(auditIssue('warning', 'readme-opportunity-stale', `${README_INDEX_PATH} 列出的机会目录不存在：${staleIndex.join('、')}`));
  const known = new Set(debriefNames);
  const missingDebriefs = debriefNames.filter(name => !indexed.debriefs.has(name));
  if (missingDebriefs.length) issues.push(auditIssue('warning', 'readme-debrief-missing', `${README_INDEX_PATH} 复盘索引缺 ${missingDebriefs.length} 份复盘：${missingDebriefs.join('、')}`));
  const staleDebriefs = [...indexed.debriefs].filter(name => !known.has(name));
  if (staleDebriefs.length) issues.push(auditIssue('warning', 'readme-debrief-stale', `${README_INDEX_PATH} 链接的复盘文件不存在：${staleDebriefs.join('、')}`));
  const missingType = rows.filter(row => !row.data['opportunity-type']).map(row => row.slug);
  if (missingType.length) issues.push(auditIssue('warning', 'missing-opportunity-type', `${missingType.length} 个主档缺 opportunity-type（校招 / 实习分类无法投影）：${missingType.join('、')}`));
  const missingCycle = rows.filter(row => row.data['opportunity-type'] === 'campus' && !row.data['recruiting-cycle']).map(row => row.slug);
  if (missingCycle.length) issues.push(auditIssue('info', 'missing-recruiting-cycle', `${missingCycle.length} 个 campus 主档缺 recruiting-cycle：${missingCycle.join('、')}`));
  return issues;
}

export async function loadRepositoryAuditInputs(slugs) {
  const readmeText = await readFile(join(ROOT, README_INDEX_PATH), 'utf8');
  const debriefNames = (await readdir(join(ROOT, 'interview-prep', 'debriefs'))).filter(name => name.endsWith('.md')).sort();
  const root = join(ROOT, 'interview-prep', 'opportunities');
  const quickBriefGates = {};
  for (const slug of slugs) {
    try {
      const gate = extractQuickBriefGate(await readFile(join(root, slug, 'quick-brief.md'), 'utf8'));
      if (gate) quickBriefGates[slug] = gate;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return { readmeText, debriefNames, quickBriefGates };
}

function staticContextPayload(catalog, scope) {
  const metadata = catalog.scopes[scope];
  return { scope, label: metadata.label, readingPlan: { required: metadata.required ?? [], onDemand: metadata.onDemand ?? [] }, forbiddenByDefault: metadata.forbiddenByDefault ?? [], agentInstructions: metadata.forbiddenByDefault?.map(item => `遵守边界：${item}`) ?? [] };
}
export async function buildContextPayload(scope, at, selector = {}) {
  const catalog = await loadContextCatalog();
  if (scope === 'career' || scope === 'profile') return staticContextPayload(catalog, scope);
  if (scope === 'all') {
    const opportunity = await buildContextPayload('opportunity', at, selector);
    return { scope: 'all', scopes: { opportunity, career: staticContextPayload(catalog, 'career'), profile: staticContextPayload(catalog, 'profile') } };
  }
  const { slug, match } = selector;
  if (Boolean(slug) === Boolean(match)) throw new Error('context 必须且只能提供 --slug 或 --match');
  let row;
  if (slug) {
    const safeSlug = slug;
    const recordPath = await requireOpportunity(safeSlug); const { content, data } = await readFrontmatter(recordPath); const flags = await opportunityDocFlags(safeSlug); const calendar = await opportunityCalendarEvents(safeSlug); const debriefs = await opportunityDebriefs(safeSlug); const events = normalizeInterviewEvents(data, calendar.events);
    row = { slug: safeSlug, recordPath, content, data, flags, debriefs, events, runtime: await deriveOpportunityRuntime(data, at, { ...calendar, events }, debriefs), pipeline: deriveInterviewPipeline(data, events, debriefs, at) };
  } else {
    const needle = match.trim().toLocaleLowerCase('zh-CN'); if (!needle) throw new Error('--match 不能为空'); const rows = await loadOpportunityRows(undefined, at); const values = item => [item.slug, item.data.company, item.data.role, `${item.data.company} ${item.data.role}`].map(value => value.toLocaleLowerCase('zh-CN')); const exact = rows.filter(item => values(item).includes(needle)); const matches = exact.length > 0 ? exact : rows.filter(item => values(item).some(value => value.includes(needle)));
    if (matches.length === 0) throw new Error(`--match 没有匹配到机会: ${match}`); if (matches.length > 1) throw new Error(`--match 匹配多个机会，请改用 --slug：${matches.map(item => item.slug).join('、')}`); row = matches[0];
  }
  const { slug: rowSlug, data, content, flags, runtime, recordPath, debriefs } = row; const dir = opportunityDir(rowSlug); const entries = await readdir(dir, { withFileTypes: true }); const opportunityDocs = entries.filter(entry => entry.isFile() && entry.name.endsWith('.md')).map(entry => entry.name).sort(); const duePath = join(dir, 'due-diligence.md'); const dueContent = flags['due-diligence.md'] ? await readFile(duePath, 'utf8') : null; const evidenceSources = []; if (hasFilledG1Summary(content)) evidenceSources.push(repoRelative(recordPath)); if (hasFilledDueDiligence(dueContent)) evidenceSources.push(repoRelative(duePath));
  const requiredDocs = [{ path: repoRelative(recordPath), reason: '规范机会主档：身份、Gate、状态、岗位模型和事实边界' }]; const onDemandDocs = []; if (flags['due-diligence.md']) requiredDocs.push({ path: repoRelative(duePath), reason: '本地 G1 公司 / JD 尽调与来源边界；不得在未读时重复外部研究' }); for (const debrief of debriefs) requiredDocs.push({ path: repoRelative(debrief.path), reason: `已发生面试的现场证据：${debrief.data.date} · ${debrief.data.stage} · ${debrief.data.result}` }); if (flags['offer-decision.md']) requiredDocs.push({ path: repoRelative(join(dir, 'offer-decision.md')), reason: 'Offer 条件、雇佣核验与候选人决策边界' }); for (const name of opportunityDocs) { const path = repoRelative(join(dir, name)); if (!requiredDocs.some(doc => doc.path === path) && name !== 'record.md') onDemandDocs.push({ path, reason: '机会执行材料：按当前任务需要读取' }); } onDemandDocs.push({ path: 'INVENTORY.md', reason: '个人事实与能力边界；涉及匹配或项目表述时读取' });
  return { slug: rowSlug, opportunity: { slug: rowSlug, company: data.company, role: data.role, gate: data.gate, status: data.status, runtime: { timeState: runtime.timeState, label: formatRuntime(runtime), nextAction: runtime.nextAction }, pipeline: row.pipeline }, localG1Evidence: { present: evidenceSources.length > 0, sources: evidenceSources }, readingPlan: { required: requiredDocs, onDemand: onDemandDocs }, externalResearch: { mode: evidenceSources.length > 0 || data.gate === 'G4' ? 'blocked-by-default' : 'required-for-g1', reason: evidenceSources.length > 0 ? '已有本地 G1 证据，不重复背调' : '缺少本地 G1 证据，若当前问题需要应先完成 G1' }, agentInstructions: ['先完整读取 readingPlan.required。', ...(evidenceSources.length > 0 ? ['不要调用 web search；除非用户明确要求刷新或决策依赖时效缺口。'] : [])] };
}

export async function ensureNew(path, force) { if (!force) { try { await access(path, constants.F_OK); throw new Error(`文件已存在，拒绝覆盖: ${path}；如需覆盖请追加 --force`); } catch (error) { if (error.code !== 'ENOENT') throw error; } } await mkdir(dirname(path), { recursive: true }); }
export async function outputPath(defaultPath, requested) { const target = requested ?? defaultPath; if (!target || target.startsWith('/') || target.split('/').includes('..')) throw new Error('--output 必须是工作台根目录内的相对路径'); return resolve(ROOT, target); }
export async function renderTemplate(templatePath, destinationPath, replacements, force) { await ensureNew(destinationPath, force); let content = await readFile(templatePath, 'utf8'); for (const [key, value] of Object.entries(replacements)) content = content.replaceAll(`{{${key}}}`, () => value ?? ''); const leftover = content.match(/\{\{[A-Za-z0-9_-]+\}\}/g); if (leftover) console.error(`⚠ 模板残留未填槽位（${destinationPath}）: ${[...new Set(leftover)].join(' ')}`); await writeFile(destinationPath, content); console.log(destinationPath); }
