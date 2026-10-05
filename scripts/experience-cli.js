#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 catnuko <https://github.com/catnuko>
/**
 * geoai :: experience-cli.js
 *
 * 经验库的校验与创建流水线 —— 组织模式对照 WorkBuddy expert-manager
 * （validate_expert / init_expert / 资料转化模式），落地为无依赖纯脚本：
 *
 *   lint       条目 + 导出物的硬校验。把「YAML 冒号后丢空格静默失效」
 *              「缺 id/title 被解析器静默跳过」这类只能人肉发现的坑固化成检查。
 *   new        生成 draft 条目脚手架（TODO 占位，填完实测通过后改 verified）。
 *   from-note  资料转化模式：从笔记 / WorkBuddy memory 片段启发式提取 draft
 *              条目，补不齐的字段留 TODO，人工确认后入库（产出草稿而非成品）。
 *
 * validateSkillMd 同时被 skill-export.js 作为库复用（导出后自动校验），
 * 因此本文件有 main() 执行守卫，被 import 时不会触发 CLI。
 *
 * 用法:
 *   node experience-cli.js lint
 *   node experience-cli.js new <slug> --title "标题" [--kind pitfall] [--tag t]... [--api a]... [--error e]...
 *   node experience-cli.js from-note <note.md> [--kind pitfall] [--dry-run] [--title ...] [--slug ...]
 *
 * 退出码: lint 存在 ERROR 时为 1（WARN / INFO 不阻塞）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  KINDS,
  STATUSES,
  LIBS,
  DEFAULT_LIB,
  parseEntry,
  buildEntryMd,
  uniqueId,
  normalizeTitle,
  storeDir,
  rebuildIndex,
} from './experience.js';
import { getRegistry } from './lib-registry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENTRIES_DIR = path.join(storeDir(), 'entries'); // 与 experience.js 的目录布局一致
const SKILL_OUT = path.join(__dirname, '..', 'geoai-cesium-experience', 'SKILL.md'); // skill-export 的默认输出位

// 严格行格式：真 YAML 解析器（harness 加载 SKILL.md / 未来工具链）对 `key:value`（冒号后无空格）
// 会把整行当 key 静默解析失败 —— 本仓库一律要求 `key: value`。
const FM_LINE_RE = /^[a-zA-Z0-9_-]+: .+$/;
const CREATED_RE = /^\d{4}-\d{2}-\d{2}$/;
// 检索词上限：searchExperience 按 tags/apis 逐词加分，堆砌不提升召回还稀释排序，只防极端
const CAPS = { tags: 10, apis: 15, errors: 8 };

function listEntryFiles() {
  if (!fs.existsSync(ENTRIES_DIR)) return [];
  return fs.readdirSync(ENTRIES_DIR).filter((x) => x.endsWith('.md')).sort();
}

/** 诊断用的宽松 frontmatter 读取（canonical 解析走 parseEntry；这里只为给坏文件报出具体原因） */
function fmMap(fmText) {
  const o = {};
  for (const line of fmText.split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i <= 0) continue;
    o[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
  return o;
}

/** 单条目检查。返回 [{ level, msg }]，level ∈ ERROR / WARN / INFO */
function lintEntry(base, raw, allIds) {
  const issues = [];
  const add = (level, msg) => issues.push({ level, msg });

  const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!fmMatch) {
    add('ERROR', '缺 frontmatter（--- 包裹的元数据头）');
    return issues;
  }
  const fmLines = fmMatch[1].split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const line of fmLines) {
    if (!FM_LINE_RE.test(line)) add('ERROR', `frontmatter 行不符合 "key: value"（YAML 会静默失效）: "${line}"`);
  }
  const meta = fmMap(fmMatch[1]);
  const entry = parseEntry(path.join(ENTRIES_DIR, `${base}.md`), raw);

  if (!meta.id) add('ERROR', '缺 id —— 解析器会静默跳过整条（检索永远看不到它）');
  else if (meta.id !== base) add('ERROR', `id(${meta.id}) 与文件名(${base}) 不一致`);
  if (!meta.title) add('ERROR', '缺 title —— 解析器会静默跳过整条');
  if (!meta.kind) add('WARN', '缺 kind，解析时默认 pattern');
  else if (!KINDS.has(meta.kind)) add('ERROR', `kind 非法: ${meta.kind}（允许 ${[...KINDS].join('/')}）`);
  if (!meta.status) add('WARN', '缺 status，解析时默认 draft');
  else if (!STATUSES.has(meta.status)) add('ERROR', `status 非法: ${meta.status}（允许 ${[...STATUSES].join('/')}）`);
  if (!meta.lib) add('WARN', `缺 lib（归属域），解析时默认 ${DEFAULT_LIB}（leaflet/mapbox/amap/geo/data 域经验会被误归到 cesium）`);
  else if (!LIBS.has(meta.lib)) add('ERROR', `lib 非法: ${meta.lib}（允许 ${[...LIBS].join('/')}）`);
  if (!meta.created) add('WARN', '缺 created（排序与淘汰依赖它）');
  else if (!CREATED_RE.test(meta.created)) add('ERROR', `created 非日期: ${meta.created}（应为 YYYY-MM-DD）`);

  if (entry) {
    if (!entry.trigger) add('WARN', '缺 `## 什么时候用` 节（trigger 提取不到）');
    for (const field of ['tags', 'apis', 'errors']) {
      const arr = entry[field];
      if (arr.length > CAPS[field]) add('WARN', `${field} 共 ${arr.length} 项，超上限 ${CAPS[field]}（检索词堆砌会稀释排序）`);
      const dup = arr.filter((x, i) => arr.indexOf(x) !== i);
      if (dup.length) add('WARN', `${field} 有重复项: ${[...new Set(dup)].join('、')}`);
    }
    if (entry.kind === 'pitfall' && !entry.code) add('WARN', 'pitfall 无已验证代码（修法建议配最小可执行代码）');
    if (entry.status === 'draft') add('INFO', 'draft 条目：实测通过后请改 status: verified');
    const body = entry.body ?? '';
    for (const m of body.matchAll(/\[\[([^\]]+)\]\]/g)) {
      if (!allIds.has(m[1])) add('ERROR', `相关条目断链: [[${m[1]}]]`);
    }
  }
  return issues;
}

