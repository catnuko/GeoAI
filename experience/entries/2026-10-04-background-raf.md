---
id: 2026-10-04-background-raf
title: 页面在后台时 rAF 可能停摆, flyTo 动画不推进; 验证脚本优先 setView
kind: pitfall
lib: cesium
tags: [flyTo, 后台标签页, requestAnimationFrame, 动画, setView]
apis: [camera.flyTo, camera.setView]
errors: [flyTo 卡住, 动画不动, 相机没到]
status: verified
successCount: 0
created: 2026-10-04
source: manual
---

## 什么时候用
代码"执行成功"但相机长时间没到位, 尤其页面不在前台时

## 现象 / 报错
浏览器对后台标签页会暂停/节流 requestAnimationFrame, flyTo 的逐帧动画可能停滞。

## 修法（已验证代码）
```js
// 需要相机"确定到位"(自动化/验证场景): 用 setView 瞬时定位, 不依赖动画帧
viewer.camera.setView({
  destination: Cesium.Cartesian3.fromDegrees(121.4998, 31.2397, 50000),
});
// 展示用动画可继续用 flyTo, 但要知道后台可能不推进; 保持页面前台即可恢复
return 'setView is instantaneous, rAF-independent';
```

> 相关: [[2026-10-05-frame-listener-leak]]（每帧监听器的泄漏——同一批后台也不跑的回调）
