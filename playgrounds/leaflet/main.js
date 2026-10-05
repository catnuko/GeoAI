// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 catnuko <https://github.com/catnuko>
/* geoai :: playgrounds/leaflet/main.js  （Leaflet 试炼场页面入口，Vite 构建）
 * 页面侧：
 *   - 初始化 Leaflet 地图（OSM 免 key 底图）
 *   - 初始化 Monaco Editor（初始示例代码）
 *   - 连接 MCP Server 的 WebSocket（地址读 /config.json；连接时上报 playground=leaflet），
 *     接收 setCode / runCode
 *
 * Leaflet / Monaco 由本目录 index.html 用 CDN <script> 加载（不打包），
 * 因此这里读 window.L / window.require。执行上下文暴露 map、L 两个变量（无 kit——能力库目前仅 cesium 域）。
 */
import './style.css';

(function () {
  'use strict';

  // ---------------------------------------------------------------- 配置
  /** WS 地址：优先读 server.js 下发的 /config.json（支持 GEOAI_WS_PORT 换端口）；
   *  dev:web（Vite 无该端点）或读取失败时退回默认端口。 */
  const DEFAULT_WS_URL = 'ws://127.0.0.1:3001';
  async function resolveConfig() {
    try {
      const res = await fetch('/config.json', { cache: 'no-store' });
      if (res.ok) return await res.json();
    } catch {
      // 静默回退默认地址
    }
    return { wsUrl: DEFAULT_WS_URL };
  }

  const INITIAL_CODE = [
    '// 由 MCP send_code 推送的代码会覆盖这里',
    '// 可用变量: map (L.Map 实例), L (Leaflet 全局)',
    '// 免 key 底图为 OSM；业务底图（天地图/高德）的坐标系与行号方案坑见 search_experience(lib=geo)。',
    'L.marker([31.2304, 121.4737]).addTo(map).bindPopup("上海人民广场").openPopup();',
    'L.circle([31.2304, 121.4737], { radius: 1000, color: "#2563eb" }).addTo(map);',
    'map.flyTo([31.2304, 121.4737], 13);',
    "return 'leaflet-ready';",
  ].join('\n');

  // ---------------------------------------------------------------- DOM
  const wsStatusEl = document.getElementById('wsStatus');
  const logPane = document.getElementById('logPane');
  const runResultEl = document.getElementById('runResult');
  const runBtn = document.getElementById('runBtn');

  function log(msg, kind) {
    const line = document.createElement('div');
    if (kind) line.className = kind === 'err' ? 'l-err' : 'l-ok';
    line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    logPane.appendChild(line);
    logPane.scrollTop = logPane.scrollHeight;
  }

  function setRunResult(text, kind) {
    runResultEl.textContent = text;
    runResultEl.className = 'run-result' + (kind ? ' ' + kind : '');
  }

  // ---------------------------------------------------------------- Leaflet
  let map;
  function initLeaflet() {
    if (typeof window.L === 'undefined') {
      throw new Error('Leaflet 未加载成功。请检查网络能否访问 cdn.jsdelivr.net；Leaflet 必须在 monaco loader.js 之前加载。');
    }
    // OSM 免 key 底图（XYZ 行号方案，北在上）
    map = L.map('mapContainer', { zoomControl: true }).setView([31.2304, 121.4737], 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);
    window.map = map; // 便于控制台手动调试
  }

  // ---------------------------------------------------------------- Monaco
  let editor;
  function initMonaco() {
    return new Promise((resolve, reject) => {
      // ESM 模块作用域没有 require / monaco 标识符，必须从 window 取
      const amdRequire = window.require;
      if (typeof amdRequire !== 'function') {
        return reject(new Error('Monaco AMD loader 未加载（检查 index.html 中的 loader.js）'));
      }
      amdRequire(['vs/editor/editor.main'], () => {
        const monacoNs = window.monaco;
        if (!monacoNs) return reject(new Error('monaco 命名空间未就绪'));
        editor = monacoNs.editor.create(document.getElementById('editor'), {
          value: INITIAL_CODE,
          language: 'javascript',
          theme: 'vs',
          automaticLayout: true,
          minimap: { enabled: false },
          fontSize: 13,
          scrollBeyondLastLine: false,
        });
        window.editor = editor;
        resolve();
      });
    });
  }

  // ---------------------------------------------------------------- 执行
  function runCode(requestId) {
    const code = editor.getValue();
    setRunResult('执行中…');
    const reply = (type, payload) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type, payload, id: requestId ?? null }));
      }
    };
    try {
      // 验证用途：直接执行用户代码，无沙箱。AsyncFunction 包装支持顶层 await。
      const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
      const fn = new AsyncFunction('map', 'L', code);
      const ret = fn(map, window.L);

      Promise.resolve(ret).then(
        (val) => {
          const desc = val === undefined ? 'undefined' : JSON.stringify(val);
          setRunResult('✅ 执行成功，返回：' + desc, 'ok');
          log('执行成功，返回 ' + desc, 'ok');
          reply('result', String(desc));
        },
        (err) => {
          const msg = err && err.message ? err.message : String(err);
          setRunResult('❌ 执行失败：' + msg, 'err');
          log('执行失败: ' + msg, 'err');
          reply('error', msg);
        },
      );
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      setRunResult('❌ 运行错误：' + msg, 'err');
      log('运行错误: ' + msg, 'err');
      reply('error', msg);
    }
  }

  // ---------------------------------------------------------------- WebSocket
  let ws = null;
  async function connectWS() {
    // 页面 URL 的 ?token= / ?session= 透传给 WS；?playground= 固定上报本页归属（server 用于经验归属域）
    const pageParams = new URLSearchParams(location.search);
    const extra = new URLSearchParams();
    const token = pageParams.get('token');
    if (token) extra.set('token', token);
    extra.set('session', pageParams.get('session') || 'default');
    extra.set('playground', 'leaflet');
    const cfg = await resolveConfig();
    const wsUrl = cfg.wsUrl || DEFAULT_WS_URL;
    const fullUrl = `${wsUrl}${wsUrl.includes('?') ? '&' : '?'}${extra.toString()}`;
    ws = new WebSocket(fullUrl);

    ws.onopen = () => {
      wsStatusEl.textContent = 'WebSocket: 已连接';
      wsStatusEl.className = 'badge badge-on';
      log('WebSocket 已连接到 ' + fullUrl, 'ok');
    };

    ws.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.type === 'hello') {
        log('服务端消息: ' + msg.message);
      } else if (msg.type === 'setCode') {
        editor.setValue(msg.code);
        setRunResult('代码已更新（来自 send_code），等待 run_code');
        log('收到 setCode，编辑器内容已更新（' + msg.code.length + ' 字符）');
      } else if (msg.type === 'runCode') {
        runCode(msg.id);
      }
    };

    ws.onclose = (ev) => {
      wsStatusEl.textContent = 'WebSocket: 已断开';
      wsStatusEl.className = 'badge badge-off';
      log(
        ev.code === 4001
          ? 'WebSocket 被拒绝: token 校验失败（服务端要求 GEOAI_WS_TOKEN，请从带 ?token= 的入口打开本页）'
          : 'WebSocket 已断开（刷新页面恢复，server.js 是否在运行？）',
        'err',
      );
    };

    ws.onerror = () => {
      wsStatusEl.textContent = 'WebSocket: 错误';
      wsStatusEl.className = 'badge badge-off';
      log('WebSocket 错误（server.js 是否在运行？）', 'err');
    };
  }

  // ---------------------------------------------------------------- 启动
  runBtn.addEventListener('click', () => runCode(null));

  try {
    initLeaflet();
  } catch (e) {
    log('Leaflet 初始化失败: ' + e.message, 'err');
    setRunResult('❌ Leaflet 初始化失败：' + e.message, 'err');
  }

  initMonaco()
    .then(() => {
      log('Leaflet + Monaco 初始化完成');
      connectWS();
    })
    .catch((e) => {
      log('Monaco 初始化失败: ' + e.message, 'err');
      setRunResult('❌ Monaco 初始化失败：' + e.message, 'err');
    });
})();
