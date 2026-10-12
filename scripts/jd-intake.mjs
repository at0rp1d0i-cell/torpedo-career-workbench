// JD 自动抽取：为 new-opportunity --jd/--jd-file 提供客观事实提取与 INVENTORY 对照草稿。
// 只做可复核的字符串级抽取，不做语义判断；语义结论（岗位实质、匹配判断）留给人工/主代理。
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const LOCATION_ORDER = [
  '北京', '上海', '深圳', '杭州', '广州', '成都', '南京', '武汉',
  '西安', '苏州', '天津', '重庆', '长沙', '合肥', '远程'
];

// 中文 JD 常见交付/动作动词，用于从行文本召回职责句
const VERB_RE = /设计|实现|开发|优化|负责|支持|建设|解决|分析|提升|维护|评估|编写|参与|构建|完成|落地|调优|诊断|建模|搭建|部署|跟踪|推动|改进/;

function findLocations(text) {
  return LOCATION_ORDER.filter(loc => text.includes(loc));
}

function findSalary(text) {
  const results = [];
  const patterns = [
    /(\d+(?:\.\d+)?)\s*[-–~至]\s*(\d+(?:\.\d+)?)\s*K(?:\s*[·・]\s*(\d+)\s*薪)?/g,
    /(\d+)\s*[-–~至]\s*(\d+)\s*元\s*\/\s*天/g
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(text)) !== null) results.push(m[0].trim());
  }
  return [...new Set(results)];
}

function findKeywords(text, keywords) {
  const lower = text.toLowerCase();
  return keywords.filter(kw => lower.includes(kw.toLowerCase()));
}

function findDutyLines(text, matchedKeywords) {
  const seen = new Set();
  const lines = [];
  for (const raw of text.split('\n')) {
    const trimmed = raw.trim().replace(/^[-•*·]\s*/, '').trim();
    if (trimmed.length < 8) continue;
    const lower = trimmed.toLowerCase();
    const keywordHit = matchedKeywords.some(kw => lower.includes(kw.toLowerCase()));
    if (!VERB_RE.test(trimmed) && !keywordHit) continue;
    const key = lower;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(trimmed);
    if (lines.length >= 12) break;
  }
  return lines;
}

