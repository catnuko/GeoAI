---
id: 2026-10-05-viewer-constructor-once
title: Viewer 关键构造项只在 new 时生效——baseLayer/webgl alpha/preserveDrawingBuffer 事后改无效
kind: pitfall
lib: cesium
tags: [Viewer, 构造项, baseLayer, Ion, token, 截图, 背景图, webgl]
apis: [Viewer, ImageryLayer.fromProviderAsync, EllipsoidTerrainProvider]
errors: [Ion.defaultAccessToken 报错, 截图全黑, canvas 背景图不显示, 底图一直转圈]
status: draft
successCount: 0
created: 2026-10-05
source: Cesium-Skills
---

## 什么时候用
自建页面/双屏场景新建 Viewer, 或排查「Ion token 报错」「截图全黑」「设了背景图看不见」时。
geoai 试炼场的 viewer 已由页面创建, 下列构造项**不能事后改**, 要变就改 `playgrounds/*/main.js` 后重新构建。

## 现象 / 报错
- 不配 `baseLayer: false` 且无 Ion token → 渲染循环抛 `An error occurred in rendering: ... Ion.defaultAccessToken`, 或底图永远转圈。
- `contextOptions.webgl.alpha: true`（露出 CSS 背景图）与 `preserveDrawingBuffer: true`（toDataURL 截图不黑）**只在构造时生效**, 事后改无效。
- 背景图三件套缺一不可: 构造时 `alpha: true` + `skyBox.show = false` + `scene.backgroundColor` 全透明。

## 参考代码（未实测）
```js
const viewer = new Cesium.Viewer(container, {
  baseLayer: false,                                 // 不要 Ion 默认底图 (token 报错的根因)
  baseLayerPicker: false,
  creditContainer: document.createElement('div'),   // 隐去版权水印
  scene3DOnly: true,                                // 不做二三维切换时可省资源
  contextOptions: { webgl: { alpha: true, preserveDrawingBuffer: true } },  // 只在此处生效
});
// 底图自备: 异步 provider 必须包 ImageryLayer, 见 [[2026-10-05-async-factory-migration]];
// 免 key 真实影像走 kit.imagery.addArcGisImagery(), 见 [[2026-10-04-arcgis-world-imagery-terrain3d]]
// 清地形: viewer.scene.terrainProvider = new Cesium.EllipsoidTerrainProvider();
```

> 出处: OpenCesium/Cesium-Skills examples/1.1、00.js、5.1.4（上游 jiawanlong/Cesium-Examples），本仓库未实测, 通过后改 verified。
