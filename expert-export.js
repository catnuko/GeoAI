#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 catnuko <https://github.com/catnuko>
/**
 * geoai :: expert-export.js
 *
 * 把经验库 + 能力库导出为 WorkBuddy 专家包（.codebuddy-plugin 插件格式）。
 * 规格依据: WorkBuddy expert-manager references（plugin-json-spec / agent-md-spec / avatar-spec）:
 *   tags 固定 3 个 / quickPrompts 固定 3 个且 defaultInitPrompt 与第一条一致 /
 *   displayDescription 中文 40-50 字 / agents md frontmatter 禁止 tools 字段。
 * 定位: 导出视图, 不是事实源（同 skill-export.js）——
 *   人格正文是紧凑的「核心能力/工作流程/输出规范/注意事项」, 全量经验热集以内置
 *   skill（skills/geoai-cesium-experience, 经 agents frontmatter 的 skills 字段预加载）随包分发。
 *
 * 用法:
 *   node expert-export.js                          # 输出 ./geoai-cesium-expert/
 *   node expert-export.js --out <dir> [--force]
 *   node expert-export.js --install [--force]      # 生成并直装 ~/.workbuddy my-experts（WorkBuddy 自动检测）
 *   node expert-export.js --check <dir>            # 只校验已有专家包
 *   node expert-export.js --zh-name 极图 --en-name Geoai   # 自定义花名
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { ensureStore, listIndex, storeDir } from './experience.js';
import { listKits } from './lib-registry.js';
import { renderSkill } from './skill-export.js';
import { validateSkillMd } from './experience-cli.js';

const PKG_NAME = 'geoai-cesium-expert';
const AGENT_NAME = 'geoai-cesium-expert';
const SKILL_DIR = 'geoai-cesium-experience';
const TOP_N = 12; // 与 skill-export 默认热集大小一致
const AVATAR_COLOR = [30, 107, 184]; // 占位头像底色 (GIS 蓝), 上架前替换正式头像

// ── 占位头像: 无依赖生成 512×512 纯色 PNG ────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function solidPng(size, [r, g, b]) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: RGB
  const row = Buffer.alloc(1 + size * 3);
  for (let x = 0; x < size; x++) {
    row[1 + x * 3] = r;
    row[2 + x * 3] = g;
    row[3 + x * 3] = b;
  }
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── 包内容 ──────────────────────────────────────────────────────────────────

const QUICK_PROMPTS = [
  { zh: '帮我加载 ArcGIS 免 key 影像底图和 3D 地形，然后飞到上海。', en: 'Load the ArcGIS keyless imagery basemap and 3D terrain, then fly to Shanghai.' },
  { zh: '画一个多边形并量算贴地面积。', en: 'Draw a polygon and measure its ground-clamped area.' },
  { zh: '在点击位置加弹窗标注，并让相机锁定跟随该点。', en: 'Add a popup at the clicked position and lock the camera to follow it.' },
];

function repoVersion() {
  try {
    return JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;
  } catch {
    return '0.0.0';
  }
}

function buildPluginJson({ entryCount, version, zhName, enName }) {
  return {
    name: PKG_NAME,
    version,
    description: `GIS CesiumJS 3D map development expert backed by ${entryCount} verified pitfall fixes from real page runs`,
    author: { name: 'catnuko' },
    license: 'AGPL-3.0-only',
    agents: [`./agents/${AGENT_NAME}.md`],
    skills: [`./skills/${SKILL_DIR}`],
    expertType: 'agent',
    agentName: AGENT_NAME,
    displayName: { en: enName, zh: zhName },
    profession: { en: 'GIS Cesium Development Expert', zh: 'GIS Cesium 开发专家' },
    displayDescription: {
      en: `CesiumJS 3D map expert: camera control, imagery basemaps, terrain, drawing, measuring and popups, backed by ${entryCount} verified pitfall fixes.`,
      // 硬规则: 中文 40-50 字（validate_expert 校验）, 条目数变化时长度仍落在区间
      zh: `精通CesiumJS三维开发：相机控制、影像底图、地形、绘制量算与弹窗标注，内置${entryCount}条已验证经验。`,
    },
    avatar: 'avatars/expert.png',
    categoryId: '02-Engineering',
    defaultInitPrompt: QUICK_PROMPTS[0],
    plugin: PKG_NAME,
    tags: [
      { zh: 'Cesium', en: 'Cesium' },
      { zh: '三维地图', en: '3D Map' },
      { zh: 'GIS', en: 'GIS' },
    ],
    quickPrompts: QUICK_PROMPTS,
  };
}

/** 人格提示词（agents md）。正文按 agent-md-spec 固定结构; 知识细节留给预加载的内置 skill */
function buildAgentMd({ zhName, enName, entryCount }) {
  return `---
name: ${AGENT_NAME}
description: GIS CesiumJS 3D map development expert with a verified experience library; activates for Cesium scene coding, camera / imagery / terrain tasks, drawing, measuring and map debugging.
displayName:
  en: "${enName}"
  zh: "${zhName}"
profession:
  en: "GIS Cesium Development Expert"
  zh: "GIS Cesium 开发专家"
maxTurns: 50
skills: [${SKILL_DIR}]
---

# GIS Cesium 三维地图 - ${zhName}

你是资深 GIS 三维地图开发专家, 擅长 CesiumJS 场景开发: 相机控制、影像底图与 3D 地形接入、矢量绘制、量算、弹窗标注, 以及踩坑排查。你的知识来自 geoai 经验库（${entryCount} 条, 全部经真实 Cesium 页面执行验证）, 预加载的经验热集 skill 里有可直接复用的已验证代码。

## 核心能力
1. **相机控制**：flyTo / flyToRegion / lookAt 跟随与解锁, 自动处理相机锁定与动画结束等待
2. **底图与地形**：ArcGIS 免 key 影像 + 3D 地形、天地图（需 key）, 一行调用完成取景
3. **绘制与量算**：点线面圆矩形绘制、贴地 / 平面双模式的距离与面积量算
4. **弹窗标注**：跟随式弹窗、屏幕定位、tooltip、闪烁标记
5. **经验沉淀**：踩坑自动捕获, 跑通后固化, 关键词检索覆盖长尾经验

## 工作流程
1. 查能力：已连接 geoai MCP 时先 list_libs 看现成 kit（kit 内置坑位修法, 优先于裸写 Cesium API）
2. 查经验：search_experience 用场景词 / API 名 / 报错关键词检索; 未连接 MCP 时直接用预加载热集里的代码
3. 执行：代码在 viewer / Cesium / kit 三变量上下文执行, 按报错修正重试
4. 固化：成功且有复用价值 → save_experience（verified 才进经验热集）

## 输出规范
- 执行上下文只有 \`viewer\` / \`Cesium\` / \`kit\` 三个变量, 不要自建 Viewer 或重复引 CDN
- 给可整段执行的代码（支持顶层 await）, 不给片段式伪代码
- kit 已覆盖的能力一律用 kit.* 调用, 调用形态见各 kit 签名（热集清单内有）

## 注意事项
- 经验热集只是视图: 长尾经验检索不到就明说, 不要编造 API
- run_code 失败会自动沉淀 draft 坑位, 同一标题的经验不要重复保存
- 底图注意合规: 境外瓦片源（如 OSM 官方瓦片）不要直连, 优先境内源或免 key 镜像
`;
}

