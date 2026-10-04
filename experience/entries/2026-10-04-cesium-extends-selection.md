---
id: 2026-10-04-cesium-extends-selection
title: cesium-extends 选型取舍：12 个子包哪些值得用、哪些不要，以及双 Cesium 前提
kind: pattern
tags: [cesium-extends, 选型, 第三方库, MIT, 双 Cesium, peerDependencies, 依赖评估]
apis: []
errors: [双 Cesium 实例, instanceof 失效, ScreenSpaceEventHandler 行为错乱]
status: verified
successCount: 0
created: 2026-10-04
source: manual
---

## 什么时候用
评估「要不要引入 cesium-extends」或「从它那里抄哪些能力进自己的项目」时

> **已沉淀**：其中 drawer / measure / popup+tooltip 已注入式重写为本地 kit
> （见 `list_libs` → drawer / measure / overlay）。本条保留**全量体检结论与取舍理由**，
> 避免重新评估一遍，也说明为什么其余部分没有沉淀。

## 前提：它内部 import from 'cesium'，与你页面的 Cesium 未必是同一个

仓库全部 12 个子包的 `peerDependencies` 都是 `{"cesium": "*"}`，源码**顶层值导入** Cesium
（共 21 处），且 rollup 产物只有 ESM（无 UMD/IIFE）。两个直接后果：

1. **CDN 全局场景基本用不了。** 本项目页面走 `window.Cesium`（CDN script 标签），
   而 npm 安装的 cesium-extends 产物里是 `import { ... } from 'cesium'` 裸导入，
   浏览器无法解析，除非配 import map 或打包器。
2. **一旦页面上存在两份 Cesium，功能会静默错乱。** 这是最危险的一类问题：
   - `drawer/src/index.ts:358` 用 `instanceof Entity` 判断 —— 双实例下恒为 false，
     画完的图形**不会被加入 viewer**，且不报错。
   - `subscriber/src/index.ts:286` 用 `ScreenSpaceEventType[name]` 反查 ——
     用 A 实例的 handler 挂 canvas，却用 B 实例的枚举表，行为完全错乱。
   - 枚举比较（`ArcType.RHUMB`、`ClassificationType.CESIUM_3D_TILE`、`LabelStyle.FILL_AND_OUTLINE`）
     与静态方法（`JulianDate.now()`、`Ellipsoid.WGS84`）同样实例敏感。

**所以本项目的做法是注入式重写**：Cesium 只从入参拿，`import type` 只在编译期被擦除。
这样同一份库能同时服务「CDN 全局」与「npm cesium」两种宿主。

## 逐包体检结论

| 子包 | 行数 | 结论 | 关键问题 |
|---|---|---|---|
| drawer | 1902 | ✅ 已沉淀 → `kit.drawer` | start() 重入泄漏 painter；once/sameStyle 语义与文档矛盾；右键 <3 点清空整图 |
| measure | 1486 | ✅ 已沉淀 → `kit.measure` | destroy() 泄漏整个 drawer；二次 start 静默 no-op；每次 mousemove 做 100 次 globe.pick；无 seed 随机点致结果不可复现 |
| popup + tooltip + common | 564 | ✅ 已沉淀 → `kit.overlay` | 自定义容器销毁必崩；内容翻倍；Occluder 半径硬编码 |
| primitive-geojson + geojson-render | 5148 | ⚠️ 未沉淀，价值最高但坑密集 | 见下 |
| subscriber | 295 | 🔸 未沉淀 | `add()` 默认完全无效（须 `pickResult.enable:true`）；移除监听后 handler 仍驻留；薄且 Cesium 原生可替代 |
| sync-viewer | 332 | 🔸 未沉淀 | 主导权仅在 MOUSE_MOVE 切换 → 触屏 / 键盘 / 程序化 flyTo 同步失效；2D 模式有 lookAt 锁死风险 |
| compass + zoom-control | 1626 | ❌ 不建议 | compass 约 600 行在重实现 Cesium 自带 compass 的拖拽数学；document 级监听 destroy 时不解绑；orbit 依赖 clock.onTick 故时钟停止即无响应；内外环判定用魔数 50/145。zoom 焦点是椭球不是地形（详见下方专节） |
| heat | 640 | ❌ 不建议 | 依赖已过时的 `@mars3d/heatmap.js`；`_getDataRange` 南北边界硬编码写错（纬度上限写成 180）；canvas 宽度用「数据条数」算 |

## 为什么 GeoJSON 渲染那两个包没沉淀

它的价值是真实的：用 Primitive 批量渲染替代 Entity，能让数万点/面流畅交互
（Entity 是 Cesium 的经典性能瓶颈）。但原库 5148 行里埋的确定性缺陷包括：

- **样式 `type` 必须小写**（`'point'`），而文档两处示例都写大写 `'Point'` → 直接 TypeError。
- **`value` 单值渲染方案只在 primitive 路径可用**：datasource 路径的 `getEntityValue`
  把所有属性 `String()` 强转，导致 `label === value` 恒不成立，静默退回默认色。
  而且 `String()` 让数值 `0` 被当成 falsy → 返回 `''`。
