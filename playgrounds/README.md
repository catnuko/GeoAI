# 试炼场（playgrounds）

试炼场是**沉淀经验的真实执行环境**：左侧编辑器写代码，右侧真实地球/地图立即预览，
MCP 下发的代码在这里执行、报错在这里暴露、踩坑经验从这里沉淀（`run_code` 失败自动落草稿，
跑通可固化为 verified 经验）。每个目标地图库一个试炼场，互不干扰。

```
playgrounds/
  cesium/    # CesiumJS 试炼场（当前主线）：Monaco + Cesium 双栏，WebSocket 执行
  mapbox/    # （示例）未来可加：同样的页面骨架，换成 Mapbox GL JS 的 CDN 与初始化
```

## 页面骨架（每个试炼场固定三件套）

```
playgrounds/<name>/
  index.html   # 页面入口：CDN 引入目标库与 Monaco（注意全局脚本加载顺序坑）
  main.js      # 初始化地图实例 / Monaco / WebSocket，接收 setCode / runCode
  style.css    # 左右分栏布局样式
```

页面执行上下文向 MCP 下发的代码暴露三类变量：地图库全局对象、实例（如 `viewer`）、`kit`（能力库）。

## 如何新增一个试炼场

1. **建目录**：复制 `playgrounds/cesium/` 的三件套到 `playgrounds/<name>/`，
   替换 CDN 地址、地图初始化代码与执行上下文变量（如 Mapbox 是 `map` 而非 `viewer`）。
2. **注册构建入口**：`vite.config.js` 的 `rollupOptions.input` 加一行
   `<name>: fileURLToPath(new URL('./playgrounds/<name>/index.html', import.meta.url))`。
   产物会落在 `dist/playgrounds/<name>/`，访问地址即 `http://127.0.0.1:3000/playgrounds/<name>/`。
3. **（可选）设为默认试炼场**：`server.js` 顶部 `DEFAULT_PLAYGROUND` 常量决定
   `open_page` 打开与根路径 `/` 重定向的目标，按需切换。
4. **能力库（可选）**：目标库若有可封装的坑位与能力，在 `kits/` 下新建
   `<name>-kit-<能力>/`（注入式契约，见主 README 5.1），并在 `kits/registry.json` 登记。
5. **验证**：`npm run build:check` → `npm test`（端到端）。

经验库（`experience/`）与试炼场是解耦的：经验按意图组织、按场景检索，
不绑定某个具体试炼场；同一份经验库可以服务多个试炼场。
