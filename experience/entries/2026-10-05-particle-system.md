---
id: 2026-10-05-particle-system
title: 粒子系统三前提——shouldAnimate、每帧刷 modelMatrix 跟 entity、emitterModelMatrix 管局部偏移
kind: pattern
lib: cesium
tags: [ParticleSystem, 粒子, 火焰, 烟, 爆炸, modelMatrix, updateCallback]
apis: [ParticleSystem, ConeEmitter, CircleEmitter, updateCallback, emitterModelMatrix, scene.preUpdate]
errors: [粒子不动, 粒子留在原点, 删了还占内存]
status: draft
successCount: 0
created: 2026-10-05
source: Cesium-Skills
---

## 什么时候用
火焰/烟/爆炸/喷雾/水枪等粒子效果不动、位置不对或删不干净时。

## 三前提 + 销毁
- `viewer.clock.shouldAnimate = true` 不开, 粒子永远不动。
- **世界位置**: 每帧 `preUpdate` 里 `ps.modelMatrix = entity.computeModelMatrix(time, new Cesium.Matrix4())`; **发射器局部偏移**是另一个矩阵 `emitterModelMatrix`（TranslationRotationScale → fromTranslationRotationScale）, 两者别混。
- 重力/浮力在 `updateCallback(p, dt)` 里改 `p.velocity`。
- 上游示例的销毁代码自带 bug（箭头函数没调用/引用对不上, 见 [[2026-10-05-frame-listener-leak]]）——正确三件套: removeEventListener + `primitives.remove` + `entities.remove`。

## 参考代码（未实测）
```js
viewer.clock.shouldAnimate = true;
const ps = viewer.scene.primitives.add(new Cesium.ParticleSystem({
  image: '/textures/fire.png', emissionRate: 5, lifetime: 16, loop: true,
  sizeInMeters: true, imageSize: new Cesium.Cartesian2(25, 25),
  startColor: Cesium.Color.WHITE, endColor: new Cesium.Color(0.5, 0, 0, 0),
  emitter: new Cesium.ConeEmitter(Cesium.Math.toRadians(45)),
  updateCallback: (p, dt) => {   // 重力
    p.velocity = Cesium.Cartesian3.add(p.velocity,
      Cesium.Cartesian3.multiplyByScalar(Cesium.Cartesian3.UNIT_Z, -9.8 * dt, new Cesium.Cartesian3()),
      p.velocity);
  },
}));
const anchor = viewer.entities.add({ position: Cesium.Cartesian3.fromDegrees(116, 39) });
const onPreUpdate = (scene, time) => {
  ps.modelMatrix = anchor.computeModelMatrix(time, new Cesium.Matrix4());
  // ps.emitterModelMatrix = Cesium.Matrix4.fromTranslationRotationScale(trs);  局部偏移走这个
};
viewer.scene.preUpdate.addEventListener(onPreUpdate);
// 销毁三件套:
// viewer.scene.preUpdate.removeEventListener(onPreUpdate);
// viewer.scene.primitives.remove(ps); viewer.entities.remove(anchor);
return ps;
```

> 出处: OpenCesium/Cesium-Skills examples/5.4.1~5.4.5。
> 时钟前提见 [[2026-10-05-should-animate-clock]]; 监听器卫生见 [[2026-10-05-frame-listener-leak]]。
