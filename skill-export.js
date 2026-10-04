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
 *   - 能力清单的事实源是 src/lib/registry.json，随代码分发，改动后同样需要重新导出。
 * skill 正文只放热集（按成功次数排序取 top N）；长尾与最新经验引导模型调用 geoai MCP 的
 * search_experience 工具实时检索。
 *
 * 用法:
 *   node skill-export.js                       # 输出 ./geoai-cesium-experience/SKILL.md, top 12
 *   node skill-export.js --out<dir> --top 20
 */

import fs from 'node:fs';
import path from 'node:path';
import { ensureStore, listIndex, getEntryById, storeDir } from './experience.js';
import { listKits, experiencesForKit, kitsForExperience } from './lib-registry.js';

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
    '> 执行上下文变量：`viewer`、`Cesium`、`kit`。库代码事实源为 `src/lib/registry.json`。',
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

  const pitfalls = [];
  const patterns = [];
  for (const meta of top) {
    const entry = getEntryById(meta.id);
    if (!entry) continue;
    (entry.kind === 'pitfall' ? pitfalls : patterns).push(fmtEntry(entry));
  }

  const today = new Date().toISOString().slice(0, 10);
  const skill = [
    '---',
    'name: geoai-cesium-experience',
    'description: 写 CesiumJS / geoai 场景代码前的能力库与已验证经验 —— 可直接调用的 kit 能力（相机飞行/取景、影像底图、3D 地形）、常见坑位与修法（flyTo 不返回 Promise、lookAt 相机锁定、后台动画不推进、脚本加载顺序）、可复用代码模式。当用户要生成、调试或运行 Cesium 三维场景代码时使用。',
    `---`,
    '',
    '# geoai Cesium 能力库 + 经验热集',
    '',
    `> 本文件由 \`npm run export-skill\` 自动导出（${today}, 共 ${top.length} 条经验 + ${listKits().filter((k) => k.status === 'ready').length} 个能力库）。`,
    `> 经验事实源: \`${storeDir()}\`（模型运行中会持续沉淀新经验, 本文件不会自动更新 —— 库更新后请重新导出）。`,
    `> 能力清单事实源: \`src/lib/registry.json\`。`,
    '> 这里只是热集: 长尾经验请调用 geoai MCP 的 `search_experience` / `list_libs` 实时检索。',
    '',
    // 能力库放在经验之前 —— 模型读 skill 时先知道「有什么现成能力」，再学坑位
    ...fmtKits(index),
    ...(pitfalls.length ? ['## 坑位与修法（pitfall）', '', ...pitfalls] : []),
    ...(patterns.length ? ['## 用法要点与代码范例（pattern / snippet）', '', ...patterns] : []),
  ].join('\n');

  fs.mkdirSync(args.out, { recursive: true });
  const file = path.join(args.out, 'SKILL.md');
  fs.writeFileSync(file, skill, 'utf8');
  console.log(`已导出 ${top.length} 条经验热集 + ${listKits().filter((k) => k.status === 'ready').length} 个能力库 → ${file}`);
  console.log(`（事实源: ${storeDir()} / src/lib/registry.json; 库更新后重新运行 npm run export-skill 即可）`);
}

main();
