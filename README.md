# GeoAI

把 Cesium 地球接入 MCP 客户端的桥接服务。npm 包名为 `geoai-mcp`（`geoai` 在 npm 上已被占用），原名 mini-mcp-cesium。链路：

```
MCP 客户端（WorkBuddy / Claude Desktop / Cursor）
   │  stdio (JSON-RPC)
   ▼
geoai MCP Server (server.js)
   │  WebSocket  ws://127.0.0.1:3001（可用环境变量换端口）
   ▼
浏览器页面（左侧 Monaco Editor + 右侧 Cesium 地球）
   │  new Function('viewer','Cesium', code)
   ▼
Cesium 执行代码
```

不做数据库、不做登录、不接 LLM、不做沙箱。代码由 MCP 客户端通过 `send_code` 传入。

---

## 1. 环境要求

- Node.js >= 20（开发时使用 v22 / v24）
- 浏览器需能访问 CDN（jsDelivr）：Monaco Editor + CesiumJS

## 2. 安装与启动

### 方式 A：MCP 客户端直接使用（推荐，无需克隆仓库）

npm 包发布后，在 MCP 客户端配置里加一条即可（WorkBuddy 为 `~/.workbuddy/mcp.json`）：

```json
{
  "mcpServers": {
    "geoai": {
      "command": "npx",
      "args": ["-y", "geoai-mcp"]
    }
  }
}
```

首次调用会自动下载并启动，无需手动安装、构建。

### 方式 B：克隆源码运行

```bash
git clone https://github.com/catnuko/GeoAI.git && cd GeoAI
npm install        # prepare 钩子自动执行 vite build，装完即有 dist/，无需手动构建
npm start          # MCP Server + HTTP(3000) + WebSocket(3001)
```

MCP 客户端配置见第 4 节。

### 开发辅助

```bash
npm run dev:web    # 前端热更新 http://127.0.0.1:5173（open_page 仍指向 3000，见已知限制 #4）
npm test           # 内置自测客户端，自动拉起 server.js 驱动全流程
```

启动后：
- HTTP 静态服务： http://127.0.0.1:3000 （托管 `dist/`，页面通过 `/config.json` 获取 WS 地址）
- WebSocket： ws://127.0.0.1:3001
- 端口被占用或想并行多实例时，用环境变量 `GEOAI_HTTP_PORT` / `GEOAI_WS_PORT` 覆盖（见第 4 节）。

> 若 `dist/` 不存在，3000 端口会返回 503 并提示构建命令，不会静默白屏。

## 3. 目录结构

```
GeoAI/                # 仓库根目录即项目根
  package.json
  vite.config.js      # Vite 构建配置（只构建自有代码）
  index.html          # Vite 入口 HTML（CDN 引入 Monaco / Cesium）
  server.js           # MCP stdio + WebSocket + HTTP 静态服务（三合一进程，不参与构建）
  test-client.js      # 模拟 MCP 客户端的端到端自测脚本
  src/
    main.js           # Cesium Viewer / Monaco / WebSocket / 代码执行
    style.css
  dist/               # Vite 构建产物（gitignore；npm 发布时经 files 白名单随包分发）
  README.md
```

### 构建边界（刻意保持最小）

- **只有 `src/` 与 `index.html` 参与 Vite 构建**。
- **Cesium 与 Monaco Editor 仍从 CDN 加载**，不进产物。原因：两者都依赖全局脚本
  加载顺序（见已知限制 #2），打包进来会破坏该顺序且引入 worker/资源路径问题。
  代价：离线环境不可用。
- **`server.js` 不参与构建**，它跑在 Node 侧，负责托管 `dist/`。
- **npm 发布内容**：`files` 白名单只带 `server.js` + `dist/` + README；`prepare`
  钩子在 `npm install` / `npm publish` 前自动完成构建。

## 4. MCP 客户端配置

npx 方式（包发布后推荐）：

```json
{
  "mcpServers": {
    "geoai": {
      "command": "npx",
      "args": ["-y", "geoai-mcp"]
    }
  }
}
```

本地源码方式（开发 / 未发包时）：

```json
{
  "mcpServers": {
    "geoai": {
      "command": "node",
      "args": ["/绝对路径/GeoAI/server.js"]
    }
  }
}
```

自定义端口（HTTP 与 WS 建议一起换，页面会通过 `/config.json` 自动拿到新 WS 地址）：

```json
{
  "mcpServers": {
    "geoai": {
      "command": "npx",
      "args": ["-y", "geoai-mcp"],
      "env": { "GEOAI_HTTP_PORT": "3002", "GEOAI_WS_PORT": "3003" }
    }
  }
}
```

在 WorkBuddy 中即为 `~/.workbuddy/mcp.json`。配置后需在连接器管理页右上角的自定义连接器入口点「信任」才会生效。

## 5. 工具说明

| 工具 | 参数 | 行为 |
| --- | --- | --- |
| `open_page` | 无 | 用默认浏览器打开 HTTP 服务地址（默认 http://127.0.0.1:3000），并等待页面 WebSocket 连入（超时 10s） |
| `send_code` | `code: string` | 把 JS 推送到页面左侧 Monaco（不执行） |
| `run_code` | 无 | 通知页面执行编辑器当前代码 |
| `get_status` | 无 | 返回 `{ pageConnected, http, websocket }` |

页面执行上下文提供两个变量：
- `viewer` — `Cesium.Viewer` 实例
- `Cesium` — CesiumJS 全局对象

```js
viewer.camera.flyTo({
  destination: Cesium.Cartesian3.fromDegrees(116.39, 39.9, 10000000),
  duration: 2.0,
});
```

