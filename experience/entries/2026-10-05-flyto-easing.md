---
id: 2026-10-05-flyto-easing
title: flyTo 终点明显减速顿挫——easingFunction 用 LINEAR_NONE, orientation 的 heading/pitch 是弧度
kind: snippet
lib: cesium
tags: [flyTo, 缓动, 相机, 弧度, 卡顿]
apis: [camera.flyTo, EasingFunction.LINEAR_NONE, Math.toRadians]
errors: [飞行终点卡顿, pitch 方向反了]
status: draft
successCount: 0
created: 2026-10-05
source: Cesium-Skills
---

## 什么时候用
大范围飞行到终点明显减速顿挫, 或俯仰角方向不对时。

## 代码（未实测）
```js
viewer.camera.flyTo({
  destination: Cesium.Cartesian3.fromDegrees(116, 39, 2000000),
  duration: 5,
  easingFunction: Cesium.EasingFunction.LINEAR_NONE,  // 默认缓动在终点减速; 上游原注释"用这个, 不卡顿"
  orientation: {
    heading: Cesium.Math.toRadians(0),
    pitch: Cesium.Math.toRadians(-45),   // 弧度! -90 为正俯视
    roll: 0,
  },
});
return 'flying';
```

> 出处: OpenCesium/Cesium-Skills examples/1.5、2.js。
> flyTo 不返回 Promise、等待动画结束的正确姿势见 [[2026-10-04-flyto-moveend]]。
