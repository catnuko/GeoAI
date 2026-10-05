---
id: 2026-10-05-gis-vector-format-choice
title: 矢量数据格式怎么选——shp 的 dbf 默认 GBK, 字段名截 10 字符, 交换用 GeoPackage
kind: pattern
lib: geo
tags: [格式选型, GeoJSON, Shapefile, GeoPackage, CSV, TopoJSON, 编码, GBK, 乱码]
apis: []
errors: [属性中文乱码, 字段名被截断, 文件超 2GB 打不开, GeoJSON 太大加载慢]
status: draft
successCount: 0
created: 2026-10-05
source: manual
---

## 什么时候用
拿到/要交付一批矢量数据选格式，或遇到属性乱码、字段名诡异截断、大文件卡死时。按场景对口：

- **GeoJSON**：Web 前端直读的事实标准，JSON 文本单文件，坐标系语义只有一种（经纬度）。缺点是文本体积大，几十 MB 起步加载卡——大数据换 MVT 瓦片或 GeoPackage。
- **Shapefile**：行业存量最大，但是**多文件**（.shp/.shx/.dbf/.prj/.cpg 缺一不可）。两个经典坑：`.dbf` 属性表**默认 GBK/本地编码**（没有 .cpg 时按本机 locale 猜），UTF-8 工具链直读必乱码；字段名**截断到 10 字符**（`administrative_code` 变 `administr`），文件 2GB 上限。
- **GeoPackage（.gpkg）**：SQLite 单文件，无编码坑、无 2GB 限制、支持矢量+瓦片+元数据，**归档与交换首选**（GDAL/ogr2ogr/QGIS 全支持）。国内交付正在普及。
- **CSV + 经纬度列（或 WKT 列）**：表格属性数据、批量点位最省事的入口；注意坐标列顺序与分隔符，万级以上建议转 GeoJSON/GPKG。
- **TopoJSON**：Topology 去重，行政边界类数据体积比 GeoJSON 小 60%+，但只有 Web 库生态（需要 topojson-client 解码），GIS 桌面软件基本不认。

## 约定

- 格式转换一律走 **ogr2ogr**（GDAL 命令行），别手写解析器——编码、投影、字段类型它都兜住了，常用命令见 data 域条目。
- 交付政务项目：GeoPackage 或 Shapefile（附 .cpg 标明 UTF-8）+ 坐标系 4490；Web 内部流转：GeoJSON（小）/ MVT（大）。
- Web 加载 GeoJSON 的库侧坑（要素过多、字段类型）见 cesium 域 [[2026-10-05-geojson-load-notes]]。

相关: [[2026-10-05-epsg-4326-3857-4490]] [[2026-10-05-geojson-load-notes]]
