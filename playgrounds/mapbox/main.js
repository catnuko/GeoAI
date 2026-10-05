// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 catnuko <https://github.com/catnuko>
/* geoai :: playgrounds/mapbox/main.js  （Mapbox GL JS 试炼场页面入口，Vite 构建）
 * 页面侧：
 *   - 初始化 Mapbox GL 地图（token 来自 /config.json 的 keys.mapbox，
 *     即 server.js 环境变量 GEOAI_MAPBOX_TOKEN；未配置时 map=null 并挂 createMap(token) 供代码内创建）
 *   - 初始化 Monaco Editor（初始示例代码）
 *   - 连接 MCP Server 的 WebSocket（地址读 /config.json；连接时上报 playground=mapbox）
 *
 * 执行上下文暴露 map、mapboxgl 两个变量（无 kit——能力库目前仅 cesium 域）。
 */
import './style.css';

(function () {
  'use strict';

  // ---------------------------------------------------------------- 配置
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
    '// 可用变量: map (mapboxgl.Map 实例, 未配置 token 时为 null), mapboxgl (全局)',
    '// 未配置 token 时先执行: map = createMap("你的 token"); 再继续其他操作。',
    "map.flyTo({ center: [121.4737, 31.2304], zoom: 12, essential: true });",
    "return 'mapbox-ready';",
  ].join('\n');

  // ---------------------------------------------------------------- DOM
  const wsStatusEl = document.getElementById('wsStatus');
  const logPane = document.getElementById('logPane');
  const runResultEl = document.getElementById('runResult');
  const runBtn = document.getElementById('runBtn');
  const mapContainer = document.getElementById('mapContainer');

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

  function banner(text) {
    const el = document.createElement('div');
    el.className = 'map-banner';
    el.textContent = text;
    mapContainer.style.position = 'relative';
    mapContainer.appendChild(el);
  }

  // ---------------------------------------------------------------- Mapbox GL
  let map = null;
  /** 代码内手动建图（未配置 GEOAI_MAPBOX_TOKEN 时用）：创建后记得赋回 map（window.map 会同步） */
  window.createMap = function createMap(token, center = [121.4737, 31.2304], zoom = 12) {
    mapboxgl.accessToken = token;
    map = new mapboxgl.Map({
      container: 'mapContainer',
      style: 'mapbox://styles/mapbox/streets-v12',
      center,
      zoom,
    });
    window.map = map;
    return map;
  };

  function initMapbox(token) {
    if (typeof window.mapboxgl === 'undefined') {
      throw new Error('mapboxgl 未加载成功。请检查网络能否访问 cdn.jsdelivr.net；mapbox-gl.js 必须在 monaco loader.js 之前加载。');
    }
    if (!token) {
      banner('未配置 Mapbox token：map 为 null。\n在 server 环境设 GEOAI_MAPBOX_TOKEN，或在代码里 map = createMap(token)');
      log('未配置 GEOAI_MAPBOX_TOKEN：不自动建图，执行上下文 map=null（createMap 可用）', 'err');
      return;
    }
    window.createMap(token);
    log('底图：Mapbox streets-v12');
  }

  // ---------------------------------------------------------------- Monaco
  let editor;
  function initMonaco() {
    return new Promise((resolve, reject) => {
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
      // 注意: map 是闭包变量，代码内 `map = createMap(...)` 改的是 fn 入参的局部值；
      // 下发代码里直接读 window.map 或先 `map = createMap(token)` 同名遮蔽即可（示例代码已按此写法）。
      const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
      const fn = new AsyncFunction('map', 'mapboxgl', code);
      const ret = fn(map, window.mapboxgl);

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
    const pageParams = new URLSearchParams(location.search);
    const extra = new URLSearchParams();
    const token = pageParams.get('token');
    if (token) extra.set('token', token);
    extra.set('session', pageParams.get('session') || 'default');
    extra.set('playground', 'mapbox');
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

  // 先取配置（决定是否自动建图），再初始化 Monaco，最后连 WS；任一步失败都不静默
  resolveConfig()
    .then((cfg) => {
      try {
        initMapbox(cfg?.keys?.mapbox || '');
      } catch (e) {
        log('Mapbox 初始化失败: ' + e.message, 'err');
        setRunResult('❌ Mapbox 初始化失败：' + e.message, 'err');
      }
      return initMonaco();
    })
    .then(() => {
      log('Mapbox + Monaco 初始化完成');
      connectWS();
    })
    .catch((e) => {
      log('初始化失败: ' + e.message, 'err');
      setRunResult('❌ 初始化失败：' + e.message, 'err');
    });
})();
