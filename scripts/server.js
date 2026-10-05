#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 catnuko <https://github.com/catnuko>
/**
 * geoai :: server.js
 *
 * 单进程同时承载:
 *   1. MCP Server (stdio)      -> 与 MCP 客户端 (Claude Desktop / Cursor / WorkBuddy) 通信
 *   2. HTTP 静态服务           -> 127.0.0.1:$GEOAI_HTTP_PORT(默认 3000), 托管 Vite 构建产物 dist/
 *   3. WebSocket Server        -> 127.0.0.1:$GEOAI_WS_PORT(默认 3001), 页面主动连入
 *
 * 环境变量:
 *   GEOAI_HTTP_PORT / GEOAI_WS_PORT   端口覆盖（页面经 /config.json 自动获取 WS 地址）
 *   GEOAI_WS_TOKEN                    可选。设置后页面必须带 ?token=xxx 才能连入 WS
 *   GEOAI_RUN_TIMEOUT_MS              run_code 等待页面执行回执的超时（默认 30000）
 *   GEOAI_MAPBOX_TOKEN / GEOAI_AMAP_KEY / GEOAI_AMAP_SECURITY
 *                                     可选。经 /config.json 下发给对应试炼场页面初始化地图（不配则页面提示自行 createMap）
 *
 * 会话: 页面以 ?session=<id>&playground=<name> 连入（session 默认 default；playground 记录页面归属
 *       试炼场，用于 save/capture 时推断经验归属域 lib）。同 id 后连者替换先连者；
 *       send_code / run_code 可用 sessionId 定向，不填则发给最近连入的页面。
 *       run_code 为请求-响应模式：页面执行后带 id 回传 result/error，工具把返回值或报错
 *       直接交还 MCP 客户端，模型据此自我修正。
 *
 * 关键纪律: 进程 stdout 属于 MCP 协议通道, 任何日志都必须走 console.error (stderr)。
 *            下面的 log() 是唯一允许的输出方式, 代码中不允许出现 console.log。
 *
 * 边界: 本文件不参与 Vite 构建。前端由 Vite 产出 dist/，本进程只负责托管。
 */

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { WebSocketServer } from 'ws';
import express from 'express';
import open from 'open';
import {
  ensureStore,
  storeDir,
  listIndex,
  searchExperience,
  getEntryById,
  saveExperience,
  captureFailure,
} from './experience.js';
import { listKits, getKit, searchKits, listExternal, kitsForExperience, experiencesForKit } from './lib-registry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** 项目根（scripts/ 的上一级）：dist / package.json 都相对它解析 */
const ROOT_DIR = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);
const { name: PKG_NAME, version: PKG_VERSION } = require(path.join(ROOT_DIR, 'package.json'));

const HTTP_HOST = '127.0.0.1';
const WS_HOST = '127.0.0.1';
const HTTP_PORT = Number.parseInt(process.env.GEOAI_HTTP_PORT ?? '', 10) || 3000;
const WS_PORT = Number.parseInt(process.env.GEOAI_WS_PORT ?? '', 10) || 3001;
const WS_TOKEN = process.env.GEOAI_WS_TOKEN || '';
const RUN_TIMEOUT_MS = Number.parseInt(process.env.GEOAI_RUN_TIMEOUT_MS ?? '', 10) || 30_000;
/** 默认试炼场（playgrounds/ 下的目录名）：open_page 不带参数与根路径 / 重定向的目标 */
const DEFAULT_PLAYGROUND = 'cesium';
const PLAYGROUND_PATH = `/playgrounds/${DEFAULT_PLAYGROUND}/`;
const PAGE_URL = `http://${HTTP_HOST}:${HTTP_PORT}${PLAYGROUND_PATH}`;
const OPEN_TIMEOUT_MS = 10_000;

/** 试炼场页面地址（playgrounds/ 目录名 -> 完整 URL） */
function pageUrlOf(name) {
  return `http://${HTTP_HOST}:${HTTP_PORT}/playgrounds/${name}/`;
}

/** 可用试炼场 = dist（构建产物）与源码 playgrounds/ 下含 index.html 的目录并集 */
function availablePlaygrounds() {
  const names = new Set();
  for (const base of [path.join(DIST_DIR, 'playgrounds'), path.join(ROOT_DIR, 'playgrounds')]) {
    try {
      for (const d of fs.readdirSync(base)) {
        if (fs.existsSync(path.join(base, d, 'index.html'))) names.add(d);
      }
    } catch {}
  }
  return [...names].sort();
}

