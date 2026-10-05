---
id: 2026-10-05-domestic-imagery-traps
title: 国内底图三坑——天地图 _c 层号从 1 起、4490 层号偏移因服务而异、高德/腾讯是 GCJ02 整体偏移
kind: pitfall
lib: cesium
tags: [天地图, WMTS, 4490, CGCS2000, GCJ02, 高德, 腾讯, tileMatrixLabels, 瓦片404, 底图偏移]
apis: [WebMapTileServiceImageryProvider, GeographicTilingScheme, WebMercatorTilingScheme, tileMatrixLabels, UrlTemplateImageryProvider.customTags, WebMapServiceImageryProvider]
errors: [瓦片 404, 底图整体错位, 底图和数据偏几百米, WMS 盖住底图]
status: draft
successCount: 0
created: 2026-10-05
source: Cesium-Skills
---

## 什么时候用
接天地图/省级 4490 切片/高德腾讯底图, 出现 404、错位、或底图与 WGS84 数据偏几百米时。

> **已封装为库**：`kit.imagery.addTianditu(tk, { layer, projection })`（c/w 层号自适应）、
> `kit.imagery.add4490(url, { levelOffset })`（customTags 兜底）、`kit.imagery.addWms()`（透明参数默认补齐）。
> 本条保留**根因**——换其他服务/排查 404 时仍需知道层号与投影的配对关系。

## 三坑
1. **天地图 WMTS 层号**: `_c`（经纬度投影）TileMatrix **从 1 开始** → `tileMatrixLabels` 要 `(z+1)` 且配 `GeographicTilingScheme`; `_w`（墨卡托）从 0 开始 → 配 `WebMercatorTilingScheme`。tilingScheme 与层号错一个 → 全盘 404/错位。subdomains 用 `t0`~`t7`。
2. **4490/CGCS2000**: 切片方案同 4326（第 0 级 2×1）→ `GeographicTilingScheme({ numberOfLevelZeroTilesX: 2, numberOfLevelZeroTilesY: 1 })`; 很多服务 TileMatrix 有 ±1 偏移**且因服务而异** → `UrlTemplateImageryProvider.customTags` 兜底, 404 就试 ±1。
3. **GCJ02 偏移**: 高德/腾讯瓦片是 GCJ02, 直连与 WGS84 数据差几百米, 需纠偏（第三方 cesium-map 插件的 `crs: 'WGS84'`）。另 WMS 必给 `parameters: { transparent: 'true', format: 'image/png' }`, 否则不透明整幅盖住底图。

## 参考代码（未实测）
```js
// 天地图 _c: 层号 +1
const max = 18;
const labels = Array.from({ length: max + 1 }, (_, z) => String(z + 1));
viewer.imageryLayers.addImageryProvider(new Cesium.WebMapTileServiceImageryProvider({
  url: 'http://t{s}.tianditu.gov.cn/vec_c/wmts?service=WMTS&version=1.0.0&request=GetTile'
     + '&tilematrix={TileMatrix}&layer=vec&style=default&tilerow={TileRow}&tilecol={TileCol}'
     + '&tilematrixset=c&format=tiles&tk=YOUR_KEY',
  layer: 'vec', style: 'default', format: 'tiles', tileMatrixSetID: 'c',
  subdomains: ['0','1','2','3','4','5','6','7'],
  tileMatrixLabels: labels,
  tilingScheme: new Cesium.GeographicTilingScheme(),
  maximumLevel: max,
}));
// 4490 层号偏移兜底: url 里写 {z4490}, 再配
//   customTags: { z4490: (provider, x, y, level) => level + 1 }   // 有的服务返回 level 本身
// 最省事 xyz 直连: http://t{s}.tianditu.gov.cn/DataServer?T=img_w&x={x}&y={y}&l={z}&tk=KEY
```

> 出处: OpenCesium/Cesium-Skills examples/2.1.5、2.1.6、2.1.7、2.1.8、2.1.12、2.1.4。
> 默认无 key 时的纯色球合规默认见 [[2026-10-04-solid-globe-not-bug]]。

相关: [[2026-10-05-wgs84-gcj02-bd09-convert]] [[2026-10-05-epsg-4326-3857-4490]] [[2026-10-05-tile-scheme-xyz-tms]] [[2026-10-05-gis-vector-format-choice]]
