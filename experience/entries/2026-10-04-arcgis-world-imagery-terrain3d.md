---
id: 2026-10-04-arcgis-world-imagery-terrain3d
title: 加载 ArcGIS 免费图层: 影像底图 + 地形（World_Imagery / Terrain3D）
kind: pattern
tags: [ArcGIS, 影像, 底图, 地形, imagery, terrain, World_Imagery, 免费图层]
apis: [ArcGisMapServerImageryProvider.fromUrl, ArcGISTiledElevationTerrainProvider.fromUrl, imageryLayers.addImageryProvider, sampleTerrainMostDetailed]
errors: []
status: verified
successCount: 0
created: 2026-10-04
source: model
---

## 什么时候用
需要给 Cesium 地球换上免费真实影像底图或真实地形高程时（免 key）

> **已封装为库**：`await kit.imagery.addArcGisImagery()` / `await kit.imagery.enableTerrain3D()`
> （见 `list_libs` → imagery）。URL 常量在 `kit.imagery.ARCGIS`。
> 本条保留的价值是**服务清单与合规边界**——库里只放了 World_Imagery / Terrain3D 两个默认服务，
> 要换其他服务仍需照下面的清单手动拼 URL。

## 代码（已验证）
```js
// 影像底图（免 key, 2026-10 实测）—— 换服务只改 URL 路径:
const imagery = await Cesium.ArcGisMapServerImageryProvider.fromUrl(
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer'
);
viewer.imageryLayers.addImageryProvider(imagery); // 页面 baseLayer:false 时, 首层即底图

// 地形高程（免 key, 正高/米, 数据精度按区域 1000m~50cm）:
viewer.terrainProvider = await Cesium.ArcGISTiledElevationTerrainProvider.fromUrl(
  'https://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/Terrain3D/ImageServer'
);

// 免费服务清单（host: server.arcgisonline.com/ArcGIS/rest/services/）:
// 根目录: World_Imagery(卫星影像) / World_Street_Map / World_Topo_Map / World_Physical_Map
//         World_Shaded_Relief / World_Terrain_Base / NatGeo_World_Map / USA_Topo_Maps
// Canvas/: World_Light_Gray_Base|_Reference, World_Dark_Gray_Base|_Reference
// Elevation/: World_Hillshade, World_Hillshade_Dark    Ocean/: World_Ocean_Base|_Reference
// 地形验证: await Cesium.sampleTerrainMostDetailed(viewer.terrainProvider,
//   [Cesium.Cartographic.fromDegrees(86.925, 27.988)]) → 珠峰采样 8837m（实测）
// 注意: ArcGIS 境外服务, 国内合规场景仍用天地图(见 solid-globe-not-bug 条目); 商用请自查 Esri 条款
```
