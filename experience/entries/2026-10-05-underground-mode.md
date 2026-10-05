---
id: 2026-10-05-underground-mode
title: 地下模式三件套缺一不可——关碰撞检测 + 开地表半透明 + 关深度检测
kind: pattern
lib: cesium
tags: [地下模式, 地表透明, 管线, collisionDetection, translucency, frontFaceAlphaByDistance]
apis: [screenSpaceCameraController.enableCollisionDetection, globe.translucency.enabled, globe.translucency.frontFaceAlphaByDistance, NearFarScalar, globe.baseColor]
errors: [相机进不了地下, 地表透不下去, 只透出影像不透地形]
status: draft
successCount: 0
created: 2026-10-05
source: Cesium-Skills
---

## 什么时候用
要看地下管线/矿井等地下空间, 钻进地下时发现地球挡着、或透明不彻底时。

## 三件套（未实测）
```js
viewer.scene.globe.depthTestAgainstTerrain = false;              // ① 深度检测先关
viewer.scene.screenSpaceCameraController.enableCollisionDetection = false;  // ② 不关钻不下去
viewer.scene.globe.translucency.enabled = true;                  // ③ 地表半透明
viewer.scene.globe.translucency.frontFaceAlphaByDistance =
  new Cesium.NearFarScalar(500.0, 0.0, 1000.0, 1.0);             // 近处全透, 1000m 外不透明
viewer.scene.globe.baseColor = new Cesium.Color(0, 0, 0, 0);
// 影像层要另设 layer.alpha, 否则只透出影像不透地形
return 'underground ready';
```

> 出处: OpenCesium/Cesium-Skills examples/1.13、1.10。
