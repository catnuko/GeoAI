---
id: 2026-10-05-custom-material-property
title: 自定义动态材质四件套缺一不可——addMaterial 同名静默覆盖, minimumHeights 拼错被静默忽略
kind: pattern
lib: cesium
tags: [MaterialProperty, 动态材质, 流光墙, 电子围栏, 扩散点, fabric, addMaterial, czm_getMaterial]
apis: [Material._materialCache.addMaterial, createPropertyDescriptor, czm_getMaterial, czm_gammaCorrect, ImageMaterialProperty]
errors: [材质不报错但不动, 效果被别的实例覆盖, 墙脚高度不生效]
status: draft
successCount: 0
created: 2026-10-05
source: Cesium-Skills
---

## 什么时候用
流光墙/电子围栏/动态扩散点/流线等动态材质不报错但不动、或多个实例互相覆盖时。

## 四件套 + 三坑
- MaterialProperty 必须齐: `isConstant: false`、`definitionChanged` getter、`getType()` 返回**注册的类型名**、`getValue()` 返回**全部** uniform（含 `time = ((Date.now()-t0) % duration) / duration`）、`equals`。
- **`Material._materialCache.addMaterial` 同名静默覆盖**——不同参数的实例要用不同 type 名（惯用 `'wall' + Math.random()` 后缀）。
- fabric `source` 里 WebGL2 用 `texture()`; 自发光要 `czm_gammaCorrect`。
- 拼写雷: wall 的 `minimumHeights`（不是 minimunHeights）, 拼错被**静默忽略**, 想抬墙脚的人莫名失败。
- 静态贴图流动用轻量版: `Cesium.ImageMaterialProperty({ image, transparent: true, repeat })`。
- 自定义 `MaterialAppearance` 顶点着色器时纹理 uniform 名是 **`image_0`**（Cesium 给纹理 uniform 加索引后缀）, 要自己声明 `uniform sampler2D image_0;`。

## 参考代码（未实测）
```js
const TYPE = 'flowWall' + Math.floor(Math.random() * 1000);   // 同名会静默覆盖
Cesium.Material._materialCache.addMaterial(TYPE, {
  fabric: {
    type: TYPE,
    uniforms: { color: Cesium.Color.CYAN, image: Cesium.Material.DefaultImageId, time: -20 },
    source: `czm_material czm_getMaterial(czm_materialInput materialInput) {
      czm_material m = czm_getDefaultMaterial(materialInput);
      vec4 c = texture(image, vec2(fract(materialInput.st.s - time), materialInput.st.t));
      m.diffuse = c.rgb; m.alpha = c.a; return m; }`,
  },
  translucent: () => true,
});
class FlowWall {
  constructor(o) { this._definitionChanged = new Cesium.Event(); this.color = o.color;
    this.duration = o.duration || 1500; this.image = o.image; this._t0 = Date.now(); }
  get isConstant() { return false; }
  get definitionChanged() { return this._definitionChanged; }
  getType() { return TYPE; }
  getValue(time, result) { result = result || {};
    result.color = this.color; result.image = this.image;
    result.time = ((Date.now() - this._t0) % this.duration) / this.duration; return result; }
  equals(o) { return this === o; }
}
viewer.entities.add({ wall: {
  positions: Cesium.Cartesian3.fromDegreesArray([116,39, 117,39, 117,40]),
  maximumHeights: new Array(3).fill(500),
  minimumHeights: new Array(3).fill(0),   // 注意拼写
  material: new FlowWall({ image: '/textures/wall.png', color: Cesium.Color.CYAN }),
}});
return 'flow wall ok';
```

> 出处: OpenCesium/Cesium-Skills examples/5.3.9、5.3.5、7.1.2、7.1.5、8.1.3。
> GLSL 关键字迁移见 [[2026-10-05-webgl2-shader]]。