/** 各试炼场的执行上下文说明（open_page 返回给模型，随页面不同） */
const PLAYGROUND_CONTEXT = {
  cesium: '左侧为 Monaco 编辑器, 右侧为 Cesium 地球。执行上下文变量: viewer / Cesium / kit（能力库层）。',
  leaflet: '左侧为 Monaco 编辑器, 右侧为 Leaflet 2D 地图。执行上下文变量: map / L。',
  mapbox:
    '左侧为 Monaco 编辑器, 右侧为 Mapbox GL JS 地图。执行上下文变量: map / mapboxgl。' +
    '未配置 GEOAI_MAPBOX_TOKEN 时 map 为 null, 可在代码里用 createMap(token) 创建并赋给 map。',
  amap:
    '左侧为 Monaco 编辑器, 右侧为高德 JSAPI 地图。执行上下文变量: map / AMap。' +
    '未配置 GEOAI_AMAP_KEY 时 map 为 null, 可在代码里用 createMap(key, securityJsCode) 创建并赋给 map。',
};

/** log 唯一出口, 严禁 console.log */
function log(...args) {
  console.error('[geoai]', ...args);
}

// ---------------------------------------------------------------- HTTP 静态服务
// 托管 Vite 构建产物 dist/。开发时请跑 `npm run dev:web`（Vite dev server 独立端口），
// 或先 `npm run build` 再 `npm start`（npm install 的 prepare 钩子通常会自动完成构建）。
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const DIST_INDEX = path.join(DIST_DIR, 'playgrounds', DEFAULT_PLAYGROUND, 'index.html');
const HAS_DIST = fs.existsSync(DIST_INDEX);

const app = express();
// 页面侧下发: WS 地址（端口可被环境变量改变, 页面不能写死 3001）、可用试炼场清单、
// 可选地图服务 key（来自环境变量, 只落在本地回环页面；未配置时页面退化为无底图并提示）
app.get('/config.json', (_req, res) => {
  res.type('application/json').send(
    JSON.stringify({
      wsUrl: `ws://${WS_HOST}:${WS_PORT}`,
      playgrounds: availablePlaygrounds(),
      keys: {
        mapbox: process.env.GEOAI_MAPBOX_TOKEN || '',
        amap: process.env.GEOAI_AMAP_KEY || '',
        amapSecurity: process.env.GEOAI_AMAP_SECURITY || '',
      },
    }),
  );
});
if (HAS_DIST) {
  // 根路径重定向到默认试炼场（产物按源码目录布局：dist/playgrounds/cesium/…）
  app.get('/', (_req, res) => res.redirect(PLAYGROUND_PATH));
  app.use(express.static(DIST_DIR));
} else {
  app.get('/', (_req, res) => {
    res
      .status(503)
      .type('text/plain; charset=utf-8')
      .send(
        `${path.relative(ROOT_DIR, DIST_INDEX)} 不存在，页面尚未构建。\n\n` +
          '请任选其一：\n' +
          '  1) 构建后启动：  npm run build && npm start\n' +
          `  2) 前端 dev：     npm run dev:web （Vite dev server ${PAGE_URL.replace(String(HTTP_PORT), '5173')}）\n\n` +
          `注意：MCP 工具 open_page 打开的是本 express 服务（${HTTP_PORT} 端口）。\n`,
      );
  });
}

const httpServer = app.listen(HTTP_PORT, HTTP_HOST, () => {
  log(`HTTP 静态服务已启动: ${PAGE_URL}`);
  if (!HAS_DIST) {
    log(`警告: 未找到 ${path.relative(ROOT_DIR, DIST_INDEX)}，页面将返回 503。构建命令: npm run build`);
  }
});

httpServer.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    log(`致命错误: 端口 ${HTTP_PORT} 已被占用。可设置环境变量 GEOAI_HTTP_PORT 换端口，或先关闭占用进程（lsof -ti :${HTTP_PORT} | xargs kill）后重试。`);
  } else {
    log(`HTTP 服务错误: ${err.message}`);
  }
  process.exit(1);
});

