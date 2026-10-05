---
id: 2026-10-05-default-click-handler
title: 默认单击选中/双击追踪挂在 cesiumWidget 的 handler 上——在自己 new 的 handler 里摘不掉
kind: pitfall
lib: cesium
tags: [事件, 双击, 默认行为, ScreenSpaceEventHandler, removeInputAction, 鼠标习惯]
apis: [ScreenSpaceEventHandler, removeInputAction, screenSpaceCameraController.tiltEventTypes, zoomEventTypes]
errors: [双击后相机飞走, 右上角弹出信息框, 自定义点击响应两次]
status: draft
successCount: 0
created: 2026-10-05
source: Cesium-Skills
---

## 什么时候用
自定义点击交互（拾取/量算/点选）时发现双击把相机飞到实体上、右上角弹出默认信息框, 或业务点击与默认选中双响应时。

## 根因
`viewer.cesiumWidget.screenSpaceEventHandler` 与自己 `new Cesium.ScreenSpaceEventHandler(...)` 是**两个独立对象**。
默认 LEFT_CLICK（选中）/ LEFT_DOUBLE_CLICK（追踪实体）挂在前者; 在自建 handler 上 removeInputAction **关不掉默认行为**。

## 参考代码（未实测）
```js
// 摘默认行为必须对着 cesiumWidget 的 handler:
const h = viewer.cesiumWidget.screenSpaceEventHandler;
h.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);  // 防双击追踪
h.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_CLICK);         // 防默认选中(按需)
// 业务 handler 正常 new, 互不影响:
const mine = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
mine.setInputAction((m) => { /* ... */ }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
// 改鼠标习惯(左键旋转/右键倾斜)不碰 handler, 改控制器的 *EventTypes 数组:
viewer.scene.screenSpaceCameraController.tiltEventTypes = [Cesium.CameraEventType.RIGHT_DRAG];
return mine;
```

> 出处: OpenCesium/Cesium-Skills examples/1.6、1.14、4.2.1。
> 屏幕坐标→世界坐标的分支选择见 [[2026-10-04-drawer-pick-terrain]]。