/** 导出物结构校验（skill-export.js 写盘前后都会调；lint 对已存在文件复用） */
export function validateSkillMd(text) {
  const errors = [];
  const warns = [];
  const fmMatch = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch) {
    errors.push('SKILL.md 缺 frontmatter');
  } else {
    const lines = fmMatch[1].split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      if (!FM_LINE_RE.test(line)) errors.push(`frontmatter 行不符合 "key: value"（harness YAML 会静默失效）: "${line}"`);
    }
    const meta = fmMap(fmMatch[1]);
    if (!meta.name) errors.push('frontmatter 缺 name（skill 触发注册依赖它）');
    if (!meta.description) errors.push('frontmatter 缺 description（skill 触发注册依赖它）');
  }
  if (!text.includes('## 能力库清单')) warns.push('缺 `## 能力库清单` 节');
  if (!text.includes('## 试试这样问我')) warns.push('缺 `## 试试这样问我` 节');
  if (!/kit\.\w+/.test(text)) warns.push('正文无 kit. 引用（能力库互导提示缺失）');
  return { errors, warns };
}

function lintExports(issues) {
  if (!fs.existsSync(SKILL_OUT)) {
    issues.push({ file: path.relative(path.join(__dirname, '..'), SKILL_OUT), items: [{ level: 'INFO', msg: '未导出（npm run export-skill 可生成热集视图）' }] });
    return;
  }
  const items = [];
  const { errors, warns } = validateSkillMd(fs.readFileSync(SKILL_OUT, 'utf8'));
  for (const msg of errors) items.push({ level: 'ERROR', msg });
  for (const msg of warns) items.push({ level: 'WARN', msg });
  const newestSource = Math.max(
    ...listEntryFiles().map((f) => fs.statSync(path.join(ENTRIES_DIR, f)).mtimeMs),
    fs.existsSync(path.join(__dirname, '..', 'kits', 'registry.json'))
      ? fs.statSync(path.join(__dirname, '..', 'kits', 'registry.json')).mtimeMs
      : 0,
  );
  if (fs.statSync(SKILL_OUT).mtimeMs < newestSource) {
    items.push({ level: 'WARN', msg: '导出物早于最新事实源修改时间 —— 库更新后请重新 npm run export-skill' });
  }
  issues.push({ file: path.relative(path.join(__dirname, '..'), SKILL_OUT), items });
}

