import fs from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  ROOT, readFrontmatter, renderRecordUpdate, serializeFrontmatter, DEBRIEF_FIELDS,
  validateDebriefFrontmatter, validateRecordFrontmatter, relativeLinkTargets, GATE_LABELS, opportunityDebriefs
} from './workbench-data.mjs';
import { parseInterviewProcess, deriveInterviewPipeline } from './interview-process.mjs';

async function bytes(path) {
  try { return await fs.readFile(path, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function safeTarget(path) {
  const local = relative(ROOT, path);
  if (local.startsWith('..') || local.split('/').includes('.git')) throw new Error('写入路径不在工作台内');
  let current = ROOT;
  for (const part of local.split('/')) {
    current = join(current, part);
    try { if ((await fs.lstat(current)).isSymbolicLink()) throw new Error('拒绝通过符号链接写入'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

// 同一批 Markdown 变更先完整验证，再写入；异常时还原全部已写入文件。
export async function commitChanges(changes) {
  for (const [path, change] of changes) {
    await safeTarget(path);
    if (await bytes(path) !== change.before) throw new Error('准备后文件已变化，拒绝覆盖');
  }
  const written = [];
  const suffix = `.aftercare-${randomUUID()}.tmp`;
  const temporary = new Set();
  try {
    for (const [path, change] of changes) {
      if (change.before === change.after) continue;
      await fs.mkdir(dirname(path), { recursive: true });
      const mode = change.before === null ? 0o600 : (await fs.stat(path)).mode & 0o777;
      const handle = await fs.open(path + suffix, 'wx', mode);
      temporary.add(path + suffix);
      try { await handle.writeFile(change.after); } finally { await handle.close(); }
      await fs.rename(path + suffix, path);
      written.push(path);
    }
  } catch (error) {
    for (const path of written.reverse()) {
      const { before } = changes.get(path);
      if (before === null) await fs.rm(path, { force: true });
      else await fs.writeFile(path, before);
    }
    throw error;
  } finally {
    for (const path of temporary) await fs.rm(path, { force: true });
  }
}

const label = value => String(value).replace(/[\r\n]/g, ' ').replace(/[\\[\]*|]/g, '\\$&');

function addLink(text, heading, target, title) {
  if (relativeLinkTargets(text).includes(target)) return text;
  const line = `- [${label(title)}](${target})`;
  const lines = text.split('\n');
  const start = lines.findIndex(value => value.trim() === heading);
  if (start < 0) return `${text.trimEnd()}\n\n${heading}\n\n${line}\n`;
  let end = start + 1;
  while (end < lines.length && !/^## /.test(lines[end])) end += 1;
  lines.splice(end, 0, line, '');
  return lines.join('\n');
}

function updateOpportunityIndex(text, slug, data, updates) {
  const target = `opportunities/${slug}/record.md`;
  if (!relativeLinkTargets(text).includes(target)) {
    return addLink(text, '## 岗位机会索引（自动补充）', target, `${data.company} · ${data.role}`);
  }
  let gateColumn = -1; let statusColumn = -1;
  return text.split('\n').map(line => {
    if (!line.trim().startsWith('|')) return line;
    const cells = line.split('|');
    const gateHeader = cells.findIndex(cell => /^(?:当前\s*)?Gate$/i.test(cell.trim()));
    const statusHeader = cells.findIndex(cell => /^(?:当前)?状态$/.test(cell.trim()));
    if (gateHeader >= 0 || statusHeader >= 0) { gateColumn = gateHeader; statusColumn = statusHeader; }
    if (!relativeLinkTargets(line).includes(target)) return line;
    if (updates.gate !== undefined && gateColumn >= 0) cells[gateColumn] = ` ${data.gate} `;
    if (updates.status !== undefined && statusColumn >= 0) cells[statusColumn] = ` ${data.status} `;
    return cells.join('|');
  }).join('\n');
}

async function indexChanges(slug, record, updates, debriefName, changes) {
  const recordPath = join(ROOT, 'interview-prep/opportunities', slug, 'record.md');
  let after = renderRecordUpdate(record.content, record.data, updates).content;
  const data = { ...record.data, ...updates };
  if (debriefName) after = addLink(after, '## 面试复盘索引', `../../debriefs/${debriefName}`, debriefName.replace(/\.md$/, ''));
  const errors = validateRecordFrontmatter(recordPath, { ...data, 'updated-at': record.data['updated-at'] });
  if (errors.length) throw new Error(errors.join('；'));
  changes.set(recordPath, { before: record.content, after });
  const readmePath = join(ROOT, 'interview-prep/README.md');
  const before = await fs.readFile(readmePath, 'utf8');
  let readme = updateOpportunityIndex(before, slug, data, updates);
  if (debriefName) readme = addLink(readme, '## 复盘索引', `debriefs/${debriefName}`, debriefName.replace(/\.md$/, ''));
  changes.set(readmePath, { before, after: readme });
  if (updates.gate !== undefined) {
    const briefPath = join(ROOT, 'interview-prep/opportunities', slug, 'quick-brief.md');
    const brief = await bytes(briefPath);
    if (brief !== null) changes.set(briefPath, { before: brief, after: brief.replace(/^(\s*>\s*当前 Gate[：:])[^\n]*$/m, `$1 ${data.gate} · ${GATE_LABELS[data.gate]}`) });
  }
}

export async function quickDebrief({ slug, stage, date, notes, company, role, force }) {
  if (force) throw new Error('快速记录不支持 --force；请在同一份复盘中补充，避免覆盖现场证据');
  if (!notes?.trim()) throw new Error('快速记录需要 --notes 或 --notes-file 提供至少一条现场记录');
  const name = `${date}-${slug}-${stage}.md`;
  const path = join(ROOT, 'interview-prep/debriefs', name);
  if (await bytes(path) !== null) throw new Error('复盘已存在，拒绝覆盖；请继续补充原文件');
  const record = await readFrontmatter(join(ROOT, 'interview-prep/opportunities', slug, 'record.md'));
  const data = { 'session-id': name.replace(/\.md$/, ''), opportunity: slug, stage, date, result: '待反馈' };
  const errors = validateDebriefFrontmatter(path, data, new Set([slug]));
  if (errors.length) throw new Error(errors.join('；'));
  const template = await fs.readFile(join(ROOT, 'interview-prep/templates/quick-debrief.md'), 'utf8');
  let content = template;
  for (const [key, value] of Object.entries({ FRONTMATTER: serializeFrontmatter(data, DEBRIEF_FIELDS).trimEnd(), COMPANY: company, ROLE: role, DATE: date, STAGE: stage, RECORD_PATH: `../opportunities/${slug}/record.md`, NOTES: notes.trim() })) content = content.replaceAll(`{{${key}}}`, () => value);
  const changes = new Map([[path, { before: null, after: content }]]);
  await indexChanges(slug, record, {}, name, changes);
  await commitChanges(changes);
  return { file: relative(ROOT, path), result: '待反馈', synchronized: ['record.md', 'interview-prep/README.md'], next: '现场证据已保存；反馈到达后用 record-outcome --sync，深度分析可在原文件补充' };
}

export async function synchronizedOutcome({ slug, updates, target, result }) {
  const record = await readFrontmatter(join(ROOT, 'interview-prep/opportunities', slug, 'record.md'));
  const changes = new Map();
  if (updates.gate === 'G3') {
    const process = parseInterviewProcess(record.data);
    if (!process.configured) throw new Error('进入 G3 前需配置面试流程并确认全部非 HR 必填轮次已通过');
    const debriefs = await opportunityDebriefs(slug);
    if (target) for (const item of debriefs) if (item.name === target.name) item.data.result = result;
    const pipeline = deriveInterviewPipeline({ ...record.data, ...updates }, [], debriefs, new Date());
    const pending = pipeline.steps.filter(step => !step.optional && step.kind !== 'hr' && step.result !== '通过');
    if (pending.length) throw new Error('不能进入 G3：仍有必填非 HR 轮次未明确通过');
  }
  if (target) {
    const before = await fs.readFile(target.path, 'utf8');
    const debrief = await readFrontmatter(target.path);
    if (debrief.data?.opportunity !== slug) throw new Error('复盘不属于当前机会');
    const data = { ...debrief.data, result };
    const errors = validateDebriefFrontmatter(target.path, data, new Set([slug]));
    if (errors.length) throw new Error(errors.join('；'));
    const body = before.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
    changes.set(target.path, { before, after: `${serializeFrontmatter(data, DEBRIEF_FIELDS)}\n${body}` });
  }
  await indexChanges(slug, record, updates, target?.name, changes);
  await commitChanges(changes);
  return { slug, result: result ?? null, updates, synchronized: [...changes.keys()].map(path => relative(ROOT, path)), gate: updates.gate ?? record.data.gate };
}
