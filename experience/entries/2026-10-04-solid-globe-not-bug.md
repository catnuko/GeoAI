---
id: 2026-10-04-solid-globe-not-bug
title: 地球是纯色深蓝不是渲染故障——未配置天地图 key 的合规默认
kind: pitfall
tags: [底图, 天地图, 纯色地球, 影像]
apis: [globe.baseColor, showGraticule]
errors: [地球全黑, 没有地图, 纯色球]
status: verified
successCount: 0
created: 2026-10-04
source: manual
---

## 什么时候用
看到地球是深蓝纯色/只有经纬网、以为渲染挂了时

## 现象 / 报错
页面日志明确提示「未配置天地图 key：以纯色地球 + 经纬网渲染（不影响 MCP 桥接验证）」。

## 修法（已验证代码）
```js
// 这是合规默认: 境外 OSM 直连瓦片不符合国内地图合规要求, 项目默认不加载影像。
// 要真实影像: 到 lbs.tianditu.gov.cn 申请 key, 在 playgrounds/cesium/main.js 顶部替换 TIANDITU_TK 后重新构建。
// 桥接/相机/实体等一切功能不受影响 —— 不要把它当 bug 修。
return 'solid globe is by design (no tianditu key)';
```
