---
id: 2026-10-05-external-analysis-libs
title: 插值/等值面外部库的暗约定——kriging 的 gridWidth 单位是度, isobands 输出区间是字符串
kind: pattern
lib: cesium
tags: [kriging, 插值, 热力图, 等值面, isobands, turf, 泰森多边形, 第三方库]
apis: [kriging.train, kriging.grid, turf.isobands, turf.tin, GeoJsonDataSource.load]
errors: [格网实体爆炸卡死, 取不到插值值, 等值面没盖满范围]
status: draft
successCount: 0
created: 2026-10-05
source: Cesium-Skills
---

## 什么时候用
站点数据做克里金插值/等值面/泰森多边形/热力图, 出现实体数量爆炸或取值不对时。
依赖外部 kriging.js / turf / heatmap.js（需自行引入, Cesium 无内置）。

## 暗约定
- `kriging.train(values, lons, lats, 'exponential'|'gaussian'|'spherical', sigma2, alpha)` 吃三个**平行数组**。
- `kriging.grid(polygons, variogram, gridWidth)` 的 gridWidth 单位是**度**（0.002° ≈ 200m）; 格网数 = 范围²/宽度²——逐格建 entity 时宽度减半实体数 ×4, 页面直接卡死; 连续面应走 canvas 出图（heatmap 类）。
- `turf.isobands(points, breaks, { zProperty })`: `breaks` 必须**递增**且最后一级给大值兜底; 输出面属性是 `"1-2"` **字符串**, 取色要 `split('-')[0]`。
- `turf.tin(points, 'z')` 只覆盖点集凸包——把 bbox 四角点 push 进 features 才盖满范围。
- `GeoJsonDataSource.load(result, { clampToGround: true })` 才贴地。
- 3D 热力图: heatmap.js 的离屏容器必须显式 px 宽高并 append 进 DOM（可 `display:none`, 不能没尺寸）; `MaterialAppearance` 自定义顶点着色器里纹理 uniform 名是 `image_0`（见 [[2026-10-05-custom-material-property]]）。

## 参考代码（未实测）
```js
const variogram = kriging.train(values, lons, lats, 'exponential', 0, 100);
const grid = kriging.grid([[[xMin, yMin], [xMin, yMax], [xMax, yMax], [xMax, yMin]]], variogram, 0.002);
const bands = turf.isobands(points, [0, 5, 10, 20, 99], { zProperty: 'speed' });  // 末级兜底
const ds = await Cesium.GeoJsonDataSource.load(bands, { clampToGround: true });
viewer.dataSources.add(ds);
for (const e of ds.entities.values) {
  const raw = e.properties.speed.getValue(Cesium.JulianDate.now());  // "1-2" 字符串
  const v = Number(String(raw).split('-')[0]) || 0;
  e.polygon.material = Cesium.Color.fromCssColorString(colorFor(v));
}
return ds.entities.values.length;
```

> 出处: OpenCesium/Cesium-Skills examples/8.1.1、8.1.2、8.1.5、8.2.6、8.1.3。
