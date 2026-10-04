#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 catnuko <https://github.com/catnuko>
/**
 * geoai :: lib-registry.js
 *
 * 能力清单（库层）的 Node 侧读取与检索。事实源是 src/lib/registry.json。
 *
 * 与 experience.js 的分工：
 *   experience.js  管「坑与用法」（Markdown 条目，按意图检索）
 *   lib-registry.js 管「有哪些库、怎么调」（registry.json，按意图/api 检索）
 *   两者通过 entry.experience 字段双向关联，检索时合并返回给模型。
 *
 * 边界：本文件只读 JSON，不引入任何浏览器侧代码（src/lib/*.js 依赖 window.Cesium）。
 */

import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/**
 * registry.json 可能随包发布（files 白名单里的 src/lib/registry.json），
 * 也可能被 GEOAI_EXPERIENCE_DIR 之类的路径覆盖 —— 但库清单属于代码而非数据，
 * 所以路径固定相对本文件解析，不提供环境变量覆盖。
 */
const REGISTRY_URL = new URL('./src/lib/registry.json', import.meta.url);

let cache = null;

/** log 唯一出口，与 server.js 保持一致（stdout 属 MCP 协议通道） */
function log(...args) {
  console.error('[geoai/lib]', ...args);
}

/** 读取并缓存 registry.json。文件缺失时返回空清单（不抛错，库层可选）。 */
export function getRegistry() {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(REGISTRY_URL, 'utf8'));
  } catch (err) {
    log(`能力清单读取失败（库层将不可用）: ${err.message}`);
    cache = { version: '0.0.0', kits: [], external: [] };
  }
  return cache;
}

/** 全部 kit 条目 */
export function listKits() {
  return getRegistry().kits ?? [];
}

/** 按 id 取单个 kit；找不到返回 null */
export function getKit(id) {
  const key = String(id ?? '').trim();
  return listKits().find((k) => k.id === key) ?? null;
}

/**
 * 检索 kit。词命中权重：id/标题 5 / 意图词 3 / api 名 3 / 摘要 1。
 * 与 searchExperience 同构，便于模型一次调用拿到「该调什么 + 会踩什么坑」。
 * @param {string} query
 * @param {number} [limit]
 * @returns {Array<{kit: object, score: number}>}
 */
export function searchKits(query, limit = 3) {
  const tokens = String(query ?? '')
    .toLowerCase()
    .split(/[\s,，。;；:：]+/)
    .filter(Boolean);
  if (!tokens.length) return [];
  const scored = [];
  for (const kit of listKits()) {
    const id = kit.id.toLowerCase();
    const title = String(kit.title ?? '').toLowerCase();
    const summary = String(kit.summary ?? '').toLowerCase();
    const intents = (kit.intents ?? []).map((x) => String(x).toLowerCase());
    const apis = (kit.apis ?? []).map((x) => String(x).toLowerCase());
    let score = 0;
    for (const t of tokens) {
      if (id.includes(t) || title.includes(t)) score += 5;
      if (intents.some((x) => x.includes(t))) score += 3;
      if (apis.some((x) => x.includes(t))) score += 3;
      if (summary.includes(t)) score += 1;
    }
    if (score > 0) scored.push({ kit, score });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** 外部包登记（npm / script 引入），只读不深链 */
export function listExternal() {
  return getRegistry().external ?? [];
}

/**
 * 反向索引：经验条目 id -> 引用它的 kit 列表。
 * registry.json 里是 kit.experience（库指向经验），
 * 这里反着建一份，供 search_experience 命中后提示「该条已封装为哪个 kit」。
 * @returns {Map<string, Array<{id: string, title: string, status: string}>>}
 */
let expIndexCache = null;
export function kitsByExperience() {
  if (expIndexCache) return expIndexCache;
  const map = new Map();
  for (const kit of listKits()) {
    for (const expId of kit.experience ?? []) {
      if (!map.has(expId)) map.set(expId, []);
      map.get(expId).push({ id: kit.id, title: kit.title, status: kit.status });
    }
  }
  expIndexCache = map;
  return map;
}

/**
 * 查某个经验条目被哪些 kit 引用。
 * @param {string} experienceId
 * @returns {Array<{id:string,title:string,status:string}>} 空数组表示未被库封装
 */
export function kitsForExperience(experienceId) {
  return kitsByExperience().get(String(experienceId ?? '').trim()) ?? [];
}

/**
 * 列一个 kit 关联的经验条目（读经验库元数据，拼标题供模型直接判断相关性）。
 * 依赖 experience.js 的 listIndex()，故用惰性注入避免模块循环依赖。
 * @param {string} kitId
 * @param {() => Array} listIndex 经验库索引函数
 * @returns {Array<{id:string,title:string,status:string}>}
 */
export function experiencesForKit(kitId, listIndex) {
  const kit = getKit(kitId);
  if (!kit) return [];
  const ids = new Set(kit.experience ?? []);
  if (!ids.size || typeof listIndex !== 'function') return [];
  return listIndex()
    .filter((e) => ids.has(e.id))
    .map((e) => ({ id: e.id, title: e.title, status: e.status }));
}