// ---------------------------------------------------------------- WebSocket 服务
/** @type {Map<string, import('ws').WebSocket>} sessionId -> 当前页面连接（同 id 后连者替换先连者） */
const pageSockets = new Map();
/** @type {string | null} 最近连入的会话, 作为未显式指定 sessionId 时的目标 */
let lastSessionId = null;
/** @type {Map<string, {ws: import('ws').WebSocket, resolve: (r: {ok: boolean, payload: unknown}) => void, reject: (e: Error) => void, timer: NodeJS.Timeout}>} run_code 请求-响应等待表 */
const pendingRuns = new Map();
let runSeq = 0;
/** @type {Map<string, string>} sessionId -> 最近一次 send_code 的代码（失败自动捕获时回溯用） */
const lastCodeBySession = new Map();
/** @type {Map<string, string>} sessionId -> 页面所属试炼场（save/capture 推断经验归属域 lib 用） */
const sessionPlayground = new Map();
/** 试炼场 -> 经验归属域（experience.js 的 lib 字段）；geo/data 域无对应页面, 只能显式指定 */
const PLAYGROUND_LIB = { cesium: 'cesium', leaflet: 'leaflet', mapbox: 'mapbox', amap: 'amap' };
/** 会话对应经验归属域：显式 sessionId > 最近连入会话；未知试炼场回落 cesium */
function libOfSession(sessionId) {
  const pg = sessionPlayground.get(sessionId || lastSessionId || 'default');
  return PLAYGROUND_LIB[pg] ?? DEFAULT_PLAYGROUND;
}

/** @type {Set<{sessionId: string, resolve: () => void, reject: (e: Error) => void, timer: NodeJS.Timeout}>} */
const pageWaiters = new Set();

function wakePageWaiters() {
  for (const w of pageWaiters) {
    if (pageSockets.get(w.sessionId)) {
      clearTimeout(w.timer);
      pageWaiters.delete(w);
      w.resolve();
    }
  }
}

/** 等待指定会话的页面连入（已连接则立即返回）, 超时抛错；urlHint 用于超时提示手动打开的地址 */
function waitForPage(sessionId = 'default', timeoutMs = OPEN_TIMEOUT_MS, urlHint = PAGE_URL) {
  if (pageSockets.get(sessionId)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pageWaiters.delete(waiter);
      reject(new Error(`等待页面 WebSocket 连接超时 (${timeoutMs / 1000}s)。请手动打开 ${urlHint}`));
    }, timeoutMs);
    const waiter = { sessionId, resolve, reject, timer };
    pageWaiters.add(waiter);
  });
}

/** 解析目标页面: 显式 sessionId > 最近连入会话; 无任何页面时抛错 */
function resolveTarget(sessionId) {
  const sid = sessionId || lastSessionId || 'default';
  const ws = pageSockets.get(sid);
  if (!ws || ws.readyState !== ws.OPEN) {
    throw new Error(`页面未连接 (session=${sid}): 请先调用 open_page 工具 (或手动打开 ${PAGE_URL})`);
  }
  return { ws, sessionId: sid };
}

function sendToPage(payload, sessionId) {
  const target = resolveTarget(sessionId);
  target.ws.send(JSON.stringify(payload));
  return target.sessionId;
}

const wss = new WebSocketServer({ host: WS_HOST, port: WS_PORT }, () => {
  log(`WebSocket 服务已启动: ws://${WS_HOST}:${WS_PORT}`);
});

wss.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    log(`致命错误: 端口 ${WS_PORT} 已被占用。可设置环境变量 GEOAI_WS_PORT 换端口，或先关闭占用进程（lsof -ti :${WS_PORT} | xargs kill）后重试。`);
  } else {
    log(`WebSocket 服务错误: ${err.message}`);
  }
  process.exit(1);
});

wss.on('connection', (ws, req) => {
  const url = new URL(req.url ?? '/', `http://${HTTP_HOST}:${HTTP_PORT}`);
  if (WS_TOKEN && url.searchParams.get('token') !== WS_TOKEN) {
    log('拒绝页面连接: token 缺失或不匹配');
    ws.close(4001, 'invalid token');
    return;
  }
  const sessionId = url.searchParams.get('session') || 'default';
  const playground = url.searchParams.get('playground') || DEFAULT_PLAYGROUND;
  log(`页面已连接 WebSocket: session=${sessionId} playground=${playground} (from ${req.socket.remoteAddress})`);

  const prev = pageSockets.get(sessionId);
  if (prev && prev !== ws) {
    try {
      prev.close(4000, 'replaced by newer connection');
    } catch {}
  }
  pageSockets.set(sessionId, ws);
  sessionPlayground.set(sessionId, playground);
  lastSessionId = sessionId;
  wakePageWaiters();

  ws.send(JSON.stringify({ type: 'hello', message: 'MCP Server 已连接', session: sessionId }));

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    // 页面侧回执: run_code 请求-响应 + 日志观察
    if (msg.type === 'result' || msg.type === 'error') {
      const pending = msg.id ? pendingRuns.get(msg.id) : undefined;
      if (pending && pending.ws === ws) {
        clearTimeout(pending.timer);
        pendingRuns.delete(msg.id);
        pending.resolve({ ok: msg.type === 'result', payload: msg.payload });
      }
      log(`页面执行回执 [${msg.type}]${msg.id ? ` id=${msg.id}` : ''}:`, JSON.stringify(msg.payload ?? '').slice(0, 500));
    }
  });

  ws.on('close', () => {
    log(`页面已断开 WebSocket: session=${sessionId}`);
    if (pageSockets.get(sessionId) === ws) {
      pageSockets.delete(sessionId);
      sessionPlayground.delete(sessionId);
      if (lastSessionId === sessionId) {
        lastSessionId = pageSockets.keys().next().value ?? null;
      }
    }
    for (const [id, pending] of pendingRuns) {
      if (pending.ws === ws) {
        clearTimeout(pending.timer);
        pendingRuns.delete(id);
        pending.reject(new Error(`页面 (session=${sessionId}) 已断开, 执行结果未知`));
      }
    }
  });

  ws.on('error', (err) => {
    log('WebSocket 错误:', err.message);
  });
});