function cmdLint() {
  const files = listEntryFiles();
  if (!files.length) {
    console.error(`经验库为空: ${ENTRIES_DIR}`);
    return false;
  }

  // 两遍：先收集全部 id（含坏文件的自报 id），再逐文件校验引用断链
  const allIds = new Set();
  const raws = new Map();
  for (const f of files) {
    const base = f.replace(/\.md$/, '');
    allIds.add(base);
    const raw = fs.readFileSync(path.join(ENTRIES_DIR, f), 'utf8');
    raws.set(f, raw);
    const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    const meta = m ? fmMap(m[1]) : {};
    if (meta.id) allIds.add(meta.id);
  }

  const issues = [];
  const normTitles = new Map();
  let parseable = 0;
  for (const [f, raw] of raws) {
    const base = f.replace(/\.md$/, '');
    const items = lintEntry(base, raw, allIds);
    issues.push({ file: f, items });
    const entry = parseEntry(path.join(ENTRIES_DIR, f), raw);
    if (entry) {
      parseable += 1;
      const norm = normalizeTitle(entry.title);
      if (!normTitles.has(norm)) normTitles.set(norm, []);
      normTitles.get(norm).push(f);
    }
  }
  for (const [norm, fsList] of normTitles) {
    if (fsList.length > 1) {
      for (const f of fsList) {
        issues.find((x) => x.file === f).items.push({
          level: 'WARN',
          msg: `标题与 ${fsList.filter((x) => x !== f).join('、')} 归一化后相同 —— save_experience 会视为同一经验误并计数`,
        });
      }
    }
  }

  // registry.json kit.experience 反向断链
  const reg = getRegistry();
  for (const kit of reg.kits ?? []) {
    for (const expId of kit.experience ?? []) {
      if (!allIds.has(expId)) {
        issues.push({ file: `kits/registry.json (kit.${kit.id})`, items: [{ level: 'ERROR', msg: `experience 引用断链: ${expId}` }] });
      }
    }
  }

  // index.json 缓存计数（缺失/漂移都会在下次写入时自动重建，只提醒）
  try {
    const idx = JSON.parse(fs.readFileSync(path.join(storeDir(), 'index.json'), 'utf8'));
    if (idx.count !== parseable) {
      issues.push({
        file: 'experience/index.json',
        items: [{ level: 'WARN', msg: `缓存 count(${idx.count}) 与实际条目(${parseable}) 不符 —— 下次写入会自动重建，可忽略` }],
      });
    }
  } catch {}

  lintExports(issues);

  let errors = 0;
  let warns = 0;
  let infos = 0;
  for (const { file, items } of issues) {
    if (!items.length) continue;
    console.log(`\n${file}`);
    for (const { level, msg } of items) {
      console.log(`  ${level}: ${msg}`);
      if (level === 'ERROR') errors += 1;
      else if (level === 'WARN') warns += 1;
      else infos += 1;
    }
  }
  console.log(`\n校验完成: ${files.length} 个条目文件（${parseable} 条可解析），${errors} error / ${warns} warn / ${infos} info`);
  return errors === 0;
}

function parseFlags(argv, repeatable) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      if (repeatable.has(key)) {
        if (!flags[key]) flags[key] = [];
        const v = argv[++i];
        if (v !== undefined) flags[key].push(v);
      } else {
        // 无值的布尔开关（如 --dry-run）: 下一个参数缺失或以 -- 开头时按 true 处理
        const v = argv[i + 1];
        flags[key] = v !== undefined && !v.startsWith('--') ? argv[++i] : true;
      }
    } else {
      positional.push(a);
    }
  }
  return { flags, positional };
}

