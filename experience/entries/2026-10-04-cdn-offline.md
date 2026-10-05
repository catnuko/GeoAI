---
id: 2026-10-04-cdn-offline
title: 离线/内网环境页面起不来——Cesium 与 Monaco 走 jsDelivr CDN
kind: pitfall
lib: cesium
tags: [CDN, 离线, 内网, jsDelivr, 白屏]
apis: []
errors: [CesiumJS 未加载成功, Cesium is not defined, monaco 未加载]
status: verified
successCount: 0
created: 2026-10-04
source: manual
---

## 什么时候用
页面右侧全空、控制台报 Cesium/monaco 未定义, 且机器不能访问公网时

## 现象 / 报错
playgrounds/cesium/main.js 显式检查: 「CesiumJS 未加载成功。请检查网络能否访问 cdn.jsdelivr.net」

## 修法（已验证代码）
```js
// 这不是代码 bug: index.html 从 jsDelivr 加载 Cesium@1.121.1 与 monaco-editor@0.52.2。
// 离线内网方案: 改 npm 依赖 + vite-plugin-static-copy 复制 Cesium 资源,
// 并重新验证 Cesium 先于 Monaco loader 的加载顺序(见 cesium-monaco-order 条目)。
return 'offline requires local assets, see README 已知限制 #3';
```