// ---------------------------------------------------------------- MCP Server
const mcp = new McpServer(
  { name: PKG_NAME, version: PKG_VERSION },
  {
    capabilities: { tools: {}, resources: {} },
    instructions:
      '通过 WebSocket 把代码推送到试炼场页面并执行，在真实地图（Cesium / Leaflet / Mapbox / 高德）上验证。' +
      'open_page 可选 playground 打开不同试炼场（默认 cesium），执行上下文变量随试炼场不同（cesium: viewer/Cesium/kit；leaflet: map/L；mapbox: map/mapboxgl；amap: map/AMap）。' +
      '代码以 AsyncFunction 包装执行（支持顶层 await）。' +
      '工作流: 写代码前先 list_libs 看有没有现成能力（优先 kit.* 而非裸写库 API），' +
      '再 search_experience 检索坑位与已验证代码（覆盖 cesium / leaflet / mapbox / amap / geo 跨库通识 / data 数据处理与 CLI 工具各域，可用 lib 参数聚焦）；' +
      '然后 send_code 下发代码, run_code 执行 —— run_code 返回执行返回值或报错；' +
      '失败时按报错修改重试, 成功且有复用价值时用 save_experience 固化经验（geo/data 域经验请显式传 lib）。' +
      '数据处理（ogr2ogr / tippecanoe / 3d-tiles-tools 等 CLI 工具）不经页面执行：直接在宿主 shell 跑命令，search_experience 的 lib=data 检索经验与校验清单。',
  },
);

mcp.registerTool(
  'open_page',
  {
    title: '打开验证页面',
    description:
      `用默认浏览器打开试炼场页面（默认 ${DEFAULT_PLAYGROUND}，可用 playground=leaflet / mapbox / amap 切换），` +
      '并等待页面 WebSocket 连接成功（超时 10 秒）。配置了 GEOAI_WS_TOKEN 时自动携带 token。' +
      '指定 playground 时会话默认用 playground 名（避免顶掉已打开页面的连接），可用 sessionId 覆盖。',
    inputSchema: {
      playground: z.string().optional().describe('试炼场（playgrounds/ 目录名）：cesium（默认）/ leaflet / mapbox / amap，决定页面与执行上下文变量'),
      sessionId: z.string().optional().describe('页面会话 id；不填时 default（显式指定 playground 且未指定会话时用 playground 名）'),
    },
  },
  async ({ playground, sessionId } = {}) => {
    const pg = String(playground ?? DEFAULT_PLAYGROUND).trim();
    const known = availablePlaygrounds();
    if (!known.includes(pg)) {
      return {
        isError: true,
        content: [{ type: 'text', text: `未知试炼场 "${pg}"。可用: ${known.join(' / ') || '(未构建任何页面)'}（playgrounds/ 下目录名）` }],
      };
    }
    const sid = String(sessionId ?? '').trim() || (playground ? pg : 'default');
    const base = pageUrlOf(pg);
    const params = new URLSearchParams({ session: sid });
    if (WS_TOKEN) params.set('token', WS_TOKEN);
    const openUrl = `${base}?${params.toString()}`;
    let openedBy = 'open()';
    try {
      await open(openUrl);
    } catch (err) {
      // macOS 无 GUI / 沙箱环境常见, 不阻断流程, 走等待分支
      openedBy = `open() 失败: ${err.message}；请手动打开 ${openUrl}`;
      log(openedBy);
    }
    try {
      await waitForPage(sid, OPEN_TIMEOUT_MS, base);
    } catch (err) {
      return {
        isError: true,
        content: [{ type: 'text', text: `${err.message}\n(${openedBy})` }],
      };
    }

    return {
      content: [
        {
          type: 'text',
          text: `页面已打开并连接成功: ${base} (session=${sid}, playground=${pg})\n打开方式: ${openedBy}\n${PLAYGROUND_CONTEXT[pg] ?? ''}`,
        },
      ],
    };
  },
);

