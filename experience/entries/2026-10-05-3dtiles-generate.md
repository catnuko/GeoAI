---
id: 2026-10-05-3dtiles-generate
title: 3D Tiles 数据怎么生成——3D Tiles 1.1 直接吃 glb, 倾斜摄影/点云各有专用工具, 生成后先 validate
kind: pattern
lib: data
tags: [3dtiles, 3D Tiles 生成, glb, 倾斜摄影, osgb, 点云, py3dtiles, 3d-tiles-tools, tileset]
apis: [3d-tiles-tools, py3dtiles, tileset.json]
errors: [Cesium 不显示 3dtiles, 模型位置不对, tileset.json 校验失败, geometricError 为 0]
status: draft
successCount: 0
created: 2026-10-05
source: manual
---

## 什么时候用
手里是模型/倾斜摄影/点云，要在 Cesium 里以 3D Tiles 方式加载，需要选生成工具链时。加载侧的坑（modelMatrix、根变换、monolith 结构）在 cesium 域 [[2026-10-05-3dtiles-modelmatrix-enu]] 与 [[2026-10-05-3dtiles-monolith]]。

## 工具链选型（按数据源对口）

- **单个/少量 glb/glTF 模型**：3D Tiles 1.1 原生支持 glTF content——手写 `tileset.json`（每 tile 一个 `boundingVolume` + `content.uri: model.glb`）即可，不需要转 b3dm；老版本 Cesium（<1.107）才需要 3d-tiles-tools 升级格式。
- **倾斜摄影（osgb）**：Smart3D/大疆智建产物，用社区工具链（如 3dtiler、CesiumLab）批量转；osgb 的局部坐标原点在 metadata.xml 里，转换工具必须读它否则整体位置飘。
- **点云（las/laz）**：`py3dtiles` 或 3d-tiles-tools 的 pnts 路线；大数据量分块转换再合并。
- **格式升级/合并/检查**：`3d-tiles-tools`（npm 官方）——`upgrade`（1.0→1.1、b3dm/i3dm→glb）、`merge`、`validate`。

## 生成后校验清单（先过这关再进 Cesium）

```bash
npx 3d-tiles-tools validate -i ./tileset.json
```

- `tileset.json` 的 `geometricError` 自上而下必须递减，根节点为 0 会导致整树不渲染；
- `boundingVolume` 包不住 content 时瓦片被剔除——表现为"Cesium 里看不见"；
- root 变换：源数据是 ENU 局部坐标时，位置在 tileset 的 `transform`（或 Cesium 端 modelMatrix）里补，见 [[2026-10-05-3dtiles-modelmatrix-enu]]；
- Cesium 端不显示的排查顺序：validate 过没过 → 浏览器 Network 看 .glb/b3dm 是否 404 → 控制台看 DeveloperError 归因。

## 未实测说明
本条为工具链选型 pattern；`3d-tiles-tools validate` 命令与本地无倾斜摄影样例，待 data 域测试环境补齐后升级 verified。

相关: [[2026-10-05-3dtiles-modelmatrix-enu]] [[2026-10-05-3dtiles-monolith]] [[2026-10-05-epsg-4326-3857-4490]]
