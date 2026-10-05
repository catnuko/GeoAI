---
id: 2026-10-05-globe-clipping-excavate
title: globe 裁剪面挖坑的三个约定——法线指外侧、distance 是 Hessian 负点积、绕向必须归一化
kind: pattern
lib: cesium
tags: [开挖, 裁剪面, ClippingPlaneCollection, 地形分析, 挖坑, globe]
apis: [globe.clippingPlanes, ClippingPlaneCollection, ClippingPlane, Ellipsoid.WGS84.geodeticSurfaceNormal]
errors: [挖反了(只剩坑柱), 挖不掉, 多边形绕向不同结果不同]
status: draft
successCount: 0
created: 2026-10-05
source: manual
---

## 什么时候用
地形开挖/挖坑（隐藏区域内地形），发现"挖反了"或"挖不掉"时。

## 三个约定
- **法线方向**：`ClippingPlane` 默认交集语义（`unionClippingRegions: false`）下，被裁的是每个面**负侧**的公共区域。要挖掉区域内部，法线必须指向多边形**外侧**；法线朝内会变成"只留坑柱"。
- **distance**：Hessian 法向式 `dot(normal, p) + distance = 0`——平面过棱上点 E 时 `distance = -dot(normal, E)`，符号给反会整体位移。
- **绕向归一化**：`cross(边方向, 地表法线)` 的朝向随多边形绕向翻转，逐面检查 `dot(normal, 质心 - 棱中点)`，为正则取反——绕向无关化。
- 非凸区域按凸包语义被裁（交集语义只保证凸内被裁）。

## 参考代码（已封装为 `kit.analysis.excavate`）
```js
// 直接用库（推荐）：绕向无关, restore 可还原
const dig = kit.analysis.excavate([{ lon: 116.39, lat: 39.90 }, { lon: 116.42, lat: 39.90 },
  { lon: 116.42, lat: 39.93 }, { lon: 116.39, lat: 39.93 }]);
// dig.restore();  // 移除裁剪面还原地形
```

> 出处：Cesium Globe Clipping Planes 官方模式 + 本仓库实现推导，真机渲染验证见 test:libs。
> 相关：[[2026-10-05-terrain-height-timing]]（同库的通视/剖面采样）。
