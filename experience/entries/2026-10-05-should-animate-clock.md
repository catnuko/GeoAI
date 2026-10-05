---
id: 2026-10-05-should-animate-clock
title: 时间驱动动画不动先查 viewer.clock.shouldAnimate——CZML/模型动画/插值运动全被它卡住
kind: pitfall
lib: cesium
tags: [clock, shouldAnimate, CZML, SampledPositionProperty, 动画不动, JulianDate, availability]
apis: [clock.shouldAnimate, SampledPositionProperty, VelocityOrientationProperty, JulianDate.addHours, availability, clock.multiplier]
errors: [CZML 不动, 卫星不飞, 模型沿路径不动, 动画时间差 8 小时]
status: draft
successCount: 0
created: 2026-10-05
source: Cesium-Skills
---

## 什么时候用
设了 startTime/stopTime/SampledPositionProperty 但画面纹丝不动, 或动画时间差 8 小时时。

> **已封装为库**：`const h = kit.motion.animatePath([{lon,lat,height?},...], { duration, multiplier, loop })`
> ——shouldAnimate / UTC+8 / availability 三坑内置, `h.stop()` 摘实体并恢复接入前的时钟。见 `list_libs` → track。

## 三个坑
- **不开 `viewer.clock.shouldAnimate = true` 永远静止**——时钟不动, 一切时间驱动（路径插值/CZML/glTF 动画/粒子）都不动。
- `JulianDate.fromDate(new Date())` 解析的是 **UTC**, 比北京时间慢 8 小时 → `Cesium.JulianDate.addHours(j, 8, new Cesium.JulianDate())`。
- entity 的 `availability` 必须覆盖当前时间区间, 否则**整段不可见**（不是停在起点）。

## 参考代码（未实测）
```js
const start = Cesium.JulianDate.addHours(Cesium.JulianDate.fromDate(new Date()), 8, new Cesium.JulianDate());
const stop = Cesium.JulianDate.addSeconds(start, 360, new Cesium.JulianDate());
Object.assign(viewer.clock, {
  startTime: start.clone(), stopTime: stop.clone(), currentTime: start.clone(),
  clockRange: Cesium.ClockRange.LOOP_STOP, multiplier: 10, shouldAnimate: true,  // 关键
});
const prop = new Cesium.SampledPositionProperty();
prop.addSample(start, Cesium.Cartesian3.fromDegrees(116, 39, 1000));
prop.addSample(stop, Cesium.Cartesian3.fromDegrees(117, 40, 1000));
viewer.entities.add({
  availability: new Cesium.TimeIntervalCollection([
    new Cesium.TimeInterval({ start, stop })]),                  // 不覆盖则整段不可见
  position: prop,
  orientation: new Cesium.VelocityOrientationProperty(prop),     // 朝向沿速度
  path: { show: true, width: 2, material: Cesium.Color.PINK },
});
return 'clock running';
```

> 出处: OpenCesium/Cesium-Skills examples/1.8、2.3.18、2.4.8。
> 粒子系统同样受 shouldAnimate 制约, 见 [[2026-10-05-particle-system]]。
