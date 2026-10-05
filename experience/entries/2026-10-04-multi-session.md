---
id: 2026-10-04-multi-session
title: 多标签页并行用 ?session=区分; 同 id 后连入会替换先连入
kind: pattern
lib: cesium
tags: [session, 多会话, 多标签页, 并行]
apis: []
errors: [发到了别的页面]
status: verified
successCount: 0
created: 2026-10-04
source: manual
---

## 什么时候用
想同时开多个 Cesium 页面并行驱动(比如对比两种方案)时

## 代码（已验证）
```js
// 页面 URL 带 ?session=<id> 连入不同会话:
//   http://127.0.0.1:3000/?session=dev
//   http://127.0.0.1:3000/?session=test
// send_code / run_code 传 sessionId: 'dev' 定向发送; 不填则发给最近连入的页面。
// 同一个 session id 被第二个页面连入时, 先连入的会被断开(后连替换先连)。
return 'open pages with ?session=a and ?session=b, then target them by sessionId';
```
