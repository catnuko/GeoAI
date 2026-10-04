---
id: 2026-10-04-measure-plane-vs-surface
title: 量算的平面与贴地双模式；原库「不带 Surface 后缀的版本默认不贴地」很反直觉
kind: pitfall
tags: [measure, 量算, 面积, 距离, 贴地, surface, plane, 单位]
apis: [EllipsoidGeodesic.surfaceDistance, Cartesian3.distance, globe.getHeight]
errors: [面积算成平面投影, 距离偏小, 单位突然跳变, 面积不一致]
status: verified
successCount: 0
created: 2026-10-04
source: manual
---

## 什么时候用
量距离或面积时，发现结果和实际地形对不上时

> **已封装为库**：`kit.measure.distance/polylineDistance/area`，`mode: 'surface'`（默认，贴地）
> 或 `'plane'`（椭球面几何）。见 `list_libs` → measure。本条保留**两种算法的差别与选择依据**。

## 两种模式的本质区别

| | `surface`（贴地，沿地表） | `plane`（椭球面几何） |
|---|---|---|
| 距离 | 屏幕空间插值 + 逐段射线打到地形，累加地表距离 | `EllipsoidGeodesic.surfaceDistance`，球面两点大圆弧 |
| 面积 | 顶点在屏幕空间参与三角剖分，逐顶点取地形高程 | 球面多边形面积公式（Chamberlain-Duquette） |
| 依赖相机 | **是**（见 measure-surface-camera-dependency） | 否 |
| 耗时 | 分段数 × 射线求交（默认 64 段/边） | 微秒级 |
| 适用 | 起伏地形上的真实距离/面积 | 大范围、点在视口外、或只需粗略量级 |

**球面 vs 平面差多少**：山区起伏 1000m 的区域，平面算的「面积」其实是椭球面投影面积，
与地表实际面积可差 **5%~15%**；平面算的「距离」是直线投影，山区可差更大。
所以「量算」默认必须是 `surface`。

## 两个反直觉的默认值（cesium-extends 原库的坑，已在 kit 里改掉）

**1. 不带 `Surface` 后缀的版本默认不贴地。**
原库 `AreaMeasure.start()` 不传 `clampToGround`（`AreaMeasure.ts:60-62`）→ `undefined` → falsy → 面悬浮。
名字里的 `Surface` 后缀才是贴地版。`DistanceMeasure` 显式传了 `false`（`DistanceMeasure.ts:78`）。
本库改为**默认 surface，用 `plane` 显式 opt-out** —— 默认该是安全的那一侧。

**2. 单位在显示层跳变。**
原库 `utils.ts:38-47`：`< 1000m` 输出「数值+米」，`>= 1000m` 输出「数值+kilometers」。
所以量一段 999m 和 1001m 的路，显示会从「999meters」跳到「1.00kilometers」，
且拼接无空格、多余尾空格。本库数值字段恒定给出米 / 平方米，`text` 只作附加信息。

## 代码

```js
// 两点贴地距离（默认 surface）
const d = kit.measure.distance({ lon: 116.39, lat: 39.90 }, { lon: 116.42, lat: 39.95 });
// → { chordMeters, geodesicMeters, surfaceMeters, text: "4.21 千米", samples: 65 }

// 多边形贴地面积（至少 3 点，自动闭合）
const a = kit.measure.area([
  { lon: 116.39, lat: 39.90 },
  { lon: 116.42, lat: 39.90 },
  { lon: 116.42, lat: 39.93 },
  { lon: 116.39, lat: 39.93 },
]);
// → { squareMeters, surfaceSquareMeters, text: "1.21 平方千米" }

// 点在视口外 / 只需粗略量级 → 用 plane，零相机依赖
const approx = kit.measure.distance({ lon: 0, lat: 0 }, { lon: 1, lat: 0 }, 'plane');
```

## 精度调节

`splitNum` 控制贴地算法的分段数（默认 64，封顶 512）：越大越贴合地形也越慢，
因为每段是一次射线求交。山地陡坡建议 128~256；平原 32 足够。