#!/usr/bin/env node
/**
 * geoai :: server.js
 *
 * 单进程同时承载:
 *   1. MCP Server (stdio)      -> 与 MCP 客户端 (Claude Desktop / Cursor / WorkBuddy) 通信
 *   2. HTTP 静态服务           -> 127.0.0.1:$GEOAI_HTTP_PORT(默认 3000), 托管 Vite 构建产物 dist/
 *   3. WebSocket Server        -> 127.0.0.1:$GEOAI_WS_PORT(默认 3001), 页面主动连入
 *
 * 端口可用环境变量覆盖: GEOAI_HTTP_PORT / GEOAI_WS_PORT。
 * 页面通过 /config.json 获取 WS 地址，因此换端口无需改前端代码。
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { name: PKG_NAME, version: PKG_VERSION } = require('./package.json');

const HTTP_HOST = '127.0.0.1';
const WS_HOST = '127.0.0.1';
const HTTP_PORT = Number.parseInt(process.env.GEOAI_HTTP_PORT ?? '', 10) || 3000;
const WS_PORT = Number.parseInt(process.env.GEOAI_WS_PORT ?? '', 10) || 3001;
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
/** @type {import('ws').WebSocket | null} 当前页面连接 */
let pageSocket = null;
/** @type {(() => void) | null} 页面连接时的等待者 */
let pageWaiter = null;

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
  log(`页面已连接 WebSocket (from ${req.socket.remoteAddress})`);
  pageSocket = ws;

  if (pageWaiter) {
    const w = pageWaiter;
    pageWaiter = null;
    w();
  }

  ws.send(JSON.stringify({ type: 'hello', message: 'MCP Server 已连接' }));

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    // 页面侧回执: 运行结果 / 错误, 仅用于日志观察
    if (msg.type === 'result' || msg.type === 'error') {
      log(`页面执行回执 [${msg.type}]:`, JSON.stringify(msg.payload ?? '').slice(0, 500));
    }
  });

  ws.on('close', () => {
    log('页面已断开 WebSocket');
    if (pageSocket === ws) pageSocket = null;
  });

  ws.on('error', (err) => {
    log('WebSocket 错误:', err.message);
  });
});

/** 等待页面连入, 超时抛错 */
function waitForPage(timeoutMs) {
  if (pageSocket) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pageWaiter = null;
      reject(new Error(`等待页面 WebSocket 连接超时 (${timeoutMs / 1000}s)。请手动打开 ${PAGE_URL}`));
    }, timeoutMs);
    pageWaiter = () => {
      clearTimeout(timer);
      resolve();
    };
  });
}

function sendToPage(payload) {
  if (!pageSocket || pageSocket.readyState !== pageSocket.OPEN) {
    throw new Error('页面未连接: 请先调用 open_page 工具 (或手动打开 ' + PAGE_URL + ')');
  }
  pageSocket.send(JSON.stringify(payload));
}

// ---------------------------------------------------------------- MCP Server
const mcp = new McpServer(
  { name: PKG_NAME, version: PKG_VERSION },
  {
    capabilities: { tools: {} },
    instructions:
      '通过 WebSocket 把 JavaScript 推送到一个内嵌 Cesium 地球的页面并执行。' +
      '代码在页面上下文中以 new Function("viewer","Cesium", code)(viewer, Cesium) 执行，' +
      '可直接访问 viewer 与 Cesium 全局对象。',
  },
);

mcp.registerTool(
  'open_page',
  {
    title: '打开验证页面',
    description: `用默认浏览器打开 ${PAGE_URL} ，并等待页面 WebSocket 连接成功（超时 10 秒）。`,
    inputSchema: {},
  },
  async () => {
    let openedBy = 'open()';
    try {
      await open(PAGE_URL);
    } catch (err) {
      // macOS 无 GUI / 沙箱环境常见, 不阻断流程, 走等待分支
      openedBy = `open() 失败: ${err.message}；请手动打开 ${PAGE_URL}`;
      log(openedBy);
    }
    try {
      await waitForPage(OPEN_TIMEOUT_MS);
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
            `页面已打开并连接成功: ${PAGE_URL}\n` +
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
    description: '把一段 JavaScript 代码推送到页面左侧 Monaco 编辑器（不执行）。代码可使用 viewer 与 Cesium 变量。',
    inputSchema: {
      code: z.string().min(1).describe('要执行的 JavaScript 源码'),
    },
  },
  async ({ code }) => {
    if (typeof code !== 'string' || !code.length) {
      return { isError: true, content: [{ type: 'text', text: '参数 code 必须是非空字符串' }] };
    }
    try {
      sendToPage({ type: 'setCode', code });
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: err.message }] };
    }
    return { content: [{ type: 'text', text: `已推送 ${code.length} 字符到编辑器。调用 run_code 执行。` }] };
  },
);

mcp.registerTool(
  'run_code',
  {
    title: '执行编辑器中的代码',
    description: '通知页面执行当前 Monaco 编辑器中的代码（new Function("viewer","Cesium", code)）。',
    inputSchema: {},
  },
  async () => {
    try {
      sendToPage({ type: 'runCode' });
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: err.message }] };
    }
    return { content: [{ type: 'text', text: '已下发执行指令，结果见页面控制台 / 回执日志。' }] };
  },
);

mcp.registerTool(
  'get_status',
  {
    title: '查询页面连接状态',
    description: '返回页面 WebSocket 是否已连接。',
    inputSchema: {},
  },
  async () => {
    const connected = !!pageSocket && pageSocket.readyState === pageSocket.OPEN;
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            pageConnected: connected,
            http: PAGE_URL,
            websocket: `ws://${WS_HOST}:${WS_PORT}`,
          }),
        },
      ],
    };
  },
);

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