function sanitizeSlug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function lintAndReport(file, raw, allIds) {
  const items = lintEntry(path.basename(file, '.md'), raw, allIds);
  for (const { level, msg } of items) console.log(`  ${level}: ${msg}`);
  return !items.some((x) => x.level === 'ERROR');
}

function cmdNew(argv) {
  const { flags, positional } = parseFlags(argv, new Set(['tag', 'api', 'error']));
  const slug = sanitizeSlug(positional[0] ?? '');
  const title = String(flags.title ?? '').trim();
  const kind = flags.kind ?? 'pitfall';
  const lib = String(flags.lib ?? DEFAULT_LIB).trim();
  const lang = flags.lang === 'bash' ? 'bash' : 'js';
  if (!slug) return usage('用法: node experience-cli.js new <slug> --title "标题" [--kind pitfall] [--lib cesium] [--lang js|bash] [--tag t]... [--api a]... [--error e]...');
  if (!title) return usage('new 需要 --title');
  if (!KINDS.has(kind)) return usage(`kind 非法: ${kind}（允许 ${[...KINDS].join('/')}）`);
  if (!LIBS.has(lib)) return usage(`lib 非法: ${lib}（允许 ${[...LIBS].join('/')}）`);

  const date = new Date().toISOString().slice(0, 10);
  const id = `${date}-${slug}`;
  const file = path.join(ENTRIES_DIR, `${id}.md`);
  if (fs.existsSync(file)) return usage(`条目已存在: ${file}（换个 slug）`);

  const todoMark = lang === 'bash' ? '#' : '//';
  const md = buildEntryMd({
    id,
    title,
    kind,
    lib,
    lang,
    tags: flags.tag ?? [],
    apis: flags.api ?? [],
    errors: flags.error ?? [],
    status: 'draft',
    successCount: 0,
    created: date,
    source: 'manual',
    trigger: kind === 'pitfall' ? `遇到「${title}」时` : '',
    problem: kind === 'pitfall' ? 'TODO: 现象 / 完整报错首行' : undefined,
    code: kind === 'pitfall' ? `${todoMark} TODO: 已验证的最小修法代码（实测通过后粘贴）` : `${todoMark} TODO: 已验证代码`,
  });

  fs.mkdirSync(ENTRIES_DIR, { recursive: true });
  fs.writeFileSync(file, md, 'utf8');
  rebuildIndex();
  console.log(`已生成 draft: ${file}\n自检:`);
  const allIds = new Set(listEntryFiles().map((f) => f.replace(/\.md$/, '')));
  const ok = lintAndReport(file, md, allIds);
  console.log(ok ? '\n下一步: 补齐 TODO → 实测通过后把 status 改为 verified → npm run lint:exp' : '\n请先修复上面的 ERROR 再入库');
  return ok;
}

