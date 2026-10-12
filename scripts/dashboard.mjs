import { NEGATIVE_TERMINAL_STATUSES } from './interview-process.mjs';

const CURRENT_STATUS_PRIORITY = {
  needs_debrief: 0,
  in_progress: 1,
  scheduled: 2,
  awaiting_schedule: 3,
  waiting_feedback: 4,
  failed: 5,
  expected: 6,
  optional: 7,
  not_entered: 8,
  passed: 9
};

function opportunityTypeLabel(type) {
  return { campus: '校招正式岗', internship: '实习', experienced: '其他正式岗' }[type] ?? '未分类';
}

function recruitingCycleLabel(cycle) {
  const match = cycle?.match(/^(\d{4})-(spring|autumn)$/);
  if (!match) return null;
  return `${match[1]} ${match[2] === 'autumn' ? '秋招' : '春招'}`;
}

function serializeOpportunity(row) {
  const { data, pipeline, runtime, flags, events, debriefs, issues } = row;
  return {
    slug: row.slug,
    company: data.company,
    role: data.role,
    gate: data.gate,
    status: data.status,
    nextAction: data['next-action'] || runtime.nextAction,
    updatedAt: data['updated-at'],
    opportunityType: pipeline.opportunityType,
    opportunityTypeLabel: opportunityTypeLabel(pipeline.opportunityType),
    recruitingCycle: pipeline.recruitingCycle,
    recruitingCycleLabel: recruitingCycleLabel(pipeline.recruitingCycle),
    timeState: runtime.timeState,
    pipeline,
    schedules: events.map(event => ({
      file: event.file,
      stage: event.stage,
      title: event.title,
      start: event.start.toISOString(),
      end: event.end.toISOString()
    })),
    documents: {
      record: `interview-prep/opportunities/${row.slug}/record.md`,
      quickBrief: flags['quick-brief.md'] ? `interview-prep/opportunities/${row.slug}/quick-brief.md` : null,
      questions: flags['question-script.md'] ? `interview-prep/opportunities/${row.slug}/question-script.md` : null,
      dueDiligence: flags['due-diligence.md'] ? `interview-prep/opportunities/${row.slug}/due-diligence.md` : null,
      offerDecision: flags['offer-decision.md'] ? `interview-prep/opportunities/${row.slug}/offer-decision.md` : null,
      debriefs: debriefs.map(debrief => `interview-prep/debriefs/${debrief.name}`)
    },
    issues
  };
}

function opportunitySortKey(opportunity) {
  const status = opportunity.pipeline.currentStep?.status ?? (opportunity.status === 'Offer' ? 'passed' : 'expected');
  const priority = CURRENT_STATUS_PRIORITY[status] ?? 50;
  const nextSchedule = opportunity.schedules.find(schedule => new Date(schedule.start).getTime() > 0)?.start ?? '9999';
  return [priority, nextSchedule, opportunity.company];
}

function compareOpportunities(a, b) {
  const ak = opportunitySortKey(a);
  const bk = opportunitySortKey(b);
  return ak[0] - bk[0] || ak[1].localeCompare(bk[1]) || ak[2].localeCompare(bk[2], 'zh-CN');
}