function splitProjectBlocks(inventoryText) {
  // 项目块只切到下一个项目标题或章节标题，避免最后一个项目吞掉后续章节；
  // ASC 三届竞赛经历与项目条目同属简历主叙事，一并识别为证据块
  const projectRe = /^### (项目 \d+|ASC 三届竞赛项目经历)[^\n]*$/gm;
  const sectionRe = /^## \d+[^\n]*$/gm;
  const boundaries = [];
  let m;
  while ((m = projectRe.exec(inventoryText)) !== null) boundaries.push({ index: m.index, type: 'project' });
  while ((m = sectionRe.exec(inventoryText)) !== null) boundaries.push({ index: m.index, type: 'section' });
  boundaries.sort((a, b) => a.index - b.index);
  const blocks = [];
  for (const p of boundaries.filter(b => b.type === 'project')) {
    const next = boundaries.find(b => b.index > p.index);
    const end = next ? next.index : inventoryText.length;
    const block = inventoryText.slice(p.index, end);
    const title = block.split('\n')[0].replace(/^###\s*/, '').trim();
    blocks.push({ title, block });
  }
  return blocks;
}

// 关键词 → INVENTORY 命中清单（项目块 / 技能区）；未命中 → 缺口
function matchInventory(matchedKeywords, inventoryText) {
  const projects = splitProjectBlocks(inventoryText);
  const skillsIndex = inventoryText.indexOf('## 5. 技能');
  const nextSection = /^## \d+[^\n]*$/gm;
  let skillsBlock = skillsIndex >= 0 ? inventoryText.slice(skillsIndex) : '';
  if (skillsIndex >= 0) {
    nextSection.lastIndex = 0;
    let m;
    while ((m = nextSection.exec(skillsBlock)) !== null) {
      if (m.index === 0) continue; // 跳过自身（## 5. 技能 标题）
      skillsBlock = skillsBlock.slice(0, m.index);
      break;
    }
  }
  const hits = new Map(); // kw -> [{where, title}]
  const gaps = [];
  for (const kw of matchedKeywords) {
    const lower = kw.toLowerCase();
    const locations = [];
    for (const p of projects) {
      if (p.block.toLowerCase().includes(lower)) locations.push({ where: '项目', title: p.title });
    }
    if (skillsBlock.toLowerCase().includes(lower)) locations.push({ where: '技能', title: '技能区' });
    if (locations.length > 0) hits.set(kw, locations);
    else gaps.push(kw);
  }
  return { hits, gaps, projects };
}

export function analyzeJd(jdText, inventoryText, keywords) {
  const normalized = jdText.replace(/\r/g, '');
  const matchedKeywords = findKeywords(normalized, keywords);
  const { hits, gaps, projects } = matchInventory(matchedKeywords, inventoryText);
  return {
    locations: findLocations(normalized),
    salary: findSalary(normalized),
    matchedKeywords,
    dutyLines: findDutyLines(normalized, matchedKeywords),
    inventoryHits: hits,
    inventoryGaps: gaps,
    projects
  };
}

export function renderJdDraft(result) {
  const lines = [];
  lines.push('## JD 自动抽取草稿（--jd 生成 · 待人工校对）');
  lines.push('');
  lines.push('> 本节由 `new-opportunity --jd-file` 自动生成，未经人工核对。确认后请把事实吸收到上方对应章节并删除本节。');
  lines.push('> JD 是理想候选人画像（"许愿池"式要求，含学历/论文/年限），不是录取线；约面即说明已进入考虑范围。下方缺口只表示"无证据可声称"，不等于"竞争力不足"，也不等于 JD 要求必须逐项满足。');
  lines.push('');
  lines.push('### 抽取事实');
  lines.push('');
  lines.push('| 字段 | 值 |');
  lines.push('|---|---|');
  lines.push(`| 地点 | ${result.locations.join(' / ') || '未识别'} |`);
  lines.push(`| 薪资 | ${result.salary.join('；') || '未识别'} |`);
  lines.push(`| 技术栈关键词命中 | ${result.matchedKeywords.join(' · ') || '未命中词表'} |`);
  lines.push('');
  lines.push('### 职责行候选（按行召回，需人工筛选）');
  lines.push('');
  if (result.dutyLines.length === 0) {
    lines.push('（未召回到明显的职责行）');
  } else {
    for (const line of result.dutyLines) lines.push(`- ${line}`);
  }
  lines.push('');
  lines.push('### INVENTORY 对照草稿');
  lines.push('');
  lines.push('| 关键词 | INVENTORY 命中 | 已有证据候选 | 缺口候选 |');
  lines.push('|---|---|---|---|');
  const allKeywords = [...new Set([...result.matchedKeywords, ...result.inventoryGaps])];
  for (const kw of allKeywords) {
    const hit = result.inventoryHits.get(kw);
    const evidence = hit ? hit.map(h => h.where === '项目' ? h.title : h.title).join('；') : '—';
    const gap = hit ? '—' : '✅ 无 INVENTORY 证据，不可声称';
    lines.push(`| ${kw} | ${hit ? '✅' : '❌'} | ${evidence} | ${gap} |`);
  }
  lines.push('');
  lines.push('### 待人工确认');
  lines.push('');
  lines.push('- [ ] 核对 JD 事实（地点 / 薪资）与招聘方沟通口径');
  lines.push('- [ ] 回填约面轮次结构、转正 HC 与转正情况（招聘方口径；未确认项标注待确认）');
  lines.push('- [ ] 把技术栈与职责吸收到「JD 与岗位画像」');
  lines.push('- [ ] 按「当前匹配与诚实边界」表核对手动判断，不把缺口关键词写成经历');
  lines.push('- [ ] 全部确认后删除本节');
  lines.push('');
  return lines.join('\n');
}

export async function loadJdIntake() {
  const [inventoryText, keywordJson] = await Promise.all([
    readFile(join(ROOT, 'INVENTORY.md'), 'utf8'),
    readFile(join(ROOT, 'scripts', 'jd-keywords.json'), 'utf8').then(JSON.parse)
  ]);
  return { inventoryText, keywords: keywordJson.keywords };
}
