---
id: 2026-10-05-3dtiles-modelmatrix-enu
title: 3D Tiles 抬升/平移沿 ECEF 轴会斜着飞走——用包围球中心的 ENU 竖直方向做差
kind: pitfall
lib: cesium
tags: [3DTiles, modelMatrix, 抬升, 压平, ECEF, ENU, 偏移]
apis: [Cesium3DTileset.modelMatrix, Matrix4.fromTranslation, Cartographic.fromCartesian, BoundingSphere]
errors: [tileset 抬升后斜着飞走, 压平位置不对]
status: draft
successCount: 0
created: 2026-10-05
source: Cesium-Skills
---

## 什么时候用
给倾斜摄影/3D Tiles 整体抬升或平移, 结果不是垂直升高而是斜着跑时。

> **已封装为库**：`kit.tiles.lift(tileset, meters)`（沿包围球中心 ENU 竖直方向, 可叠加调用）、
> `await kit.tiles.load(url, { zoom })`（异步工厂 + 失败归因）。见 `list_libs` → tiles。

## 根因
`Matrix4.fromTranslation(Cartesian3.fromArray([x, y, z]))` 平移的是**地心地固（ECEF）坐标轴**方向——在球面上不是"向上"。正确做法: 用 tileset 包围球中心, 取"地表→抬高 N 米"两点做差得到平移向量。

## 参考代码（未实测）
```js
const tileset = await Cesium.Cesium3DTileset.fromUrl(url);
viewer.scene.primitives.add(tileset);
const carto = Cesium.Cartographic.fromCartesian(tileset.boundingSphere.center);
const surface = Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, 0.0);
const target  = Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, 80); // 抬 80m
const translation = Cesium.Cartesian3.subtract(target, surface, new Cesium.Cartesian3());
tileset.modelMatrix = Cesium.Matrix4.fromTranslation(translation.clone());
return 'lifted 80m';
```
注: 该写法只适合小范围偏移（原示例注释）; 压平场景通常先整体抬高再往下压（压平基准受地形/模型原始高度限制）。

> 出处: OpenCesium/Cesium-Skills examples/3.1.2、3.1.7。
