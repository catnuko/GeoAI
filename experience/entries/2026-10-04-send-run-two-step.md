---
id: 2026-10-04-send-run-two-step
title: send_code 只把代码放进编辑器, run_code 才执行; 下发是整体覆盖不是追加
kind: pattern
lib: cesium
tags: [send_code, run_code, 编辑器, 覆盖]
apis: []
errors: [代码没执行, 改了没生效]
status: verified
successCount: 0
created: 2026-10-04
source: manual
---

## 什么时候用
下发代码后页面"没反应", 或想修改已下发代码时

## 代码（已验证）
```js
// 两步分离:
// 1) send_code { code }  -> editor.setValue(code), 只更新编辑器, 不执行
// 2) run_code {}         -> 执行编辑器当前内容并回传结果
// send_code 是整体覆盖(editor.setValue), 不是拼接 —— 修改代码要发完整新版本。
// 想检查页面当前编辑器内容: return editor.getValue().length;
```