mcp.registerTool(
  'send_code',
  {
    title: '推送代码到编辑器',
    description: '把一段 JavaScript 代码推送到目标页面的 Monaco 编辑器（不执行）。代码可使用 viewer、Cesium 与 kit（能力库层）三个变量。',
    inputSchema: {
      code: z.string().min(1).describe('要下发的 JavaScript 源码'),
      sessionId: z.string().optional().describe('目标页面会话 id（页面以 ?session=<id> 连入）；不填则发给最近连入的页面'),
    },
  },
  async ({ code, sessionId }) => {
    if (typeof code !== 'string' || !code.length) {
      return { isError: true, content: [{ type: 'text', text: '参数 code 必须是非空字符串' }] };
    }
    try {
      const sid = sendToPage({ type: 'setCode', code }, sessionId);
      lastCodeBySession.set(sid, code);
      return {
        content: [
          { type: 'text', text: `已推送 ${code.length} 字符到 session=${sid} 的编辑器。调用 run_code 执行（会返回执行结果或报错）。` },
        ],
      };
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: err.message }] };
    }
  },
);

mcp.registerTool(
  'run_code',
  {
    title: '执行编辑器中的代码',
    description:
      '通知目标页面执行当前 Monaco 编辑器中的代码（new Function("viewer","Cesium","kit", code)），并等待执行回执：' +
      '成功时返回执行返回值，失败时返回报错信息（可据此修改代码重试），超时默认 30 秒。',
    inputSchema: {
      sessionId: z.string().optional().describe('目标页面会话 id；不填则发给最近连入的页面'),
    },
  },
  async ({ sessionId }) => {
    let target;
    try {
      target = resolveTarget(sessionId);
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: err.message }] };
    }

    const id = `run-${++runSeq}`;
    try {
      const outcome = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pendingRuns.delete(id);
          reject(new Error(`等待页面执行回执超时 (${RUN_TIMEOUT_MS / 1000}s)。代码可能包含长时间异步操作, 结果可稍后查看页面日志。`));
        }, RUN_TIMEOUT_MS);
        pendingRuns.set(id, { ws: target.ws, resolve, reject, timer });
        target.ws.send(JSON.stringify({ type: 'runCode', id }));
      });

      const desc =
        typeof outcome.payload === 'string' ? outcome.payload : JSON.stringify(outcome.payload ?? null);
      if (outcome.ok) {
        return {
          content: [
            {
              type: 'text',
              text:
                `执行成功 (session=${target.sessionId})，返回：${desc}\n` +
                '（若该代码模式有复用价值, 可调用 save_experience 固化为经验条目）',
            },
          ],
        };
      }
      // 失败自动捕获为经验草稿（坑位），供后续检索与固化修法；归属域按页面所属试炼场推断
      let captureNote = '';
      try {
        const captured = captureFailure(lastCodeBySession.get(target.sessionId) ?? '', desc, libOfSession(target.sessionId));
        if (captured) {
          captureNote = `\n（已自动捕获本次失败为经验草稿 ${captured.id}，修复后可调用 save_experience 固化修法）`;
        }
      } catch {}
      return {
        isError: true,
        content: [{ type: 'text', text: `页面执行失败 (session=${target.sessionId})：${desc}${captureNote}` }],
      };
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: err.message }] };
    }
  },
);

mcp.registerTool(
  'get_status',
  {
    title: '查询页面连接状态',
    description: '返回各会话页面的 WebSocket 连接情况。',
    inputSchema: {},
  },
  async () => {
    const sessions = [...pageSockets.keys()];
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            pageConnected: sessions.length > 0,
            sessions: sessions.map((s) => ({ id: s, playground: sessionPlayground.get(s) ?? DEFAULT_PLAYGROUND })),
            lastSession: lastSessionId,
            playgrounds: availablePlaygrounds(),
            http: PAGE_URL,
            websocket: `ws://${WS_HOST}:${WS_PORT}`,
          }),
        },
      ],
    };
  },
);

