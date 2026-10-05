---
id: 2026-10-05-custom-shader
title: CustomShader 静默失效点——varyings 要放顶层、函数签名一字不差、清除靠赋空对象
kind: pattern
lib: cesium
tags: [CustomShader, 3DTiles, 分层设色, UNLIT, uniforms, 扫光, 染色]
apis: [CustomShader, LightingModel.UNLIT, UniformType.FLOAT, TextureUniform, czm_frameNumber]
errors: [tileset 整片黑或白, shader 改了没效果, 自定义效果清不掉]
status: draft
successCount: 0
created: 2026-10-05
source: Cesium-Skills
---

## 什么时候用
给 3D Tiles 按高度分层染色/渐变/扫光带, 写完不生效或整片黑时。

> **已封装为库**：`kit.tiles.setShader(tileset, { fragmentShaderText, uniforms, lightingModel })` /
> `kit.tiles.clearShader(tileset)`——签名校验前置, 清除直接赋 undefined。见 `list_libs` → tiles。

## 静默失效点
- 函数签名固定: `void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material)`, 错一个词全黑/全白。
- `varyings` 是 CustomShader 的**顶层选项**, 嵌进 uniforms 对象里**静默无效**（上游示例自己就嵌错过）。
- 想让自定义 diffuse 可见, 惯用 `lightingModel: UNLIT`, 否则 PBR 光照冲掉效果。
- 动画用内置 `czm_frameNumber`; 动态调参直接改 `shader.uniforms.u_xxx.value`, 不必重建。
- **清除**没有 remove 接口: `tileset.customShader = new Cesium.CustomShader({})`。
- shader 可通过 `fromUrl` 的 options 预挂, 避免加载完成后再编译闪烁。
- `fsInput.attributes.positionMC` 是模型空间米制坐标, 可手工做 UV（mod + fract）。

## 参考代码（未实测）
```js
const shader = new Cesium.CustomShader({
  uniforms: { u_height: { type: Cesium.UniformType.FLOAT, value: 30.0 } },
  lightingModel: Cesium.LightingModel.UNLIT,
  fragmentShaderText: `
    void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
      float h = fsInput.attributes.positionMC.y;
      material.diffuse = h > u_height ? vec3(0.2, 0.6, 1.0) : vec3(1.0, 0.4, 0.0);
    }`,
});
const tileset = await Cesium.Cesium3DTileset.fromUrl(url, { customShader: shader });
viewer.scene.primitives.add(tileset);
// 动态: shader.uniforms.u_height.value = 50;
// 清除: tileset.customShader = new Cesium.CustomShader({});
return tileset;
```

> 出处: OpenCesium/Cesium-Skills examples/3.1.4、3.1.5、7.2.2、7.2.3、7.2.4、patterns.md。
> GLSL 关键字迁移见 [[2026-10-05-webgl2-shader]]; 楼栋级高亮见 [[2026-10-05-3dtiles-monolith]]。
