const OPPORTUNITY_TYPES = new Set(['campus', 'internship', 'experienced']);
const ROUND_KINDS = new Set(['business', 'technical', 'hiring-manager', 'hr', 'assessment', 'other']);
const PASS_RESULTS = new Set(['通过', '进入下一轮']);
const FAIL_RESULTS = new Set(['未通过', '流程终止']);
const PENDING_RESULTS = new Set(['待反馈', '未知']);

export const NEGATIVE_TERMINAL_STATUSES = new Set([
  '感谢信', '未通过', '流程终止', '无回复关闭', '搁置', '放弃', '主动终止', 'HC 取消'
]);

const STEP_STATUS_LABELS = {
  expected: '预计', optional: '可能追加', awaiting_schedule: '待安排', scheduled: '已定档',
  in_progress: '进行中', needs_debrief: '待复盘', waiting_feedback: '待反馈', passed: '已通过',
  failed: '未通过', not_entered: '未进入'
};

export function parseInterviewProcess(data) {
  const raw = data['interview-process'];
  if (!raw) return {
    configured: false,
    opportunityType: data['opportunity-type'] || null,
    recruitingCycle: data['recruiting-cycle'] || null,
    source: data['interview-process-source'] || null,
    asOf: data['interview-process-as-of'] || null,
    steps: []
  };
  let steps;
  try { steps = JSON.parse(raw); } catch (error) {
    throw new Error(`interview-process 不是有效 JSON: ${error.message}`);
  }
  if (!Array.isArray(steps)) throw new Error('interview-process 必须是 JSON 数组');
  return {
    configured: steps.length > 0,
    opportunityType: data['opportunity-type'] || null,
    recruitingCycle: data['recruiting-cycle'] || null,
    source: data['interview-process-source'] || null,
    asOf: data['interview-process-as-of'] || null,
    steps: steps.map((step, index) => ({
      id: step.id, label: step.label, kind: step.kind, optional: step.optional === true, order: index + 1
    }))
  };
}

export function validateInterviewProcess(data) {
  const errors = [];
  const type = data['opportunity-type'];
  if (type && !OPPORTUNITY_TYPES.has(type)) errors.push(`opportunity-type="${type}" 不在词表 (campus|internship|experienced)`);
  const cycle = data['recruiting-cycle'];
  if (cycle && !/^\d{4}-(spring|autumn)$/.test(cycle)) errors.push(`recruiting-cycle="${cycle}" 必须是 YYYY-spring 或 YYYY-autumn`);
  if (data['interview-process-as-of'] && !/^\d{4}-\d{2}-\d{2}$/.test(data['interview-process-as-of'])) errors.push('interview-process-as-of 必须是 YYYY-MM-DD');
  let process;
  try { process = parseInterviewProcess(data); } catch (error) { errors.push(error.message); return errors; }
  if (!process.configured) return errors;
  if (!type) errors.push('已配置 interview-process 时必须设置 opportunity-type');
  if (!process.source) errors.push('已配置 interview-process 时必须设置 interview-process-source');
  if (!process.asOf) errors.push('已配置 interview-process 时必须设置 interview-process-as-of');
  const ids = new Set();
  for (const [index, step] of process.steps.entries()) {
    const prefix = `interview-process[${index}]`;
    if (typeof step.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,30}$/.test(step.id)) errors.push(`${prefix}.id 必须是 1–31 位小写 slug`);
    else if (ids.has(step.id)) errors.push(`${prefix}.id="${step.id}" 重复`);
    else ids.add(step.id);
    if (typeof step.label !== 'string' || !step.label.trim() || step.label.length > 80) errors.push(`${prefix}.label 必须是 1–80 字符非空文本`);
    if (!ROUND_KINDS.has(step.kind)) errors.push(`${prefix}.kind="${step.kind ?? ''}" 不在词表 (${[...ROUND_KINDS].join('|')})`);
  }
  return errors;
}

function resolveStepIndex(steps, stage) {
  if (!stage) return -1;
  const direct = steps.findIndex(step => step.id === stage);
  if (direct >= 0) return direct;
  const normalized = String(stage).toLowerCase();
  const number = normalized.match(/(?:round|r|第)(?:-|_)?([1-9]\d*)/);
  if (number) return Number(number[1]) <= steps.length ? Number(number[1]) - 1 : -1;
  if (normalized.includes('first') || normalized.includes('technical-round')) return 0;
  if (normalized.includes('second')) return steps.length > 1 ? 1 : 0;
  if (normalized.includes('third')) return steps.length > 2 ? 2 : 0;
  if (normalized.includes('hr')) return steps.findIndex(step => step.kind === 'hr');
  return -1;
}