// ---------------------------------------------------------------- 经验库工具
mcp.registerTool(
  'search_experience',
  {
    title: '检索经验库',
    description:
      '在经验库中检索写地图/GIS 代码的已验证经验（坑位修法 / 代码范例 / 用法要点），' +
      '覆盖 cesium / leaflet / mapbox / amap / geo（跨库通识: 坐标系、瓦片方案、投影）/ data（数据处理与 CLI 工具: GDAL、tippecanoe、3d-tiles-tools）各域。' +
      '检索词可用: 场景意图（如"加载3DTiles""相机对准实体""shapefile转geojson"）、API 名或 CLI 工具名、或报错关键词（失败时按报错搜修法）。',
    inputSchema: {
      query: z.string().min(1).describe('检索词'),
      limit: z.number().int().min(1).max(8).optional().describe('返回条数, 默认 3, 最多 8'),
      lib: z.string().optional().describe('归属域聚焦: cesium / leaflet / mapbox / amap / geo / data。命中里优先返回本域经验（不硬过滤, 跨域命中仍返回）'),
    },
  },
  async ({ query, limit, lib }) => {
    let hits;
    try {
      hits = searchExperience(query, limit ?? 3, { lib });
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: `经验库读取失败: ${err.message}` }] };
    }
    if (!hits.length) {
      const top = listIndex()
        .slice(0, 5)
        .map((e) => e.title)
        .join('；');
      return {
        content: [{ type: 'text', text: `未命中「${query}」。库内现有经验: ${top || '(空)'}。可换关键词重试。` }],
      };
    }
    const lines = hits.map((h, i) => {
      const m = h.entry;
      const codeLines = m.code ? `\n   代码: ${m.code.split('\n').slice(0, 6).join('\n   ')}` : '';
      // A 方案·互导：若该条经验已被能力库封装，明确告诉模型优先用库，别再裸写地图库 API
      const kits = kitsForExperience(m.id).filter((k) => k.status === 'ready');
      const kitHint = kits.length
        ? `\n   ⚡ 已封装为库: kit.${kits.map((k) => k.id).join(' / kit.')} —— 优先用库（已内置本条修法），` +
          `get_lib_doc("${kits[0].id}")`
        : '';
      return `${i + 1}. [${m.lib}/${m.kind}/${m.status}] ${m.title} (id=${m.id}, 成功${m.successCount}次)\n   什么时候用: ${m.trigger || '(见全文)'}${codeLines}${kitHint}\n   完整内容: get_experience("${m.id}")`;
    });
    return { content: [{ type: 'text', text: `命中 ${hits.length} 条经验:\n${lines.join('\n')}` }] };
  },
);

mcp.registerTool(
  'get_experience',
  {
    title: '读取单条经验全文',
    description: '按 id 读取一条经验的完整内容（含已验证代码与修法说明）。',
    inputSchema: {
      id: z.string().min(1).describe('经验条目 id（search_experience 返回的 id）'),
    },
  },
  async ({ id }) => {
    const entry = getEntryById(id);
    if (!entry) {
      return { isError: true, content: [{ type: 'text', text: `未找到经验条目 id=${id}，请用 search_experience 重新检索。` }] };
    }
    // A 方案·互导：单条阅读时同样提示库封装情况
    const kits = kitsForExperience(entry.id).filter((k) => k.status === 'ready');
    const hint = kits.length
      ? `\n\n---\n⚡ 本条已封装为能力库：${kits.map((k) => `kit.${k.id}（${k.title}）`).join('、')}\n` +
        `→ 写代码时优先用库（已内置本条修法），调 get_lib_doc("${kits[0].id}") 取用法。`
      : '';
    return { content: [{ type: 'text', text: entry.raw + hint }] };
  },
);

mcp.registerTool(
  'save_experience',
  {
    title: '固化经验到经验库',
    description:
      '把一条已验证的经验写入经验库（Markdown 文件，人可读、可 git 版本化）。' +
      'run_code 成功且代码模式有复用价值时调用；同名条目自动去重并累加成功次数。',
    inputSchema: {
      kind: z.enum(['pitfall', 'snippet', 'pattern']).describe('pitfall=坑位+修法, snippet=可复用代码, pattern=用法要点'),
      title: z.string().min(1).describe('一句话标题, 具体到场景（如"3DTiles 大场景相机初始定位"）'),
      code: z.string().optional().describe('已验证的代码（js 代码或 shell 命令）'),
      problem: z.string().optional().describe('pitfall: 现象或报错原文'),
      fix: z.string().optional().describe('pitfall: 修法说明'),
      trigger: z.string().optional().describe('什么时候用本条（一行触发条件, 不填自动生成）'),
      tags: z.array(z.string()).optional().describe('意图关键词（中英文均可, 不要含逗号）'),
      apis: z.array(z.string()).optional().describe('涉及的 API 名（地图库 API 或 ogr2ogr / tippecanoe 等 CLI 工具与子命令）'),
      errors: z.array(z.string()).optional().describe('典型报错签名（便于按报错检索）'),
      lib: z.string().optional().describe('归属域: cesium / leaflet / mapbox / amap / geo / data。不填按当前执行页面的试炼场推断；geo（跨库通识）与 data（数据处理/CLI）域经验必须显式指定'),
      lang: z.enum(['js', 'bash']).optional().describe('代码语言: shell 命令用 bash, 默认 js'),
    },
  },
  async (input) => {
    try {
      // lib 缺省按最近会话的试炼场推断（geo/data 无对应页面, 靠显式传参）
      const saved = saveExperience(
        { ...input, lib: input.lib ?? libOfSession(), lang: input.lang ?? 'js' },
        { source: 'model' },
      );
      return {
        content: [
          {
            type: 'text',
            text: saved.deduped
              ? `已存在同名经验, 成功次数+1 (id=${saved.id})`
              : `经验已固化: ${saved.file} (id=${saved.id})`,
          },
        ],
      };
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: `保存失败: ${err.message}` }] };
    }
  },
);