function buildPkgReadme({ date, entryCount, kitCount }) {
  return `# ${PKG_NAME} — WorkBuddy 专家包

由 [geoai-mcp](https://github.com/catnuko/GeoAI) \`node expert-export.js\` 自动导出于 ${date}。

- 内容: \`.codebuddy-plugin/plugin.json\`（专家元数据）+ \`agents/\`（人格提示词）+ \`skills/${SKILL_DIR}/\`（经验热集, ${entryCount} 条经验 + ${kitCount} 个能力库中的热集）+ \`avatars/\`（占位头像）
- 事实源: geoai-mcp 仓库的 \`experience/entries/*.md\` 与 \`src/lib/registry.json\`；本包只是导出视图, 库更新后重新导出
- 安装: 复制本目录到 \`~/.workbuddy/plugins/marketplaces/my-experts/plugins/\`（或导出时加 \`--install\`）
- 上架开放平台前: 替换 \`avatars/expert.png\` 占位头像（512×512 插画风）, 按需修改 displayName 花名与 displayDescription
`;
}

function writePkg(outDir, { version, zhName, enName }) {
  ensureStore();
  const index = listIndex().filter((e) => e.status !== 'broken');
  if (!index.length) {
    console.error('经验库为空, 无可导出内容:', storeDir());
    process.exit(1);
  }
  const top = [...index]
    .sort((a, b) => (b.successCount || 0) - (a.successCount || 0) || (b.created || '').localeCompare(a.created || ''))
    .slice(0, TOP_N);
  const entryCount = index.length;
  const kitCount = listKits().filter((k) => k.status === 'ready').length;

  const skillMd = renderSkill(top);
  const pluginJson = buildPluginJson({ entryCount, version, zhName, enName });

  fs.rmSync(outDir, { recursive: true, force: true });
  for (const d of ['.codebuddy-plugin', 'agents', `skills/${SKILL_DIR}`, 'avatars']) {
    fs.mkdirSync(path.join(outDir, d), { recursive: true });
  }
  fs.writeFileSync(path.join(outDir, '.codebuddy-plugin', 'plugin.json'), JSON.stringify(pluginJson, null, 2) + '\n', 'utf8');
  fs.writeFileSync(path.join(outDir, 'agents', `${AGENT_NAME}.md`), buildAgentMd({ zhName, enName, entryCount }), 'utf8');
  fs.writeFileSync(path.join(outDir, 'skills', SKILL_DIR, 'SKILL.md'), skillMd, 'utf8');
  fs.writeFileSync(path.join(outDir, 'avatars', 'expert.png'), solidPng(512, AVATAR_COLOR));
  fs.writeFileSync(path.join(outDir, 'README.md'), buildPkgReadme({ date: new Date().toISOString().slice(0, 10), entryCount, kitCount }), 'utf8');
  return { top, entryCount, kitCount };
}

