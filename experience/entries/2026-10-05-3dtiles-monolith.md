---
id: 2026-10-05-3dtiles-monolith
title: 倾斜摄影单体化两条路——alpha=0 分类面（业务面控制高亮）或 silhouette 后处理（轮廓描边）
kind: pattern
lib: cesium
tags: [单体化, 3DTiles, ClassificationType, 分类面, 高亮, 轮廓, silhouette]
apis: [ClassificationType.CESIUM_3D_TILE, PostProcessStageLibrary.createEdgeDetectionStage, PostProcessStageLibrary.createSilhouetteStage, scene.pick]
errors: [pick 拿到 Cesium3DTileFeature 没法按楼栋控制, 高亮整片 tileset]
status: draft
successCount: 0
created: 2026-10-05
source: Cesium-Skills
---

## 什么时候用
倾斜摄影上按楼栋/房间高亮, 但直接 `scene.pick` 只拿到 `Cesium3DTileFeature`（tile/feature 粒度）, 无法用业务面控制时。

## 路线 A: 分类面（未实测）
GeoJSON 面（**不带高度**）转 entity polygon, `material: Color.withAlpha(0)`（全透明仍参与拾取）, `classificationType: CESIUM_3D_TILE` 才会贴在 tileset 表面而不是地表。高亮只改 `polygon.material.color`（ColorMaterialProperty 可变）, 不重建实体。
```js
const ds = viewer.dataSources.add(new Cesium.CustomDataSource('rooms'));
ds.entities.add({ polygon: {
  hierarchy: Cesium.Cartesian3.fromDegreesArray(flatDegreesArray),  // 只经纬度
  material: Cesium.Color.WHITE.withAlpha(0),                        // 全透明仍可拾取
  classificationType: Cesium.ClassificationType.CESIUM_3D_TILE,
}});
// 点击高亮: picked.id.polygon.material.color = Cesium.Color.RED.withAlpha(1)
```

## 路线 B: silhouette 轮廓（未实测）
```js
const edge = Cesium.PostProcessStageLibrary.createEdgeDetectionStage();
edge.uniforms.color = Cesium.Color.LIME;
edge.uniforms.length = 0.01;
edge.selected = [];                                 // 数组: 赋 [picked] 高亮, 赋 [] 取消
viewer.scene.postProcessStages.add(Cesium.PostProcessStageLibrary.createSilhouetteStage([edge]));
// MOUSE_MOVE 里: const p = viewer.scene.pick(m.endPosition);
//               edge.selected = Cesium.defined(p) ? [p] : [];
```

> 出处: OpenCesium/Cesium-Skills examples/4.1.11、1.14。
> 给 tileset 整体染色走 CustomShader, 见 [[2026-10-05-custom-shader]]。
