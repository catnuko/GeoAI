---
id: 2026-10-05-async-factory-migration
title: 1.107+ 资源加载全异步化——同步构造器与 readyPromise 是死路, 改 await fromUrl 系工厂
kind: pitfall
lib: cesium
tags: [fromUrl, readyPromise, 异步工厂, 版本迁移, 3DTiles, 地形, 模型, when.js]
apis: [Cesium3DTileset.fromUrl, CesiumTerrainProvider.fromUrl, Model.fromGltfAsync, ImageryLayer.fromProviderAsync, Terrain.fromWorldTerrain, UrlTemplateImageryProvider]
errors: [readyPromise is undefined, 瓦片不加载, .otherwise is not a function, new 完不显示]
status: draft
successCount: 0
created: 2026-10-05
source: Cesium-Skills
---

## 什么时候用
照老教程/老项目代码写 Cesium（1.98 时代风格）报错或加载不出来时。本库试炼场是 1.121, 一律按新写法。

## 迁移对照（新 API 均返回标准 Promise）
| 旧 | 新 |
|---|---|
| `new Cesium3DTileset({ url })` | `await Cesium.Cesium3DTileset.fromUrl(url)` |
| `tileset.readyPromise.then(...)` | `fromUrl` resolve 即元数据 ready, 直接 `primitives.add` |
| `new CesiumTerrainProvider({ url })` | `await Cesium.CesiumTerrainProvider.fromUrl(url)` |
| `createWorldTerrain()` | `viewer.terrain = Cesium.Terrain.fromWorldTerrain()`（不必先 await 再赋值） |
| `Model.fromGltf(...)` | `await Cesium.Model.fromGltfAsync(...)` |
| `provider.readyPromise` / `.otherwise(fn)` / `.always(fn)` | `await` + `.catch(fn)` / `.finally(fn)`（when.js 方法在标准 Promise 上不存在） |
| Viewer 选项 `imageryProvider: false` | 已更名 `baseLayer: false` |
| 异步 provider 直接塞 `baseLayer` | 包一层 `Cesium.ImageryLayer.fromProviderAsync(promise)` |
| `requestWebgl1: true` | 已删, 着色器按 WebGL2 重写（见 [[2026-10-05-webgl2-shader]]） |

例外: `UrlTemplateImageryProvider` 至今**仍用构造器**, 没有 fromUrl。

## 参考代码（未实测）
```js
try {
  const tileset = await Cesium.Cesium3DTileset.fromUrl(url);
  viewer.scene.primitives.add(tileset);
  await viewer.zoomTo(tileset);
} catch (e) {
  return 'tileset failed: ' + e.message;
}
```

> 出处: OpenCesium/Cesium-Skills migration.md。上游示例由旧版机械迁移, 两个遗留坏味道别照抄:
> ① 自动插入的 `await` 可能落在非 async 回调里; ② `readyPromise` 被机械替换成 `Promise.resolve(obj)`, 这类链直接删。
> fromUrl 实测样例见 [[2026-10-04-arcgis-world-imagery-terrain3d]]; Viewer 构造项见 [[2026-10-05-viewer-constructor-once]]。
