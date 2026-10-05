---
id: 2026-10-05-polygon-height-semantics
title: polygon 的 height 是底面、extrudedHeight 是顶面——perPositionHeight 一开, height 就被忽略
kind: pattern
lib: cesium
tags: [polygon, height, extrudedHeight, perPositionHeight, 淹没分析, CallbackProperty, 拉伸]
apis: [CallbackProperty, fromDegreesArrayHeights, polygon.perPositionHeight]
errors: [悬浮面高度不对, 拉伸体厚度不对, 水位无限上涨]
status: draft
successCount: 0
created: 2026-10-05
source: Cesium-Skills
---

## 什么时候用
画悬浮面/拉伸体高度对不上, 或实现淹没分析（水位上升）时。

> **已封装为库**：`kit.analysis.flood(region, { startHeight, endHeight, seconds })`——
> 水位按真实时间推进并封顶, `stop()` 摘水面。见 `list_libs` → analysis。

## 语义
- `height` = **底面**高度, `extrudedHeight` = **顶面**高度——"extrudedHeight 是本身高度"的直觉是反的。
- `perPositionHeight: true` 时逐顶点取 z（配 `fromDegreesArrayHeights`）, `height` 参数被忽略。
- 淹没分析的极简实现 = 普通 entity polygon + `extrudedHeight` 挂 `CallbackProperty` 每帧 +speed; **回调内必须 clamp 到目标水位**, 否则水位无限涨。重启分析前 `viewer.entities.removeAll()`。

## 参考代码（未实测）
```js
// 逐顶点高度的多边形, 拉伸到 0:
viewer.entities.add({ polygon: {
  hierarchy: Cesium.Cartesian3.fromDegreesArrayHeights([116,40,1000, 116,39,1000, 117,39,2000]),
  perPositionHeight: true,   // 用顶点 z, height 被忽略
  extrudedHeight: 0,
  material: Cesium.Color.ORANGE.withAlpha(0.5),
}});
// 淹没: extrudedHeight 动画 + clamp
let h = 1000; const target = 3600;
viewer.entities.add({ polygon: {
  hierarchy: Cesium.Cartesian3.fromDegreesArray([116,40, 116,39, 117,39]),
  material: Cesium.Color.fromBytes(64, 157, 253, 150),
  extrudedHeight: new Cesium.CallbackProperty(() => { h = Math.min(h + 2, target); return h; }, false),
}});
return 'ok';
```

> 出处: OpenCesium/Cesium-Skills examples/2.3.3、4.1.3、4.1.4。
