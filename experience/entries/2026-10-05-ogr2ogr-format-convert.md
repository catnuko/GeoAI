---
id: 2026-10-05-ogr2ogr-format-convert
title: ogr2ogr 矢量格式互转——shp 属性乱码指定 SHAPE_ENCODING, 重投影 -s_srs/-t_srs
kind: snippet
lib: data
tags: [ogr2ogr, GDAL, 格式转换, GeoJSON, GeoPackage, Shapefile, 编码, GBK, 重投影]
apis: [ogr2ogr]
errors: [属性中文乱码, 字段名被截断, 不支持的字段类型, prj 缺失投影报错]
status: draft
successCount: 0
created: 2026-10-05
source: manual
---

## 什么时候用
矢量数据格式互转（shp/GeoJSON/GeoPackage/CSV…）、转换时顺带重投影、或转换后属性中文乱码时。GDAL 全家桶的瑞士军刀，格式选型逻辑见 [[2026-10-05-gis-vector-format-choice]]。

## 常用命令（待实测: 通过 tests/test-data.js 验证后改 verified）
```bash
# shapefile -> GeoJSON；dbf 是 GBK 编码时必须声明, 否则中文属性乱码
ogr2ogr -f GeoJSON output.geojson input.shp --config SHAPE_ENCODING GBK

# GeoJSON -> GeoPackage（推荐交换格式）, -nln 指定图层名
ogr2ogr -f GPKG output.gpkg input.geojson -nln mylayer

# 重投影: 输入没有 .prj 时 -s_srs 必填, 否则 GDAL 猜错坐标系
ogr2ogr -f GeoJSON out_wgs84.geojson input.shp -s_srs EPSG:4549 -t_srs EPSG:4326

# 只导部分字段 / 裁剪范围（-spat: minX minY maxX maxY, 目标坐标系）
ogr2ogr -f GeoJSON out.geojson input.gpkg -select name,adcode -spat 113.9 30.4 114.6 31.0

# CSV(含 lon/lat 列) -> 点图层; -oo X_POSSIBLE_NAMES 自动识别列名
ogr2ogr -f GeoJSON points.geojson input.csv -oo X_POSSIBLE_NAMES=lon -oo Y_POSSIBLE_NAMES=lat -s_srs EPSG:4326
```

要点：
- shp 字段名截断到 10 字符是格式限制，转出后字段名不对不是 bug；要保全长字段名就转 GeoPackage。
- `SHAPE_ENCODING` 只影响 .dbf 解码；有 .cpg 文件时 GDAL 优先读它，乱码先检查 .cpg 是否撒谎。
- 批量目录转换用 `find … -name '*.shp' -exec` 循环，GDAL 没有内置递归。
- 转完先 `ogrinfo -so output.geojson mylayer` 看要素数与字段类型，再进业务。

相关: [[2026-10-05-gis-vector-format-choice]] [[2026-10-05-epsg-4326-3857-4490]]
