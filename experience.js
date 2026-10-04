/**
 * geoai :: experience.js
 *
 * 经验库存储。定位: "经验注入中间件"的事实源 —— 每条经验一个 Markdown 文件
 * (frontmatter 元数据 + 正文), index.json 仅为可随时重建的缓存。
 *
 * 目录: $GEOAI_EXPERIENCE_DIR (默认 ~/.geoai/experience)
 *   entries/*.md   事实源, 人类可直接编辑, git 可版本化
 *   index.json     缓存索引, 缺失/写入时自动重建
 *
 * 设计约束:
 *   - 检索为实时扫描文件 (人工改文件后下一次 search 立即生效, 无需重启)
 *   - 写入原子化 (tmp + rename)
 *   - 首次使用自动安装 seed/entries 内置冷启动经验
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_DIR = path.join(__dirname, 'seed', 'entries');

const KINDS = new Set(['pitfall', 'snippet', 'pattern']);
const STATUSES = new Set(['draft', 'verified', 'broken']);

export function storeDir() {
  return process.env.GEOAI_EXPERIENCE_DIR || path.join(os.homedir(), '.geoai', 'experience');
}

function entriesDir() {
  return path.join(storeDir(), 'entries');
}

function indexPath() {
  return path.join(storeDir(), 'index.json');
}

function warn(...args) {
  console.error('[geoai:experience]', ...args);
}

function atomicWrite(file, data) {
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, data, 'utf8');
  fs.renameSync(tmp, file);
}

function toArray(val) {
  if (Array.isArray(val)) return val.map((x) => String(x).trim().replace(/^["']|["']$/g, '')).filter(Boolean);
  if (typeof val === 'string') {
    const s = val.trim().replace(/^\[|\]$/g, '');
    return s ? s.split(',').map((x) => x.trim().replace(/^["']|["']$/g, '')).filter(Boolean) : [];
  }
  return [];
}

/** 解析 frontmatter (无依赖严格子集: `key: value` / `key: [a, b]`) */
function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { meta: null, body: text };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if (val.startsWith('[') && val.endsWith(']')) {
      meta[key] = toArray(val);
    } else if (val !== '') {
      meta[key] = val.replace(/^["']|["']$/g, '');
    }
  }
  return { meta, body: m[2] ?? '' };
}

/** 解析并规范化一个条目文件; 结构不完整时返回 null */
function parseEntry(file, raw) {
  const { meta, body } = parseFrontmatter(raw);
  if (!meta || !meta.id || !meta.title) return null;
  const entry = {
    id: String(meta.id),
    title: String(meta.title),
    kind: KINDS.has(meta.kind) ? meta.kind : 'pattern',
    tags: toArray(meta.tags),
    apis: toArray(meta.apis),
    errors: toArray(meta.errors),
    status: STATUSES.has(meta.status) ? meta.status : 'draft',
    successCount: Number.parseInt(meta.successCount ?? '0', 10) || 0,
    created: String(meta.created || ''),
    source: String(meta.source || 'manual'),
  };
  const trig = body.match(/##\s*什么时候用\s*\n+([^\n]+)/);
  entry.trigger = trig ? trig[1].trim() : '';
  const code = body.match(/```(?:js|javascript)\r?\n([\s\S]*?)```/);
  entry.code = code ? code[1].trim() : '';
  entry.body = body;
  entry.file = file;
  entry.raw = raw;
  return entry;
}

function readAllEntries() {
  const dir = entriesDir();
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md')).sort()) {
    try {
      const e = parseEntry(path.join(dir, f), fs.readFileSync(path.join(dir, f), 'utf8'));
      if (e) out.push(e);
      else warn(`跳过不完整条目: ${f}`);
    } catch (err) {
      warn(`读取条目失败: ${f} (${err.message})`);
    }
  }
  return out;
}

