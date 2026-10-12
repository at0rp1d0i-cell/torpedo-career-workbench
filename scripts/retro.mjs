// 求职周期收尾：只读聚合一个招聘周期的结果分布、轮次通过情况和未收尾事项。
// 输出是投影，不是事实源；所有事实仍归各机会 record.md 与单场复盘。
import { NEGATIVE_TERMINAL_STATUSES } from './interview-process.mjs';

const KIND_LABELS = {
  assessment: '笔试 / 测评', technical: '技术面', business: '业务面', 'hiring-manager': '主管面',
  hr: 'HR 面', other: '其他', unclassified: '未配置流程'
};
const KIND_ORDER = Object.keys(KIND_LABELS);
const TYPE_LABELS = { campus: '校招正式岗', internship: '实习', experienced: '其他正式岗' };
const PENDING_RESULTS = new Set(['待反馈', '未知']);
const PASS_RESULTS = new Set(['通过', '进入下一轮']);
const FAIL_RESULTS = new Set(['未通过', '流程终止']);

function countBy(items, key) {
  const counts = {};
  for (const item of items) { const value = key(item) ?? '未设置'; counts[value] = (counts[value] ?? 0) + 1; }
  return counts;
}

function outcomeOf(row) {
  if (row.data.status === 'Offer') return 'offer';
  if (row.data.gate === 'G4' || NEGATIVE_TERMINAL_STATUSES.has(row.data.status)) return 'closed';
  return 'open';
}

// 「到达」只认有日程或复盘的轮次；由后续轮次推断的通过不计入通过率，避免把推导当证据。
function furthestStep(row) {
  const touched = (row.pipeline?.steps ?? []).filter(step => step.schedule || step.debrief);
  return touched.at(-1) ?? null;
}

function roundRecords(row) {
  if (row.pipeline?.configured) {
    return row.pipeline.steps.filter(step => step.debrief).map(step => ({ kind: step.kind, result: step.debrief.result }));
  }
  return (row.debriefs ?? []).map(debrief => ({ kind: 'unclassified', result: debrief.data.result }));
}

function looseEnds(row, at) {
  const ends = []; const { slug, data } = row; const outcome = outcomeOf(row);
  if (outcome === 'open') ends.push({ slug, code: 'open-opportunity', message: `仍在 ${data.gate} · ${data.status}，周期结束前需要关闭或写明保留理由`, command: `node scripts/workbench.mjs record-outcome --slug ${slug} --gate G4 --status <最终状态> --next-action "<关闭说明>"` });
  for (const debrief of row.debriefs ?? []) {
    if (PENDING_RESULTS.has(debrief.data.result)) ends.push({ slug, code: 'pending-debrief', message: `复盘 ${debrief.name} 结果仍为「${debrief.data.result}」`, command: `node scripts/workbench.mjs record-outcome --slug ${slug} --result <结果> --debrief ${debrief.name}` });
  }
  if (data.status === 'Offer' && !row.flags?.['offer-decision.md']) ends.push({ slug, code: 'offer-without-decision', message: '已记录 Offer，但缺少 offer-decision.md（接受 / 拒绝理由）', command: `node scripts/workbench.mjs new-offer --slug ${slug} --date <YYYY-MM-DD>` });
  if (outcome !== 'open') {
    for (const event of row.events ?? []) {
      if (event.start > at) ends.push({ slug, code: 'future-calendar-input', message: `机会已结束，但仍有未来日程 ${event.file}`, command: `核对后用 calendar.mjs delete 精确删除 Calendar.app 事件，并把输入移入 private-notes/calendar/cancelled/` });
    }
  }
  return ends;
}