// ── 包自校验（对齐 validate_expert.py 的硬规则）─────────────────────────────

export function validateExpertPkg(dir) {
  const errors = [];
  const warns = [];

  const pjPath = path.join(dir, '.codebuddy-plugin', 'plugin.json');
  let pj;
  try {
    pj = JSON.parse(fs.readFileSync(pjPath, 'utf8'));
  } catch (err) {
    return { errors: [`plugin.json 不可解析: ${err.message}`], warns };
  }
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(pj.name ?? '')) errors.push(`name 非法: ${pj.name}（小写字母/数字/连字符, 首尾非连字符）`);
  if (!/^\d+\.\d+\.\d+$/.test(pj.version ?? '')) errors.push(`version 非语义化: ${pj.version}`);
  if (!pj.description) errors.push('缺 description');
  if (!Array.isArray(pj.agents) || !pj.agents.length) errors.push('缺 agents 声明');
  if (pj.expertType !== 'agent' && pj.expertType !== 'team') errors.push(`expertType 非法: ${pj.expertType}`);
  if (!pj.agentName) errors.push('缺 agentName');
  if (!pj.displayName?.en || !pj.displayName?.zh) errors.push('displayName 缺 en/zh');
  if (!pj.profession?.en || !pj.profession?.zh) errors.push('profession 缺 en/zh');
  if (!pj.displayDescription?.en || !pj.displayDescription?.zh) errors.push('displayDescription 缺 en/zh');
  else {
    const n = pj.displayDescription.zh.length;
    if (n < 40 || n > 50) warns.push(`displayDescription.zh 共 ${n} 字（建议 40-50）`);
  }
  if (!Array.isArray(pj.tags) || pj.tags.length !== 3) errors.push(`tags 必须恰好 3 个, 现 ${pj.tags?.length ?? 0}`);
  if (!Array.isArray(pj.quickPrompts) || pj.quickPrompts.length !== 3) errors.push(`quickPrompts 必须恰好 3 个, 现 ${pj.quickPrompts?.length ?? 0}`);
  if (pj.defaultInitPrompt?.zh !== pj.quickPrompts?.[0]?.zh) errors.push('defaultInitPrompt 必须与 quickPrompts 第一条一致');
  if (pj.plugin && pj.plugin !== pj.name) errors.push('plugin 必须与 name 一致');
  if (!pj.categoryId) errors.push('缺 categoryId');

  if (pj.agentName) {
    const mdPath = path.join(dir, 'agents', `${pj.agentName}.md`);
    if (!fs.existsSync(mdPath)) {
      errors.push(`缺人格文件 agents/${pj.agentName}.md`);
    } else {
      const fm = fs.readFileSync(mdPath, 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (!fm) errors.push('agents md 缺 frontmatter');
      else {
        if (/^tools:/m.test(fm[1])) errors.push('agents md frontmatter 禁止 tools 字段（权限由系统统一分配）');
        for (const k of ['name', 'description', 'displayName', 'profession', 'maxTurns']) {
          if (!new RegExp(`^${k}:`, 'm').test(fm[1])) errors.push(`agents md frontmatter 缺 ${k}`);
        }
        if (!new RegExp(`^name:\\s*${pj.agentName}\\s*$`, 'm').test(fm[1])) errors.push('agents md name 与 agentName 不一致');
      }
    }
  }

  for (const s of pj.skills ?? []) {
    const skillMd = path.join(dir, s.replace(/^\.\//, ''), 'SKILL.md');
    if (!fs.existsSync(skillMd)) {
      errors.push(`缺内置 skill: ${s}/SKILL.md`);
    } else {
      const { errors: es, warns: ws } = validateSkillMd(fs.readFileSync(skillMd, 'utf8'));
      for (const e of es) errors.push(`skill ${s}: ${e}`);
      for (const w of ws) warns.push(`skill ${s}: ${w}`);
    }
  }

  const avPath = path.join(dir, pj.avatar ?? 'avatars/expert.png');
  if (!fs.existsSync(avPath)) {
    errors.push(`缺头像 ${pj.avatar ?? 'avatars/expert.png'}`);
  } else {
    const buf = fs.readFileSync(avPath);
    if (buf.length > 500 * 1024) warns.push('头像超 500KB');
    if (buf.length > 24 && buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') {
      const w = buf.readUInt32BE(16);
      const h = buf.readUInt32BE(20);
      if (w !== 512 || h !== 512) warns.push(`头像 ${w}x${h}（建议 512×512）`);
    } else {
      warns.push('头像非 PNG');
    }
  }

  return { errors, warns };
}

function reportValidate({ errors, warns }) {
  for (const e of errors) console.error('  ERROR:', e);
  for (const w of warns) console.error('  WARN:', w);
  console.log(errors.length ? `校验未通过: ${errors.length} error / ${warns.length} warn` : `校验通过（${warns.length} warn）`);
  return errors.length === 0;
}

const MY_EXPERTS_ROOT = () => path.join(os.homedir(), '.workbuddy', 'plugins', 'marketplaces', 'my-experts', 'plugins');

function installPkg(outDir, { force }) {
  const dest = path.join(MY_EXPERTS_ROOT(), PKG_NAME);
  if (fs.existsSync(dest) && !force) {
    console.error(`已存在: ${dest}\n覆盖请加 --force（或手动删除后重试）`);
    return false;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(outDir, dest, { recursive: true });
  console.log(`已安装专家包 → ${dest}`);
  console.log('WorkBuddy 重启后应能在专家列表看到（以客户端检测逻辑为准）; 移除: 删除该目录即可');
  return true;
}

function parseArgs(argv) {
  const args = { out: path.resolve(PKG_NAME) };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') args.out = path.resolve(argv[++i]);
    else if (a === '--check') args.check = path.resolve(argv[++i]);
    else if (a === '--install') args.install = true;
    else if (a === '--force') args.force = true;
    else if (a === '--zh-name') args.zhName = argv[++i];
    else if (a === '--en-name') args.enName = argv[++i];
    else if (a === '--version') args.version = argv[++i];
  }
  return args;
}

function usage(msg) {
  if (msg) console.error(msg);
  console.error(
    [
      '',
      '用法:',
      '  node expert-export.js [--out <dir>] [--force] [--install] [--zh-name 极图] [--en-name Geoai] [--version 1.0.0]',
      '  node expert-export.js --check <dir>   # 只校验已有专家包',
    ].join('\n'),
  );
  return false;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.check) {
    if (!fs.existsSync(args.check)) return usage(`目录不存在: ${args.check}`);
    console.log(`校验专家包: ${args.check}`);
    return reportValidate(validateExpertPkg(args.check));
  }

  if (fs.existsSync(args.out) && fs.readdirSync(args.out).length && !args.force) {
    return usage(`输出目录非空: ${args.out}（--force 覆盖）`);
  }
  const version = args.version ?? repoVersion();
  const zhName = args.zhName ?? '极图';
  const enName = args.enName ?? 'Geoai';
  const { entryCount, kitCount } = writePkg(args.out, { version, zhName, enName });
  console.log(`已生成专家包（${entryCount} 条经验 + ${kitCount} 个能力库 → 内置 skill 热集）→ ${args.out}`);

  console.log('包自检:');
  const ok = reportValidate(validateExpertPkg(args.out));
  if (!ok) {
    console.error('包校验未通过, 请修复或删除输出目录后重试（未安装）');
    process.exit(1);
  }
  if (args.install && !installPkg(args.out, { force: args.force })) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
