---
id: 2026-10-05-geojson-load-notes
title: GeoJsonDataSource 四注意——属性走公开 API、flyTo 直接吃 DataSource、shp/mvt 无原生支持
kind: pattern
lib: cesium
tags: [GeoJSON, GeoJsonDataSource, 属性, shp, mvt, WKT, 数据格式]
apis: [GeoJsonDataSource.load, entity.properties, entity.polygon.extrudedHeight, Resource.fetchBlob]
errors: [取属性 undefined, _properties 断链, shp 加载不了]
status: draft
successCount: 0
created: 2026-10-05
source: Cesium-Skills
---

## 什么时候用
批量改 GeoJSON 图元样式/按属性拉伸/取属性, 或想直接加载 shp/mvt 时。

## 四注意（未实测）
```js
const ds = await Cesium.GeoJsonDataSource.load('./areas.json', {
  clampToGround: true,                        // ② 贴地选项在 load 参数里
  fill: Cesium.Color.PINK.withAlpha(0.6),
});
viewer.dataSources.add(ds);
for (const e of ds.entities.values) {
  // ① 公开 API 取属性: _properties._xxx._value 私有链在 Cesium 升级时必断
  const v = e.properties.nums ? Number(e.properties.nums.getValue()) : 1;
  e.polygon.extrudedHeight = v * 100;
}
viewer.flyTo(ds);   // ③ flyTo/zoomTo 直接吃 DataSource(含 await 的 Promise), 不用自己算包围盒
return ds.entities.values.length;
// ④ shp/mvt 无原生支持:
//   shp → shapefile.js 转 GeoJSON 再走上面流程(需 .shp+.dbf+.prj 三件套);
//   mvt → 第三方 VectorTileImageryProvider / OpenLayers 渲染成 ImageryProvider(样式写死在扩展里);
//   wkt → turf 或自解析转 GeoJSON。
```

> 出处: OpenCesium/Cesium-Skills examples/2.3.7、1.11、1.12、2.1.13、2.1.14。

相关: [[2026-10-05-wgs84-gcj02-bd09-convert]] [[2026-10-05-epsg-4326-3857-4490]] [[2026-10-05-tile-scheme-xyz-tms]] [[2026-10-05-gis-vector-format-choice]]