export function rebuildIndex() {
  const entries = readAllEntries()
    .map(({ raw, body, file, trigger, code, ...meta }) => ({ ...meta, file: path.basename(file) }))
    .sort((a, b) => (b.created || '').localeCompare(a.created || ''));
  const index = { version: 1, updatedAt: new Date().toISOString(), count: entries.length, entries };
  fs.mkdirSync(storeDir(), { recursive: true });
  atomicWrite(indexPath(), JSON.stringify(index, null, 2));
  return entries;
}

/** 索引缓存读取 (启动/写入时重建, 资源与导出用) */
export function listIndex() {
  try {
    const parsed = JSON.parse(fs.readFileSync(indexPath(), 'utf8'));
    if (Array.isArray(parsed.entries)) return parsed.entries;
  } catch {}
  return rebuildIndex();
}

/** 初始化: 建目录 + 空库时装种子 + 索引缺失时重建 */
export function ensureStore() {
  fs.mkdirSync(entriesDir(), { recursive: true });
  const existing = fs.readdirSync(entriesDir()).filter((f) => f.endsWith('.md'));
  if (existing.length === 0 && fs.existsSync(SEED_DIR)) {
    for (const f of fs.readdirSync(SEED_DIR).filter((x) => x.endsWith('.md'))) {
      try {
        fs.copyFileSync(path.join(SEED_DIR, f), path.join(entriesDir(), f));
      } catch (err) {
        warn(`种子安装失败: ${f} (${err.message})`);
      }
    }
  }
  if (!fs.existsSync(indexPath())) rebuildIndex();
}

function uniqueId(date, title) {
  let slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  if (!slug) slug = Math.random().toString(36).slice(2, 8);
  let id = `${date}-${slug}`;
  let n = 2;
  while (fs.existsSync(path.join(entriesDir(), `${id}.md`))) {
    id = `${date}-${slug}-${n++}`;
  }
  return id;
}

function normalizeTitle(t) {
  return String(t).trim().toLowerCase().replace(/\s+/g, ' ');
}

function buildEntryMd(e) {
  const parts = [];
  const fm = {
    id: e.id,
    title: e.title,
    kind: e.kind,
    tags: e.tags ?? [],
    apis: e.apis ?? [],
    errors: e.errors ?? [],
    status: e.status,
    successCount: e.successCount ?? 0,
    created: e.created,
    source: e.source,
  };
  parts.push('---');
  for (const [k, v] of Object.entries(fm)) {
    parts.push(`${k}: ${Array.isArray(v) ? `[${v.join(', ')}]` : v}`);
  }
  parts.push('---', '');
  parts.push('## 什么时候用', e.trigger || `需要${e.title}时`, '');
  if (e.kind === 'pitfall' && e.problem) {
    parts.push('## 现象 / 报错', String(e.problem).slice(0, 500), '');
  }
  if (e.code) {
    parts.push(e.kind === 'pitfall' ? '## 修法（已验证代码）' : '## 代码（已验证）', '```js', String(e.code).slice(0, 2000), '```', '');
  }
  if (e.fix) {
    parts.push('修法说明:', String(e.fix).slice(0, 500), '');
  }
  if (e.related?.length) {
    parts.push(`相关: ${e.related.map((r) => `[[${r}]]`).join(' ')}`, '');
  }
  return parts.join('\n');
}

/**
 * 固化经验。同名条目(标题归一化后相同)视为同一经验: 不新增, successCount+1。
 * 返回 { id, deduped, file }。
 */
