---
id: 2026-10-05-tile-scheme-xyz-tms
title: 瓦片行号方案 XYZ 与 TMS 的 y 轴翻转——瓦片 404/图上下颠倒先查这个
kind: snippet
lib: geo
tags: [瓦片, XYZ, TMS, 瓦片方案, 行号, tile, 翻转, 404, 瓦片错位]
apis: [L.tileLayer, UrlTemplateImageryProvider, xyzToTms]
errors: [瓦片 404, 瓦片上下颠倒, 瓦片南北错位, y 行号对不上]
status: verified
successCount: 0
created: 2026-10-05
source: manual
---

## 什么时候用
自建瓦片服务或写瓦片 URL 模板时，同一份瓦片在 A 库正常、B 库 404 或上下颠倒。根源是行号方案两派：**XYZ**（Google/OSM/高德/天地图，y 从北往南）与 **TMS**（OSGeo 标准，y 从南往北）。

## 公式与各库默认（node 实测翻转闭合）
```js
// 两者只差一个 y 翻转: y_tms = 2^z - 1 - y_xyz
function xyzToTms(z, y) {
  return Math.pow(2, z) - 1 - y;
}
// 实测: z=3,y_xyz=5 -> y_tms=2; z=10,y=377 -> 646; 往返闭合
```

各库默认与开关：
- **Leaflet** `L.tileLayer`：默认 XYZ；`{ tms: true }` 切 TMS。
- **Mapbox GL / MapLibre** `raster` source：默认 XYZ（`scheme: 'tms'` 可切）。
- **高德/百度/天地图**：全部 XYZ 语义（y 从北往南）。
- **Cesium** `UrlTemplateImageryProvider` 的 `{TileRow}` 占位符：XYZ 语义（北在上）；接 TMS 服务要么先翻转行号，要么用 `TileMapServiceImageryProvider`。
- **GeoServer/WMS/WMTS**：WMTS `TileMatrix` 行号从北往南（XYZ 语义），但 TMS REST 接口是南往北，同一服务两种端点行为不同。

排查顺序：瓦片 404 → 先对一下 z/x/y 取值范围（z=10 时 x/y 都应 < 1024）；图南北颠倒 → 八成是 TMS 服务被当 XYZ 接了。

相关: [[2026-10-05-epsg-4326-3857-4490]] [[2026-10-05-domestic-imagery-traps]]