## 6. 底图与合规说明

需求原稿使用 `OpenStreetMapImageryProvider` + `tile.openstreetmap.org`。**境外 OSM 直连瓦片不符合国内地图合规要求，因此本项目未采用**，改为：

- **默认（无需 key）**：不加载影像瓦片，渲染纯色地球 + 经纬网 + 大气效果。
  桥接链路、Monaco 注入、代码执行、相机飞行全部可正常验证，不影响本项目目标。
- **可选（合规影像）**：在 `src/main.js` 顶部把 `TIANDITU_TK` 的占位字符串替换为你自己的天地图 Key，即启用天地图影像底图。
  申请入口：天地图官网 http://lbs.tianditu.gov.cn/ → 控制台 → 创建新应用 → 服务接口 → 申请 Key。

未配置时页面日志会明确提示「未配置天地图 key」，不会静默失败。

## 7. 已知限制（重要）

1. **无沙箱**：页面用 `new Function('viewer','Cesium', code)(viewer, Cesium)` 直接执行 MCP 客户端下发的代码。
   该代码拥有页面同源的全部权限（DOM、网络、存储）。**本项目仅限本地验证用途，生产必须替换为 iframe sandbox + postMessage，或 Web Worker + 独立 origin。**
2. **Cesium.js 必须先于 monaco loader.js 加载**（顺序敏感，改动 `index.html` 时勿调换）：
   Cesium 打包产物内含 UMD 模块（如 `ipv6`），会检测全局 `define.amd`。
   若 Monaco AMD loader 先执行并注入 `define`，Cesium 会走 `define(t)` 分支，
   而 Monaco loader 拒绝匿名 define（`Can only have one anonymous define call per script file`），
   导致 Cesium 脚本抛错中断、`window.Cesium` 未定义、右侧地球全黑。
   症状隐蔽（无控制台错误提示），`src/main.js` 已加显式检查并给出该提示。
3. **依赖 CDN，离线不可用**：Cesium / Monaco 走 jsDelivr（见第 3 节「构建边界」）。
   内网或离线环境需改为 npm 依赖 + `vite-plugin-static-copy` 复制 Cesium 资源，
   但必须重新验证上面第 2 条的加载顺序。
4. **`dev:web` 与 `open_page` 端口不同**：Vite dev server 在 5173，而 MCP 工具
   `open_page` 打开的是 express 的 3000。开发时要么 `npm run build` 后用 3000，
   要么手动访问 5173（此时 MCP 仍能连上：WS 地址优先从 express 的 `/config.json` 获取，
   Vite 下没有该端点时回退默认 3001，因此要求 express 侧用默认端口在跑）。
5. **未接 LLM**：不自动生成代码，代码由客户端 `send_code` 传入。
6. **默认端口 3000/3001，可用环境变量覆盖**：`GEOAI_HTTP_PORT` / `GEOAI_WS_PORT`，
   仅绑定 127.0.0.1。端口被占用时 server 会打印明确错误并退出（`lsof -ti :3000 | xargs kill` 可清理）。
7. **无重连**：页面 WebSocket 断开后不会自动重连，刷新页面才恢复。
8. **单页面连接**：同一时刻只保留最后一个页面连接（`pageSocket` 被后来者覆盖）。
9. **stdio 单通道**：`server.js` 的 stdout 属于 MCP 协议通道，所有日志强制走 `console.error`（stderr）。
   往 server.js 加日志时务必不要使用 `console.log`，否则会破坏 MCP 协议。
10. **`open_page` 依赖 GUI**：无桌面环境 / 沙箱中 `open()` 会失败，此时需手动访问 http://127.0.0.1:3000。
11. **后台标签页不推进动画**：浏览器把页面切到后台时 `requestAnimationFrame` 暂停，
    `camera.flyTo` 动画会停住（代码已下发并执行，只是画面不推进）。保持页面前台即可。

## 8. 自测步骤

```bash
npm test
```

脚本会依次执行 `open_page` → 等待 3s → `get_status` → `send_code`（飞向上海东方明珠）→ `run_code` → `get_status`，并打印每次返回。

浏览器未自动打开时：手动访问 http://127.0.0.1:3000 后重跑 `npm test`，肉眼确认：
1. 左侧 Monaco 显示 test-client 推送的代码
2. 右侧 Cesium 相机飞向上海东方明珠（121.4998, 31.2397）
3. 页面底部显示「执行成功」

## 9. 发布到 npm（维护者）

```bash
npm login
npm publish        # prepare 钩子先自动重新构建；files 白名单保证包内只有运行时文件
```

> 包名为 `geoai-mcp`（`geoai` 在 npm 上已被占用）。`package.json` 已去掉 `private`；
> 如需改回私有，把 `"private": true` 加回去即可。License 目前为 MIT，可按需更换。

## 10. 下一步建议

| 方向 | 说明 |
| --- | --- |
| iframe 沙箱 | 把用户代码放进 `sandbox` iframe，`allow-scripts` + `postMessage` 返回结果/错误，替换 `new Function` |
| 结果回传 | 给 `run_code` 加 `await` 回执，让 MCP 直接拿到页面执行返回值 |
| 场景库 | 内置 flyTo / 添加实体 / 地形剖面 / 时间轴 等预置代码片段，`send_snippet(name)` 工具 |
| 多页面 | `pageSockets` Map 按 sessionId 管理，支持多标签页并行 |
| 鉴权 | WS 加随机 token，避免本机其它进程误连 |
| 自动重连 | 页面 WebSocket 断开后指数退避重连，替代「刷新页面恢复」 |