export function saveExperience(input, { source = 'model' } = {}) {
  ensureStore();
  if (!KINDS.has(input.kind)) {
    throw new Error(`kind 必须是 ${[...KINDS].join('/')}`);
  }
  const title = String(input.title ?? '').trim();
  if (!title) throw new Error('title 必填');

  const norm = normalizeTitle(title);
  for (const e of readAllEntries()) {
    if (normalizeTitle(e.title) === norm) {
      const newCount = (e.successCount || 0) + 1;
      const raw = e.raw.replace(/(successCount:\s*)(\d+)/, `$1${newCount}`);
      atomicWrite(e.file, raw);
      rebuildIndex();
      return { id: e.id, deduped: true, file: e.file };
    }
  }

  const date = new Date().toISOString().slice(0, 10);
  const id = uniqueId(date, title);
  const entry = {
    id,
    title,
    kind: input.kind,
    tags: input.tags ?? [],
    apis: input.apis ?? [],
    errors: input.errors ?? [],
    status: 'verified',
    successCount: 0,
    created: date,
    source,
  };
  const trigger =
    String(input.trigger ?? '').trim() ||
    (input.kind === 'pitfall' ? `遇到「${title}」${input.errors?.[0] ? `或报错含 ${input.errors[0]}` : ''}时` : `需要${title}时`);
  const md = buildEntryMd({ ...entry, trigger, problem: input.problem, code: input.code, fix: input.fix, related: input.related });
  const file = path.join(entriesDir(), `${id}.md`);
  atomicWrite(file, md);
  rebuildIndex();
  return { id, deduped: false, file };
}

/**
 * run_code 失败时自动捕获: 以报错首行ident为键写一条 draft 坑位。
 * 同一报错(首行相同)不重复捕获。返回 { id } 或 null(重复/无内容)。
 */
export function captureFailure(code, errorText) {
  const firstLine = String(errorText ?? '').split('\n')[0].trim().slice(0, 80);
  if (!firstLine) return null;
  const norm = firstLine.toLowerCase();
  for (const e of readAllEntries()) {
    if ((e.errors ?? []).some((x) => x.toLowerCase() === norm)) return null;
  }
  const date = new Date().toISOString().slice(0, 10);
  const id = uniqueId(date, `auto ${firstLine}`);
  const entry = {
    id,
    title: `自动捕获: ${firstLine}`,
    kind: 'pitfall',
    tags: [],
    apis: [],
    errors: [firstLine],
    status: 'draft',
    successCount: 0,
    created: date,
    source: 'run_code',
  };
  const md = buildEntryMd({
    ...entry,
    trigger: `遇到报错「${firstLine}」时`,
    problem: String(errorText ?? '').slice(0, 500),
    code: String(code ?? '').slice(0, 2000) || '(server 未留存本次代码, 请查看页面编辑器)',
  });
  atomicWrite(path.join(entriesDir(), `${id}.md`), md);
  rebuildIndex();
  return { id };
}

/** 单条全文 */
export function getEntryById(id) {
  const target = String(id ?? '').trim();
  return readAllEntries().find((e) => e.id === target) ?? null;
}

/**
 * 关键词检索。打分: 标题 5 / 报错签名 4 / tags 3 / apis 3 / 正文 1,
 * 同分按 successCount 降序。返回 [{ entry, score }]。
 */
export function searchExperience(query, limit = 3) {
  const tokens = String(query ?? '')
    .toLowerCase()
    .split(/[\s,，。;；:：]+/)
    .filter(Boolean);
  if (!tokens.length) return [];
  const scored = [];
  for (const e of readAllEntries()) {
    const title = e.title.toLowerCase();
    const tags = e.tags.map((x) => x.toLowerCase());
    const apis = e.apis.map((x) => x.toLowerCase());
    const errors = e.errors.map((x) => x.toLowerCase());
    const body = e.body.toLowerCase();
    let score = 0;
    for (const t of tokens) {
      if (title.includes(t)) score += 5;
      if (errors.some((x) => x.includes(t))) score += 4;
      if (tags.some((x) => x.includes(t))) score += 3;
      if (apis.some((x) => x.includes(t))) score += 3;
      if (body.includes(t)) score += 1;
    }
    if (score > 0) scored.push({ entry: e, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || (b.entry.successCount || 0) - (a.entry.successCount || 0))
    .slice(0, Math.max(1, Math.min(8, limit)));
}
