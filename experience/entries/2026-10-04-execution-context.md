---
id: 2026-10-04-execution-context
title: 页面执行上下文只有 viewer 和 Cesium 两个变量
kind: pattern
lib: cesium
tags: [viewer, Cesium, 执行上下文, 全局变量]
apis: [viewer, Cesium]
errors: []
status: verified
successCount: 0
created: 2026-10-04
source: manual
---

## 什么时候用
在 geoai 页面写任何代码前, 需要知道能用什么变量时

## 代码（已验证）
```js
// 代码以 AsyncFunction('viewer','Cesium', code) 包装执行:
// - viewer: Cesium.Viewer 实例 (页面右侧地球)
// - Cesium: CesiumJS 全局对象
// - 支持顶层 await (provider 的 fromUrl 等异步工厂可直接 await)
// 没有其他注入变量; 需要 DOM/网络等走页面原生能力, 同源权限全部可用(无沙箱)。
return typeof viewer + '/' + typeof Cesium; // "object/object"
```
