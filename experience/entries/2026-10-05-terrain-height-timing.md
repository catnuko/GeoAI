---
id: 2026-10-05-terrain-height-timing
title: globe.getHeight 只反映已加载瓦片基本不可靠——批量取高用 sampleTerrainMostDetailed 且输入是弧度
kind: pitfall
lib: cesium
tags: [地形, 采样, getHeight, sampleTerrainMostDetailed, 高度, 地形夸张]
apis: [globe.getHeight, sampleTerrainMostDetailed, Cartographic.fromDegrees, terrainExaggeration]
errors: [取到的高度是 0, 采样结果 undefined, 高度错得离谱]
status: draft
successCount: 0
created: 2026-10-05
source: Cesium-Skills
---

## 什么时候用
取某经纬度的地形高度（画点/量算/方量/剖面）发现是 0、undefined 或明显不对时。

> **已封装为库**：`await kit.imagery.sampleHeight(lon, lat)` / `sampleHeights([{lon,lat},...])`
> ——弧度转换内置，入参直接给度。（此前 sampleHeight 曾把度数对象直接传给 Cesium，恒返回 0，已修。）

## 根因
`globe.getHeight` 是同步接口, **只查当前视口已加载瓦片**——没飞到过/瓦片没加载完就返回不可靠值（上游示例为求稳, flyTo 完成后还要再等 10 秒才敢采样）。
跨区域/后台查询必须走异步采样: 输入是**弧度** `Cartographic`（直接传度数结果错得离谱）, 必须显式传 terrainProvider, 返回数组取 `[0].height`（米）。

## 参考代码（未实测）
```js
const updated = await Cesium.sampleTerrainMostDetailed(
  viewer.terrainProvider,
  [Cesium.Cartographic.fromDegrees(116.39, 39.9)]);   // fromDegrees 内部转弧度
const h = updated[0].height;
// 开了地形夸张时视觉高度 ≠ 采样高度:
// viewer.scene.globe.terrainExaggeration = 2.0;
// 若版本有 terrainExaggerationRelativeHeight, 需一并设置
return { h };
```

> 出处: OpenCesium/Cesium-Skills examples/1.22、4.1.9、4.1.12、4.1.13、patterns.md。
> ArcGIS 地形上的实测样例见 [[2026-10-04-arcgis-world-imagery-terrain3d]]; 贴地显示的前提同样是地形就绪, 见 [[2026-10-05-clamp-to-ground-scope]]。
