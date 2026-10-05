---
id: 2026-10-05-intervisibility-sampling
title: 通视分析只看地形不算建筑——沿线采样地形高与视线高比较，椭球地形必通视
kind: pattern
lib: cesium
tags: [通视, 视线, 遮挡分析, 地形采样, 可见性, 地形分析]
apis: [sampleTerrainMostDetailed, Cartographic.fromDegrees]
errors: [通视结果不准, 采样 undefined, 两点间明明有楼却通了]
status: draft
successCount: 0
created: 2026-10-05
source: manual
---

## 什么时候用
判断两点间是否被地形遮挡（瞭望塔/监控点位选址），或通视结果和肉眼不符时。

## 边界与做法
- **本方案只考虑地形**：3D Tiles / 建筑不参与遮挡——要算建筑遮挡需深度纹理方案（`pickPosition` 沿线采样，见 drawer-pick-terrain 条目的 model 分支）。
- 做法：沿线等分 N 点 → 异步采样地形高（弧度 Cartographic，见 terrain-height-timing 条目）→ 视线高 = 两端点"地形高 + 视点离地高"线性插值 → 任一点地形高超出视线高即被挡。
- **椭球地形（未启用 3D 地形）没有 availability，必然"通视"**——高程全 0 不是 bug；要真实结论先 `kit.imagery.enableTerrain3D()`。
- 上游示例（Cesium-Skills 4.1.8）走的是屏幕空间插值 + `pickPosition` 路线，随相机视角变化需重算；本方案纯数据采样，与视角无关。

## 参考代码（已封装为 `kit.analysis.intervisibility`）
```js
const see = await kit.analysis.intervisibility(
  { lon: 116.39, lat: 39.90 }, { lon: 116.42, lat: 39.93 },
  { samples: 100, eyeHeight: 1.8, tolerance: 1 },
);
// see.blocked / see.blocker(第一个遮挡点) / see.minClearance(最小净空, 负即被挡)
```

> 出处：本仓库实现，算法规格参考 Cesium-Skills examples/4.1.8、4.1.12（坡度采样的 9 点法未采用）。
> 相关：[[2026-10-04-drawer-pick-terrain]]（含模型遮挡的拾取分支）。