export function buildRetroPayload(rows, at, filter = {}) {
  const selected = rows.filter(row => (!filter.cycle || row.data['recruiting-cycle'] === filter.cycle) && (!filter.type || row.data['opportunity-type'] === filter.type));
  const opportunities = selected.map(row => {
    const furthest = furthestStep(row);
    const failed = row.pipeline?.steps?.find(step => step.status === 'failed') ?? null;
    return {
      slug: row.slug, company: row.data.company, role: row.data.role,
      type: row.data['opportunity-type'] || null, cycle: row.data['recruiting-cycle'] || null,
      gate: row.data.gate, status: row.data.status, outcome: outcomeOf(row),
      reached: furthest ? furthest.label : null, failedAt: failed ? failed.label : null,
      debriefCount: (row.debriefs ?? []).length
    };
  });
  const roundStats = new Map();
  for (const record of selected.flatMap(roundRecords)) {
    const stat = roundStats.get(record.kind) ?? { kind: record.kind, label: KIND_LABELS[record.kind] ?? record.kind, total: 0, passed: 0, failed: 0, pending: 0 };
    stat.total += 1;
    if (PASS_RESULTS.has(record.result)) stat.passed += 1;
    else if (FAIL_RESULTS.has(record.result)) stat.failed += 1;
    else stat.pending += 1;
    roundStats.set(record.kind, stat);
  }
  const rounds = [...roundStats.values()].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
  const outcomes = countBy(opportunities, item => item.outcome);
  return {
    generatedAt: at.toISOString(),
    filter: { cycle: filter.cycle ?? null, type: filter.type ?? null },
    summary: {
      total: opportunities.length, offers: outcomes.offer ?? 0, closed: outcomes.closed ?? 0, open: outcomes.open ?? 0,
      debriefs: opportunities.reduce((sum, item) => sum + item.debriefCount, 0),
      byType: countBy(opportunities, item => TYPE_LABELS[item.type]), byGate: countBy(opportunities, item => item.gate), byStatus: countBy(opportunities, item => item.status)
    },
    rounds,
    opportunities,
    looseEnds: selected.flatMap(row => looseEnds(row, at))
  };
}

function formatCounts(counts) { return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([key, value]) => `${key} ${value}`).join(' · ') || '无'; }
function scopeLabel(filter) { return [filter.cycle ?? '全部周期', filter.type ? TYPE_LABELS[filter.type] : null].filter(Boolean).join(' · '); }
function escapeCell(value) { return String(value ?? '—').replaceAll('|', '\\|'); }

export function renderTerminalRetro(payload) {
  const { summary } = payload; const lines = [
    `=== 周期复盘 · ${scopeLabel(payload.filter)} ===`,
    `机会 ${summary.total} 个：Offer ${summary.offers} · 已关闭 ${summary.closed} · 未收尾 ${summary.open}；复盘 ${summary.debriefs} 份`,
    `类型：${formatCounts(summary.byType)}`,
    `状态：${formatCounts(summary.byStatus)}`,
    '--- 轮次结果（只计已建复盘）---'
  ];
  if (payload.rounds.length === 0) lines.push('  尚无复盘');
  for (const round of payload.rounds) lines.push(`  ${round.label}：${round.total} 场 · 通过 ${round.passed} · 未通过 ${round.failed} · 待定 ${round.pending}`);
  lines.push('--- 机会结果 ---');
  for (const item of payload.opportunities) lines.push(`  ${item.gate} | ${item.status} | ${item.slug} · 最远 ${item.reached ?? '未进入面试'}${item.failedAt ? ` · 止于 ${item.failedAt}` : ''}`);
  lines.push(`--- 收尾清单 · ${payload.looseEnds.length} 项 ---`);
  if (payload.looseEnds.length === 0) lines.push('  无未收尾事项');
  for (const end of payload.looseEnds) { lines.push(`  [${end.code}] ${end.slug}：${end.message}`); lines.push(`    → ${end.command}`); }
  return `${lines.join('\n')}\n`;
}

export function renderMarkdownSnapshot(payload) {
  const { summary } = payload; const lines = [
    `> 快照生成于 ${payload.generatedAt}，范围：${scopeLabel(payload.filter)}。只读投影，不随主档自动更新。`,
    '',
    `- 机会 ${summary.total} 个：Offer ${summary.offers} · 已关闭 ${summary.closed} · 未收尾 ${summary.open}；复盘 ${summary.debriefs} 份`,
    `- 类型：${formatCounts(summary.byType)}`,
    `- 状态：${formatCounts(summary.byStatus)}`,
    '',
    '| 轮次类型 | 场次 | 通过 | 未通过 | 待定 |',
    '|---|---|---|---|---|',
    ...(payload.rounds.length ? payload.rounds.map(round => `| ${round.label} | ${round.total} | ${round.passed} | ${round.failed} | ${round.pending} |`) : ['| 尚无复盘 | 0 | 0 | 0 | 0 |']),
    '',
    '| 机会 | Gate | 状态 | 最远轮次 | 止于 |',
    '|---|---|---|---|---|',
    ...(payload.opportunities.length ? payload.opportunities.map(item => `| ${escapeCell(`${item.company} · ${item.role}`)} | ${item.gate} | ${escapeCell(item.status)} | ${escapeCell(item.reached ?? '未进入面试')} | ${escapeCell(item.failedAt)} |`) : ['| 无 | — | — | — | — |']),
    '',
    `生成时未收尾事项：${payload.looseEnds.length} 项${payload.looseEnds.length ? `（${[...new Set(payload.looseEnds.map(end => end.code))].join('、')}）；以 \`retro\` 命令的最新输出为准` : ''}。`
  ];
  return lines.join('\n');
}
