---
id: 2026-10-04-drawer-pick-terrain
title: 鼠标拾取地表坐标的三条分支互斥；model 模式下 terrain 会静默失效
kind: pitfall
lib: cesium
tags: [drawer, pick, 拾取, 贴地, terrain, ellipsoid, pickPosition, 深度纹理]
apis: [camera.pickEllipsoid, camera.getPickRay, globe.pick, scene.pickPosition, pickPositionSupported]
errors: [点浮在地形上面, 点埋在地形里, model 无效, terrain 无效]
status: verified
successCount: 0
created: 2026-10-04
source: manual
---

## 什么时候用
需要把鼠标屏幕坐标转成地表坐标时（绘图、量算、点选都依赖这一步）

> **已封装为库**：`kit.drawer.start({ pick: 'terrain' | 'model' | 'ellipsoid' })`，
> 拾取函数也可单独用：`kit.drawer.pick(x, y, mode)`。本条保留**三条分支的能力边界**，
> 直接用原生 Cesium 时必须自己判断。

## 三条分支

| mode | 底层调用 | 能拾取到什么 | 前置条件 |
|---|---|---|---|
| `ellipsoid`（默认） | `camera.pickEllipsoid` | 只到椭球面，**完全忽略地形** | 无 |
| `terrain` | `camera.getPickRay` + `globe.pick` | 只到地形表面，**拾取不到 3D Tiles / 建筑 / 模型** | 已加载地形（有 globe） |
| `model` | `scene.pickPosition` | 任何有深度的东西（含 3D Tiles、地形） | `scene.pickPositionSupported`（需 WebGL 深度纹理） |

## 三个必踩的坑

**1. `ellipsoid` 在有地形时点位是错的。**
地形隆起处，`pickEllipsoid` 返回的点在椭球面上，即**埋在地下**。
要贴地就必须走 `terrain`。这是最常见的「点怎么 elevated 了一截 / 沉下去了」的成因。

**2. `terrain` 拾取不到挡在前面的建筑与 3D Tiles。**
`globe.pick` 是「射线 vs 地形瓦片求交」，不读深度缓冲。所以鼠标指着一栋楼，
点却落在楼后面的地面上。要点中 3D 物体必须用 `model`。
反之 `model` 依赖深度纹理，部分设备 / 老 WebGL 实现不支持。

**3. 两个布尔开关同时打开时，terrain 静默失效。**
cesium-extends 原库用 `terrain` + `model` 两个独立布尔（`drawer/src/painter.ts:70-83` 的 if/if/else），
`model` 分支排在最前且先 return，于是 `{ terrain: true, model: true }` 时 terrain 永远走不到，
**且没有任何警告**。另外它只在 `terrain` 为真时检查 `pickPositionSupported`，
`model: true` 时不检查 —— 老设备上表现为「所有点都拾取失败，返回 undefined」。

本库用互斥的 `pick` 枚举，从类型上排除了这种歧义，并在构造时对
「无 globe 却要 terrain」「不支持 pickPosition 却要 model」直接抛错说明修法。

## 代码

```js
// 贴地拾取（推荐）
const world = kit.drawer.pick(evt.clientX - rect.left, evt.clientY - rect.top, 'terrain');

// 原生 Cesium 等价写法
const ray  = viewer.camera.getPickRay(new Cesium.Cartesian2(x, y));
const cart = ray && viewer.scene.globe.pick(ray, viewer.scene);

// 要点中 3D Tiles / 建筑（注意 supported 检查）
if (viewer.scene.pickPositionSupported) {
  const cart = viewer.scene.pickPosition(new Cesium.Cartesian2(x, y));
}
```

> 相关: [[2026-10-05-default-click-handler]]（默认双击/选中行为的摘除位置——两个 handler 对象）