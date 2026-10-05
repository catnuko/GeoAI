---
id: 2026-10-05-camera-roaming-listeners
title: 绕点飞行/限俯仰都靠 onTick 每帧校正——监听器必须自清理, 上游示例还埋了逗号表达式坑
kind: pitfall
lib: cesium
tags: [绕点飞行, 巡检, 限制视角, 俯仰, onTick, 漫游, 监听器泄漏]
apis: [clock.onTick.addEventListener, camera.setView, camera.moveBackward, clock.shouldAnimate]
errors: [绕点飞行停不下来, 页面越用越卡, 限制视角不生效, 相机根本不动]
status: draft
successCount: 0
created: 2026-10-05
source: Cesium-Skills
---

## 什么时候用
做绕点环绕飞行（巡检/展示）或限制相机俯仰范围，发现停不下来、不生效或相机不动时。

## 坑
- **onTick 监听器不自清理**：上游 1.16（绕点飞行）、1.21（限俯仰）的监听器从不移除——切场景/重复调用会叠加, 页面越来越卡（同源问题见 [[2026-10-05-frame-listener-leak]]）。`clock.onTick.addEventListener` 的返回值就是移除函数, 存下来在 stop 里调用。
- **时钟不走环绕就不动**：绕点飞行按 `clock.currentTime` 推进角度, `shouldAnimate = false` 时完全静止——先开时钟。
- **上游示例自带 bug**：1.21 里 `cameraController, enableLook = false` 是逗号表达式, **根本没有赋值**——照抄示例是坑。
- 限俯仰的正确姿势是每帧 `setView` 只传 `orientation`（不动位置）, pitch 钳制到 `[min, max]`。

## 参考代码（已封装为库）
```js
// 绕点巡检: 时钟自动开, stop() 摘监听并恢复接入前的时钟状态
const orbit = kit.motion.orbitAround({ lon: 116.39, lat: 39.9 }, { radius: 50000, degreesPerSecond: 12 });
// orbit.stop();

// 限制俯仰: 只允许 -60° ~ -20° 之间
const limit = kit.motion.limitPitch({ minPitch: -60, maxPitch: -20 });
// limit.stop();
```

> 出处: OpenCesium/Cesium-Skills examples/1.16、1.21（上游监听器泄漏为反面教材）, 本仓库实现。
> 相关: [[2026-10-05-should-animate-clock]]（时钟前提）。
