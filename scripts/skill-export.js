#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 catnuko <https://github.com/catnuko>
/**
 * geoai :: skill-export.js
 *
 * 从经验库 + 能力清单导出"热集"为 SKILL.md —— 给支持 skills 的 harness（Claude Code / ZCode 等）用。
 *
 * 定位: 导出视图, 不是事实源。
 *   - 经验的事实源在 $GEOAI_EXPERIENCE_DIR（默认 <包目录>/experience，随仓库分发），
 *     模型在运行中沉淀的新经验不会自动进入已导出的 skill —— 库更新后重新执行本命令即可。
 *   - 能力清单的事实源是 kits/registry.json，随代码分发，改动后同样需要重新导出。
 * skill 正文只放热集（按成功次数排序取 top N）；长尾与最新经验引导模型调用 geoai MCP 的
 * search_experience 工具实时检索。
 *
 * 用法:
 *   node scripts/skill-export.js                       # 输出 ./geoai-cesium-experience/SKILL.md, top 12
 *   node scripts/skill-export.js --out<dir> --top 20
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ensureStore, listIndex, getEntryById, storeDir } from './experience.js';
import { listKits, experiencesForKit, kitsForExperience } from './lib-registry.js';
import { validateSkillMd } from './experience-cli.js';

function parseArgs(argv) {
  const args = { out: path.resolve('geoai-cesium-experience'), top: 12 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') args.out = path.resolve(argv[++i]);
    if (argv[i] === '--top') args.top = Math.max(1, Number.parseInt(argv[++i], 10) || 12);
  }
  return args;
}

function fmtEntry(entry) {
  const m = entry;
  const lines = [];
  lines.push(`### ${m.title}`);
  lines.push(`- 什么时候用: ${m.trigger || '(见代码)'}`);
  lines.push(`- id: ${m.id}（geoai MCP get_experience 可查全文; 成功 ${m.successCount} 次）`);
  // A 方案·互导：经验条目在导出物里也标出对应的库，避免 harness 只抄代码不用库
  const kits = kitsForExperience(m.id).filter((k) => k.status === 'ready');
  if (kits.length) {
    lines.push(`- ⚡ 已封装为库: \`kit.${kits.map((k) => k.id).join('` / `kit.')}\`（优先用库）`);
  }
  if (m.code) {
    lines.push('```js', m.code, '```');
  }
  lines.push('');
  return lines.join('\n');
}

/** 渲染「能力清单」一节：让不装 MCP 的 harness 也知道有哪些现成能力 */
function fmtKits(index) {
  const ready = listKits().filter((k) => k.status === 'ready');
  if (!ready.length) return [];
  const lines = [
    '## 能力库清单（优先使用，不要重写）',
    '',
    '> 这些能力已内置常见坑位的修法（相机锁定 / flyTo 不返回 Promise / 后台动画不推进等）。',
    '> 执行上下文变量：`viewer`、`Cesium`、`kit`。库代码事实源为 `kits/registry.json`。',
    '',
  ];
  for (const k of ready) {
    lines.push(`### kit.${k.id} · ${k.title}`);
    lines.push(`- 能做什么: ${k.summary}`);
    lines.push(`- 调用: \`${k.signature}\``);
    const exps = experiencesForKit(k.id, index).map((e) => e.title);
    if (exps.length) lines.push(`- 适用场景: ${exps.join('；')}`);
    if (k.snippet) lines.push('', '```js', k.snippet, '```');
    lines.push('');
  }
  return lines;
}