export function buildDashboardPayload(rows, at, windowDays) {
  const opportunities = rows.map(serializeOpportunity);
  const offers = opportunities.filter(opportunity => opportunity.status === 'Offer').sort(compareOpportunities);
  const closed = opportunities.filter(opportunity => opportunity.status !== 'Offer'
    && (opportunity.gate === 'G4' || NEGATIVE_TERMINAL_STATUSES.has(opportunity.status))).sort(compareOpportunities);
  const active = opportunities.filter(opportunity => !offers.includes(opportunity) && !closed.includes(opportunity));
  const campus = active.filter(opportunity => opportunity.opportunityType === 'campus').sort(compareOpportunities);
  const internship = active.filter(opportunity => opportunity.opportunityType === 'internship').sort(compareOpportunities);
  const other = active.filter(opportunity => !['campus', 'internship'].includes(opportunity.opportunityType)).sort(compareOpportunities);
  const windowEnd = new Date(at.getTime() + windowDays * 24 * 60 * 60 * 1000);
  const timeline = active.flatMap(opportunity => opportunity.schedules
    .filter(schedule => {
      const start = new Date(schedule.start);
      return start >= at && start <= windowEnd;
    })
    .map(schedule => ({
      slug: opportunity.slug,
      company: opportunity.company,
      role: opportunity.role,
      stage: schedule.stage,
      stageLabel: opportunity.pipeline.steps.find(step => step.id === schedule.stage)?.label ?? '面试',
      start: schedule.start,
      end: schedule.end
    })))
    .sort((a, b) => a.start.localeCompare(b.start));

  const currentStatuses = active.map(opportunity => opportunity.pipeline.currentStep?.status ?? opportunity.timeState);
  return {
    generatedAt: at.toISOString(),
    windowDays,
    summary: {
      total: opportunities.length,
      active: active.length,
      campusActive: campus.length,
      internshipActive: internship.length,
      campusOffers: offers.filter(opportunity => opportunity.opportunityType === 'campus').length,
      internshipOffers: offers.filter(opportunity => opportunity.opportunityType === 'internship').length,
      upcomingInterviews: timeline.length,
      waitingFeedback: currentStatuses.filter(status => status === 'waiting_feedback').length,
      needsDebrief: currentStatuses.filter(status => status === 'needs_debrief').length,
      closed: closed.length,
      auditErrors: active.flatMap(opportunity => opportunity.issues).filter(issue => issue.severity === 'error').length
    },
    sections: { offers, campus, internship, other, closed },
    timeline
  };
}

function localDateTime(value) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
  }).format(new Date(value)).replaceAll('/', '-');
}

function terminalPipeline(opportunity) {
  if (!opportunity.pipeline.configured) return '[流程待确认]';
  return opportunity.pipeline.steps.map(step => `[${step.label} · ${step.statusLabel}]`).join(' → ');
}