/** 截取 body 中第一个标题匹配 re 的章节内容（到下一个标题为止） */
function sectionOf(body, re) {
  const m = body.match(new RegExp(`^#{1,6}\\s*.*(?:${re}).*$`, 'mi'));
  if (!m) return '';
  const start = m.index + m[0].length;
  const next = body.slice(start).match(/^#{1,6}\s/m);
  return body.slice(start, next ? start + next.index : undefined).trim();
}

function cmdFromNote(argv) {
  const { flags, positional } = parseFlags(argv, new Set());
  const notePath = positional[0];
  if (!notePath || !fs.existsSync(notePath)) return usage('用法: node experience-cli.js from-note <note.md> [--kind pitfall] [--dry-run]');
  const kind = flags.kind ?? 'pitfall';
  if (!KINDS.has(kind)) return usage(`kind 非法: ${kind}（允许 ${[...KINDS].join('/')}）`);

  const raw = fs.readFileSync(notePath, 'utf8');
  const baseName = path.basename(notePath).replace(/\.(md|txt|markdown)$/i, '');
  const lib = String(flags.lib ?? DEFAULT_LIB).trim();
  if (!LIBS.has(lib)) return usage(`lib 非法: ${lib}（允许 ${[...LIBS].join('/')}）`);

  const title =
    String(flags.title ?? '').trim() ||
    (raw.match(/^#\s+(.+)$/m) ?? raw.match(/^##\s+(.+)$/m))?.[1]?.replace(/[#*`]/g, '').trim() ||
    baseName;
  const codeMatch =
    raw.match(/```(?:js|javascript)\r?\n([\s\S]*?)```/) ??
    raw.match(/```(?:bash|sh|shell|console)\r?\n([\s\S]*?)```/) ??
    raw.match(/```\r?\n([\s\S]*?)```/);
  const code = codeMatch ? codeMatch[1].trim() : '';
  const problem = (sectionOf(raw, '现象|报错|踩坑|问题') || '').slice(0, 500);
  const fix = (sectionOf(raw, '修法|解法|解决|修复') || '').slice(0, 500);

  const errors = new Set();
  for (const line of raw.split(/\r?\n/)) {
    if (/^#{1,6}\s/.test(line)) continue; // 标题行不是报错内容
    const t = line.replace(/^[-*]\s*/, '').trim();
    if (t.length >= 8 && t.length <= 120 && /TypeError|ReferenceError|SyntaxError|RangeError|Unexpected|Cannot read|is not a function|not defined|ERR_|报错|异常/.test(t)) {
      errors.add(t.slice(0, 80));
      if (errors.size >= 3) break;
    }
  }

  const date = new Date().toISOString().slice(0, 10);
  const slugSource = flags.slug ? sanitizeSlug(flags.slug) : sanitizeSlug(baseName) || title;
  const id = uniqueId(date, slugSource);
  const md = buildEntryMd({
    id,
    title,
    kind,
    lib,
    tags: [], // TODO: 补检索词（场景关键词 + API 名 + 报错签名）
    apis: [], // TODO: 补涉及的 API / CLI 工具名
    errors: [...errors],
    status: 'draft',
    successCount: 0,
    created: date,
    source: 'manual',
    trigger: kind === 'pitfall' ? `遇到「${title}」时` : '',
    problem: problem || (kind === 'pitfall' ? 'TODO: 现象 / 完整报错首行' : undefined),
    code: code || '// TODO: 未从笔记中提取到 js 代码块，请粘贴已验证修法',
    fix: fix || undefined,
  });

  if (flags['dry-run']) {
    console.log(`--dry-run 预览（将写入 experience/entries/${id}.md）:\n`);
    console.log(md);
    console.log('\n确认后去掉 --dry-run 正式生成，并补齐 tags / apis / TODO 字段。');
    return true;
  }

  const file = path.join(ENTRIES_DIR, `${id}.md`);
  fs.mkdirSync(ENTRIES_DIR, { recursive: true });
  fs.writeFileSync(file, md, 'utf8');
  rebuildIndex();
  console.log(`已从笔记转化 draft: ${file}\n自检:`);
  const allIds = new Set(listEntryFiles().map((f) => f.replace(/\.md$/, '')));
  const ok = lintAndReport(file, md, allIds);
  console.log('\n下一步: 核对提取结果（标题/报错/修法），补齐 tags / apis → 实测后 status 改 verified → npm run lint:exp');
  return ok;
}

function usage(msg) {
  if (msg) console.error(msg);
  console.error(
    [
      '',
      '子命令:',
      '  lint                          校验 entries/*.md 与导出物 SKILL.md',
      '  new <slug> --title "标题"     生成 draft 条目（--kind pitfall|pattern|snippet, --lib cesium|leaflet|mapbox|amap|geo|data, --lang js|bash, --tag/--api/--error 可重复）',
      '  from-note <note.md>           笔记启发式转化为 draft 条目（--dry-run 预览, --kind, --lib, --title, --slug）',
    ].join('\n'),
  );
  return false;
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  let ok;
  if (cmd === 'lint') ok = cmdLint();
  else if (cmd === 'new') ok = cmdNew(rest);
  else if (cmd === 'from-note') ok = cmdFromNote(rest);
  else ok = usage();
  if (!ok) process.exit(1);
}

// 被 skill-export.js import 时（argv[1] 指向别的文件）不触发 CLI
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
