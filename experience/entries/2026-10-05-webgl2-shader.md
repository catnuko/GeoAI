---
id: 2026-10-05-webgl2-shader
title: WebGL1 着色器在新 Cesium 直接编译失败——texture2D/gl_FragColor/varying 三个词全要换
kind: pitfall
lib: cesium
tags: [WebGL2, GLSL, shader, PostProcessStage, 黑屏, texture2D, gl_FragColor, out_FragColor]
apis: [PostProcessStage, CustomShader, czm_unpackDepth, out_FragColor, requestWebgl1]
errors: [着色器编译失败, 后处理黑屏, 全屏效果不生效]
status: draft
successCount: 0
created: 2026-10-05
source: Cesium-Skills
---

## 什么时候用
写/移植 PostProcessStage、Fabric 材质、CustomShader 遇到黑屏或 shader 编译报错时。
新 Cesium 默认 WebGL2（GLSL ES 3.00）, `requestWebgl1` 已删——只能改 shader, 不能回退。

## 三个必换 + 两个暗坑
- `texture2D(sampler, uv)` → `texture(sampler, uv)`。
- PPS 输出 `gl_FragColor` → `out_FragColor`（Cesium 给 PPS 注入了 FS 包装, 不用自己写 precision/out 声明; varying 声明写 `in vec2 v_textureCoordinates;`）。
- 手写完整 program（DrawCommand 级）时 `attribute` → `in`、`varying` → `out`。
- 暗坑 1: 循环上界必须是**编译期常量**（`for (int i = 0; i < 10; i++)`）, 用 uniform 当上界直接炸。
- 暗坑 2: 采样深度后 `depth == 0.0` 是天空/无几何, 要按无穷大处理, 否则雾/深度类效果糊到天空上。
- 排障次序: 确认没设 requestWebgl1 → shader 简化成颜色直通验证管线 → 逐段加回深度采样。

## 参考代码（未实测）
```js
const stage = viewer.scene.postProcessStages.add(new Cesium.PostProcessStage({
  fragmentShader: `
    uniform sampler2D colorTexture; uniform sampler2D depthTexture;
    in vec2 v_textureCoordinates;                        // varying 声明; wrapper 不用写 precision
    void main(void) {
      float depth = czm_unpackDepth(texture(depthTexture, v_textureCoordinates));  // 不是 texture2D
      vec4 color = texture(colorTexture, v_textureCoordinates);
      out_FragColor = depth == 0.0 ? color : vec4(color.rg, 0.0, color.a);         // 不是 gl_FragColor
    }`,
}));
return stage;
```

> 出处: OpenCesium/Cesium-Skills webgl2.md。
> 相关: [[2026-10-05-postprocess-uniform]]、[[2026-10-05-custom-shader]]、[[2026-10-05-custom-material-property]]。
