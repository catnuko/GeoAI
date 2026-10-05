---
id: 2026-10-04-drawer-state-machine
title: 绘图交互状态机与 once/dynamicStyle 的真实语义（原库文档与实现矛盾）
kind: pattern
lib: cesium
tags: [drawer, 绘图, 状态机, once, dynamicStyle, 交互, draw]
apis: [ScreenSpaceEventHandler, CallbackProperty, entities.add, PolygonHierarchy]
errors: [画完一个就停了, 预览样式不生效, 重复 start 泄漏]
status: verified
successCount: 0
created: 2026-10-04
source: manual
---

## 什么时候用
需要让用户在地图上用鼠标勾画点/线/面/圆/矩形，并拿到最终坐标时

> **已封装为库**：`kit.drawer.start({ type, ... })`，回调 `onEnd(result)` 拿纯 JSON 坐标
> （见 `list_libs` → drawer）。本条保留的是**状态机与两个反直觉默认值**的成因，
> 直接用原生 Cesium 手写交互时会踩。

## 状态机

```
INIT ──start()──▶ DRAWING ──双击/end事件──▶ (固化图形) ──once=true──▶ PAUSE
  ▲                   │  │
  │                   │  └──cancel()──▶ INIT
  └──reset/clear──────┘
```

绘制中的点分成两类：**固定点**（左键落下，有断点标记）与**跟随点**（最后一个，实时跟鼠标）。
鼠标移动时只改跟随点，所以绘制过程中的 `onPointsChange` 会高频触发 —— 别在里面做重活。

## 两个反直觉的默认值（cesium-extends 原库的坑，已在 kit 里改掉）

**1. `once` 文档写 undefined、实现是 true。**
原库 `drawer/src/index.ts:244` 是 `config.once ?? true`，而 `typings.ts` 的 JSDoc 写 `@default undefined`。
结果：默认画完一个就 `pause()`，想连续画多个必须显式 `once: false`。本库显式默认 `false`。

**2. `sameStyle: true` 让预览样式彻底失效。**
原库判定式是 `isDynamic && !sameStyle ? dynamicOptions : finalOptions`（见 `shape/polygon.ts:57` 等四处）。
默认 `sameStyle: true` → `!sameStyle` 恒为 false → **`dynamicOptions` 永远不会被选中**。
本库把它拆成两个独立选项 `style`（最终）与 `dynamicStyle`（绘制中），行为可见可预期。

## 代码（kit 用法）

```js
// 画一个贴地多边形：左键加点 / 右键撤销最后一点 / 双击结束
const result = await new Promise((resolve) => {
  kit.drawer.start({
    type: 'POLYGON',
    pick: 'terrain',                                  // 见 drawer-pick-terrain 条目
    style: { color: '#00CED1', outlineColor: '#FFD700' },   // 画完的样式
    dynamicStyle: { color: '#00CED1', alpha: 0.15 },        // 绘制中的预览样式
    once: false,                                      // 默认 false，可连续画
    onEnd: resolve,                                   // 拿到 { ok, type, points, count }
  });
});
return result.points;   // [{ lon, lat, height }, ...] 纯 JSON
```

## 清理

- `cancel()` 取消当前绘制（清断点与预览，保留已画图形）
- `pause()` 结束绘制但保留图形
- `clear()` 清空本库画出的全部图形
- `kit.dispose()` 会连带清掉所有图形并解绑事件

原库在 `start()` 里先 `_initPainter()` 再判 `status === 'START'`，重复 start 会 new 一个新 Painter
顶替旧的，旧的断点实体永远无法清理。本库先判状态再建会话，无此问题。