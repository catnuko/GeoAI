// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 catnuko <https://github.com/catnuko>
/* geoai :: playgrounds/amap/main.js  （高德 JSAPI 试炼场页面入口，Vite 构建）
 * 页面侧：
 *   - 通过官方 JSAPI Loader 动态加载高德 JSAPI 2.0（key 来自 /config.json 的 keys.amap，
 *     即 server.js 环境变量 GEOAI_AMAP_KEY / GEOAI_AMAP_SECURITY；
 *     未配置时 map=null 并挂 createMap(key, securityJsCode) 供代码内创建）
 *   - 初始化 Monaco Editor（初始示例代码）
 *   - 连接 MCP Server 的 WebSocket（地址读 /config.json；连接时上报 playground=amap）
 *
 * 执行上下文暴露 map、AMap 两个变量（无 kit——能力库目前仅 cesium 域）。
 * 注意: 高德一切坐标为 GCJ-02，与 WGS84 数据混叠需纠偏（经验库 lib=geo 检索）。
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
    '// 可用变量: map (AMap.Map 实例, 未配置 key 时为 null), AMap (JSAPI 全局, 加载后才可用)',
    '// 未配置 key 时先执行: map = await createMap("你的key"); 再继续其他操作。',
    '// 坐标为 GCJ-02（火星坐标）, GPS/GeoJSON(WGS84) 数据要纠偏, 见 search_experience(lib=geo)。',
    'const marker = new AMap.Marker({ position: [121.4737, 31.2304], title: "上海人民广场" });',
    'map.add(marker);',
    'map.setZoomAndCenter(13, [121.4737, 31.2304]);',
    "return 'amap-ready';",
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

  // ---------------------------------------------------------------- 高德 JSAPI
  let map = null;
  let AMapNS = null; // AMapLoader.load resolve 出的命名空间

  /** 代码内手动建图（未配置 GEOAI_AMAP_KEY 时用）：创建后记得赋回 map */
  window.createMap = function createMap(key, securityJsCode) {
    if (typeof window.AMapLoader === 'undefined') {
      return Promise.reject(new Error('AMapLoader 未加载（检查 index.html 中的 loader.js 与网络）'));
    }
    if (securityJsCode) {
      // 安全密钥必须在 AMapLoader.load 之前挂到 window（官方要求）
      window._AMapSecurityConfig = { securityJsCode };
    }
    return window.AMapLoader.load({
      key,
      version: '2.0',
      plugins: ['AMap.Scale', 'AMap.ToolBar'],
    }).then((AMap) => {
      AMapNS = AMap;
      window.AMap = AMap;
      map = new AMap.Map('mapContainer', {
        viewMode: '2D',
        zoom: 12,
        center: [121.4737, 31.2304],
      });
      window.map = map;
      return map;
    });
  };

  function initAmap(key, securityJsCode) {
    if (typeof window.AMapLoader === 'undefined') {
      throw new Error('AMapLoader 未加载成功。请检查网络能否访问 webapi.amap.com；loader.js 必须在 monaco loader.js 之前加载。');
    }
    if (!key) {
      banner('未配置高德 key：map 为 null。\n在 server 环境设 GEOAI_AMAP_KEY（可选 GEOAI_AMAP_SECURITY），或在代码里 map = await createMap(key)');
      log('未配置 GEOAI_AMAP_KEY：不自动建图，执行上下文 map=null（createMap 可用）', 'err');
      return Promise.resolve();
    }
    return window.createMap(key, securityJsCode).then(
      () => log('底图：高德 JSAPI 2.0（GCJ-02 坐标系）'),
      (err) => log('高德建图失败: ' + (err && err.message ? err.message : err), 'err'),
    );
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
      // AMap 传加载后的命名空间（未加载时 undefined，代码里应先 createMap）
      const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
      const fn = new AsyncFunction('map', 'AMap', code);
      const ret = fn(map, AMapNS);

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
    extra.set('playground', 'amap');
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
      const keys = cfg?.keys ?? {};
      return initAmap(keys.amap || '', keys.amapSecurity || '').then(() => initMonaco());
    })
    .then(() => {
      log('高德 + Monaco 初始化完成');
      connectWS();
    })
    .catch((e) => {
      log('初始化失败: ' + e.message, 'err');
      setRunResult('❌ 初始化失败：' + e.message, 'err');
    });
})();
