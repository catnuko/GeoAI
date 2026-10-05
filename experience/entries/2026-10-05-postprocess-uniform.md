---
id: 2026-10-05-postprocess-uniform
title: PostProcessStage 的 uniform 可以传函数每帧求值——stage 只有 add/remove, 换效果先 remove 旧的
kind: pattern
lib: cesium
tags: [PostProcessStage, uniform, 高度雾, 后处理, 雨雪, 每帧求值]
apis: [PostProcessStage, postProcessStages.add, postProcessStages.remove, czm_unpackDepth, czm_windowToEyeCoordinates, czm_inverseView]
errors: [雾不跟相机走, 效果叠加越来越卡]
status: draft
successCount: 0
created: 2026-10-05
source: Cesium-Skills
---

## 什么时候用
做高度雾/雨雪等全屏效果需要参数随相机变化; 或换效果后越来越卡时。

> **已封装为库**：`kit.effects.rain() / snow() / fog({ density, color })`——WebGL2 shader 内置,
> 句柄 `h.remove()` / `kit.effects.stopAll()` 负责摘除。见 `list_libs` → effects。

## 要点
- uniform 值可以是**函数**, Cesium 每帧求值——跟随相机高度的唯一写法。
- stage 没有"替换"语义, 重挂前必须 `postProcessStages.remove(stage)`, 否则叠加变卡（上游封装类甚至要求 `skyBox.removePostProcessStage()` 后再建新效果）。
- 深度反算世界坐标三步: `czm_unpackDepth(texture(depthTexture, uv))` → `czm_windowToEyeCoordinates(gl_FragCoord.xy, depth)` → `czm_inverseView * (eye / eye.w)`; `depth == 0.0` 是天空, 按无穷远处理。

## 参考代码（未实测）
```js
const fog = viewer.scene.postProcessStages.add(new Cesium.PostProcessStage({
  fragmentShader: `
    uniform sampler2D colorTexture; uniform sampler2D depthTexture;
    in vec2 v_textureCoordinates; uniform float u_cameraHeight; uniform vec3 u_fogColor;
    void main(void) {
      float depth = czm_unpackDepth(texture(depthTexture, v_textureCoordinates));
      vec4 eye = czm_windowToEyeCoordinates(gl_FragCoord.xy, depth);
      vec4 wc = czm_inverseView * (eye / eye.w);
      float dist = length(wc.xyz);
      float f = clamp((dist - 8000.0) / 40000.0, 0.0, 1.0) * smoothstep(0.0, 2000.0, u_cameraHeight);
      out_FragColor = mix(texture(colorTexture, v_textureCoordinates), vec4(u_fogColor, 1.0), f);
    }`,
  uniforms: {
    u_cameraHeight: () => viewer.camera.positionCartographic.height,  // 函数 uniform, 每帧求值
    u_fogColor: () => new Cesium.Color(0.8, 0.82, 0.84),
  },
}));
// 换效果前: viewer.scene.postProcessStages.remove(fog);
return fog;
```

> 出处: OpenCesium/Cesium-Skills examples/5.1.9、5.1.10、5.1.1。
> GLSL 关键字迁移见 [[2026-10-05-webgl2-shader]]。
