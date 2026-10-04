---
id: 2026-10-04-lookat-unlock
title: lookAt 之后相机被锁定, 后续 flyTo/setView 失效; 用 lookAtTransform 解锁
kind: pitfall
tags: [camera, lookAt, 相机, flyTo, 解锁]
apis: [camera.lookAt, camera.lookAtTransform, HeadingPitchRange]
errors: [flyTo 无效, 相机不动]
status: verified
successCount: 0
created: 2026-10-04
source: manual
---

## 什么时候用
用 camera.lookAt 对准目标之后, 还需要继续用 flyTo/setView 自由控制相机时

> **已封装为库**：`kit.camera.lookAtPoint()` / `kit.camera.unlock()`（见 `list_libs` → camera）。
> `kit.camera` 的所有飞行方法都会在起飞前自动 `unlock()`，无需手写下面这段。
> 本条保留的价值是**边界条件**：直接用原生 API 时才会遇到，需要自己补 `lookAtTransform`。

## 现象 / 报错
lookAt 会把相机切到"目标跟随"变换模式; 该模式下 flyTo/setView 表现异常或不生效。

## 修法（已验证代码）
```js
const target = Cesium.Cartesian3.fromDegrees(116.39, 39.9, 15000);
viewer.camera.setView({ destination: target });
viewer.camera.lookAt(target, new Cesium.HeadingPitchRange(0, -0.3, 800));
// 用完 lookAt 后解锁, 恢复自由相机:
viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
return 'lookAt -> shoot -> unlock';
```
