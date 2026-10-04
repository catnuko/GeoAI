---
id: 2026-10-04-return-value-json
title: return 的值会被序列化回传给模型, 忘写 return 则返回 undefined
kind: pattern
tags: [return, 返回值, 调试]
apis: []
errors: [undefined]
status: verified
successCount: 0
created: 2026-10-04
source: manual
---

## 什么时候用
想让 run_code 把计算结果带回给模型(而非只看页面效果)时

## 代码（已验证）
```js
// 返回值经 JSON 序列化回传: 字符串带引号, 对象/数组原样, undefined 显示为 "undefined"
const center = Cesium.Cartesian3.fromDegrees(121.4998, 31.2397);
return { lon: 121.4998, height: 3000, ok: true };
// run_code 返回: 执行成功，返回：{"lon":121.4998,"height":3000,"ok":true}
// 忘记 return 时模型只会看到 "undefined" —— 想报告状态就显式 return
```