export function assignEventStages(processData, events) {
  const process = parseInterviewProcess(processData);
  if (!process.configured) return events;
  const used = new Set();
  return [...events].sort((a, b) => a.start - b.start).map(event => {
    if (event.purpose && event.purpose !== 'interview') return { ...event, stage: null };
    let index = resolveStepIndex(process.steps, event.stage);
    if (index < 0) index = process.steps.findIndex((step, candidate) => !used.has(candidate));
    if (index >= 0) used.add(index);
    return { ...event, stage: index >= 0 ? process.steps[index].id : event.stage };
  });
}
export const normalizeInterviewEvents = assignEventStages;

function latestDebrief(debriefs) {
  return [...debriefs].sort((a, b) => a.data.date.localeCompare(b.data.date) || a.name.localeCompare(b.name)).at(-1) ?? null;
}

function relevantEvent(events, now) {
  const ordered = [...events].sort((a, b) => a.start - b.start);
  return ordered.find(event => event.start <= now && now < event.end)
    ?? ordered.find(event => now < event.start)
    ?? ordered.at(-1)
    ?? null;
}

export function deriveInterviewPipeline(data, events, debriefs, now) {
  const process = parseInterviewProcess(data);
  if (!process.configured) return {
    ...process, currentStepId: null, currentStep: null, completedCount: 0, totalCount: 0,
    offer: data.status === 'Offer', steps: []
  };
  const normalizedEvents = assignEventStages(data, events);
  const reachedIndexes = [];
  for (const event of normalizedEvents) {
    const index = resolveStepIndex(process.steps, event.stage);
    if (index >= 0) reachedIndexes.push(index);
  }
  for (const debrief of debriefs) {
    const index = resolveStepIndex(process.steps, debrief.data.stage);
    if (index >= 0) reachedIndexes.push(index);
  }
  const furthestReachedIndex = reachedIndexes.length > 0 ? Math.max(...reachedIndexes) : -1;
  const closedNegative = data.gate === 'G4' || NEGATIVE_TERMINAL_STATUSES.has(data.status);
  const concluded = closedNegative || data.status === 'Offer';
  let previousPassed = true;
  let failureSeen = false;
  const steps = process.steps.map((step, index) => {
    const stepEvents = normalizedEvents.filter(event => event.stage === step.id);
    const stepDebriefs = debriefs.filter(debrief => resolveStepIndex(process.steps, debrief.data.stage) === index);
    const debrief = latestDebrief(stepDebriefs);
    const result = debrief?.data.result ?? null;
    const event = relevantEvent(stepEvents, now);
    let status;
    let inferred = false;
    if (FAIL_RESULTS.has(result)) { status = 'failed'; failureSeen = true; }
    else if (PASS_RESULTS.has(result)) status = 'passed';
    else if (event && event.start <= now && now < event.end) status = 'in_progress';
    else if (event && now < event.start) status = 'scheduled';
    else if (event && now >= event.end) status = PENDING_RESULTS.has(result) ? 'waiting_feedback' : 'needs_debrief';
    else if (PENDING_RESULTS.has(result)) status = 'waiting_feedback';
    else if (index < furthestReachedIndex) { status = 'passed'; inferred = true; }
    else if (failureSeen || (closedNegative && index > furthestReachedIndex)) status = 'not_entered';
    else if (concluded && index > furthestReachedIndex) status = step.optional ? 'optional' : 'not_entered';
    else if (previousPassed) status = 'awaiting_schedule';
    else status = step.optional ? 'optional' : 'expected';
    if (status !== 'passed') previousPassed = false;
    return {
      ...step, status, statusLabel: STEP_STATUS_LABELS[status], inferred, result,
      schedule: event ? { file: event.file, start: event.start.toISOString(), end: event.end.toISOString() } : null,
      debrief: debrief ? { file: debrief.name, date: debrief.data.date, result } : null
    };
  });
  const currentStep = data.status === 'Offer' ? null : (
    steps.find(step => ['needs_debrief', 'in_progress', 'scheduled', 'awaiting_schedule', 'waiting_feedback'].includes(step.status))
      ?? steps.find(step => step.status === 'failed') ?? null
  );
  return {
    ...process, currentStepId: currentStep?.id ?? null, currentStep,
    completedCount: steps.filter(step => step.status === 'passed').length,
    totalCount: steps.length, offer: data.status === 'Offer', steps
  };
}

export function parseRoundSpecification(value) {
  const parts = value.split('|');
  if (parts.length < 3 || parts.length > 4) throw new Error('--round 必须是 ID|KIND|LABEL 或 ID|KIND|LABEL|optional');
  const [id, kind, label, marker] = parts.map(part => part.trim());
  if (marker && marker !== 'optional') throw new Error('--round 第四段只允许 optional');
  const step = { id, kind, label, ...(marker ? { optional: true } : {}) };
  const errors = validateInterviewProcess({
    'opportunity-type': 'internship', 'interview-process-source': 'cli', 'interview-process-as-of': '2000-01-01',
    'interview-process': JSON.stringify([step])
  });
  const stepError = errors.find(error => error.startsWith('interview-process['));
  if (stepError) throw new Error(`--round 无效: ${stepError}`);
  return step;
}