export function renderTerminalDashboard(payload) {
  const s = payload.summary;
  const lines = [
    `=== 求职工作台 · ${localDateTime(payload.generatedAt)} ===`,
    `秋招推进中 ${s.campusActive} · 秋招 Offer ${s.campusOffers} · 实习推进中 ${s.internshipActive} · 实习 Offer ${s.internshipOffers}`,
    `未来 ${payload.windowDays} 天面试 ${s.upcomingInterviews} · 待反馈 ${s.waitingFeedback} · 待复盘 ${s.needsDebrief} · 审计缺陷 ${s.auditErrors}`
  ];
  const renderSection = (title, opportunities) => {
    lines.push('', `[${title} · ${opportunities.length}]`);
    if (opportunities.length === 0) lines.push('（无）');
    for (const opportunity of opportunities) {
      const current = opportunity.pipeline.currentStep;
      const progress = opportunity.pipeline.configured
        ? `${current ? `${current.id.toUpperCase()} / ${opportunity.pipeline.totalCount} · ${current.label} · ${current.statusLabel}` : `已完成 ${opportunity.pipeline.completedCount} / ${opportunity.pipeline.totalCount}`}`
        : '流程待确认';
      lines.push(`${opportunity.company} · ${opportunity.role}`);
      lines.push(`  ${opportunity.gate} · ${opportunity.status} · ${progress}`);
      lines.push(`  ${terminalPipeline(opportunity)}`);
      lines.push(`  下一步：${opportunity.nextAction || '待确认'}`);
      if (opportunity.issues.length > 0) lines.push(`  审计：${opportunity.issues.map(issue => issue.message).join('；')}`);
    }
  };
  renderSection('Offer', payload.sections.offers);
  renderSection('秋招', payload.sections.campus);
  renderSection('实习', payload.sections.internship);
  if (payload.sections.other.length > 0) renderSection('其他推进中', payload.sections.other);
  lines.push('', `[近期时间线 · ${payload.timeline.length}]`);
  if (payload.timeline.length === 0) lines.push('（未来窗口内无面试）');
  for (const item of payload.timeline) lines.push(`${localDateTime(item.start)}  ${item.company} · ${item.stageLabel}`);
  lines.push('', `[已关闭 · ${payload.sections.closed.length} 个，HTML 默认折叠]`);
  return `${lines.join('\n')}\n`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function fileLink(path) {
  return path ? `../${path}` : null;
}

function renderStep(step) {
  const meta = [step.schedule ? localDateTime(step.schedule.start) : null, step.inferred ? '由后续轮次推断' : null].filter(Boolean).join(' · ');
  return `<li class="step step-${escapeHtml(step.status)}"><span class="step-label">${escapeHtml(step.label)}</span><span class="step-status">${escapeHtml(step.statusLabel)}</span>${meta ? `<span class="step-meta">${escapeHtml(meta)}</span>` : ''}</li>`;
}

function renderDocuments(documents) {
  const links = [
    ['主档', documents.record],
    ['尽调', documents.dueDiligence],
    ['速览', documents.quickBrief],
    ['反问', documents.questions],
    ['Offer 决策', documents.offerDecision]
  ].filter(([, path]) => path).map(([label, path]) => `<a href="${escapeHtml(fileLink(path))}">${escapeHtml(label)}</a>`);
  if (documents.debriefs.length > 0) links.push(...documents.debriefs.map((path, index) => `<a href="${escapeHtml(fileLink(path))}">复盘 ${index + 1}</a>`));
  return links.join('');
}

function renderCard(opportunity, closed = false) {
  const current = opportunity.pipeline.currentStep;
  const cycle = opportunity.recruitingCycleLabel ? `<span class="tag">${escapeHtml(opportunity.recruitingCycleLabel)}</span>` : '';
  const type = `<span class="tag">${escapeHtml(opportunity.opportunityTypeLabel)}</span>`;
  const progress = opportunity.pipeline.configured
    ? current
      ? `${current.id.toUpperCase()} / ${opportunity.pipeline.totalCount} · ${current.label} · ${current.statusLabel}`
      : `已完成 ${opportunity.pipeline.completedCount} / ${opportunity.pipeline.totalCount}`
    : '面试流程待确认';
  const steps = opportunity.pipeline.configured
    ? `<ol class="pipeline">${opportunity.pipeline.steps.map(renderStep).join('')}</ol>`
    : '<p class="unknown-process">预计轮次尚未确认；当前日程和运行态仍独立展示。</p>';
  const issues = opportunity.issues.length > 0
    ? `<ul class="issues">${opportunity.issues.map(issue => `<li class="issue-${escapeHtml(issue.severity)}">${escapeHtml(issue.message)}</li>`).join('')}</ul>`
    : '<p class="audit-ok">审计正常</p>';
  return `<article class="opportunity-card${closed ? ' is-closed' : ''}" data-type="${escapeHtml(opportunity.opportunityType ?? 'other')}" data-status="${escapeHtml(current?.status ?? opportunity.timeState)}">
    <header><div><div class="tags">${cycle}${type}<span class="tag gate">${escapeHtml(opportunity.gate)}</span></div><h3>${escapeHtml(opportunity.company)}</h3><p class="role">${escapeHtml(opportunity.role)}</p></div><span class="human-status">${escapeHtml(opportunity.status)}</span></header>
    <p class="progress">${escapeHtml(progress)}</p>
    ${steps}
    <div class="next-action"><strong>下一步</strong><span>${escapeHtml(opportunity.nextAction || '待确认')}</span></div>
    ${issues}
    <nav class="document-links">${renderDocuments(opportunity.documents)}</nav>
  </article>`;
}

function renderSection(title, opportunities, className) {
  return `<section class="dashboard-section ${className}"><div class="section-heading"><div><p class="eyebrow">Opportunity pipeline</p><h2>${escapeHtml(title)}</h2></div><span class="section-count">${opportunities.length}</span></div><div class="card-grid">${opportunities.length > 0 ? opportunities.map(opportunity => renderCard(opportunity)).join('') : '<p class="empty-state">当前没有机会。</p>'}</div></section>`;
}

export function renderDashboardHtml(payload) {
  const s = payload.summary;
  const closedCards = payload.sections.closed.map(opportunity => renderCard(opportunity, true)).join('');
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>求职工作台</title>
<style>
:root{color-scheme:light;--bg:#f4f3ee;--surface:#fff;--ink:#18201d;--muted:#64706b;--line:#d9ded9;--accent:#174f46;--accent-soft:#e1eee9;--blue:#245d8c;--blue-soft:#e9f1f8;--amber:#8b5b00;--amber-soft:#fff4d6;--red:#9b2f2f;--red-soft:#fbeaea;--green:#256747;--green-soft:#e8f4ed;--shadow:0 16px 40px rgba(23,38,33,.08)}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB",sans-serif}.page{width:min(1240px,calc(100% - 32px));margin:0 auto;padding:48px 0 80px}.hero{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(320px,.6fr);gap:24px;align-items:end;margin-bottom:28px}.eyebrow{margin:0 0 6px;color:var(--accent);font-size:12px;font-weight:750;letter-spacing:.12em;text-transform:uppercase}.hero h1{margin:0;font-size:clamp(34px,5vw,62px);line-height:1.05;letter-spacing:-.045em}.hero-copy{margin:14px 0 0;max-width:700px;color:var(--muted);font-size:16px}.generated{justify-self:end;color:var(--muted);font-size:13px}.metrics{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:12px;margin-bottom:32px}.metric{padding:18px;border:1px solid var(--line);border-radius:16px;background:rgba(255,255,255,.7)}.metric strong{display:block;font-size:28px;line-height:1.1}.metric span{color:var(--muted);font-size:13px}.toolbar{position:sticky;top:12px;z-index:4;display:flex;gap:8px;align-items:center;margin-bottom:28px;padding:10px;border:1px solid var(--line);border-radius:14px;background:rgba(255,255,255,.88);backdrop-filter:blur(12px);box-shadow:0 10px 24px rgba(23,38,33,.06)}.filter{border:0;border-radius:10px;padding:9px 13px;background:transparent;color:var(--muted);font:inherit;cursor:pointer}.filter.is-active{background:var(--accent);color:white}.dashboard-section{margin-top:38px}.section-heading{display:flex;align-items:end;justify-content:space-between;margin-bottom:16px}.section-heading h2{margin:0;font-size:28px;letter-spacing:-.025em}.section-count{display:grid;place-items:center;min-width:38px;height:38px;border-radius:20px;background:var(--accent-soft);color:var(--accent);font-weight:750}.card-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}.opportunity-card{padding:22px;border:1px solid var(--line);border-radius:20px;background:var(--surface);box-shadow:var(--shadow)}.opportunity-card header{display:flex;justify-content:space-between;gap:18px}.tags{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:9px}.tag{padding:3px 8px;border-radius:999px;background:var(--accent-soft);color:var(--accent);font-size:11px;font-weight:720}.tag.gate{background:#edf0ee;color:#56615d}.opportunity-card h3{margin:0;font-size:22px;line-height:1.25}.role{margin:4px 0 0;color:var(--muted)}.human-status{align-self:start;white-space:nowrap;color:var(--muted);font-size:12px}.progress{margin:18px 0 12px;font-weight:750}.pipeline{display:flex;gap:8px;margin:0;padding:0;list-style:none;overflow-x:auto}.step{position:relative;min-width:130px;padding:12px;border:1px solid var(--line);border-radius:13px;background:#fafbf9}.step-label,.step-status,.step-meta{display:block}.step-label{font-weight:700}.step-status{margin-top:2px;color:var(--muted);font-size:12px}.step-meta{margin-top:7px;color:var(--muted);font-size:11px}.step-passed{border-color:#bad8c8;background:var(--green-soft)}.step-failed,.step-needs_debrief{border-color:#efc0c0;background:var(--red-soft)}.step-scheduled,.step-in_progress,.step-awaiting_schedule{border-color:#bfd2e4;background:var(--blue-soft)}.step-waiting_feedback{border-color:#ead39d;background:var(--amber-soft)}.step-expected,.step-optional,.step-not_entered{border-style:dashed;color:#69736f}.next-action{display:grid;grid-template-columns:74px 1fr;gap:10px;margin-top:18px;padding-top:16px;border-top:1px solid var(--line)}.next-action strong{color:var(--accent)}.issues{margin:14px 0 0;padding:12px 12px 12px 30px;border-radius:12px;background:var(--red-soft);color:var(--red);font-size:13px}.audit-ok{margin:14px 0 0;color:var(--green);font-size:12px}.document-links{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}.document-links a{padding:5px 9px;border-radius:8px;background:#f1f3f1;color:var(--accent);font-size:12px;text-decoration:none}.document-links a:hover{text-decoration:underline}.unknown-process,.empty-state{color:var(--muted)}.timeline{display:grid;gap:8px;margin:0;padding:0;list-style:none}.timeline li{display:grid;grid-template-columns:110px 1fr auto;gap:14px;padding:14px 16px;border:1px solid var(--line);border-radius:14px;background:var(--surface)}.timeline time{font-variant-numeric:tabular-nums;font-weight:750}.timeline span{color:var(--muted)}.hidden{display:none!important}.closed{margin-top:40px;border-top:1px solid var(--line);padding-top:20px}.closed summary{cursor:pointer;font-size:20px;font-weight:750}.closed .card-grid{margin-top:16px}.is-closed{box-shadow:none;opacity:.82}.footer{margin-top:48px;color:var(--muted);font-size:12px}
@media(max-width:900px){.hero{grid-template-columns:1fr}.generated{justify-self:start}.metrics{grid-template-columns:repeat(3,1fr)}.card-grid{grid-template-columns:1fr}}
@media(max-width:560px){.page{width:min(100% - 20px,1240px);padding-top:28px}.metrics{grid-template-columns:repeat(2,1fr)}.toolbar{overflow-x:auto}.timeline li{grid-template-columns:1fr}.opportunity-card{padding:17px}}
</style>
</head>
<body>
<main class="page">
  <section class="hero"><div><p class="eyebrow">Agent-first career workspace</p><h1>求职工作台</h1><p class="hero-copy">聚焦正在推进的秋招与实习机会。预计流程来自招聘方口径，实际状态由日程、单场复盘和显式结果推导。</p></div><p class="generated">生成于 ${escapeHtml(localDateTime(payload.generatedAt))}</p></section>
  <section class="metrics" aria-label="工作台摘要">
    <div class="metric"><strong>${s.campusActive}</strong><span>秋招推进中</span></div><div class="metric"><strong>${s.campusOffers}</strong><span>秋招 Offer</span></div><div class="metric"><strong>${s.internshipActive}</strong><span>实习推进中</span></div><div class="metric"><strong>${s.upcomingInterviews}</strong><span>未来 ${payload.windowDays} 天面试</span></div><div class="metric"><strong>${s.waitingFeedback}</strong><span>待反馈</span></div><div class="metric"><strong>${s.needsDebrief}</strong><span>待复盘</span></div>
  </section>
  <nav class="toolbar" aria-label="筛选"><button class="filter is-active" data-filter="all">全部推进</button><button class="filter" data-filter="campus">秋招</button><button class="filter" data-filter="internship">实习</button><button class="filter" data-filter="attention">需要处理</button></nav>
  <div id="active-sections">
    ${renderSection('Offer', payload.sections.offers, 'section-offers')}
    ${renderSection('秋招', payload.sections.campus, 'section-campus')}
    ${renderSection('实习', payload.sections.internship, 'section-internship')}
    ${payload.sections.other.length > 0 ? renderSection('其他推进中', payload.sections.other, 'section-other') : ''}
  </div>
  <section class="dashboard-section"><div class="section-heading"><div><p class="eyebrow">Next ${payload.windowDays} days</p><h2>近期时间线</h2></div><span class="section-count">${payload.timeline.length}</span></div><ol class="timeline">${payload.timeline.length > 0 ? payload.timeline.map(item => `<li><time>${escapeHtml(localDateTime(item.start))}</time><strong>${escapeHtml(item.company)}</strong><span>${escapeHtml(item.stageLabel)}</span></li>`).join('') : '<li><span>未来窗口内没有已定档面试。</span></li>'}</ol></section>
  <details class="closed"><summary>已关闭机会 ${payload.sections.closed.length} 个</summary><div class="card-grid">${closedCards || '<p class="empty-state">没有已关闭机会。</p>'}</div></details>
  <p class="footer">只读投影。修改机会、轮次、日程和结果仍通过终端 Agent 与受控 workbench 命令完成。</p>
</main>
<script>
const filters=[...document.querySelectorAll('.filter')];
filters.forEach(button=>button.addEventListener('click',()=>{filters.forEach(item=>item.classList.remove('is-active'));button.classList.add('is-active');const value=button.dataset.filter;document.querySelectorAll('#active-sections .opportunity-card').forEach(card=>{const attention=['needs_debrief','in_progress','scheduled','awaiting_schedule'].includes(card.dataset.status);const matches=value==='all'||value===card.dataset.type||(value==='attention'&&attention);card.classList.toggle('hidden',!matches);});document.querySelectorAll('#active-sections .dashboard-section').forEach(section=>{const visible=[...section.querySelectorAll('.opportunity-card')].some(card=>!card.classList.contains('hidden'));section.classList.toggle('hidden',!visible);});}));
</script>
</body>
</html>`;
}
