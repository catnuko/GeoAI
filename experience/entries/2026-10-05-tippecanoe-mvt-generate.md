---
id: 2026-10-05-tippecanoe-mvt-generate
title: tippecanoe 生成矢量瓦片(MVT)——密集自动抽稀, 图层名 -l 决定前端 source-layer
kind: snippet
lib: data
tags: [tippecanoe, MVT, 矢量瓦片, mbtiles, pbf, 瓦片生成, 抽稀, source-layer]
apis: [tippecanoe]
errors: [瓦片太大生成失败, 前端图层空白, source-layer 对不上, 瓦片接缝]
status: draft
successCount: 0
created: 2026-10-05
source: manual
---

## 什么时候用
把大批量矢量数据（GeoJSON 等）做成 MVT 矢量瓦片给 Mapbox GL / MapLibre / 蚁行前端渲染时。Web 端 GeoJSON 太大（>20MB 明显卡）就该转瓦片。

## 常用命令（待实测: 通过 tests/test-data.js 验证后改 verified）
```bash
# GeoJSON -> MBTiles（单文件瓦片库）: z5-14, 密集处自动抽稀保证瓦片可用
tippecanoe -o out.mbtiles -Z 5 -z 14 --drop-densest-as-needed input.geojson

# 输出为 z/x/y.pbf 瓦片目录（可静态托管）; 静态服务器不支持 gzip 时加 --no-tile-compression
tippecanoe -e tiles/ -Z 5 -z 14 --no-tile-compression input.geojson

# 指定图层名（前端 source-layer 必须与 -l 一致, 默认取文件名）
tippecanoe -o out.mbtiles -Z 5 -z 14 -l pois input.geojson

# 属性全保留（默认只保留瓦片内共享属性以省体积, 逐点属性会被丢!）
tippecanoe -o out.mbtiles -Z 12 -z 14 --no-feature-limit --no-tile-size-limit input.geojson
```

要点：
- **默认抽稀/丢属性是最常见的坑**：`--drop-densest-as-needed` 缩小数据，逐点属性（名称、ID）默认在瓦片拥挤处会被精简，业务属性必须显式验证或加 `--no-feature-limit --no-tile-size-limit`（代价是瓦片变大）。
- `-Z`/`-z` 分别是最小/最大级别；`-Z` 以下不切片，前端低级别会 404 或空白。
- 生成物两种形态：`.mbtiles`（SQLite，需要 tileserver-gl / mbtiles-server 起服务）与目录模式（`-e`，可 nginx 静态托管但注意 gzip）。
- 前端 MapLibre 配置里 `source.layers`（source-layer 名）必须等于 `-l` 的图层名，对不上整个图层空白且无报错。
- 瓦片坐标方案是标准 XYZ（y 从北往南），见 [[2026-10-05-tile-scheme-xyz-tms]]。

相关: [[2026-10-05-tile-scheme-xyz-tms]] [[2026-10-05-gis-vector-format-choice]]