- **高度换算 `×1000` 是硬编码魔法数**（配置填 500 = 500 千米），无任何配置项可调。
- **聚合（cluster）只在 datasource 路径有效**，primitive 路径静默忽略 `style.cluster`。
- `reloadPrimitive()` 重复调用会**持续堆积 Primitive**（不先 removeAll）→ GPU 泄漏 + 重复绘制。
- 图片加载只有 `img.onload` 没有 `onerror` → URL 404 时 Promise **永不 settle**，
  `preload` 的 `await Promise.all` 永久挂起，`loading` 永远为 true。
- **该包零测试**（`package.json` 无 test script），这些缺陷没有任何测试兜底。

结论：值得沉淀，但必须重新设计而不是照抄。上面的坑位清单已经完整，
第二批做的时候按单子挨个修即可。

**真正拦路的是体量而非价值**：这两个包合计 5148 行，且 `renderConfig2Style/` 下 10 个文件
（sprite 切图、统计分段、canvas 生成）全都不在index.ts 的导出面内 —— 外部完全无法复用，
等于要从内部实现反向重写一遍。同时 `geojson-render` 在 `dataSourceRender.ts` 里直接读
Cesium `ConstantProperty` 的私有 `_value` 字段取多边形轮廓（`positions`），
这是跨 Cesium 版本最易碎的一类依赖，`skipLibCheck` 与类型系统都拦不住。

## 授权口径

cesium-extends 自身是 **MIT**（Copyright (c) 2023 練氣士）。
MIT 允许复制、修改、甚至闭源分发，与本项目 AGPL-3.0-only **没有冲突** ——
所以「不能直接复制它的代码」在授权层面是不成立的，唯一义务是保留原版权声明。

真正的问题是技术层面：它内部 `import from 'cesium'`，而本项目页面走 CDN 全局
`window.Cesium`，直接引入会产生双 Cesium 实例（`instanceof` 与枚举比较全部失效且不报错）；
加上它的 rollup 产物是纯 ESM 无 UMD，以及 measure 会带进一串 turf 依赖。

所以选择**注入式重写**：既绕开上述三个问题，也顺带修掉那些 bug。
重写出的那部分代码是本项目原创，按 AGPL-3.0-only 发布；
若日后选择直接引入 npm 包，需在 THIRD-PARTY-LICENSES.md 登记该文件已存在）。

## 为什么不做 compass（1171 行的取舍）

读源码后确认不值得做，理由不是「重复」这么笼统，而是**它的主要工作量在重实现 Cesium 自带能力**：

- 约 600 行是 compass 拖拽数学（`_orbitTickFunction` 每帧算 `rotateLeft/rotateUp`、
  `_rotateMouseMoveFunction` 手算 heading 差值），而 Cesium 自带 compass 已有且经过大量验证。
- `document.addEventListener('mousemove'/'mouseup')` 与 `clock.onTick` 在
  `destroy()` 时**不解绑**（`_unbindEvent` 只解 `postRender`）→ 拖拽中销毁即永久泄漏。
- `_orbit` 依赖 `clock.onTick`，`shouldAnimate = false` 或时钟停止时**自由环绕完全无响应**。
- 内外环判定用魔数 `50 / 145`（`_handleMouseDown`），硬编码依赖 CSS 尺寸，换样式即失效。
- `import './styles/Compass.scss'` 副作用注入 `<style>`，无法 dispose。

修完这些等于重写 Cesium 的 compass，还要持续跟着 Cesium 版本走，收益仅为「换样式」。
`zoom-control` 同理放弃，另有一个独立缺陷：缩放焦点取的是**椭球**交点
（`IntersectionTests.rayEllipsoid`）而非地形，有地形时会出现「缩放没对准目标」。

## kit 化本身的成本与适用边界

kit 层不是「更高级的 Cesium」，而是**为 MCP 场景定制的检索索引 + 少写样板代码的工具**。
它的全部价值来自「有人在旁边维护 intents / signature / snippet」——没人维护就会过期成噪音。

| 收益 | 代价 |
|---|---|
| 模型可按中文意图检索（`searchKits("量算")`）而非面对 3000+ API 盲猜 | 表达力受限于维护者：kit 没暴露的能力模型找不到（如本库未暴露原库的 `getArea(positions)` 直接传坐标入口） |
| 库与坑双向索引（查坑→提示用kit / 查库→带出坑位） | 需人工保持 registry.json 与代码同步 |
| `status: planned` 是安全阀（地形分析标"勿调用"，避免模型自信调不存在的能力） | 抽象成本：写新能力要遵守契约，比裸写 API 慢半拍 |
| `snippet` 让「查到 → 跑通」零手写（`send_snippet` 直推编辑器） | 可能过度设计：需求固定时裸写 Cesium 50 行更快 |
| `track()` + `dispose()` 逆序清理强制回收事件/DOM/实体 | 维护两份：原库更新需手动同步 |

**判断标准**：能力要被反复调用、或坑位容易被手写踩错 → 值得做 kit；
一次性、需求固定、或只是想在本地快速试一下 → 直接裸写 Cesium API 更划算。