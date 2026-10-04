/* geoai :: src/main.js  （Vite 入口）
 * 页面侧：
 *   - 初始化 Cesium Viewer（合规影像源，未配置 key 时退化为无影像地球）
 *   - 初始化 Monaco Editor（初始示例代码）
 *   - 连接 MCP Server 的 WebSocket（地址优先读 /config.json），接收 setCode / runCode
 *
 * Cesium / Monaco 仍由 index.html 用 CDN <script> 加载（不打包），
 * 因此这里读 window.Cesium / window.monaco / window.require。
 */
import './style.css';

(function () {
  'use strict';

  // ---------------------------------------------------------------- 配置
  /** WS 地址：优先读 server.js 下发的 /config.json（支持 GEOAI_WS_PORT 换端口）；
   *  dev:web（Vite 无该端点）或读取失败时退回默认端口。 */
  const DEFAULT_WS_URL = 'ws://127.0.0.1:3001';
  async function resolveWsUrl() {
    try {
      const res = await fetch('config.json', { cache: 'no-store' });
      if (res.ok) {
        const cfg = await res.json();
        if (cfg && typeof cfg.wsUrl === 'string' && cfg.wsUrl) return cfg.wsUrl;
      }
    } catch {
      // 静默回退默认地址
    }
    return DEFAULT_WS_URL;
  }

  /** 天地图（合规影像源）token。未申请请保持占位符字符串，此时地球以纯色 + 经纬网渲染。
   *  申请入口：天地图官网 http://lbs.tianditu.gov.cn/ → 控制台 → 创建新应用 → 服务接口 → 申请 Key */
  const TIANDITU_TK = 'key="Please apply for your own key at the Tianditu Platform and replace this placeholder"';

  const INITIAL_CODE = [
    '// 由 MCP send_code 推送的代码会覆盖这里',
    '// 可用变量: viewer (Cesium Viewer), Cesium (CesiumJS 全局)',
    'viewer.camera.flyTo({',
    '  destination: Cesium.Cartesian3.fromDegrees(121.4737, 31.2304, 8000000),',
    '  duration: 2.0',
    '});',
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

  // ---------------------------------------------------------------- Cesium
  let viewer;
  function initCesium() {
    if (typeof window.Cesium === 'undefined') {
      throw new Error(
        'CesiumJS 未加载成功。请检查网络能否访问 cdn.jsdelivr.net；' +
          '注意 Cesium.js 必须在 monaco loader.js 之前加载（Cesium 内含 UMD 模块，会与 AMD define 冲突）。',
      );
    }
    const hasTiandituKey = TIANDITU_TK && !TIANDITU_TK.startsWith('key="Please apply');

    const options = {
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      animation: false,
      timeline: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
      baseLayer: false,
    };

    viewer = new Cesium.Viewer('cesiumContainer', options);

    if (hasTiandituKey) {
      // 天地图影像（Web Mercator WMTS，CGCS2000/WGS84 近似一致）
      viewer.imageryLayers.addImageryProvider(
        new Cesium.UrlTemplateImageryProvider({
          url:
            'https://t{s}.tianditu.gov.cn/img_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0' +
            '&LAYER=img&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles' +
            '&TILEMATRIX={TileMatrix}&TILEROW={TileRow}&TILECOL={TileCol}&tk=' + TIANDITU_TK,
          subdomains: ['0', '1', '2', '3', '4', '5', '6', '7'],
          maximumLevel: 18,
        }),
      );
      log('底图：天地图影像');
    } else {
      // 未配置合规影像 key：仍渲染完整地球几何 + 经纬网 + 大气，桥接链路可正常验证
      viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#2b3a55');
      viewer.scene.globe.showGraticule = true;
      viewer.scene.skyAtmosphere.show = true;
      log('未配置天地图 key：以纯色地球 + 经纬网渲染（不影响 MCP 桥接验证）', 'err');
    }

    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(121.4737, 31.2304, 18000000),
    });
    window.viewer = viewer; // 便于控制台手动调试
  }

  // ---------------------------------------------------------------- Monaco
  let editor;
  function initMonaco() {
    return new Promise((resolve, reject) => {
      // ESM 模块作用域没有 require / monaco 标识符，必须从 window 取
      // （它们由 index.html 里的 Monaco AMD loader 注入）
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
    // 带上请求 id 回传结果, server 据此把返回值/报错交还 MCP 客户端（模型据此自我修正）
    const reply = (type, payload) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type, payload, id: requestId ?? null }));
      }
    };
    try {
      // 验证用途：直接执行用户代码，无沙箱。生产环境必须替换为 iframe/worker 沙箱。
      // 用 AsyncFunction 包装: 支持代码顶层 await（ArcGIS/影像/地形 provider 的 fromUrl 都是异步工厂）。
      // async 函数体内的同步 throw 会变成 Promise 拒绝, 统一走下方 error 回执, 不影响 UX。
      const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
      const fn = new AsyncFunction('viewer', 'Cesium', code);
      const ret = fn(viewer, Cesium);

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
    // 页面 URL 的 ?token= / ?session= 透传给 WS：token 用于服务端鉴权，session 用于多会话路由
    const pageParams = new URLSearchParams(location.search);
    const extra = new URLSearchParams();
    const token = pageParams.get('token');
    if (token) extra.set('token', token);
    extra.set('session', pageParams.get('session') || 'default');
    const wsUrl = await resolveWsUrl();
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
          : 'WebSocket 已断开',
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
  runBtn.addEventListener('click', runCode);

  // Cesium 必须在 Monaco 之前就绪；任一初始化失败都把原因显示到页面，不静默失败
  try {
    initCesium();
  } catch (e) {
    log('Cesium 初始化失败: ' + e.message, 'err');
    setRunResult('❌ Cesium 初始化失败：' + e.message, 'err');
  }

  initMonaco()
    .then(() => {
      log('Cesium + Monaco 初始化完成');
      connectWS();
    })
    .catch((e) => {
      log('Monaco 初始化失败: ' + e.message, 'err');
      setRunResult('❌ Monaco 初始化失败：' + e.message, 'err');
    });
})();