// ---------------------------------------------------------------- 能力库工具
// 库层（kits/）把 Cesium 踩过的坑固化成可调用能力，避免模型每次重写。
// 检索时与经验库互补：list_libs 回答「该调什么」，search_experience 回答「会踩什么坑」。
mcp.registerTool(
  'list_libs',
  {
    title: '列出能力库',
    description:
      '列出能力库（kit）。写代码前先看这里：库已封装常见坑位，优先用 kit.* 而不是裸写库 API。' +
      '带 query 时按意图/场景/API 名过滤（如"相机""flyTo""底图""地形"）；带 lib 时只看指定归属域的库（目前能力库集中在 cesium 域）。',
    inputSchema: {
      query: z.string().optional().describe('可选检索词：场景意图 / API 名'),
      lib: z.string().optional().describe('可选归属域过滤: cesium / leaflet / mapbox / amap'),
    },
  },
  async ({ query, lib }) => {
    let kits = query ? searchKits(query, 8).map((h) => h.kit) : listKits();
    if (lib) kits = kits.filter((k) => (k.lib ?? 'cesium') === lib);
    if (!kits.length) {
      const all = listKits().map((k) => `${k.id}(${k.title})`).join('；');
      return {
        content: [
          {
            type: 'text',
            text: query || lib
              ? `未命中对应的能力库。现有: ${all || '(空)'}。可换个关键词, 或直接用地图库原生 API。`
              : '能力库为空（kits/registry.json 未配置或读取失败）。',
          },
        ],
      };
    }
    const lines = kits.map((k) => {
      const status = k.status === 'ready' ? '可用' : k.status === 'planned' ? '规划中(勿调用)' : k.status;
      // A 方案·互导：库带出关联坑位，让模型一次就知道「有哪些能力 + 什么时候用/有什么坑」
      const exps = experiencesForKit(k.id, listIndex).map((e) => e.title);
      const exp = exps.length ? `\n   适用场景/坑位: ${exps.join('；')}` : '';
      return `- [${status}][${k.lib ?? 'cesium'}] ${k.id} · ${k.title}\n   能力: ${k.summary}\n   调用: ${k.signature}${exp}`;
    });
    const ext = listExternal();
    const extNote = ext.length
      ? `\n\n外部包（仅登记，不深链）:\n${ext.map((e) => `- ${e.package} (${e.source}/${e.status}): ${e.note}`).join('\n')}`
      : '';
    return {
      content: [
        { type: 'text', text: `能力库 ${kits.length} 项:\n${lines.join('\n')}\n\n执行上下文可用变量: viewer, Cesium, kit（cesium 试炼场; 其他试炼场见 open_page 返回）${extNote}` },
      ],
    };
  },
);

mcp.registerTool(
  'get_lib_doc',
  {
    title: '读取能力库用法',
    description: '按 id 读取某个 kit 的完整用法说明与可运行示例代码（id来自 list_libs）。',
    inputSchema: {
      id: z.string().min(1).describe('kit id（如 camera / imagery）'),
    },
  },
  async ({ id }) => {
    const kit = getKit(id);
    if (!kit) {
      const all = listKits().map((k) => k.id).join('；');
      return { isError: true, content: [{ type: 'text', text: `未找到能力库 id=${id}。现有: ${all || '(空)'}` }] };
    }
    const parts = [
      `=== ${kit.id} · ${kit.title} ===`,
      `状态: ${kit.status}`,
      `包名: ${kit.package}`,
      `能力: ${kit.summary}`,
      `签名: ${kit.signature}`,
      `覆盖API: ${(kit.apis ?? []).join(', ')}`,
    ];
    if (kit.snippet) parts.push(`\n--- 示例代码（可直接 send_code 后 run_code）---\n${kit.snippet}`);
    if ((kit.experience ?? []).length) {
      parts.push(`\n相关经验条目（用 get_experience 读全文）: ${kit.experience.join(', ')}`);
    }
    if (kit.status === 'planned') {
      parts.push('\n注意: 该库为规划中, 尚未实现, 调用会失败。');
    }
    return { content: [{ type: 'text', text: parts.join('\n') }] };
  },
);

