---
id: 2026-10-04-cesium-monaco-order
title: 自建页面集成时 Cesium.js 必须先于 Monaco loader.js 加载
kind: pitfall
lib: cesium
tags: [Cesium, Monaco, 加载顺序, define.amd, 集成]
apis: []
errors: [Can only have one anonymous define call per script file, window.Cesium 未定义]
status: verified
successCount: 0
created: 2026-10-04
source: manual
---

## 什么时候用
自己搭 Cesium + Monaco 页面时地球全黑、window.Cesium 未定义且控制台几乎无报错时

## 现象 / 报错
Cesium 打包产物内含 UMD 模块(如 ipv6)会检测全局 define.amd; 若 Monaco 的 AMD loader 先执行并注入 define, Cesium 走 define(t) 分支, 而 Monaco loader 拒绝匿名 define。

## 修法（已验证代码）
```html
<!-- index.html 里的顺序不可调换: 先 Cesium, 后 Monaco loader -->
<script src="https://cdn.jsdelivr.net/npm/cesium@1.121.1/Build/Cesium/Cesium.js"></script>
<script src="https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs/loader.js"></script>
```
