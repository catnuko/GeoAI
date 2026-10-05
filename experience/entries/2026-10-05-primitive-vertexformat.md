---
id: 2026-10-05-primitive-vertexformat
title: Primitive 渲染异常先查 vertexFormat 与 appearance 配套——小几何加 asynchronous:false, 线宽恒被钳制
kind: pitfall
lib: cesium
tags: [Primitive, GeometryInstance, vertexFormat, appearance, 异步构建, 线宽, maximumAliasedLineWidth]
apis: [Primitive, GeometryInstance, PerInstanceColorAppearance.VERTEX_FORMAT, ColorGeometryInstanceAttribute, PolylineColorAppearance, maximumAliasedLineWidth]
errors: [Primitive 不显示或发黑, 颜色不生效, 线宽设了没用]
status: draft
successCount: 0
created: 2026-10-05
source: Cesium-Skills
---

## 什么时候用
自己拼 GeometryInstance + Primitive 渲染不出来/颜色不对, 或觉得小场景建几何莫名慢时。

## 坑
- geometry 的 `vertexFormat` 必须与 appearance 配套（如 `PerInstanceColorAppearance.VERTEX_FORMAT`）; 多个 geometry 合并进一个 Primitive 的前提也是 vertexFormat 一致。
- per-instance 颜色不能直接塞 `Cesium.Color` 对象, 要 `Cesium.ColorGeometryInstanceAttribute.fromColor(color)` + 配套的 `PolylineColorAppearance`/`PerInstanceColorAppearance`。
- Primitive 默认把几何构建丢 worker（异步）, 小几何反而慢: `asynchronous: false`。
- 线宽上限 `scene.maximumAliasedLineWidth`（Windows 多数浏览器为 1）, 超出被钳制——"width 设了没用"多半是这个。
- 拾取拿到的是 `GeometryInstance` 构造时自定义的 `id`（业务对象）。

## 参考代码（未实测）
```js
viewer.scene.primitives.add(new Cesium.Primitive({
  geometryInstances: new Cesium.GeometryInstance({
    id: { name: 'myPolygon' },
    geometry: new Cesium.PolygonGeometry({
      polygonHierarchy: new Cesium.PolygonHierarchy(
        Cesium.Cartesian3.fromDegreesArray([116, 40, 116, 39, 117, 39])),
      vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT,   // 与 appearance 配套
    }),
    attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(
      Cesium.Color.RED.withAlpha(0.5)) },
  }),
  appearance: new Cesium.PerInstanceColorAppearance(),
  asynchronous: false,   // 小几何免 worker 往返
}));
return 'primitive ok';
```

> 出处: OpenCesium/Cesium-Skills examples/2.3.8、2.3.9、patterns.md。
> 更底层手写 DrawCommand 的显存泄漏见 [[2026-10-05-drawcommand-leak]]。
