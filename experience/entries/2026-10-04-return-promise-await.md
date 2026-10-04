---
id: 2026-10-04-return-promise-await
title: return 一个 Promise 会被等待, 异步结果经回执返回给模型
kind: pattern
tags: [异步, Promise, await, 回执, setTimeout]
apis: []
errors: []
status: verified
successCount: 0
created: 2026-10-04
source: manual
---

## 什么时候用
代码里有异步操作(动画、setTimeout、fetch、Entity 加载完成回调), 想让 run_code 等到结果再返回时

## 代码（已验证）
```js
// 页面执行器对返回值做 Promise.resolve(ret).then(...):
// return 一个 Promise, run_code 的回执会等它 settle, 把 resolved 值(或异常)返回给模型
return new Promise((resolve) => {
  setTimeout(() => resolve('async-ok'), 800);
});
// run_code 返回: 执行成功 (session=default)，返回："async-ok"
```
