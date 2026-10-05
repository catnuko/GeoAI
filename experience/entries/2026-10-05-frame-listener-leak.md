---
id: 2026-10-05-frame-listener-leak
title: preRender/onTick/preUpdate 监听器不摘是越用越卡的大头——cartesianToCanvasCoordinates 相机后方返回 undefined
kind: pitfall
lib: cesium
tags: [内存泄漏, preRender, onTick, preUpdate, addEventListener, 事件监听, cartesianToCanvasCoordinates]
apis: [scene.preRender.addEventListener, clock.onTick.addEventListener, scene.preUpdate.addEventListener, scene.cartesianToCanvasCoordinates]
errors: [页面越用越卡, 删了实体还占内存, 每帧回调停不下来]
status: draft
successCount: 0
created: 2026-10-05
source: Cesium-Skills
---

## 什么时候用
HTML 弹窗跟随/动态效果绑定相机循环后页面越来越卡; 或反复触发交互后内存不降时。

## 根因与反面教材
每帧监听器闭包持有 entity/primitive, 不 remove 就永久挂在场景上。Cesium-Skills 的示例自己就带这个病:
① 气泡窗口示例在**每次点击里** addEventListener 且从不 remove;
② 粒子类的 remove() 写成 `() => { return this.removeEvent(); }` ——只创建了箭头函数**没调用**;
③ `removeEventListener(this.preUpdateEvent)` 传的是从未注册过的引用（注册时是匿名函数）, **永远移除不掉**。

## 正确做法（未实测）
```js
let onPreRender;   // 模块级存引用, 重复绑定前先摘
function bindPopup(position, el) {
  if (onPreRender) viewer.scene.preRender.removeEventListener(onPreRender);
  const scratch = new Cesium.Cartesian2();
  onPreRender = () => {
    const p = viewer.scene.cartesianToCanvasCoordinates(position, scratch);
    if (Cesium.defined(p)) {   // 目标在相机后方时返回 undefined, 不判会 NaN
      el.style.left = p.x + 'px'; el.style.top = p.y + 'px';
    }
  };
  viewer.scene.preRender.addEventListener(onPreRender);
}
return 'bound';
```

> 出处: OpenCesium/Cesium-Skills examples/1.9、2.3.13、0.js（后两者是反面教材）。
> 后台标签页这些每帧回调同样不跑, 见 [[2026-10-04-background-raf]];
> 海量点每帧更新与粒子绑定的场景见 [[2026-10-05-mass-points-collections]]、[[2026-10-05-particle-system]]。
