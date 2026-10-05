# Cesium 试炼场

当前主线试炼场：左侧 Monaco 编辑器 + 右侧真实 Cesium 地球，WebSocket（默认
`ws://127.0.0.1:3001`，地址经 `/config.json` 下发）接收 MCP 下发的代码并执行，
返回结果 / 报错，失败自动沉淀为经验草稿。

## 文件

- `index.html` — 页面入口。CesiumJS 与 Monaco Editor 均从 CDN（jsDelivr）加载。
  **加载顺序敏感**：Cesium 必须先于 Monaco AMD loader 执行，否则 `window.Cesium`
  未定义、地球全黑（原因与症状见主 README 已知限制 #2，改动本文件勿调换顺序）。
- `main.js` — 初始化 Cesium Viewer（合规影像源：未配置天地图 key 时渲染纯色地球 +
  经纬网）、Monaco、WebSocket 与代码执行，并装配 `kits/` 能力库。
- `style.css` — 左右分栏布局。

## 执行上下文

MCP `run_code` 下发的代码可用三个变量：

- `viewer` — `Cesium.Viewer` 实例
- `Cesium` — CesiumJS 全局对象
- `kit` — 能力库对象（`kit.camera` / `kit.imagery` / `kit.geojson` / `kit.drawer` / `kit.measure` / `kit.overlay`）

访问地址：`http://127.0.0.1:3000/playgrounds/cesium/`（多开用 `?session=<id>` 区分）。
根路径 `http://127.0.0.1:3000/` 由 server.js 重定向到本页面。