mcp.registerTool(
  'send_snippet',
  {
    title: '下发能力库示例代码',
    description:
      '把某个 kit 的示例代码直接推送到页面编辑器（不执行），随后调run_code 执行。' +
      '等价于 list_libs → get_lib_doc → send_code 的快捷方式。',
    inputSchema: {
      id: z.string().min(1).describe('kit id（如 camera / imagery）'),
      sessionId: z.string().optional().describe('目标页面会话 id；不填则发给最近连入的页面'),
    },
  },
  async ({ id, sessionId }) => {
    const kit = getKit(id);
    if (!kit) {
      const all = listKits().map((k) => k.id).join('；');
      return { isError: true, content: [{ type: 'text', text: `未找到能力库 id=${id}。现有: ${all || '(空)'}` }] };
    }
    if (!kit.snippet) {
      return {
        isError: true,
        content: [{ type: 'text', text: `能力库 ${id} 没有示例代码（status=${kit.status}），请直接写代码。` }],
      };
    }
    try {
      const sid = sendToPage({ type: 'setCode', code: kit.snippet }, sessionId);
      lastCodeBySession.set(sid, kit.snippet);
      return {
        content: [
          {
            type: 'text',
            text: `已把 ${id} 的示例代码推送到 session=${sid}（${kit.snippet.length} 字符）。调用 run_code 执行。`,
          },
        ],
      };
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: err.message }] };
    }
  },
);

// 资源: 能力清单
mcp.registerResource(
  'libs',
  'geoai://libs/index',
  { title: '能力库清单', description: '已挂载的能力库（含归属域 lib）与外部包登记（JSON）' },
  async () => ({
    contents: [
      {
        uri: 'geoai://libs/index',
        mimeType: 'application/json',
        text: JSON.stringify({ kits: listKits(), external: listExternal() }, null, 2),
      },
    ],
  }),
);

// 资源: 连接状态 (客户端可按需拉取)
mcp.registerResource(
  'status',
  'geoai://status',
  { title: '连接状态', description: 'geoai 页面会话连接状态（JSON）' },
  async (uri) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: 'application/json',
        text: JSON.stringify(
          {
            name: PKG_NAME,
            version: PKG_VERSION,
            sessions: [...pageSockets.keys()],
            lastSession: lastSessionId,
            http: PAGE_URL,
            websocket: `ws://${WS_HOST}:${WS_PORT}`,
          },
          null,
          2,
        ),
      },
    ],
  }),
);

// 资源: 经验库索引 (人/客户端可浏览库中有什么)
mcp.registerResource(
  'experience-index',
  'geoai://experience/index',
  { title: '经验库索引', description: 'geoai 经验库条目清单（JSON）' },
  async (uri) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: 'application/json',
        text: JSON.stringify({ store: storeDir(), count: listIndex().length, entries: listIndex() }, null, 2),
      },
    ],
  }),
);

// ---------------------------------------------------------------- 经验库初始化
ensureStore();
log(`经验库已就绪: ${storeDir()} (${listIndex().length} 条)`);

// ---------------------------------------------------------------- 启动 MCP (stdio)
const transport = new StdioServerTransport();
await mcp.connect(transport);
log(`MCP Server (stdio) 已就绪: ${PKG_NAME}@${PKG_VERSION}`);

// ---------------------------------------------------------------- 优雅退出
let closing = false;
function shutdown(signal) {
  if (closing) return;
  closing = true;
  log(`收到 ${signal}, 正在关闭...`);
  for (const [id, pending] of pendingRuns) {
    clearTimeout(pending.timer);
    pending.reject(new Error('server 正在关闭'));
  }
  try {
    wss.close();
  } catch {}
  try {
    httpServer.close();
  } catch {}
  try {
    mcp.close();
  } catch {}
  setTimeout(() => process.exit(0), 150);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
// MCP 客户端断开 (stdio EOF) 时自动退出, 避免孤儿进程占用 3000/3001
process.stdin.on('end', () => shutdown('stdin-closed'));
process.stdin.on('close', () => shutdown('stdin-closed'));
