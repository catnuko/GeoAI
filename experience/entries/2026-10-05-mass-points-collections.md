---
id: 2026-10-05-mass-points-collections
title: 上万点位别用 Entity——走 Collection 一次 batch; 聚合的 clusterEvent 监听会叠加、改样式要强制重聚
kind: pattern
lib: cesium
tags: [海量点, 性能, BillboardCollection, PointPrimitiveCollection, LabelCollection, 聚合, NearFarScalar]
apis: [BillboardCollection, PointPrimitiveCollection, LabelCollection, NearFarScalar, clustering.clusterEvent, scaleByDistance]
errors: [几万个点帧率崩, 聚合样式改了不变, 点击聚合点取不到实体]
status: draft
successCount: 0
created: 2026-10-05
source: Cesium-Skills
---

## 什么时候用
点位/图标上万导致掉帧, 或做点聚合时样式更新不生效时。

> **已封装为库**：`kit.points.addMany([{lon,lat,color|image},...], { scaleByDistance, clampToGround })`
> ——自动选 Billboard/PointPrimitive Collection, 贴地配防遮挡双保险, `kit.points.clear()` 一键清空。见 `list_libs` → points。

## 两条性能红线
- 5 万级点位逐个 add Entity 是灾难（上游原注释 "entityCollection 方式加载, 不推荐"）; 用 `BillboardCollection` / `PointPrimitiveCollection` / `LabelCollection` 直入 `scene.primitives`, 单次 batch 渲染。移除: `viewer.scene.primitives.remove(coll)`。
- 远近视觉: `scaleByDistance` / `translucencyByDistance` / `pixelOffsetScaleByDistance` + `NearFarScalar(near, nearValue, far, farValue)`。

## 聚合三个坑（未实测）
```js
const ds = await Cesium.GeoJsonDataSource.load(geojson);   // 万级点
viewer.dataSources.add(ds);
ds.clustering.enabled = true;
ds.clustering.pixelRange = 20;
const onCluster = (clustered, cluster) => {
  cluster.label.show = false; cluster.billboard.show = true;
  cluster.billboard.id = cluster.label.id;   // 点击聚合点取回实体群的钥匙
  cluster.billboard.image = pinFor(clustered.length);
};
ds.clustering.clusterEvent.addEventListener(onCluster);
// 换样式后聚合图不变 → pixelRange 置 0 再还原, 强制重算:
// ds.clustering.pixelRange = 0; ds.clustering.pixelRange = 20;
// 换监听必须先摘(addEventListener 重复调用是叠加不是覆盖):
// ds.clustering.clusterEvent.removeEventListener(onCluster);
return ds;
```

> 出处: OpenCesium/Cesium-Skills examples/2.3.5、2.3.4、2.3.17。
> 每帧更新海量 billboard 的监听器泄漏见 [[2026-10-05-frame-listener-leak]]。
