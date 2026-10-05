# 试炼场（playgrounds）

试炼场是**沉淀经验的真实执行环境**：左侧编辑器写代码，右侧真实地球/地图立即预览，
MCP 下发的代码在这里执行、报错在这里暴露、踩坑经验从这里沉淀（`run_code` 失败自动落草稿，
跑通可固化为 verified 经验）。每个目标地图库一个试炼场，互不干扰。

```
playgrounds/
  cesium/    # CesiumJS 试炼场（当前主线）：Monaco + Cesium 双栏，WebSocket 执行
  leaflet/   # Leaflet 2D 试炼场：OSM 免 key 底图，执行上下文 map / L
  mapbox/    # Mapbox GL JS 试炼场：token 经 /config.json 下发（GEOAI_MAPBOX_TOKEN），执行上下文 map / mapboxgl
  amap/      # 高德 JSAPI 2.0 试炼场：key 经 /config.json 下发（GEOAI_AMAP_KEY），执行上下文 map / AMap，坐标为 GCJ-02
```

## 页面骨架（每个试炼场固定三件套）

```
playgrounds/<name>/
  index.html   # 页面入口：CDN 引入目标库与 Monaco（注意全局脚本加载顺序坑：目标库在 Monaco loader 之前）
  main.js      # 初始化地图实例 / Monaco / WebSocket（WS 连接时上报 ?playground=<name>），接收 setCode / runCode
  style.css    # 左右分栏布局样式
```

页面执行上下文向 MCP 下发的代码暴露变量随试炼场不同：地图库全局对象（`L` / `mapboxgl` / `AMap`）、
实例（Cesium 是 `viewer`，2D 库是 `map`）、`kit`（能力库，目前仅 cesium 域挂载）。
需要 key 的库（mapbox/amap）从 `/config.json` 的 `keys` 取（对应 server 环境变量）；未配置时
`map` 为 `null`，页面挂 `createMap(key)` 供下发代码内建图。

## 如何新增一个试炼场

1. **建目录**：复制 `playgrounds/cesium/` 的三件套到 `playgrounds/<name>/`，
   替换 CDN 地址、地图初始化代码与执行上下文变量（如 Mapbox 是 `map` 而非 `viewer`）。
2. **注册构建入口**：`vite.config.js` 的 `rollupOptions.input` 加一行
   `<name>: fileURLToPath(new URL('./playgrounds/<name>/index.html', import.meta.url))`。
   产物会落在 `dist/playgrounds/<name>/`，访问地址即 `http://127.0.0.1:3000/playgrounds/<name>/`。
3. **（可选）设为默认试炼场**：`server.js` 顶部 `DEFAULT_PLAYGROUND` 常量决定
   `open_page` 不带参数与根路径 `/` 重定向的目标；`open_page` 也可用 `playground` 参数直接指定。
4. **能力库（可选）**：目标库若有可封装的坑位与能力，在 `kits/` 下新建
   `<name>-kit-<能力>/`（注入式契约，见主 README 5.1），并在 `kits/registry.json` 登记。
5. **验证**：`npm run build:check` → `npm test`（端到端）。

经验库（`experience/`）与试炼场是解耦的：经验按意图组织、按场景检索，
不绑定某个具体试炼场；同一份经验库可以服务多个试炼场。
