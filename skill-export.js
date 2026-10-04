#!/usr/bin/env node
/**
 * geoai :: skill-export.js
 *
 * 从经验库导出"热集"为 SKILL.md —— 给支持 skills 的 harness（Claude Code / ZCode 等）用。
 *
 * 定位: 导出视图, 不是事实源。经验的事实源在 $GEOAI_EXPERIENCE_DIR（默认 <包目录>/experience，随仓库分发），
 * 模型在运行中沉淀的新经验不会自动进入已导出的 skill —— 库更新后重新执行本命令即可。
 * skill 正文只放热集（按成功次数排序取 top N）；长尾与最新经验引导模型调用 geoai MCP 的
 * search_experience 工具实时检索。
 *
 * 用法:
 *   node skill-export.js                       # 输出 ./geoai-cesium-experience/SKILL.md, top 12
 *   node skill-export.js --out <dir> --top 20
 */

import fs from 'node:fs';
import path from 'node:path';
import { ensureStore, listIndex, getEntryById, storeDir } from './experience.js';

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
  if (m.code) {
    lines.push('```js', m.code, '```');
  }
  lines.push('');
  return lines.join('\n');
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
    'description: 写 CesiumJS / geoai 场景代码前的已验证经验热集 —— 常见坑位与修法（相机 flyTo/lookAt、后台动画不推进、CDN 离线、脚本加载顺序）、可复用代码模式与用法要点。当用户要生成、调试或运行 Cesium 三维场景代码时使用。',
    `---`,
    '',
    '# geoai Cesium 经验热集',
    '',
    `> 本文件由 \`npm run export-skill\` 从经验库自动导出（${today}, 共 ${top.length} 条）。`,
    `> 经验事实源: \`${storeDir()}\`（模型运行中会持续沉淀新经验, 本文件不会自动更新 —— 库更新后请重新导出）。`,
    '> 这里只是热集: 长尾经验与最新条目请调用 geoai MCP 的 `search_experience` 工具实时检索。',
    '',
    ...(pitfalls.length ? ['## 坑位与修法（pitfall）', '', ...pitfalls] : []),
    ...(patterns.length ? ['## 用法要点与代码范例（pattern / snippet）', '', ...patterns] : []),
  ].join('\n');

  fs.mkdirSync(args.out, { recursive: true });
  const file = path.join(args.out, 'SKILL.md');
  fs.writeFileSync(file, skill, 'utf8');
  console.log(`已导出 ${top.length} 条经验热集 → ${file}`);
  console.log(`（事实源: ${storeDir()}; 库更新后重新运行 npm run export-skill 即可）`);
}

main();
