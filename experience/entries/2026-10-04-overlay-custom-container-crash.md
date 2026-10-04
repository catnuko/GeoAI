---
id: 2026-10-04-overlay-custom-container-crash
title: DOM 跟随层挂自定义容器时销毁必崩；enabled 重复赋值会让内容翻倍
kind: pitfall
tags: [overlay, popup, tooltip, DOM, 销毁, removeChild, NotFoundError, 生命周期]
apis: [SceneTransforms.worldToWindowCoordinates, Occluder, scene.postRender.addEventListener]
errors: [NotFoundError, 节点不是该节点的子节点, 内容显示两遍, destroy 后 DOM 残留]
status: verified
successCount: 0
created: 2026-10-04
source: manual
---

## 什么时候用
自己实现「HTML 元素跟随地理坐标」的弹窗/提示层时

> **已封装为库**：`kit.overlay.popup / popupAtScreen / tooltip / flash`，
> 挂载与销毁已修正（见 `list_libs` → overlay）。本条保留**两个必踩坑的根因**，
> 这是所有「DOM 跟随层」实现（含 Leaflet / Mapbox / Cesium 各家插件）的通用问题。

## 坑 1：挂载与卸载用了不同的容器 → destroy() 必崩

任何自己写的跟随层都要做两件事：**挂载**（appendChild）和**卸载**（removeChild）。
只要这两件事的目标容器不是同一个，`removeChild` 就会抛 `NotFoundError`：

```
Uncaught NotFoundError: The node to be removed is not a child of this node.
```

cesium-extends 原库的 `common/src/Widget.ts` 就是这样：

```ts
// 挂载：用传入的 container
if (!this._wrapper.parentNode) this._viewer.container.appendChild(this._wrapper);
// 卸载：写死 viewer.container —— 自定义 container 时必崩
if (this._wrapper.parentNode) this._viewer.container.removeChild(this._wrapper);
```

只在 `container === viewer.container`（默认值）时侥幸能跑。一旦把弹窗放进自己 UI 面板里，
`destroy()` 就炸。而销毁通常发生在页面切换或重绘时，所以表现为「用了一会儿就崩」。

**修法**：卸载走 `parentNode` 而不是「原定的容器」——元素实际挂在哪就从哪摘。

```js
// 正确：永远从实际父节点摘除
this._wrapper.remove();          // 等价于 wrapper.parentNode?.removeChild(wrapper)
```

## 坑 2：`enabled` 的 setter 有副作用 → 内容翻倍

原库的 `_enableHook` 里是 `if (!this._ready) this._mountContent()`，
而 `destroy()` 把 `_ready` 置回 `false`。于是「destroy → 再 enable」时
`_mountContent()` 会**把子节点再追加一遍**，表现为内容显示两遍。

同时 `set enabled(v)` 无论值是否变化都会执行 `_enableHook`，
也就是每次赋值都重新 append/remove DOM 并重新绑定事件。

**修法**：把「内容是否已进 DOM」与「是否显示」拆成两个独立标记，
只在真正首次挂载时建内容；`enabled` 赋同值直接 return。

```ts
set enabled(on: boolean) {
  if (this._disposed) return;
  if (on === this._visible) return;   // 赋同值不做任何 DOM 操作
  this._visible = on;
  if (on) { this._mount(); this._wrapper.style.display = 'block'; this._onShow(); }
  else    { this._wrapper.style.display = 'none';              this._onHide(); }
}
```

## 顺带两个小坑（本库也修了）

- **Occluder 半径硬编码 6350000**（`popup/src/index.ts:78-82`）。这是 WGS84 的赤道半径，
  换椭球（或其他 planet provider）时背面剔除完全失效。应用 `Ellipsoid.WGS84.maximumRadius`。
- **destroy 后 postRender 回调仍在跑**：原库 `destroy()` 把 `setPosition` 置为 `undefined`
  再靠 removeEventListener，但解绑写在 `isDestroyed()` 守卫里 ——
  viewer 先销毁时监听就漏了。应「先解绑再摘 DOM」，让在途回调无处可去。

## 代码（kit 用法）

```js
// 经纬度锚定弹窗，随相机跟随，转到球背面自动隐藏
const p = kit.overlay.popup({
  lon: 116.39, lat: 39.90,
  content: '<b>标题</b><br/>说明',
});
p.setText('纯文本，自动转义');   // 走 textContent，免疫 XSS
p.moveTo({ lon: 116.42, lat: 39.95 });
p.close();                      // 解绑 postRender + 摘 DOM，可重复调用

// 放进自己的 UI 面板容器（不再有 NotFoundError 风险）
kit.overlay.tooltip({ container: document.getElementById('myPanel'), content: '提示' });

kit.overlay.closeAll();          // 一次性清掉全部跟随层
```