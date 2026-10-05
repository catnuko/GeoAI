---
id: 2026-10-04-measure-surface-camera-dependency
title: 贴地量算依赖当前相机：换视角结果会变，点在视口外直接 NaN 而不报错
kind: pitfall
lib: cesium
tags: [measure, 贴地, surface, 相机依赖, NaN, 视口外, worldToWindowCoordinates]
apis: [SceneTransforms.worldToWindowCoordinates, camera.getPickRay, globe.pick, EllipsoidGeodesic]
errors: [面积显示 NaN, 换相机后数值变了, 同样的点两次结果不一样, 缩放后距离跳变]
status: verified
successCount: 0
created: 2026-10-04
source: manual
---

## 什么时候用
贴地量算算出 NaN、或同样的点两次测量结果不一致时

> **已封装为库**：`kit.measure` 的 `offViewport` 策略（默认 `'error'`，直接抛错并说明修法）。
> 本条保留**根因** —— 这是 Cesium 贴地量算最容易让人怀疑「是不是有 bug」的地方，实际不是。

## 根因：贴地算法必须在屏幕空间做插值

要算「两点沿地表的距离」，需要知道中间经过哪些地形。但「地表路径」本身没有唯一定义，
原库（及多数实现）的做法是：

1. 把两个点投影到**屏幕坐标**：`SceneTransforms.worldToWindowCoordinates`
2. 在两个像素点之间**线性插值**出 N 个采样点
3. 对每个采样点发一条射线，打到地形上，得到一串真实世界坐标
4. 累加这串坐标的相邻距离

第 2 步是问题的根源：**它依赖当前相机**。换个视角，同样的两个地理点会得到不同的中间采样点，
因而得到不同的地表折线长度。

## 由此产生的两个现象

**1. 视口外的点 → NaN，且不报错。**
原库代码：

```ts
const win = SceneTransforms.worldToWindowCoordinates(scene, item)!;  // 视口外返回 undefined
// 之后 undefined 进了 Math.min / Math.max → NaN
```

`!` 是 TypeScript 的非空断言，运行时不做检查。于是用户看到「面积：NaN」，
而代码全程没报错，日志里也干干净净 —— 这类 bug 极难定位。

**2. 同一组点、不同相机 → 不同的值。**
这不是 bug，是算法的固有性质：贴地路径的定义依赖视角。
一般来说，视角越接近俯视、采样越密，结果越接近真实地表距离。

## 修法（本库的做法）

```js
// 默认：视口外直接抛错，信息里给出两条修法
kit.measure.area(points);                        // 抛错，提示先 flyToRegion 或改 plane

// 明确知道自己在视口外，只想要个量级
kit.measure.area(points, 'plane');                // 椭球面几何，零相机依赖

// 必须 surface 且点在视口外时的折中
kit.measure.area(points, 'surface', { offViewport: 'clamp' });  // 投影到视口边缘
```

`offViewport: 'skip'` 对面积无效（少一个顶点就构不成闭合多边形），库里会显式报错说明。

## 关键实践建议

**贴地量算前先把目标区域取进画面。**

```js
const bbox = { west: 116.38, south: 39.89, east: 116.43, north: 39.94 };
await kit.camera.flyToRegion(bbox, { duration: 1 });   // 见 camera kit
const a = kit.measure.area([...]);                     // 此时才算贴地面积
```

这也解释了为什么 `kit.measure` 的签名把 `mode` 默认成 `surface` 却仍然要求点可见：
它宁可**报错让你先把点取进画面**，也不愿悄悄给你一个依赖当前视角的数字。
需要完全不受相机影响的量算，就显式用 `plane`。