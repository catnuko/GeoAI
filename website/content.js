/* GeoAI 官网内容（中 / 英）
   纯数据文件，供 app.js 渲染。新增文案只需在此补齐两种语言。 */

window.GEOAI_CONTENT = {
  zh: {
    meta: { title: 'GeoAI — GIS 经验注入中间件' },
    nav: {
      brand: 'GeoAI',
      version: 'v0.6.0',
      links: [
        { href: '#features', label: '核心特性' },
        { href: '#architecture', label: '架构' },
        { href: '#quickstart', label: '快速开始' },
        { href: '#kits', label: '能力库' },
        { href: '#cases', label: '场景' },
      ],
      cta: '接入 MCP',
      langLabel: 'EN',
      themeTitle: '切换深浅主题',
    },

    hero: {
      pill: 'GIS 经验注入中间件 · 接入即获得经验',
      titleA: '把经验丰富的 GIS 专家',
      titleB: '封装成一个 MCP 服务器',
      desc: [
        { t: 'GeoAI 是一个 GIS 经验注入中间件。' },
        { t: '你的 harness 接入它之后，写 GIS 代码不再从零摸索', hl: true },
        { t: '——写之前查真实踩坑，写的时候优先调现成能力，写完之后下发到真实 Cesium 地球验证。接入即获得经验，不改变你现有的工作流。' },
      ],
      actions: [
        { label: '快速开始', href: '#quickstart', primary: true },
        { label: '查看能力库', href: '#kits' },
      ],
      stats: [
        { num: '20', lbl: '条已验证经验' },
        { num: '6', lbl: '个现成能力库' },
        { num: '3+1', lbl: '三层能力 · 一个飞轮' },
        { num: '10', lbl: '个 MCP 工具' },
      ],
    },

    pain: {
      eyebrow: 'WHY GEOAI',
      title: 'GIS 代码，不该每次',
      titleHl: '从零摸索',
      desc: '模型不缺通用编程能力，缺的是「这个领域真实踩过的坑」。GeoAI 把经验前置到写代码之前，把验证放到真实地球之上。',
      items: [
        { head: '从零摸索', desc: '每写一个 GIS 功能都要翻文档、试参数，坑要自己重新踩一遍。', kind: 'pain' },
        { head: '经验不沉淀', desc: '这次修好的问题，换个会话、换个人又要重来，经验留在人脑里。', kind: 'pain' },
        { head: '只对纸面不对真实', desc: '生成的代码没人执行，参数写错、API 用错也无从暴露。', kind: 'pain' },
        { head: '接入即专家', desc: '20 条真实踩坑经验随包分发，冷启动就带着经验写代码。', kind: 'solve' },
        { head: '经验自动生长', desc: '失败自动落草稿、成功固化为 verified、同名去重累加，越用越准。', kind: 'solve' },
        { head: '真地球上验证', desc: '代码下发到真实 Cesium 执行并回执，跑通才算数。', kind: 'solve' },
      ],
    },

    features: {
      eyebrow: 'CAPABILITIES',
      title: '三层能力',
      titleHl: ' + 一个飞轮',
      desc: '经验层告诉你「会踩什么坑」，能力层告诉你「该调什么」，执行层让代码在真实地球上跑起来。',
      items: [
        {
          icon: 'experience',
          title: '经验层',
          desc: 'search_experience / get_experience / save_experience。20 条实测验证经验按意图组织，支持场景词、API 名、报错签名检索。',
          tag: 'EXPERIENCE',
        },
        {
          icon: 'kit',
          title: '能力层',
          desc: 'list_libs / get_lib_doc / send_snippet。kit.* 现成能力封装，相机锁定、后台动画、加载顺序等常见坑已在库里修掉。',
          tag: 'KITS',
        },
        {
          icon: 'runtime',
          title: '执行层',
          desc: 'open_page / send_code / run_code。浏览器里的真实 Cesium 地球 + Monaco 编辑器，WebSocket 执行并返回结果。',
          tag: 'RUNTIME',
        },
        {
          icon: 'bridge',
          title: '两层互导',
          desc: '经验命中时提示「⚡ 已封装为库 kit.xxx」，模型拿到坑位修法的同时知道该调哪个库，两层不会各说各话。',
          tag: 'BRIDGE',
        },
        {
          icon: 'share',
          title: '双通道分发',
          desc: 'MCP 之外，还可把经验热集导出为 SKILL.md；不方便挂 MCP 的 harness 也能用上经验与能力清单。',
          tag: 'SKILL',
        },
        {
          icon: 'plug',
          title: '零改造接入',
          desc: '一行 MCP 配置，npx 即用。不改你的 harness、不接 LLM、不引入新工作流，装完就有 dist。',
          tag: 'DX',
        },
      ],
    },

    flywheel: {
      eyebrow: 'FLYWHEEL',
      title: '经验不是文档，',
      titleHl: '是一个飞轮',
      desc: '每一次检索、执行、成功与失败都会回流到经验库——用得越多，它越准。',
      steps: [
        { title: '检索经验', desc: '写代码前先 search_experience，拿到真实踩坑的修法。' },
        { title: '带着经验写', desc: '优先调用 kit.*，常见坑位已在库里修掉。' },
        { title: '真实环境验证', desc: '代码下发到浏览器里的 Cesium 地球执行并回执。' },
        { title: '回流沉淀', desc: '失败落草稿、成功固化 verified，同名去重累加计数。' },
      ],
      loop: '↻ 检索 → 编写 → 验证 → 固化，循环往复',
    },

    arch: {
      eyebrow: 'ARCHITECTURE',
      title: '从 harness 到',
      titleHl: '真实地球',
      desc: '一个三合一进程：MCP stdio + WebSocket + HTTP 静态服务，中间是经验与能力的注入层。',
      nodes: [
        { name: '你的 harness', sub: 'Claude Code · Cursor · ZCode · WorkBuddy …', accent: false },
        { name: 'geoai MCP Server', sub: 'stdio (JSON-RPC) · 经验注入中间件', accent: true },
        { name: '经验层 · 能力层 · 执行层', sub: 'search_experience · kit.* · run_code', accent: false },
        { name: '真实 Cesium 地球', sub: 'Monaco 编辑器 + WebSocket 执行', accent: false },
      ],
      legend: ['▲ stdio (JSON-RPC)', '▼ WebSocket ws://127.0.0.1:3001'],
    },

    quickstart: {
      eyebrow: 'GET STARTED',
      title: '一分钟接入',
      titleHl: '，不改变工作流',
      desc: '在 MCP 客户端配置里加一条即可，首次调用自动下载并启动。',
      tabs: [
        {
          id: 'npx',
          label: 'npx 一行接入',
          file: 'mcp.json',
          lang: 'json',
          code: `{
  "mcpServers": {
    "geoai": {
      "command": "npx",
      "args": ["-y", "geoai-mcp"]
    }
  }
}`,
        },
        {
          id: 'src',
          label: '源码运行',
          file: 'terminal',
          lang: 'bash',
          code: `git clone https://github.com/catnuko/GeoAI.git && cd GeoAI
npm install        # prepare 钩子自动执行 vite build，装完即有 dist/
npm start          # MCP Server + HTTP(3000) + WebSocket(3001)`,
        },
      ],
      note: '启动后：HTTP http://127.0.0.1:3000 · WebSocket ws://127.0.0.1:3001。端口可用 GEOAI_HTTP_PORT / GEOAI_WS_PORT 覆盖。',
    },

    kits: {
      eyebrow: 'CAPABILITY LIBRARY',
      title: '现成能力，',
      titleHl: '坑已在库里修掉',
      desc: '经验库记的是「坑与用法」，能力库记的是「可直接调用的能力」。注入式契约：库从入参拿 Cesium，不 import，避免双实例。',
      items: [
        {
          icon: 'camera',
          id: 'kit.camera',
          title: '相机控制',
          status: 'ready',
          desc: '飞行取景、lookAt 跟随与解锁、等动画结束。封装相机最常见的三类坑。',
          sig: 'kit.camera.flyToRegion({west,south,east,north}, {duration})',
        },
        {
          icon: 'imagery',
          id: 'kit.imagery',
          title: '影像与地形',
          status: 'ready',
          desc: '免 key 的 ArcGIS 影像底图与 3D 地形高程采样、天地图影像。',
          sig: 'await kit.imagery.addArcGisImagery()',
        },
        {
          icon: 'geojson',
          id: 'kit.geojson',
          title: '行政边界数据',
          status: 'ready',
          desc: '阿里 DataV 免 key 中国区划：按 adcode 取任意省市区轮廓或含下级边界。',
          sig: 'await kit.geojson.loadAdmin(420100, { flyTo: true })',
        },
        {
          icon: 'drawer',
          id: 'kit.drawer',
          title: '鼠标绘图',
          status: 'ready',
          desc: '点线面圆矩形五种图形交互绘制，贴地拾取三分支，自动跟随预览与清理。',
          sig: "kit.drawer.start({ type: 'POLYGON', pick: 'terrain' })",
        },
        {
          icon: 'measure',
          id: 'kit.measure',
          title: '距离与面积量算',
          status: 'ready',
          desc: '两点距离、折线长度、多边形面积；贴地 / 平面双模式，返回纯 JSON。',
          sig: 'kit.measure.distance(from, to, "surface")',
        },
        {
          icon: 'overlay',
          id: 'kit.overlay',
          title: '弹窗与悬浮提示',
          status: 'ready',
          desc: 'HTML 元素跟随经纬度或屏幕坐标，随相机重定位，转到地球背面自动隐藏。',
          sig: 'kit.overlay.popup({ lon, lat, content })',
        },
        {
          icon: 'terrain',
          id: 'kit.terrain',
          title: '地形分析',
          status: 'planned',
          desc: '地形剖面、通视分析、等值线。规划中，尚未实现。',
          sig: '(规划中)',
        },
      ],
    },

    tools: {
      eyebrow: 'MCP TOOLS',
      title: '十个工具，',
      titleHl: '覆盖完整闭环',
      desc: '从查经验、列能力，到下发代码、真机执行、固化经验，全部走标准 MCP 工具。',
      items: [
        { name: 'search_experience', desc: '检索经验库（坑位修法 / 已验证代码 / 用法要点）' },
        { name: 'get_experience', desc: '读取单条经验全文（含已验证代码）' },
        { name: 'save_experience', desc: '固化经验，同名去重并累加成功次数' },
        { name: 'list_libs', desc: '列出能力库（kit），带 query 时按场景 / API 过滤' },
        { name: 'get_lib_doc', desc: '读取某个 kit 的用法、签名与可运行示例' },
        { name: 'send_snippet', desc: '把 kit 示例代码推送到编辑器（不执行）' },
        { name: 'send_code', desc: '把 JS 推送到目标页面的 Monaco 编辑器' },
        { name: 'run_code', desc: '执行编辑器代码并等待回执，失败自动落经验草稿' },
        { name: 'open_page', desc: '打开页面并等待 WebSocket 连入' },
        { name: 'get_status', desc: '返回连接状态、会话与端口信息' },
      ],
    },

    cases: {
      eyebrow: 'USE CASES',
      title: '它适合',
      titleHl: '这些场景',
      desc: '无论是自己写 GIS 代码，还是给团队的 harness 扩一项能力，接入即用。',
      items: [
        { icon: 'globe', title: '三维可视化开发', desc: '相机飞行、影像地形、行政边界，边写边在真实地球上验证，不再盲写。' },
        { icon: 'book', title: 'GIS 经验沉淀', desc: '把团队踩过的坑固化成可检索、可分发、可生长的经验库，随仓库提交即分发。' },
        { icon: 'plug', title: 'Harness 能力扩展', desc: '给 Claude Code / Cursor / ZCode / WorkBuddy 加一个随叫随到的 GIS 专家。' },
        { icon: 'share', title: 'Skill 热集导出', desc: '不方便挂 MCP 的 harness，导出 SKILL.md 也能用上经验与能力清单。' },
      ],
    },

    roadmap: {
      eyebrow: 'ROADMAP',
      title: '正在',
      titleHl: '生长',
      desc: '围绕「经验注入中间件」的定位，按优先级推进。',
      items: [
        { ver: 'v0.6', title: '当前版本', desc: '经验库 20 条 + 6 个能力库 + 三合一进程（MCP / HTTP / WS）+ SKILL 导出。' },
        { ver: 'NEXT', title: '经验领域扩展', desc: '从 Cesium 三维扩展到坐标系统与投影、矢量瓦片、OGC 服务、空间分析、数据格式转换。' },
        { ver: 'NEXT', title: '能力库扩充', desc: '实体与图层管理、地形剖面、时间轴、量测绘制（cesium-extends 三件套以注入式重写）。' },
        { ver: 'PLAN', title: 'iframe 沙箱', desc: '把用户代码放进 sandbox iframe，allow-scripts + postMessage 返回结果，替换 new Function。' },
        { ver: 'PLAN', title: '语义检索 · 自动重连 · HTTP 传输', desc: '向量 / 语义检索、WebSocket 指数退避重连、Streamable HTTP 支持远程 MCP host。' },
      ],
    },

    cta: {
      titleA: '接入 ',
      titleHl: 'GeoAI',
      titleB: '，把 GIS 专家带进你的工作流',
      desc: '一行配置，冷启动即专家；每一次运行都让经验库更准一点。',
      primary: { label: '查看 GitHub', href: 'https://github.com/catnuko/GeoAI', external: true },
      ghost: { label: '回到快速开始', href: '#quickstart' },
    },

    footer: {
      tagline: 'GIS 经验注入中间件——把经验丰富的 GIS 专家封装成 MCP 服务器。经验库 + 能力库 + 真实 Cesium 执行验证。',
      cols: [
        {
          title: '产品',
          links: [
            { label: '核心特性', href: '#features' },
            { label: '渲染架构', href: '#architecture' },
            { label: '能力库', href: '#kits' },
          ],
        },
        {
          title: '开发',
          links: [
            { label: '快速开始', href: '#quickstart' },
            { label: 'MCP 工具', href: '#tools' },
            { label: '应用场景', href: '#cases' },
          ],
        },
        {
          title: '资源',
          links: [
            { label: 'GitHub', href: 'https://github.com/catnuko/GeoAI', external: true },
            { label: 'CesiumJS', href: 'https://cesium.com/cesiumjs/', external: true },
            { label: 'Model Context Protocol', href: 'https://modelcontextprotocol.io', external: true },
          ],
        },
        {
          title: '许可',
          links: [
            { label: 'AGPL-3.0-only', href: 'https://github.com/catnuko/GeoAI/blob/main/LICENSE', external: true },
            { label: '商业授权', href: 'https://github.com/catnuko/GeoAI/blob/main/COMMERCIAL-LICENSE.md', external: true },
            { label: '第三方许可', href: 'https://github.com/catnuko/GeoAI/blob/main/THIRD-PARTY-LICENSES.md', external: true },
          ],
        },
      ],
      bottomLeft: '© 2026 GeoAI · catnuko',
      bottomRight: 'AGPL-3.0-only',
      disclaimer:
        'GeoAI 仅限本地验证用途：页面执行 MCP 客户端下发的代码无沙箱，生产环境请替换为 iframe sandbox + postMessage 或 Web Worker + 独立 origin。',
    },
  },

  en: {
    meta: { title: 'GeoAI — GIS experience injection middleware' },
    nav: {
      brand: 'GeoAI',
      version: 'v0.6.0',
      links: [
        { href: '#features', label: 'Features' },
        { href: '#architecture', label: 'Architecture' },
        { href: '#quickstart', label: 'Quickstart' },
        { href: '#kits', label: 'Kits' },
        { href: '#cases', label: 'Use cases' },
      ],
      cta: 'Connect MCP',
      langLabel: '中',
      themeTitle: 'Toggle theme',
    },

    hero: {
      pill: 'GIS experience injection middleware · expertise on connect',
      titleA: 'Package a seasoned GIS expert',
      titleB: 'as an MCP server',
      desc: [
        { t: 'GeoAI is a GIS experience injection middleware. ' },
        { t: 'Once your harness connects, you never write GIS code from scratch', hl: true },
        { t: ' — look up real pitfalls before you write, call ready-made kits while you write, and run code on a real Cesium globe to verify. Expertise on connect, without changing your workflow.' },
      ],
      actions: [
        { label: 'Quickstart', href: '#quickstart', primary: true },
        { label: 'Browse kits', href: '#kits' },
      ],
      stats: [
        { num: '20', lbl: 'verified experiences' },
        { num: '6', lbl: 'ready-made kits' },
        { num: '3+1', lbl: 'layers · one flywheel' },
        { num: '10', lbl: 'MCP tools' },
      ],
    },

    pain: {
      eyebrow: 'WHY GEOAI',
      title: 'GIS code should not start',
      titleHl: 'from scratch every time',
      desc: 'Models are not short on general programming skill — they lack the real pitfalls of this domain. GeoAI puts experience before the code and verification on a real globe.',
      items: [
        { head: 'From scratch', desc: 'Every GIS feature means reading docs and guessing parameters — and hitting the same pitfalls again.', kind: 'pain' },
        { head: 'Experience never sticks', desc: 'A fix solved today is lost in the next session or the next person. Knowledge stays in someone’s head.', kind: 'pain' },
        { head: 'Paper-correct, not real', desc: 'Generated code is never executed, so wrong parameters and wrong APIs never surface.', kind: 'pain' },
        { head: 'Expert on connect', desc: '20 real, verified experiences ship with the package — you start writing with experience.', kind: 'solve' },
        { head: 'Experience grows itself', desc: 'Failures become drafts, successes become verified, duplicates merge and count up — sharper every run.', kind: 'solve' },
        { head: 'Verified on a real globe', desc: 'Code is sent down to a real Cesium globe and acknowledged back. Only what runs counts.', kind: 'solve' },
      ],
    },

    features: {
      eyebrow: 'CAPABILITIES',
      title: 'Three layers',
      titleHl: ' + one flywheel',
      desc: 'The experience layer tells you what pitfalls to avoid, the kit layer tells you what to call, and the runtime layer runs it on a real globe.',
      items: [
        {
          icon: 'experience',
          title: 'Experience layer',
          desc: 'search_experience / get_experience / save_experience. 20 verified experiences organised by intent, searchable by scenario, API name, or error signature.',
          tag: 'EXPERIENCE',
        },
        {
          icon: 'kit',
          title: 'Capability layer',
          desc: 'list_libs / get_lib_doc / send_snippet. kit.* wrappers where common pitfalls — camera lock, background rAF, load order — are already fixed.',
          tag: 'KITS',
        },
        {
          icon: 'runtime',
          title: 'Runtime layer',
          desc: 'open_page / send_code / run_code. A real Cesium globe plus Monaco editor in the browser, executed over WebSocket with results returned.',
          tag: 'RUNTIME',
        },
        {
          icon: 'bridge',
          title: 'Two-way bridge',
          desc: 'When an experience hits, it says “⚡ packaged as kit.xxx” — the model gets the fix and knows which kit to call, so the layers never disagree.',
          tag: 'BRIDGE',
        },
        {
          icon: 'share',
          title: 'Dual-channel delivery',
          desc: 'Beyond MCP, the hot set of experiences can be exported as SKILL.md — harnesses that can’t host MCP still get the experiences and kit list.',
          tag: 'SKILL',
        },
        {
          icon: 'plug',
          title: 'Zero-refactor setup',
          desc: 'One line of MCP config, run via npx. No harness changes, no LLM inside, no new workflow — and dist/ is ready after install.',
          tag: 'DX',
        },
      ],
    },

    flywheel: {
      eyebrow: 'FLYWHEEL',
      title: 'Experience is not a doc —',
      titleHl: 'it is a flywheel',
      desc: 'Every search, run, success and failure flows back into the library. The more you use it, the sharper it gets.',
      steps: [
        { title: 'Search experience', desc: 'Call search_experience before writing to get real, battle-tested fixes.' },
        { title: 'Write with it', desc: 'Prefer kit.* — the common pitfalls are already fixed inside.' },
        { title: 'Verify for real', desc: 'Code is sent to the Cesium globe in the browser and acknowledged back.' },
        { title: 'Feed it back', desc: 'Failures become drafts, successes become verified, duplicates merge and count up.' },
      ],
      loop: '↻ search → write → verify → solidify, round and round',
    },

    arch: {
      eyebrow: 'ARCHITECTURE',
      title: 'From your harness to',
      titleHl: 'a real globe',
      desc: 'One three-in-one process: MCP stdio + WebSocket + HTTP static server, with the experience and capability injection layer in the middle.',
      nodes: [
        { name: 'Your harness', sub: 'Claude Code · Cursor · ZCode · WorkBuddy …', accent: false },
        { name: 'geoai MCP Server', sub: 'stdio (JSON-RPC) · experience injection middleware', accent: true },
        { name: 'Experience · Kits · Runtime', sub: 'search_experience · kit.* · run_code', accent: false },
        { name: 'Real Cesium globe', sub: 'Monaco editor + WebSocket execution', accent: false },
      ],
      legend: ['▲ stdio (JSON-RPC)', '▼ WebSocket ws://127.0.0.1:3001'],
    },

    quickstart: {
      eyebrow: 'GET STARTED',
      title: 'Connect in a minute',
      titleHl: ', without changing your workflow',
      desc: 'Add one entry to your MCP client config — the first call downloads and starts it automatically.',
      tabs: [
        {
          id: 'npx',
          label: 'One-line npx',
          file: 'mcp.json',
          lang: 'json',
          code: `{
  "mcpServers": {
    "geoai": {
      "command": "npx",
      "args": ["-y", "geoai-mcp"]
    }
  }
}`,
        },
        {
          id: 'src',
          label: 'Run from source',
          file: 'terminal',
          lang: 'bash',
          code: `git clone https://github.com/catnuko/GeoAI.git && cd GeoAI
npm install        # the prepare hook runs vite build; dist/ is ready after install
npm start          # MCP Server + HTTP(3000) + WebSocket(3001)`,
        },
      ],
      note: 'After start: HTTP http://127.0.0.1:3000 · WebSocket ws://127.0.0.1:3001. Override ports with GEOAI_HTTP_PORT / GEOAI_WS_PORT.',
    },

    kits: {
      eyebrow: 'CAPABILITY LIBRARY',
      title: 'Ready-made capability,',
      titleHl: 'pitfalls already fixed',
      desc: 'The experience library records pitfalls and usage; the kit library records callable capability. Injected contract: kits take Cesium from arguments, never import it, avoiding double instances.',
      items: [
        {
          icon: 'camera',
          id: 'kit.camera',
          title: 'Camera control',
          status: 'ready',
          desc: 'Flight framing, lookAt follow and unlock, waiting for animation end. Wraps the three most common camera pitfalls.',
          sig: 'kit.camera.flyToRegion({west,south,east,north}, {duration})',
        },
        {
          icon: 'imagery',
          id: 'kit.imagery',
          title: 'Imagery & terrain',
          status: 'ready',
          desc: 'Key-free ArcGIS imagery basemap, 3D terrain and elevation sampling, plus Tianditu imagery.',
          sig: 'await kit.imagery.addArcGisImagery()',
        },
        {
          icon: 'geojson',
          id: 'kit.geojson',
          title: 'Administrative boundaries',
          status: 'ready',
          desc: 'Aliyun DataV key-free China divisions: fetch any province/city/district outline or its children by adcode.',
          sig: 'await kit.geojson.loadAdmin(420100, { flyTo: true })',
        },
        {
          icon: 'drawer',
          id: 'kit.drawer',
          title: 'Mouse drawing',
          status: 'ready',
          desc: 'Point, line, polygon, circle and rectangle drawn by mouse, with terrain-aware picking and live preview cleanup.',
          sig: "kit.drawer.start({ type: 'POLYGON', pick: 'terrain' })",
        },
        {
          icon: 'measure',
          id: 'kit.measure',
          title: 'Distance & area',
          status: 'ready',
          desc: 'Two-point distance, polyline length, polygon area; surface / plane modes, returning pure JSON.',
          sig: 'kit.measure.distance(from, to, "surface")',
        },
        {
          icon: 'overlay',
          id: 'kit.overlay',
          title: 'Popup & tooltip',
          status: 'ready',
          desc: 'HTML elements follow lon/lat or screen coordinates, reposition with the camera, and hide behind the globe.',
          sig: 'kit.overlay.popup({ lon, lat, content })',
        },
        {
          icon: 'terrain',
          id: 'kit.terrain',
          title: 'Terrain analysis',
          status: 'planned',
          desc: 'Terrain profile, line-of-sight, contour lines. Planned, not yet implemented.',
          sig: '(planned)',
        },
      ],
    },

    tools: {
      eyebrow: 'MCP TOOLS',
      title: 'Ten tools covering',
      titleHl: 'the whole loop',
      desc: 'From searching experience and listing kits, to sending code, running it for real and solidifying experience — all through standard MCP tools.',
      items: [
        { name: 'search_experience', desc: 'Search the experience library (fixes / verified code / usage notes)' },
        { name: 'get_experience', desc: 'Read one experience in full, including verified code' },
        { name: 'save_experience', desc: 'Solidify an experience; duplicates merge and success count accumulates' },
        { name: 'list_libs', desc: 'List kits; with a query, filter by scenario / API' },
        { name: 'get_lib_doc', desc: 'Read a kit’s usage, signature and runnable example' },
        { name: 'send_snippet', desc: 'Push a kit’s example code to the editor (no execution)' },
        { name: 'send_code', desc: 'Push JS to the target page’s Monaco editor' },
        { name: 'run_code', desc: 'Execute the editor code and await the result; failures become drafts' },
        { name: 'open_page', desc: 'Open the page and wait for the WebSocket to connect' },
        { name: 'get_status', desc: 'Return connection status, sessions and ports' },
      ],
    },

    cases: {
      eyebrow: 'USE CASES',
      title: 'Where it fits',
      titleHl: 'best',
      desc: 'Whether you write GIS code yourself or extend your team’s harness, it works the moment you connect.',
      items: [
        { icon: 'globe', title: '3D visualisation dev', desc: 'Camera flights, imagery, terrain and boundaries — verified on a real globe as you write, no more blind coding.' },
        { icon: 'book', title: 'GIS knowledge capture', desc: 'Turn your team’s pitfalls into a searchable, distributable, growing library — committed with the repo.' },
        { icon: 'plug', title: 'Harness capability boost', desc: 'Give Claude Code / Cursor / ZCode / WorkBuddy an on-call GIS expert.' },
        { icon: 'share', title: 'Skill hot-set export', desc: 'For harnesses that can’t host MCP, export SKILL.md to still get the experiences and kit list.' },
      ],
    },

    roadmap: {
      eyebrow: 'ROADMAP',
      title: 'Still',
      titleHl: 'growing',
      desc: 'Aligned with the “experience injection middleware” positioning, in priority order.',
      items: [
        { ver: 'v0.6', title: 'Current', desc: '20 experiences + 6 kits + three-in-one process (MCP / HTTP / WS) + SKILL export.' },
        { ver: 'NEXT', title: 'Broader experience domains', desc: 'From Cesium 3D to coordinate systems and projections, vector tiles, OGC services, spatial analysis, format conversion.' },
        { ver: 'NEXT', title: 'More kits', desc: 'Entity and layer management, terrain profile, timeline, measurement and drawing (cesium-extends trio rewritten as injected kits).' },
        { ver: 'PLAN', title: 'iframe sandbox', desc: 'Run user code in a sandbox iframe with allow-scripts + postMessage, replacing new Function.' },
        { ver: 'PLAN', title: 'Semantic search · auto-reconnect · HTTP transport', desc: 'Vector / semantic retrieval, exponential-backoff WebSocket reconnect, Streamable HTTP for remote MCP hosts.' },
      ],
    },

    cta: {
      titleA: 'Connect ',
      titleHl: 'GeoAI',
      titleB: ' and bring a GIS expert into your workflow',
      desc: 'One line of config, expert from a cold start; every run makes the library a little sharper.',
      primary: { label: 'View on GitHub', href: 'https://github.com/catnuko/GeoAI', external: true },
      ghost: { label: 'Back to quickstart', href: '#quickstart' },
    },

    footer: {
      tagline: 'GIS experience injection middleware — package a seasoned GIS expert as an MCP server. Experience library + capability kits + real Cesium verification.',
      cols: [
        {
          title: 'Product',
          links: [
            { label: 'Features', href: '#features' },
            { label: 'Architecture', href: '#architecture' },
            { label: 'Kits', href: '#kits' },
          ],
        },
        {
          title: 'Developers',
          links: [
            { label: 'Quickstart', href: '#quickstart' },
            { label: 'MCP tools', href: '#tools' },
            { label: 'Use cases', href: '#cases' },
          ],
        },
        {
          title: 'Resources',
          links: [
            { label: 'GitHub', href: 'https://github.com/catnuko/GeoAI', external: true },
            { label: 'CesiumJS', href: 'https://cesium.com/cesiumjs/', external: true },
            { label: 'Model Context Protocol', href: 'https://modelcontextprotocol.io', external: true },
          ],
        },
        {
          title: 'License',
          links: [
            { label: 'AGPL-3.0-only', href: 'https://github.com/catnuko/GeoAI/blob/main/LICENSE', external: true },
            { label: 'Commercial license', href: 'https://github.com/catnuko/GeoAI/blob/main/COMMERCIAL-LICENSE.md', external: true },
            { label: 'Third-party licenses', href: 'https://github.com/catnuko/GeoAI/blob/main/THIRD-PARTY-LICENSES.md', external: true },
          ],
        },
      ],
      bottomLeft: '© 2026 GeoAI · catnuko',
      bottomRight: 'AGPL-3.0-only',
      disclaimer:
        'GeoAI is for local verification only: code sent by the MCP client runs without a sandbox. For production, replace it with an iframe sandbox + postMessage, or a Web Worker on a separate origin.',
    },
  },
};
