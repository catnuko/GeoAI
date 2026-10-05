---
id: 2026-10-05-drawcommand-leak
title: 手写 DrawCommand 在 update() 里每帧建 Buffer 就是每帧泄显存——必须惰性创建并缓存
kind: pitfall
lib: cesium
tags: [DrawCommand, 显存泄漏, VertexArray, ShaderProgram, 底层渲染, 自定义 primitive]
apis: [DrawCommand, Buffer.createVertexBuffer, VertexArray, ShaderProgram.fromCache, RenderState.fromCache, Pass.OPAQUE]
errors: [显存持续增长, 页面渐卡]
status: draft
successCount: 0
created: 2026-10-05
source: Cesium-Skills
---

## 什么时候用
绕过 Primitive 手写 `update(frameState)` 提交 DrawCommand, 显存持续增长时。

## 根因
自定义 primitive 就是 `{ update(frameState) }` 往 `frameState.commandList.push(...)`。
`ShaderProgram.fromCache` 只缓存 program, **不救 Buffer/VertexArray**——上游示例 9.1.2 在 update() 里每帧 `createVertexBuffer + new VertexArray` 且从不 dispose, 等于每帧往显存丢一块。
正确写法: 首帧惰性创建并缓存, 数据变化时重建并先 `destroy()` 旧资源。

## 参考代码（未实测）
```js
class MyPrimitive {
  constructor(modelMatrix) { this._mm = modelMatrix; this._va = undefined; }
  update(frameState) {
    if (!this._va) {   // 惰性创建, 只建一次
      const ctx = frameState.context;
      const vb = Cesium.Buffer.createVertexBuffer({
        usage: Cesium.BufferUsage.STATIC_DRAW,
        typedArray: new Float32Array([0,0,0, 1,0,0, 0,1,0]), context: ctx });
      this._va = new Cesium.VertexArray({ context: ctx,
        attributes: [{ vertexBuffer: vb, componentsPerAttribute: 3,
          componentDatatype: Cesium.ComponentDatatype.FLOAT }] });
      this._prog = Cesium.ShaderProgram.fromCache({ context: ctx,
        vertexShaderSource: 'in vec3 position; void main(){ gl_Position = czm_projection * czm_modelView * vec4(position, 1.0); }',
        fragmentShaderSource: 'out vec4 fragColor; void main(){ fragColor = vec4(1.0, 0.0, 0.0, 1.0); }',
        attributeLocations: { position: 0 } });
    }
    frameState.commandList.push(new Cesium.DrawCommand({
      modelMatrix: this._mm, vertexArray: this._va, shaderProgram: this._prog,
      renderState: Cesium.RenderState.fromCache({ depthTest: { enabled: true } }),
      pass: Cesium.Pass.OPAQUE,
    }));
  }
}
viewer.scene.primitives.add(new MyPrimitive(Cesium.Matrix4.IDENTITY));
return 'drawcommand ok';
```

> 出处: OpenCesium/Cesium-Skills examples/9.1.2（原示例即泄漏反面教材）。
> 常规 Primitive 层的配套坑见 [[2026-10-05-primitive-vertexformat]]。