/** 组装 SKILL.md 全文（本 CLI 与 expert-export.js 共用; top 为已排序的热集元数据） */
export function renderSkill(top) {
  const pitfalls = [];
  const patterns = [];
  for (const meta of top) {
    const entry = getEntryById(meta.id);
    if (!entry) continue;
    (entry.kind === 'pitfall' ? pitfalls : patterns).push(fmtEntry(entry));
  }
  // fmtKits 需要完整经验清单做 kit↔经验互导标题（listIndex 有缓存, 重复读取代价可忽略）
  const index = listIndex().filter((e) => e.status !== 'broken');

  const today = new Date().toISOString().slice(0, 10);
  return [
    '---',
    'name: geoai-cesium-experience',
    'description: 写 CesiumJS / geoai 场景代码前的能力库与已验证经验 —— 可直接调用的 kit 能力（相机飞行/取景、影像底图、3D 地形）、常见坑位与修法（flyTo 不返回 Promise、lookAt 相机锁定、后台动画不推进、脚本加载顺序）、可复用代码模式。当用户要生成、调试或运行 Cesium 三维场景代码时使用。',
    `---`,
    '',
    '# geoai Cesium 能力库 + 经验热集',
    '',
    `> 本文件由 \`npm run export-skill\` 自动导出（${today}, 共 ${top.length} 条经验 + ${listKits().filter((k) => k.status === 'ready').length} 个能力库）。`,
    `> 经验事实源: \`${storeDir()}\`（模型运行中会持续沉淀新经验, 本文件不会自动更新 —— 库更新后请重新导出）。`,
    `> 能力清单事实源: \`kits/registry.json\`。`,
    '> 这里只是热集: 长尾经验请调用 geoai MCP 的 `search_experience` / `list_libs` 实时检索。',
    '',
    // 固定章节（对照 WorkBuddy 专家包 agents/*.md 的 Mission / Critical Rules / Workflow 组织方式）
    '## 使命（先读）',
    '',
    '在 Cesium 页面里生成 / 调试 / 运行三维场景代码。kit 是首选路径, 坑位是已验证的教训。',
    '',
    '## 红线',
    '',
    '- `kit.*` 已封装的能力禁止裸写等价 Cesium API（相机 / 影像 / 绘制 / 量算 / 弹窗 / 贴地拾取的坑位已内置修法）',
    '- Cesium 只从执行上下文入参拿（`viewer` / `Cesium` / `kit` 三变量）, 不要自建 Viewer 或重复引 CDN',
    '- 写码前先查: `list_libs` 看能力、`search_experience` 检索坑位（场景词 / API 名 / 报错关键词）, 查不到再裸写',
    '- `run_code` 失败会自动沉淀 draft 坑位; 成功且有复用价值才 `save_experience`（verified 才进热集）, 不要重复保存同一标题',
    '',
    '## 工作流',
    '',
    '1. `list_libs` → 有现成 kit 优先（`get_lib_doc` 看文档, `send_snippet` 直取示例）',
    '2. `search_experience` → 检索同类坑位与已验证代码',
    '3. `send_code` 下发 + `run_code` 执行 → 按报错修正重试',
    '4. 成功且有复用价值 → `save_experience` 固化（需连接 geoai MCP）',
    '',
    // 能力库放在经验之前 —— 模型读 skill 时先知道「有什么现成能力」，再学坑位
    ...fmtKits(index),
    ...(pitfalls.length ? ['## 坑位与修法（pitfall）', '', ...pitfalls] : []),
    ...(patterns.length ? ['## 用法要点与代码范例（pattern / snippet）', '', ...patterns] : []),
    // 固定 3 条高频意图入口（对照 WorkBuddy quickPrompts：数量固定, 覆盖面优先）
    '## 试试这样问我',
    '',
    '- 「加载 ArcGIS 免 key 影像 + 3D 地形, 飞到上海」（kit.imagery + kit.camera）',
    '- 「画一个多边形, 量算贴地面积」（kit.drawer + kit.measure）',
    '- 「在点击处加弹窗, 并锁定相机跟随某点」（kit.overlay + kit.camera）',
  ].join('\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  ensureStore();
  const index = listIndex().filter((e) => e.status !== 'broken');
  if (!index.length) {
    console.error('经验库为空, 无可导出内容:', storeDir());
    process.exit(1);
  }
  const top = [...index]
    .sort((a, b) => (b.successCount || 0) - (a.successCount || 0) || (b.created || '').localeCompare(a.created || ''))
    .slice(0, args.top);
  const skill = renderSkill(top);

  // 写盘前自动结构校验 —— 上次「frontmatter 冒号后丢空格静默失效」靠人肉发现, 现在固化为检查
  const { errors, warns } = validateSkillMd(skill);
  if (errors.length) {
    console.error('导出物自检未通过, 未写盘:');
    for (const e of errors) console.error('  ERROR:', e);
    process.exit(1);
  }

  fs.mkdirSync(args.out, { recursive: true });
  const file = path.join(args.out, 'SKILL.md');
  fs.writeFileSync(file, skill, 'utf8');
  console.log(`已导出 ${top.length} 条经验热集 + ${listKits().filter((k) => k.status === 'ready').length} 个能力库 → ${file}`);
  for (const w of warns) console.log(`  WARN: ${w}`);
  console.log(`（事实源: ${storeDir()} / kits/registry.json; 库更新后重新运行 npm run export-skill 即可）`);
}

// 被 expert-export.js import 时（argv[1] 指向别的文件）不触发 CLI
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
