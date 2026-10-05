---
id: 2026-10-05-video-texture
title: 视频上球两条路——video 元素直接当 polygon 材质（必须 play()）或视锥体几何投影到地面
kind: pattern
lib: cesium
tags: [视频, 视频投射, 监控, HLS, 视锥体, 投影]
apis: [PerspectiveFrustum, FrustumOutlineGeometry, IntersectionTests.rayEllipsoid, HTMLVideoElement]
errors: [polygon 黑色一片, 视频不动, 投影区错位]
status: draft
successCount: 0
created: 2026-10-05
source: Cesium-Skills
---

## 什么时候用
监控视频贴墙/投到地面, polygon 全黑或视频不动时。

## 两条路线 + 坑
- **路线 A（简单）**: polygon 的 `material` 直接收 `HTMLVideoElement`。不 `play()` 纹理就是黑的; 跨域视频注意 CORS 与自动播放策略（`muted`）; HLS 流要等 `Hls.Events.MANIFEST_PARSED` 再 play。
- **路线 B（几何投影）**: 构 `PerspectiveFrustum` → `FrustumOutlineGeometry.createGeometry` 拿远端四角 → 4 条棱与椭球求交（`IntersectionTests.rayEllipsoid`, 取落在线段内的 t）→ 交点组地面 polygon + video 材质 + `perPositionHeight: true`。静态投影, 不随镜头同步; 上游示例**没有**用 VideoSynchronizer, 要镜头同步得自己写。
- 视锥体姿态构造借临时 `new Cesium.Camera(viewer.scene)`: 设 position/direction/up 后取 `rightWC`（**取反**）/`upWC`/`directionWC` 按列拼 `Quaternion.fromRotationMatrix`。

## 参考代码（未实测, 路线 A）
```js
const video = document.getElementById('video_dom');   // 页面里需有 <video> 元素
video.muted = true;                                   // 自动播放策略
await video.play();                                   // 不 play 纹理黑
viewer.entities.add({ polygon: {
  hierarchy: { positions: Cesium.Cartesian3.fromDegreesArrayHeights(
    [116,39,10, 117,39,10, 117,40,10, 116,40,10]) },
  material: video,
  perPositionHeight: true,
}});
return 'video polygon ok';
```

> 出处: OpenCesium/Cesium-Skills examples/4.3.1、4.3.2 各变体。
