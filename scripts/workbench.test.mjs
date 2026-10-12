import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDashboardPayload } from './dashboard.mjs';
import { deriveInterviewPipeline, validateInterviewProcess } from './interview-process.mjs';
import { validateContextCatalog, validateRepositoryLinks, auditRepositoryConsistency, auditOpportunity } from './workbench-data.mjs';
const execFileAsync = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORKBENCH = join(ROOT, 'scripts', 'workbench.mjs');
const CALENDAR = join(ROOT, 'scripts', 'calendar.mjs');

// 全新 clone 不包含被忽略的私密目录；测试自行创建运行目录。
await mkdir(join(ROOT, 'private-notes', 'calendar'), { recursive: true });

async function run(command, commandArgs) {
  try {
    const result = await execFileAsync('node', [command, ...commandArgs], { cwd: ROOT });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return {
      code: error.code,
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? error.message
    };
  }
}

test('workbench 生成新文档时替换元数据并保留可填写字段', async () => {
  const tempDir = await mkdtemp(join(ROOT, 'private-notes', 'workbench-test-'));
  try {
    const output = relative(ROOT, join(tempDir, 'material.md'));
    const result = await run(WORKBENCH, [
      'new-material', '--slug', 'test-material', '--name', '测试证据', '--category', '项目',
      '--date', '2026-09-02', '--output', output
    ]);
    assert.equal(result.code, 0, result.stderr);
    const content = await readFile(join(ROOT, output), 'utf8');
    assert.match(content, /入账日期：2026-09-02/);
    assert.match(content, /素材名称：测试证据/);
    assert.match(content, /核实状态：已核实 \/ 待确认 \/ 待补证 \/ 未核实/);
    assert.match(content, /- 是什么：/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('workbench 保留未由命令提供的模板槽位', async () => {
  const slug = `test-slots-${process.pid}`;
  const opportunityDir = join(ROOT, 'interview-prep', 'opportunities', slug);
  try {
    const created = await run(WORKBENCH, [
      'new-opportunity', '--slug', slug, '--company', '测试公司', '--role', '测试岗位'
    ]);
    assert.equal(created.code, 0, created.stderr);
    const duplicate = await run(WORKBENCH, [
      'new-opportunity', '--slug', slug, '--company', '测试公司', '--role', '测试岗位'
    ]);
    assert.notEqual(duplicate.code, 0);
    assert.match(duplicate.stderr, /拒绝覆盖/);
    const record = await readFile(join(opportunityDir, 'record.md'), 'utf8');
    assert.match(record, /^# 测试公司 · 测试岗位 · 面试主记录/m);
    const brief = await run(WORKBENCH, ['new-brief', '--slug', slug]);
    assert.equal(brief.code, 0, brief.stderr);
    const content = await readFile(join(opportunityDir, 'quick-brief.md'), 'utf8');
    assert.match(content, /项目一：\{\{PROJECT_1\}\}/);
    const research = await run(WORKBENCH, [
      'new-research-brief', '--slug', slug,
      '--area', 'technical-product', '--date', '2026-09-02'
    ]);
    assert.equal(research.code, 0, research.stderr);
    const researchContent = await readFile(join(opportunityDir, 'research-2026-09-02-technical-product.md'), 'utf8');
    assert.match(researchContent, /证据面：technical-product/);
    assert.match(researchContent, /不替主代理给出“去 \/ 不去”的最终判断/);
    const questions = await run(WORKBENCH, ['new-questions', '--slug', slug]);
    assert.equal(questions.code, 0, questions.stderr);
    const questionsContent = await readFile(join(opportunityDir, 'question-script.md'), 'utf8');
    assert.match(questionsContent, /^# 测试公司 · 测试岗位 · 面试反向提问稿/m);
    const diligence = await run(WORKBENCH, ['new-due-diligence', '--slug', slug, '--as-of', '2026-09-02']);
    assert.equal(diligence.code, 0, diligence.stderr);
    const offer = await run(WORKBENCH, ['new-offer', '--slug', slug, '--date', '2026-09-02']);
    assert.equal(offer.code, 0, offer.stderr);
    const offerContent = await readFile(join(opportunityDir, 'offer-decision.md'), 'utf8');
    assert.match(offerContent, /^# 测试公司 · 测试岗位 · Offer 决策记录/m);
  } finally {
    await rm(opportunityDir, { recursive: true, force: true });
  }
});

test('workbench 拒绝无效日期和越界输出路径', async () => {
  const invalidDate = await run(WORKBENCH, [
    'new-material', '--slug', 'test-material', '--name', '测试', '--category', '项目', '--date', '2026-02-30'
  ]);
  assert.notEqual(invalidDate.code, 0);
  assert.match(invalidDate.stderr, /有效的 YYYY-MM-DD/);

  const invalidPath = await run(WORKBENCH, [
    'new-material', '--slug', 'test-material', '--name', '测试', '--category', '项目', '--output', '../outside.md'
  ]);
  assert.notEqual(invalidPath.code, 0);
  assert.match(invalidPath.stderr, /工作台根目录内/);
});

test('calendar 合同拒绝无时区时间和重复提醒，默认只预览', async () => {
  const tempDir = await mkdtemp(join(ROOT, 'private-notes', 'calendar-test-'));
  try {
    const input = join(tempDir, 'event.json');
    const base = {
      version: 1,
      eventId: 'test-calendar-event',
      calendar: '工作',
      title: '测试事件',
      start: '2026-09-02T18:00:00+08:00',
      durationMinutes: 60,
      description: '离线校验',
      alarms: [-86400, -1800]
    };
    await writeFile(input, JSON.stringify(base));
    const dryRun = await run(CALENDAR, ['upsert', '--input', input]);
    assert.equal(dryRun.code, 0, dryRun.stderr);
    assert.match(dryRun.stdout, /"mode": "dry-run"/);
    assert.match(dryRun.stdout, /-86400/);
    assert.match(dryRun.stdout, /"alarmOffsetsMinutes": \[\n\s+-1440,\n\s+-30\n\s+\]/);
    assert.doesNotMatch(dryRun.stdout, /"alarmOffsetsMinutes": \[\n\s+-86400/);
    await writeFile(input, JSON.stringify({ ...base, start: '2026-09-02T18:00:00' }));
    const missingTimezone = await run(CALENDAR, ['upsert', '--input', input]);
    assert.notEqual(missingTimezone.code, 0);
    assert.match(missingTimezone.stderr, /必须是带时区/);
    await writeFile(input, JSON.stringify({ ...base, start: '2026-02-30T18:00:00+08:00' }));
    const invalidDate = await run(CALENDAR, ['upsert', '--input', input]);
    assert.notEqual(invalidDate.code, 0);
    assert.match(invalidDate.stderr, /不是有效日期/);

    await writeFile(input, JSON.stringify({ ...base, alarms: [-1800, -1800] }));
    const duplicateAlarms = await run(CALENDAR, ['upsert', '--input', input]);
    assert.notEqual(duplicateAlarms.code, 0);
    assert.match(duplicateAlarms.stderr, /不能包含重复提醒/);
    await writeFile(input, JSON.stringify({ ...base, alarms: [-61] }));
    const fractionalMinute = await run(CALENDAR, ['upsert', '--input', input]);
    assert.notEqual(fractionalMinute.code, 0);
    assert.match(fractionalMinute.stderr, /整除 60/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
test('workbench schedule 支持预览、可选提醒和 mirror-only 原子写入', async () => {
  const slug = `test-schedule-${process.pid}`;
  const opportunityDir = join(ROOT, 'interview-prep', 'opportunities', slug);
  const calendarFile = join(ROOT, 'private-notes', 'calendar', `${slug}-technical-round.json`);
  const scheduleArgs = [
    'schedule', '--slug', slug, '--start', '2026-09-05T19:00:00+08:00',
    '--mode', 'mirror-only', '--stage', 'technical-round', '--duration-minutes', '45',
    '--alarms', '-7200,-600', '--location', '外部视频会议'
  ];
  try {
    await run(WORKBENCH, ['new-opportunity', '--slug', slug, '--company', '日程测试公司', '--role', '日程测试岗位']);
    const dryRun = await run(WORKBENCH, scheduleArgs);
    assert.equal(dryRun.code, 0, dryRun.stderr);
    const dryPayload = JSON.parse(dryRun.stdout);
    assert.equal(dryPayload.mode, 'dry-run');
    assert.equal(dryPayload.scheduleMode, 'mirror-only');
    assert.equal(dryPayload.record.gate, 'G2');
    assert.deepEqual(dryPayload.calendarInput.event.alarms, [-7200, -600]);
    assert.equal(dryPayload.calendarInput.event.durationMinutes, 45);
    assert.equal((await readFile(join(opportunityDir, 'record.md'), 'utf8')).match(/^gate: G1$/m) !== null, true);
    await assert.rejects(readFile(calendarFile, 'utf8'));

    const applied = await run(WORKBENCH, [...scheduleArgs, '--confirm']);
    assert.equal(applied.code, 0, applied.stderr);
    const appliedPayload = JSON.parse(applied.stdout);
    assert.equal(appliedPayload.mode, 'applied');
    assert.equal(appliedPayload.calendarInput.path, `private-notes/calendar/${slug}-technical-round.json`);
    const record = await readFile(join(opportunityDir, 'record.md'), 'utf8');
    assert.match(record, /^gate: G2$/m);
    const event = JSON.parse(await readFile(calendarFile, 'utf8'));
    assert.deepEqual(event.alarms, [-7200, -600]);
    assert.equal(event.durationMinutes, 45);
    assert.equal(event.location, '外部视频会议');
    const reused = await run(WORKBENCH, [...scheduleArgs, '--start', '2026-09-06T19:00:00+08:00']);
    assert.equal(reused.code, 0, reused.stderr);
    const reusedPayload = JSON.parse(reused.stdout);
    assert.equal(reusedPayload.calendarInput.path, `private-notes/calendar/${slug}-technical-round.json`);
    assert.equal(reusedPayload.calendarInput.event.eventId, `${slug}-technical-round`);
    assert.equal(reusedPayload.calendarInput.event.start, '2026-09-06T19:00:00+08:00');

    const invalidAlarm = await run(WORKBENCH, [
      'schedule', '--slug', slug, '--start', '2026-09-05T19:00:00+08:00',
      '--mode', 'mirror-only', '--alarms', '-61'
    ]);
    assert.notEqual(invalidAlarm.code, 0);
    assert.match(invalidAlarm.stderr, /可整除 60/);

    await run(WORKBENCH, ['set-gate', '--slug', slug, '--gate', 'G4']);
    const closed = await run(WORKBENCH, [...scheduleArgs, '--start', '2026-09-06T19:00:00+08:00']);
    assert.notEqual(closed.code, 0);
    assert.match(closed.stderr, /G4.*关闭/);
  } finally {
    await rm(opportunityDir, { recursive: true, force: true });
    await rm(calendarFile, { force: true });
  }
});

test('workbench 新主档带 frontmatter 且 validate 通过', async () => {
  const slug = `test-validate-${process.pid}`;
  const opportunityDir = join(ROOT, 'interview-prep', 'opportunities', slug);
  try {
    const created = await run(WORKBENCH, [
      'new-opportunity', '--slug', slug, '--company', '测试公司', '--role', '测试岗位'
    ]);
    assert.equal(created.code, 0, created.stderr);
    const record = await readFile(join(opportunityDir, 'record.md'), 'utf8');
    assert.match(record, new RegExp(`^---\\nslug: ${slug}`, 'm'));
    assert.match(record, /^gate: G1$/m);
    assert.match(record, /^status: 面试邀约$/m);
    assert.match(record, /^updated-at: \d{4}-\d{2}-\d{2}$/m);
    const validated = await run(WORKBENCH, ['validate']);
    assert.equal(validated.code, 0, validated.stderr);
    assert.match(validated.stdout, /校验通过/);
  } finally {
    await rm(opportunityDir, { recursive: true, force: true });
  }
});

test('workbench set-gate / set-status 更新受控字段并拒绝词表外值', async () => {
  const slug = `test-setfield-${process.pid}`;
  const opportunityDir = join(ROOT, 'interview-prep', 'opportunities', slug);
  try {
    await run(WORKBENCH, ['new-opportunity', '--slug', slug, '--company', '测试公司', '--role', '测试岗位']);
    const recordPath = join(opportunityDir, 'record.md');
    const setGate = await run(WORKBENCH, ['set-gate', '--slug', slug, '--gate', 'G2']);
    assert.equal(setGate.code, 0, setGate.stderr);
    let record = await readFile(recordPath, 'utf8');
    assert.match(record, /^gate: G2$/m);
    assert.match(record, /^updated-at: \d{4}-\d{2}-\d{2}$/m);
    const invalidGate = await run(WORKBENCH, ['set-gate', '--slug', slug, '--gate', 'G9']);
    assert.notEqual(invalidGate.code, 0);
    assert.match(invalidGate.stderr, /G0\|G1\|G2\|G3\|G4/);
    const setStatus = await run(WORKBENCH, ['set-status', '--slug', slug, '--status', '未通过']);
    assert.equal(setStatus.code, 0, setStatus.stderr);
    record = await readFile(recordPath, 'utf8');
    assert.match(record, /^status: 未通过$/m);
    const invalidStatus = await run(WORKBENCH, ['set-status', '--slug', slug, '--status', '自定义状态']);
    assert.notEqual(invalidStatus.code, 0);
    assert.match(invalidStatus.stderr, /受控词表/);
  } finally {
    await rm(opportunityDir, { recursive: true, force: true });
  }
});

test('workbench list 输出机会总览并支持 gate 过滤', async () => {
  const slug = `test-list-${process.pid}`;
  const opportunityDir = join(ROOT, 'interview-prep', 'opportunities', slug);
  try {
    await run(WORKBENCH, ['new-opportunity', '--slug', slug, '--company', '列表测试公司', '--role', '列表测试岗位']);
    const result = await run(WORKBENCH, ['list']);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, new RegExp(slug));
    assert.match(result.stdout, /列表测试公司 · 列表测试岗位/);
    const filtered = await run(WORKBENCH, ['list', '--gate', 'G1']);
    assert.match(filtered.stdout, new RegExp(slug));
    const excluded = await run(WORKBENCH, ['list', '--gate', 'G3']);
    assert.doesNotMatch(excluded.stdout, new RegExp(slug));
  } finally {
    await rm(opportunityDir, { recursive: true, force: true });
  }
});

test('workbench context 先加载本地机会证据并默认阻止重复外部研究', async () => {
  const slug = `test-context-${process.pid}`;
  const company = `上下文测试公司-${process.pid}`;
  const opportunityDir = join(ROOT, 'interview-prep', 'opportunities', slug);
  const dueDiligencePath = join(opportunityDir, 'due-diligence.md');
  const debriefPath = join(ROOT, 'interview-prep', 'debriefs', `2026-09-05-${slug}-first-round.md`);
  try {
    const created = await run(WORKBENCH, ['new-opportunity', '--slug', slug, '--company', company, '--role', '上下文测试岗位']);
    assert.equal(created.code, 0, created.stderr);

    const missing = await run(WORKBENCH, ['context', '--slug', slug, '--json']);
    assert.equal(missing.code, 0, missing.stderr);
    const missingPayload = JSON.parse(missing.stdout);
    assert.equal(missingPayload.localG1Evidence.present, false);
    assert.equal(missingPayload.externalResearch.mode, 'required-for-g1');
    assert.deepEqual(missingPayload.readingPlan.required.map(doc => doc.path), [
      `interview-prep/opportunities/${slug}/record.md`
    ]);

    await writeFile(dueDiligencePath, `# ${company} · 上下文测试岗位 · 公司 / 岗位尽调\n\n## 1. G1 执行结论：是否值得投入面试\n\n- **公司当前判断**：本地证据已经完成整合。\n- **岗位当前判断**：本地岗位模型已经完成。\n- **继续面试的理由**：方向匹配。\n- **主要风险**：关键未知项留待面试确认。\n\n## 2. 公司背景与经营阶段（G1）\n`);
    const debrief = await run(WORKBENCH, [
      'new-debrief', '--slug', slug, '--date', '2026-09-05', '--stage', 'first-round'
    ]);
    assert.equal(debrief.code, 0, debrief.stderr);

    const matched = await run(WORKBENCH, ['context', '--match', company, '--json']);
    assert.equal(matched.code, 0, matched.stderr);
    const payload = JSON.parse(matched.stdout);
    assert.equal(payload.opportunity.slug, slug);
    assert.equal(payload.localG1Evidence.present, true);
    assert.equal(payload.externalResearch.mode, 'blocked-by-default');
    assert.match(payload.externalResearch.reason, /不重复背调/);
    assert.deepEqual(payload.readingPlan.required.map(doc => doc.path), [
      `interview-prep/opportunities/${slug}/record.md`,
      `interview-prep/opportunities/${slug}/due-diligence.md`,
      `interview-prep/debriefs/2026-09-05-${slug}-first-round.md`
    ]);
    assert.ok(payload.readingPlan.onDemand.some(doc => doc.path === 'INVENTORY.md'));
    assert.match(payload.agentInstructions.join('\n'), /不要调用 web search/);

    const invalid = await run(WORKBENCH, ['context', '--slug', slug, '--match', company]);
    assert.notEqual(invalid.code, 0);
    assert.match(invalid.stderr, /必须且只能提供 --slug 或 --match/);
  } finally {
    await rm(opportunityDir, { recursive: true, force: true });
    await rm(debriefPath, { force: true });
  }
});

test('workbench context 按 scope 输出岗位评价与个人事实的分层索引', async () => {
  const career = await run(WORKBENCH, ['context', '--scope', 'career', '--json']);
  assert.equal(career.code, 0, career.stderr);
  const careerPayload = JSON.parse(career.stdout);
  assert.equal(careerPayload.scope, 'career');
  assert.deepEqual(careerPayload.readingPlan.required.map(doc => doc.path), [
    'career-thinking/README.md',
    'career-thinking/options.md',
    'career-thinking/preference-signals.md',
    'career-thinking/role-reality-notes.md'
  ]);
  assert.ok(careerPayload.readingPlan.onDemand.some(doc => doc.path === 'career-thinking/decision-log.md'));

  const profile = await run(WORKBENCH, ['context', '--scope', 'profile', '--json']);
  assert.equal(profile.code, 0, profile.stderr);
  const profilePayload = JSON.parse(profile.stdout);
  assert.equal(profilePayload.scope, 'profile');
  assert.deepEqual(profilePayload.readingPlan.required.map(doc => doc.path), ['INVENTORY.md']);
  const pii = profilePayload.readingPlan.onDemand.find(doc => doc.section === '## 1. 个人信息');
  assert.match(pii.reason, /不主动加载 PII/);
  assert.match(profilePayload.forbiddenByDefault.join('\n'), /不能创造 INVENTORY 没有的经历/);

  const malformed = await run(WORKBENCH, ['context', '--scope', 'career', '--slug', 'example-invalid-selector']);
  assert.notEqual(malformed.code, 0);
  assert.match(malformed.stderr, /不接受 --slug 或 --match/);
});

test('workbench new-debrief 生成带 frontmatter 的复盘', async () => {
  const slug = `test-debrief-fm-${process.pid}`;
  const opportunityDir = join(ROOT, 'interview-prep', 'opportunities', slug);
  const debriefPath = join(ROOT, 'interview-prep', 'debriefs', `2026-09-05-${slug}-first-round.md`);
  try {
    await run(WORKBENCH, ['new-opportunity', '--slug', slug, '--company', '测试公司', '--role', '测试岗位']);
    const created = await run(WORKBENCH, [
      'new-debrief', '--slug', slug, '--date', '2026-09-05', '--stage', 'first-round'
    ]);
    assert.equal(created.code, 0, created.stderr);
    const content = await readFile(debriefPath, 'utf8');
    assert.match(content, new RegExp(`^---\\nsession-id: 2026-09-05-${slug}-first-round`, 'm'));
    assert.match(content, new RegExp(`^opportunity: ${slug}$`, 'm'));
    assert.match(content, /^stage: first-round$/m);
    assert.match(content, /^date: 2026-09-05$/m);
    assert.match(content, /^result: 待反馈$/m);
  } finally {
    await rm(opportunityDir, { recursive: true, force: true });
    await rm(debriefPath, { recursive: true, force: true });
  }
});
test('workbench 生成文档时警告模板残留槽位但不失败', async () => {
  const slug = `test-warn-${process.pid}`;
  const opportunityDir = join(ROOT, 'interview-prep', 'opportunities', slug);
  try {
    await run(WORKBENCH, ['new-opportunity', '--slug', slug, '--company', '测试公司', '--role', '测试岗位']);
    const brief = await run(WORKBENCH, ['new-brief', '--slug', slug, '--company', '测试公司', '--role', '测试岗位']);
    assert.equal(brief.code, 0, brief.stderr);
    assert.match(brief.stderr, /残留未填槽位/);
  } finally {
    await rm(opportunityDir, { recursive: true, force: true });
  }
});

test('workbench gate / list 显示日历事件状态', async () => {
  const slug = `test-cal-${process.pid}`;
  const opportunityDir = join(ROOT, 'interview-prep', 'opportunities', slug);
  const calendarDir = join(ROOT, 'private-notes', 'calendar');
  const calendarFile = join(calendarDir, `${slug}-20260901.json`);
  try {
    await run(WORKBENCH, ['new-opportunity', '--slug', slug, '--company', '测试公司', '--role', '测试岗位']);
    await writeFile(calendarFile, JSON.stringify({ version: 1, eventId: `${slug}-20260901` }));
    const gateResult = await run(WORKBENCH, ['gate', '--slug', slug]);
    assert.equal(gateResult.code, 0, gateResult.stderr);
    assert.match(gateResult.stdout, new RegExp(`${slug}-20260901\\.json`));
    const listResult = await run(WORKBENCH, ['list']);
    assert.equal(listResult.code, 0, listResult.stderr);
    assert.match(listResult.stdout, new RegExp(`${slug}-20260901\\.json`));
  } finally {
    await rm(opportunityDir, { recursive: true, force: true });
    await rm(calendarFile, { force: true });
  }
});

test('workbench 根据日程时间派生状态并支持复盘与结果流转', async () => {
  const slug = `test-runtime-${process.pid}`;
  const opportunityDir = join(ROOT, 'interview-prep', 'opportunities', slug);
  const recordPath = join(opportunityDir, 'record.md');
  const calendarDir = join(ROOT, 'private-notes', 'calendar');
  const calendarFile = join(calendarDir, `${slug}-20260901.json`);
  const debriefPath = join(ROOT, 'interview-prep', 'debriefs', `2026-09-01-${slug}-technical-round.md`);
  const at = value => `${value}+08:00`;
  try {
    await run(WORKBENCH, ['new-opportunity', '--slug', slug, '--company', '运行态测试公司', '--role', '运行态测试岗位']);
    await run(WORKBENCH, ['set-gate', '--slug', slug, '--gate', 'G2']);
    await writeFile(calendarFile, JSON.stringify({
      version: 1,
      eventId: `${slug}-20260901`,
      title: '运行态测试面试',
      start: at('2026-09-01T10:00:00'),
      durationMinutes: 60
    }));

    const upcoming = await run(WORKBENCH, ['gate', '--slug', slug, '--at', at('2026-09-01T09:00:00')]);
    assert.equal(upcoming.code, 0, upcoming.stderr);
    assert.match(upcoming.stdout, /时间状态: upcoming（即将开始）/);
    const inProgress = await run(WORKBENCH, ['gate', '--slug', slug, '--at', at('2026-09-01T10:30:00')]);
    assert.match(inProgress.stdout, /时间状态: in_progress（进行中）/);
    const elapsed = await run(WORKBENCH, ['gate', '--slug', slug, '--at', at('2026-09-01T11:30:00')]);
    assert.match(elapsed.stdout, /时间状态: elapsed_needs_debrief（预计已结束，待复盘）/);
    assert.match(elapsed.stdout, /动态待办: 建立单场面试复盘/);

    const auditBeforeDebrief = await run(WORKBENCH, [
      'audit', '--at', at('2026-09-01T11:30:00'), '--json', '--strict'
    ]);
    assert.equal(auditBeforeDebrief.code, 2);
    const auditPayload = JSON.parse(auditBeforeDebrief.stdout);
    const audited = auditPayload.opportunities.find(opportunity => opportunity.slug === slug);
    assert.equal(audited.issues.some(issue => issue.code === 'missing-debrief'), true);

    const queue = await run(WORKBENCH, ['queue', '--at', at('2026-09-01T11:30:00'), '--json']);
    assert.equal(queue.code, 0, queue.stderr);
    const queueRows = JSON.parse(queue.stdout);
    assert.equal(queueRows.find(row => row.slug === slug)?.timeState, 'elapsed_needs_debrief');

    const newDebrief = await run(WORKBENCH, ['new-debrief', '--slug', slug, '--stage', 'technical-round', '--date', '2026-09-01']);
    assert.equal(newDebrief.code, 0, newDebrief.stderr);
    const debrief = await readFile(debriefPath, 'utf8');
    assert.match(debrief, /^# 运行态测试公司 · 运行态测试岗位/m);

    const invalidOutcome = await run(WORKBENCH, [
      'record-outcome', '--slug', slug, '--gate', 'G3', '--status', '面试中', '--result', '通过', '--debrief', 'missing.md'
    ]);
    assert.notEqual(invalidOutcome.code, 0);
    const unchanged = await readFile(recordPath, 'utf8');
    assert.match(unchanged, /^gate: G2$/m);

    const waiting = await run(WORKBENCH, ['gate', '--slug', slug, '--at', at('2026-09-01T11:30:00')]);
    assert.match(waiting.stdout, /时间状态: waiting_feedback（已结束，等待反馈）/);
    assert.match(waiting.stdout, /动态待办: 等待招聘方反馈；若通过，手动确认下一轮/);

    const outcome = await run(WORKBENCH, [
      'record-outcome', '--slug', slug, '--gate', 'G3', '--status', '面试中', '--result', '通过'
    ]);
    assert.equal(outcome.code, 0, outcome.stderr);
    const updatedDebrief = await readFile(debriefPath, 'utf8');
    assert.match(updatedDebrief, /^result: 通过$/m);
    const recorded = await run(WORKBENCH, ['gate', '--slug', slug, '--at', at('2026-09-01T12:00:00')]);
    assert.match(recorded.stdout, /^  gate: G3$/m);
    assert.match(recorded.stdout, /时间状态: outcome_recorded（已有面试结果，待人工流转）/);
  } finally {
    await rm(opportunityDir, { recursive: true, force: true });
    await rm(calendarFile, { force: true });
    await rm(debriefPath, { force: true });
  }
});

test('workbench audit 要求 G3 前全部技术面已通过', async () => {
  const slug = `test-gate-g3-${process.pid}`;
  const opportunityDir = join(ROOT, 'interview-prep', 'opportunities', slug);
  const debriefPath = join(ROOT, 'interview-prep', 'debriefs', `2026-09-01-${slug}-r1.md`);
  const at = '2026-09-01T12:00:00+08:00';
  const issuesFor = async () => {
    const audit = await run(WORKBENCH, ['audit', '--at', at, '--json', '--strict']);
    return JSON.parse(audit.stdout).opportunities.find(opportunity => opportunity.slug === slug).issues;
  };
  try {
    await run(WORKBENCH, ['new-opportunity', '--slug', slug, '--company', '边界测试公司', '--role', '边界测试岗位']);
    await run(WORKBENCH, [
      'set-process', '--slug', slug, '--type', 'campus', '--source', '测试口径', '--as-of', '2026-09-01',
      '--round', 'r1|technical|第一轮技术面', '--round', 'hr|hr|HR 面'
    ]);
    await run(WORKBENCH, ['set-gate', '--slug', slug, '--gate', 'G3']);
    assert.equal((await issuesFor()).some(issue => issue.code === 'gate-g3-premature'), true);

    await run(WORKBENCH, ['new-debrief', '--slug', slug, '--stage', 'r1', '--date', '2026-09-01']);
    await run(WORKBENCH, ['record-outcome', '--slug', slug, '--stage', 'r1', '--result', '通过']);
    assert.equal((await issuesFor()).some(issue => issue.code === 'gate-g3-premature'), false);
  } finally {
    await rm(opportunityDir, { recursive: true, force: true });
    await rm(debriefPath, { force: true });
  }
});

test('audit 只在存在面试轮次活动时要求面试材料与复盘', () => {
  const row = (overrides = {}) => ({
    data: { gate: 'G2', status: '面试中', 'next-action': '等待笔试筛选结果' },
    flags: {},
    runtime: { timeState: 'waiting_feedback', debriefCount: 0, warnings: [] },
    content: '',
    pipeline: { steps: [{ id: 'written', kind: 'assessment' }, { id: 'r1', kind: 'technical' }] },
    events: [],
    debriefs: [],
    ...overrides
  });
  const codes = value => auditOpportunity(value).map(issue => issue.code);

  // 只排了笔试：不要求面试现场材料
  const writtenOnly = row({ events: [{ stage: 'written' }], debriefs: [{ data: { stage: 'written', result: '待反馈' } }] });
  assert.deepEqual(codes(writtenOnly), []);

  // 出现真实面试轮次：要求 quick-brief 与 question-script
  const interviewed = row({ events: [{ stage: 'r1' }] });
  assert.ok(codes(interviewed).includes('missing-quick-brief'));
  assert.ok(codes(interviewed).includes('missing-question-script'));

  // 轮次未配置时无法判定类型，按保守处理：仍要求面试材料
  const unconfigured = row({ pipeline: { steps: [] }, events: [{ stage: 'unknown-stage' }] });
  assert.ok(codes(unconfigured).includes('missing-quick-brief'));

  // 关闭的机会：只有存在面试活动时才要求复盘
  const closedWithoutInterview = row({ data: { gate: 'G4', status: '放弃', 'next-action': '流程关闭' }, events: [], debriefs: [] });
  assert.equal(codes(closedWithoutInterview).includes('missing-closed-debrief'), false);
  const closedWithInterview = row({ data: { gate: 'G4', status: '未通过', 'next-action': '流程关闭' }, events: [{ stage: 'r1' }] });
  assert.ok(codes(closedWithInterview).includes('missing-closed-debrief'));
});

test('workbench validate 对新建主档通过', async () => {
  const slug = `test-consistency-${process.pid}`;
  const opportunityDir = join(ROOT, 'interview-prep', 'opportunities', slug);
  try {
    await run(WORKBENCH, ['new-opportunity', '--slug', slug, '--company', '测试公司', '--role', '测试岗位']);
    const setStatus = await run(WORKBENCH, ['set-status', '--slug', slug, '--status', '面试邀约']);
    assert.equal(setStatus.code, 0, setStatus.stderr);
    const validated = await run(WORKBENCH, ['validate']);
    assert.equal(validated.code, 0, validated.stderr);
  } finally {
    await rm(opportunityDir, { recursive: true, force: true });
  }
});

test('workbench new-opportunity --jd-file 生成抽取草稿节', async () => {
  const slug = `test-jd-${process.pid}`;
  const opportunityDir = join(ROOT, 'interview-prep', 'opportunities', slug);
  const jdPath = join(ROOT, 'private-notes', `jd-${process.pid}.txt`);
  const noJdSlug = `test-nojd-${process.pid}`;
  const noJdDir = join(ROOT, 'interview-prep', 'opportunities', noJdSlug);
  try {
    await writeFile(jdPath, '工作地点：北京\n薪资：20-30K·16薪\n岗位职责：\n- 设计并实现 LLM 分布式推理框架，优化吞吐与延迟\n- 熟悉 vLLM、SGLang，掌握 PagedAttention\n');
    const created = await run(WORKBENCH, [
      'new-opportunity', '--slug', slug, '--company', '测试公司', '--role', '测试岗位',
      '--jd-file', relative(ROOT, jdPath),
      '--rounds', '2 轮：技术面+HR 面', '--hc', '有', '--convert', '实习 3 个月可转正答辩'
    ]);
    assert.equal(created.code, 0, created.stderr);
    const record = await readFile(join(opportunityDir, 'record.md'), 'utf8');
    assert.match(record, /^slug: test-jd-/m);
    assert.match(record, /## JD 自动抽取草稿（--jd 生成 · 待人工校对）/);
    assert.match(record, /\| 地点 \| 北京 \|/);
    assert.match(record, /\| 薪资 \| 20-30K·16薪 \|/);
    assert.match(record, /vLLM/);
    assert.match(record, /待人工确认/);
    assert.match(record, /\| 轮次结构（招聘方口径） \| 2 轮：技术面\+HR 面 \|/);
    assert.match(record, /\| 转正 HC \| 有 \|/);
    assert.match(record, /\| 转正情况（答辩 \/ 比例 \/ 时长） \| 实习 3 个月可转正答辩 \|/);
    const both = await run(WORKBENCH, [
      'new-opportunity', '--slug', `test-jd-both-${process.pid}`, '--company', '测试公司', '--role', '测试岗位',
      '--jd-file', relative(ROOT, jdPath), '--jd', 'inline'
    ]);
    assert.notEqual(both.code, 0);
    assert.match(both.stderr, /不能同时使用/);
    await run(WORKBENCH, ['new-opportunity', '--slug', noJdSlug, '--company', '测试公司', '--role', '测试岗位']);
    const noJdRecord = await readFile(join(noJdDir, 'record.md'), 'utf8');
    assert.doesNotMatch(noJdRecord, /JD 自动抽取草稿/);
  } finally {
    await rm(opportunityDir, { recursive: true, force: true });
    await rm(noJdDir, { recursive: true, force: true });
    await rm(join(ROOT, 'interview-prep', 'opportunities', `test-jd-both-${process.pid}`), { recursive: true, force: true });
    await rm(jdPath, { force: true });
  }
});
test('面试流程推导区分预计、已定档、待反馈和后续未进入', () => {
  const data = {
    'opportunity-type': 'campus',
    'recruiting-cycle': '2027-autumn',
    'interview-process-source': 'HR 口径',
    'interview-process-as-of': '2026-09-02',
    'interview-process': JSON.stringify([
      { id: 'r1', kind: 'technical', label: '第一轮技术面' },
      { id: 'r2', kind: 'technical', label: '第二轮技术面' },
      { id: 'hr', kind: 'hr', label: 'HR 面' }
    ])
  };
  assert.deepEqual(validateInterviewProcess(data), []);
  const pipeline = deriveInterviewPipeline(data, [{
    stage: 'r1', start: new Date('2026-09-07T06:00:00Z'), end: new Date('2026-09-07T07:00:00Z'), file: 'r1.json'
  }], [], new Date('2026-09-02T04:00:00Z'));
  assert.equal(pipeline.currentStepId, 'r1');
  assert.equal(pipeline.steps[0].status, 'scheduled');
  assert.equal(pipeline.steps[1].status, 'expected');
  assert.equal(pipeline.steps[2].status, 'expected');
  const after = deriveInterviewPipeline(data, [], [{
    name: 'r1.md', data: { stage: 'r1', date: '2026-09-07', result: '通过' }
  }], new Date('2026-09-08T04:00:00Z'));
  assert.equal(after.currentStepId, 'r2');
  assert.equal(after.steps[0].status, 'passed');
  assert.equal(after.steps[1].status, 'awaiting_schedule');
  assert.equal(after.steps[2].status, 'expected');
});

test('非面试日程不绑定到面试轮次，未标注 stage 的旧日程仍按顺序归属', () => {
  const data = {
    'opportunity-type': 'campus',
    'recruiting-cycle': '2027-autumn',
    'interview-process-source': 'HR 口径',
    'interview-process-as-of': '2026-09-24',
    'interview-process': JSON.stringify([
      { id: 'r1', kind: 'technical', label: '第一轮技术面' },
      { id: 'r2', kind: 'technical', label: '第二轮技术面' },
      { id: 'r3', kind: 'technical', label: '第三轮技术面', optional: true }
    ]),
    gate: 'G3',
    status: 'Offer'
  };
  const r1 = { stage: 'r1', purpose: null, start: new Date('2026-09-22T08:00:00Z'), end: new Date('2026-09-22T09:00:00Z'), file: 'r1.json' };
  const r2 = { stage: 'r2', purpose: null, start: new Date('2026-09-24T02:00:00Z'), end: new Date('2026-09-24T03:00:00Z'), file: 'r2.json' };
  const onboarding = { stage: null, purpose: 'onboarding', start: new Date('2026-10-08T01:00:00Z'), end: new Date('2026-10-08T10:30:00Z'), file: 'onboarding.json' };
  const debriefs = [
    { name: 'r1.md', data: { stage: 'r1', date: '2026-09-22', result: '通过' } },
    { name: 'r2.md', data: { stage: 'r2', date: '2026-09-24', result: '通过' } }
  ];
  const concluded = deriveInterviewPipeline(data, [r1, r2, onboarding], debriefs, new Date('2026-09-25T04:00:00Z'));
  assert.equal(concluded.steps[2].schedule, null);
  assert.equal(concluded.steps[2].status, 'optional');
  assert.equal(concluded.steps[2].statusLabel, '可能追加');
  assert.equal(concluded.completedCount, 2);
  assert.equal(concluded.currentStepId, null);
  const legacy = deriveInterviewPipeline(data, [r1, r2, { ...onboarding, purpose: null }], debriefs, new Date('2026-09-25T04:00:00Z'));
  assert.equal(legacy.steps[2].schedule.file, 'onboarding.json');
});

test('context 索引校验拒绝磁盘上不存在的路径', async () => {
  const scope = paths => ({ label: '测试域', required: [], onDemand: paths.map(path => ({ path, reason: '测试' })) });
  const catalog = paths => ({ version: 1, scopes: { opportunity: scope([]), career: scope(paths), profile: scope([]) } });
  assert.deepEqual(await validateContextCatalog(catalog(['career-thinking/README.md'])), []);
  assert.match((await validateContextCatalog(catalog(['career-thinking/不存在的文件.md']))).join('\n'), /career-thinking\/不存在的文件\.md/);
});

test('相对链接扫描只校验落盘路径，并拒绝断链', async () => {
  const root = await mkdtemp(join(ROOT, 'link-check-test-'));
  try {
    await writeFile(join(root, 'a.md'), '[ok](./b.md) · [外部](https://example.com/x) · [协议](xd://security_scan) · [锚点](#section) · [占位](opportunities/<slug>/record.md) · [断链](./missing.md)');
    await writeFile(join(root, 'b.md'), '# b');
    const { files, errors } = await validateRepositoryLinks(root);
    assert.equal(files, 2);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /missing\.md/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('仓库现有文档的相对链接全部可达', async () => {
  const { errors } = await validateRepositoryLinks();
  assert.deepEqual(errors, []);
});

test('仓库一致性审计发现 quick-brief Gate 与 README 索引漂移', () => {
  const rows = [
    { slug: 'alpha', data: { gate: 'G4', status: '未通过', 'opportunity-type': 'campus', 'recruiting-cycle': '2027-autumn' } },
    { slug: 'beta', data: { gate: 'G2', status: '面试中' } }
  ];
  const readmeText = ['[`record.md`](opportunities/alpha/record.md)', '[`record.md`](opportunities/gone/record.md)', '[复盘](debriefs/2026-01-01-alpha-r1.md)', '[复盘](debriefs/2026-01-02-missing.md)'].join('\n');
  const issues = auditRepositoryConsistency({
    rows,
    readmeText,
    debriefNames: ['2026-01-01-alpha-r1.md', '2026-01-03-beta-r1.md'],
    quickBriefGates: { alpha: 'G2 · 已定档', beta: 'G2 · 面试中' }
  });
  assert.deepEqual(issues.map(issue => issue.code).sort(), [
    'missing-opportunity-type', 'quick-brief-gate-drift', 'readme-debrief-missing',
    'readme-debrief-stale', 'readme-opportunity-missing', 'readme-opportunity-stale'
  ].sort());
  assert.equal(issues.find(issue => issue.code === 'quick-brief-gate-drift').severity, 'error');
});

test('dashboard CLI 输出分类后的轮次链并生成只读 HTML', async () => {
  const slug = `test-dashboard-${process.pid}`;
  const opportunityDir = join(ROOT, 'interview-prep', 'opportunities', slug);
  const calendarFile = join(ROOT, 'private-notes', 'calendar', `${slug}-r1.json`);
  const htmlFile = join(ROOT, 'private-notes', `dashboard-test-${process.pid}.html`);
  try {
    const created = await run(WORKBENCH, [
      'new-opportunity', '--slug', slug, '--company', '看板测试公司', '--role', '秋招测试岗位',
      '--type', 'campus', '--cycle', '2027-autumn'
    ]);
    assert.equal(created.code, 0, created.stderr);
    const process = await run(WORKBENCH, [
      'set-process', '--slug', slug, '--type', 'campus', '--cycle', '2027-autumn',
      '--source', 'HR 口径', '--as-of', '2026-09-02',
      '--round', 'r1|technical|第一轮技术面', '--round', 'r2|technical|第二轮技术面', '--round', 'hr|hr|HR 面'
    ]);
    assert.equal(process.code, 0, process.stderr);
    const scheduled = await run(WORKBENCH, [
      'schedule', '--slug', slug, '--start', '2026-09-10T14:00:00+08:00', '--mode', 'mirror-only', '--stage', 'r1', '--confirm'
    ]);
    assert.equal(scheduled.code, 0, scheduled.stderr);
    const dashboard = await run(WORKBENCH, [
      'dashboard', '--at', '2026-09-02T12:00:00+08:00', '--window-days', '14', '--json'
    ]);
    assert.equal(dashboard.code, 0, dashboard.stderr);
    const payload = JSON.parse(dashboard.stdout);
    const card = payload.sections.campus.find(item => item.slug === slug);
    assert.ok(card);
    assert.equal(card.pipeline.currentStepId, 'r1');
    assert.equal(card.pipeline.steps.length, 3);
    assert.equal(card.pipeline.steps[0].status, 'scheduled');
    assert.equal(payload.timeline.some(item => item.slug === slug && item.stage === 'r1'), true);
    const rendered = await run(WORKBENCH, [
      'dashboard', '--at', '2026-09-02T12:00:00+08:00', '--html', '--output', relative(ROOT, htmlFile)
    ]);
    assert.equal(rendered.code, 0, rendered.stderr);
    const html = await readFile(htmlFile, 'utf8');
    assert.match(html, /看板测试公司/);
    assert.match(html, /第一轮技术面/);
    assert.match(html, /2027 秋招/);
  } finally {
    await rm(opportunityDir, { recursive: true, force: true });
    await rm(calendarFile, { force: true });
    await rm(htmlFile, { force: true });
  }
});
test('workbench context all 同时返回机会、职业与个人域', async () => {
  const slug = `test-all-scopes-${process.pid}`;
  try {
    const created = await run(WORKBENCH, ['new-opportunity', '--slug', slug, '--company', '上下文测试公司', '--role', '测试岗位']);
    assert.equal(created.code, 0, created.stderr);
    const result = await run(WORKBENCH, ['context', '--scope', 'all', '--slug', slug, '--json']);
    assert.equal(result.code, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.scope, 'all');
    assert.equal(payload.scopes.opportunity.opportunity.slug, slug);
    assert.equal(payload.scopes.career.scope, 'career');
    assert.equal(payload.scopes.profile.scope, 'profile');
  } finally {
    await rm(join(ROOT, 'interview-prep', 'opportunities', slug), { recursive: true, force: true });
  }
});
test('workbench reschedule 只更新已有日程并迁移待反馈复盘', async () => {
  const slug = `test-reschedule-${process.pid}`;
  const opportunityDir = join(ROOT, 'interview-prep', 'opportunities', slug);
  const briefPath = join(opportunityDir, 'quick-brief.md');
  const calendarFile = join(ROOT, 'private-notes', 'calendar', `${slug}-20260905-r1.json`);
  const oldDebrief = join(ROOT, 'interview-prep', 'debriefs', `2026-09-05-${slug}-r1.md`);
  const newDebrief = join(ROOT, 'interview-prep', 'debriefs', `2026-09-06-${slug}-r1.md`);
  try {
    await run(WORKBENCH, ['new-opportunity', '--slug', slug, '--company', '改期测试公司', '--role', '改期测试岗位']);
    await run(WORKBENCH, ['set-gate', '--slug', slug, '--gate', 'G2']);
    await run(WORKBENCH, ['record-outcome', '--slug', slug, '--next-action', '9月5日19:00前完成设备检查；面试后立即复盘']);
    await writeFile(calendarFile, JSON.stringify({ version: 1, eventId: `${slug}-20260905-r1`, stage: 'r1', calendar: '工作', title: '改期测试面试', start: '2026-09-05T19:00:00+08:00', durationMinutes: 60, location: '视频面试', description: '面试日期：2026-09-05（周六）\n面试时间：19:00（GMT+8）', alarms: [-86400, -1800] }));
    await writeFile(briefPath, `# 改期测试速览\n\n> 更新时间：2026-09-05\n> 本场：2026-09-05 19:00\n\n- 面试后建立 \`2026-09-05-${slug}-r1.md\`\n`);
    const debrief = await run(WORKBENCH, ['new-debrief', '--slug', slug, '--date', '2026-09-05', '--stage', 'r1']);
    assert.equal(debrief.code, 0, debrief.stderr);
    const missingSelector = await run(WORKBENCH, ['reschedule', '--slug', slug, '--start', '2026-09-06T20:30:00+08:00']);
    assert.notEqual(missingSelector.code, 0);
    assert.match(missingSelector.stderr, /必须指定 --stage 或 --event-id/);
    const dryRun = await run(WORKBENCH, ['reschedule', '--slug', slug, '--stage', 'r1', '--start', '2026-09-06T20:30:00+08:00']);
    assert.equal(dryRun.code, 0, dryRun.stderr);
    const dryPayload = JSON.parse(dryRun.stdout);
    assert.equal(dryPayload.mode, 'dry-run');
    assert.equal(dryPayload.eventId, `${slug}-20260905-r1`);
    assert.equal(dryPayload.debrief.to, `2026-09-06-${slug}-r1.md`);
    assert.equal(dryPayload.record.nextAction, '9月6日20:30前完成设备检查；面试后立即复盘');
    assert.match(await readFile(calendarFile, 'utf8'), /2026-09-05T19:00:00/);
    const applied = await run(WORKBENCH, ['reschedule', '--slug', slug, '--stage', 'r1', '--start', '2026-09-06T20:30:00+08:00', '--confirm']);
    assert.equal(applied.code, 0, applied.stderr);
    const appliedPayload = JSON.parse(applied.stdout);
    assert.equal(appliedPayload.action, 'reschedule');
    assert.equal(appliedPayload.calendarInput.path, `private-notes/calendar/${slug}-20260905-r1.json`);
    assert.equal(JSON.parse(await readFile(calendarFile, 'utf8')).start, '2026-09-06T20:30:00+08:00');
    assert.match(await readFile(join(opportunityDir, 'record.md'), 'utf8'), /日期与时间 \| 2026-09-06（周日）20:30–21:30/);
    await assert.rejects(readFile(oldDebrief, 'utf8'));
    assert.match(await readFile(newDebrief, 'utf8'), /^date: 2026-09-06$/m);
    const brief = await readFile(briefPath, 'utf8');
    assert.match(brief, /> 本场：2026-09-06 20:30/);
    assert.match(brief, new RegExp(`2026-09-06-${slug}-r1\\.md`));
    await run(WORKBENCH, ['set-gate', '--slug', slug, '--gate', 'G4']);
    const closed = await run(WORKBENCH, ['reschedule', '--slug', slug, '--stage', 'r1', '--start', '2026-09-07T19:00:00+08:00']);
    assert.notEqual(closed.code, 0);
    assert.match(closed.stderr, /G4.*不能调整/);
  } finally {
    await rm(opportunityDir, { recursive: true, force: true });
    await rm(calendarFile, { force: true });
    await rm(oldDebrief, { force: true });
    await rm(newDebrief, { force: true });
  }
});
