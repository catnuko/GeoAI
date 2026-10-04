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
 *
 * 会话: 页面以 ?session=<id> 连入（默认 default），同 id 后连者替换先连者；
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { name: PKG_NAME, version: PKG_VERSION } = require('./package.json');

const HTTP_HOST = '127.0.0.1';
const WS_HOST = '127.0.0.1';
const HTTP_PORT = Number.parseInt(process.env.GEOAI_HTTP_PORT ?? '', 10) || 3000;
const WS_PORT = Number.parseInt(process.env.GEOAI_WS_PORT ?? '', 10) || 3001;
const WS_TOKEN = process.env.GEOAI_WS_TOKEN || '';
const RUN_TIMEOUT_MS = Number.parseInt(process.env.GEOAI_RUN_TIMEOUT_MS ?? '', 10) || 30_000;
const PAGE_URL = `http://${HTTP_HOST}:${HTTP_PORT}/`;
const OPEN_TIMEOUT_MS = 10_000;

/** log 唯一出口, 严禁 console.log */
function log(...args) {
  console.error('[geoai]', ...args);
}

// ---------------------------------------------------------------- HTTP 静态服务
// 托管 Vite 构建产物 dist/。开发时请跑 `npm run dev:web`（Vite dev server 独立端口），
// 或先 `npm run build` 再 `npm start`（npm install 的 prepare 钩子通常会自动完成构建）。
const DIST_DIR = path.join(__dirname, 'dist');
const HAS_DIST = fs.existsSync(path.join(DIST_DIR, 'index.html'));

const app = express();
// 页面侧 WS 地址下发: 端口可被环境变量改变, 页面不能写死 3001
app.get('/config.json', (_req, res) => {
  res.type('application/json').send(JSON.stringify({ wsUrl: `ws://${WS_HOST}:${WS_PORT}` }));
});
if (HAS_DIST) {
  app.use(express.static(DIST_DIR));
} else {
  app.get('/', (_req, res) => {
    res
      .status(503)
      .type('text/plain; charset=utf-8')
      .send(
        'dist/index.html 不存在，页面尚未构建。\n\n' +
          '请任选其一：\n' +
          '  1) 构建后启动：  npm run build && npm start\n' +
          '  2) 前端 dev：     npm run dev:web （Vite dev server http://127.0.0.1:5173）\n\n' +
          `注意：MCP 工具 open_page 打开的是本 express 服务（${HTTP_PORT} 端口）。\n`,
      );
  });
}

const httpServer = app.listen(HTTP_PORT, HTTP_HOST, () => {
  log(`HTTP 静态服务已启动: ${PAGE_URL}`);
  if (!HAS_DIST) {
    log(`警告: 未找到 dist/index.html，页面将返回 503。构建命令: npm run build`);
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

/** 等待指定会话的页面连入（已连接则立即返回）, 超时抛错 */
function waitForPage(sessionId = 'default', timeoutMs = OPEN_TIMEOUT_MS) {
  if (pageSockets.get(sessionId)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pageWaiters.delete(waiter);
      reject(new Error(`等待页面 WebSocket 连接超时 (${timeoutMs / 1000}s)。请手动打开 ${PAGE_URL}`));
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
  log(`页面已连接 WebSocket: session=${sessionId} (from ${req.socket.remoteAddress})`);

  const prev = pageSockets.get(sessionId);
  if (prev && prev !== ws) {
    try {
      prev.close(4000, 'replaced by newer connection');
    } catch {}
  }
  pageSockets.set(sessionId, ws);
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
      '通过 WebSocket 把 JavaScript 推送到内嵌 Cesium 地球的页面并执行。' +
      '代码以 AsyncFunction("viewer","Cesium", code) 包装执行（支持顶层 await，可直接 await provider 的 fromUrl），' +
      '可直接访问 viewer 与 Cesium 全局对象。' +
      '工作流: 写代码前先 search_experience 检索已验证经验（可用场景词 / API 名 / 报错关键词）；' +
      '然后 send_code 下发代码, run_code 执行 —— run_code 返回执行返回值或报错；' +
      '失败时按报错修改重试, 成功且有复用价值时用 save_experience 固化经验。',
  },
);

mcp.registerTool(
  'open_page',
  {
    title: '打开验证页面',
    description: `用默认浏览器打开 ${PAGE_URL} （session=default），并等待页面 WebSocket 连接成功（超时 10 秒）。配置了 GEOAI_WS_TOKEN 时自动携带 token。`,
    inputSchema: {},
  },
  async () => {
    const openUrl = WS_TOKEN ? `${PAGE_URL}?token=${encodeURIComponent(WS_TOKEN)}` : PAGE_URL;
    let openedBy = 'open()';
    try {
      await open(openUrl);
    } catch (err) {
      // macOS 无 GUI / 沙箱环境常见, 不阻断流程, 走等待分支
      openedBy = `open() 失败: ${err.message}；请手动打开 ${openUrl}`;
      log(openedBy);
    }
    try {
      await waitForPage('default', OPEN_TIMEOUT_MS);
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
          text:
            `页面已打开并连接成功: ${PAGE_URL} (session=default)\n` +
            `打开方式: ${openedBy}\n` +
            '左侧为 Monaco 编辑器, 右侧为 Cesium 地球。现在可以调用 send_code / run_code。',
        },
      ],
    };
  },
);

mcp.registerTool(
  'send_code',
  {
    title: '推送代码到编辑器',
    description: '把一段 JavaScript 代码推送到目标页面的 Monaco 编辑器（不执行）。代码可使用 viewer 与 Cesium 变量。',
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
      '通知目标页面执行当前 Monaco 编辑器中的代码（new Function("viewer","Cesium", code)），并等待执行回执：' +
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
      // 失败自动捕获为经验草稿（坑位），供后续检索与固化修法
      let captureNote = '';
      try {
        const captured = captureFailure(lastCodeBySession.get(target.sessionId) ?? '', desc);
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
            sessions,
            lastSession: lastSessionId,
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
      '在经验库中检索写 Cesium 代码的已验证经验（坑位修法 / 代码范例 / 用法要点）。' +
      '检索词可用: 场景意图（如"加载3DTiles""相机对准实体"）、API 名、或报错关键词（失败时按报错搜修法）。',
    inputSchema: {
      query: z.string().min(1).describe('检索词'),
      limit: z.number().int().min(1).max(8).optional().describe('返回条数, 默认 3, 最多 8'),
    },
  },
  async ({ query, limit }) => {
    let hits;
    try {
      hits = searchExperience(query, limit ?? 3);
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
      return `${i + 1}. [${m.kind}/${m.status}] ${m.title} (id=${m.id}, 成功${m.successCount}次)\n   什么时候用: ${m.trigger || '(见全文)'}${codeLines}\n   完整内容: get_experience("${m.id}")`;
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
    return { content: [{ type: 'text', text: entry.raw }] };
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
      code: z.string().optional().describe('已验证的代码'),
      problem: z.string().optional().describe('pitfall: 现象或报错原文'),
      fix: z.string().optional().describe('pitfall: 修法说明'),
      trigger: z.string().optional().describe('什么时候用本条（一行触发条件, 不填自动生成）'),
      tags: z.array(z.string()).optional().describe('意图关键词（中英文均可, 不要含逗号）'),
      apis: z.array(z.string()).optional().describe('涉及的 Cesium API 名'),
      errors: z.array(z.string()).optional().describe('典型报错签名（便于按报错检索）'),
    },
  },
  async (input) => {
    try {
      const saved = saveExperience(input, { source: 'model' });
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
