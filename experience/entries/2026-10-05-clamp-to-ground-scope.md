---
id: 2026-10-05-clamp-to-ground-scope
title: 贴地参数各有归属——heightReference 只属点/标注, 线用 clampToGround, 面天生贴地且 outline 无效
kind: pitfall
lib: cesium
tags: [贴地, heightReference, clampToGround, outline, outlineWidth, 被地形遮挡, disableDepthTestDistance]
apis: [HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance, polyline.clampToGround, GroundPolylinePrimitive]
errors: [polygon 设 heightReference 无反应, 贴地面边线不显示, outlineWidth 设了没用, 点标注时隐时现]
status: draft
successCount: 0
created: 2026-10-05
source: Cesium-Skills
---

## 什么时候用
点/线/面想贴在表面上, 发现参数不生效或被地形/建筑遮住时。

## 归属与坑
- `heightReference: CLAMP_TO_GROUND` 只属于 **billboard / label / point**; 放到 polygon/polyline 上是无效属性。
- `polyline` 贴地用 `clampToGround: true`, 且**只支持纯色材质**（dash/glow 等在 GroundPolyline 上不渲染）。
- `polygon` 没有贴地参数——不设 height 就贴地。代价: 贴地面**没有 outline**（无 extrudedHeight, 边不渲染）; 想要边线, 用同坐标的贴地 polyline 叠加。
- `outlineWidth` 恒为 1（WebGL lineWidth 限制, 多数平台 >1 被钳制）, 设了没用。
- `heightReference` 要等地形 provider 就绪才起效。
- 点/标注防遮挡双保险: `disableDepthTestDistance: Number.POSITIVE_INFINITY`——只设 heightReference 不设它, 会被地形/建筑深度盖掉, 表现为时隐时现。

## 参考代码（未实测）
```js
viewer.entities.add({
  position: Cesium.Cartesian3.fromDegrees(116.39, 39.9),
  point: {
    pixelSize: 8, color: Cesium.Color.RED,
    heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
    disableDepthTestDistance: Number.POSITIVE_INFINITY,   // 永不被遮挡
  },
  label: {
    text: '贴地标注', font: '14pt sans-serif',
    heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
    disableDepthTestDistance: Number.POSITIVE_INFINITY,
  },
});
```

> 出处: OpenCesium/Cesium-Skills examples/2.3.1、2.3.3、2.3.4、patterns.md。
> 贴地标注已封装进 `kit.points.addMany([{ lon, lat, text }], { clampToGround: true })`（双保险内置）。
> 贴地前提是地形已就绪, 地形采样时序见 [[2026-10-05-terrain-height-timing]]。
