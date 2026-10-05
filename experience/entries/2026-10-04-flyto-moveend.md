---
id: 2026-10-04-flyto-moveend
title: camera.flyTo 不返回 Promise, 想等动画结束用 moveEnd.addEventListener
kind: pitfall
lib: cesium
tags: [flyTo, 相机, 动画, 等待, moveEnd, Promise]
apis: [camera.flyTo, camera.moveEnd.addEventListener]
errors: [flyTo 返回 undefined, 等不到动画结束, camera.once is not a function]
status: verified
successCount: 0
created: 2026-10-04
source: manual
---

## 什么时候用
想让 run_code 等相机飞行动画真正结束再返回结果时

> **已封装为库**：`kit.camera.flyTo()` / `flyToPoint()` / `flyToRegion()` 全部返回真正 resolve 的
> Promise（内部监听 `moveEnd`），并自带超时 + 后台标签页提示。优先用库。
> 本条保留的价值是**边界条件**：绕过库直接调 `viewer.camera.flyTo` 时必须自己处理这两点。

## 现象 / 报错
两个连续的坑: ① Cesium 1.121 的 camera.flyTo 返回 undefined（不是 Promise），return 它立刻得到 "undefined"；② camera 不是 Node EventEmitter，没有 .once/.on，Cesium 事件用 Cesium.Event 的 addEventListener。

## 修法（已验证代码）
```js
// moveEnd 是 Cesium.Event: addEventListener 返回移除函数, 用完即拆
// 注意: 动画依赖 rAF, 页面处于后台时不推进 —— 等待前确保页面前台(见 background-raf 条目)
return new Promise((resolve) => {
  const remove = viewer.camera.moveEnd.addEventListener(() => {
    remove();
    resolve('moveEnd-ok');
  });
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(121.4998, 31.2397, 20000),
    duration: 1.0,
  });
});
// run_code 返回: 执行成功，返回："moveEnd-ok"（且回执耗时 ≥ duration）
```

> 相关: [[2026-10-05-flyto-easing]]（终点减速顿挫的缓动参数）
