---
id: 2026-10-05-datav-china-geojson
title: 获取中国行政区划 GeoJSON（DataV 在线数据，免 key，省/市/县三级实测）
kind: pattern
tags: [GeoJSON, 行政区划, 行政边界, adcode, DataV, 阿里, 中国, 边界, 省市县, 区划]
apis: [fetch, GeoJsonDataSource.load, viewer.dataSources.add]
errors: []
status: verified
successCount: 0
created: 2026-10-05
source: model
---

## 什么时候用
需要中国任一级行政区划的 GeoJSON 边界数据（做边界叠加、区域裁剪、下钻地图、ECharts/Cesium 底图数据）时。
数据源是阿里 DataV.GeoJSON 在线服务（免 key、公开只读）：
选区交互页 https://datav.aliyun.com/portal/school/atlas/area_selector ，数据本体在 `geo.datav.aliyun.com`。

> **已封装为库**：`await kit.geojson.fetchAdmin(adcode, { full })`（拿原始 GeoJSON）/
> `await kit.geojson.loadAdmin(adcode, { full, flyTo, clampToGround })`（直接加载进地球）。
> 常用 adcode 速查在 `kit.geojson.ADCODE_HINTS`。URL 拼法在 `kit.geojson.adminUrl()`。
> 本条保留的价值是 **URL 规律、adcode 自查方法与坑位清单**——脱离 Cesium 页面（Node/curl/浏览器）也能照此取数。

## URL 规律（2026-10-05 三级实测）

```
https://geo.datav.aliyun.com/areas_v3/bound/{adcode}.json        单区域轮廓（1 个 feature）
https://geo.datav.aliyun.com/areas_v3/bound/{adcode}_full.json   区域自身不在此文件；features = 全部直接下级
```

| 层级 | 示例 adcode | `{adcode}.json` | `{adcode}_full.json` |
| --- | --- | --- | --- |
| country | 100000 中国 | 国界 1 feature（实测含南海段线，最低纬度 3.4°N），159KB | 35 个省级 feature，569KB |
| province | 420000 湖北 | 湖北轮廓，MultiPolygon | 17 个地级市，152KB |
| city | 420100 武汉 | 武汉轮廓 | 13 个区 |
| district | 420102 江岸区 | 江岸区轮廓 | **404**（无下级，childrenNum=0） |

properties 自带有用元数据：`adcode / name / level(country|province|city|district) / childrenNum /
center（中心点） / centroid（几何质心） / parent{adcode} / acroutes`（祖先链）。

**adcode 自查法（不用背表）**：`fetch(100000_full.json)` 得省级清单 → 对目标省再取 `{adcode}_full` 得下级清单，逐级下钻。省级行政区 adcode 末两位为 0（北京 110000、湖北 420000、广东 440000…）。

## 代码（已验证）
```js
// —— 裸用法：任何能 fetch 的地方都行（Node 20+ / 浏览器 / curl），2026-10-05 实测 ——
// 1) 单区域轮廓：武汉市
const wuhan = await fetch('https://geo.datav.aliyun.com/areas_v3/bound/420100.json').then(r => r.json());

// 2) 含直接下级：湖北省 → 17 个市（features 即下级，不含湖北自身轮廓）
const hubei = await fetch('https://geo.datav.aliyun.com/areas_v3/bound/420000_full.json').then(r => r.json());
const children = hubei.features.map(f => ({ adcode: f.properties.adcode, name: f.properties.name }));

// 3) 从上级 _full 里摘单个下级（如只要武汉市的轮廓）：
const wuhanFeature = hubei.features.find(f => f.properties.adcode === 420100);

// —— Cesium 页面内加载（结合 baseLayer:false 的 ArcGIS 影像底图实测可跑）——
const ds = await Cesium.GeoJsonDataSource.load(wuhan, {
  clampToGround: true,                 // 有 3D 地形时必须贴地，否则边界悬空/入地
  fill: Cesium.Color.CYAN.withAlpha(0.2),
  stroke: Cesium.Color.CYAN,
});
await viewer.dataSources.add(ds);
await viewer.flyTo(ds);                // viewer.flyTo 返回 Promise（camera.flyTo 才不返回）
```

## 坑位清单
- **`_full` 只在有下级时存在**：叶子区域（`childrenNum === 0`，如区县、直管镇）请求 `_full` 返回 404。
  想稳就先读单区域文件的 `childrenNum` 再决定要不要 `_full`（kit 的 fetchAdmin/loadAdmin 已自动降级）。
- **`_full` 文件里没有自身轮廓**：`420000_full.json` 的 features 是 17 个市，不含湖北省边界；
  要湖北省自身轮廓取 `420000.json`。两者配合用：`{adcode}.json` 画自己、`{adcode}_full.json` 下钻。
- **坐标系（社区共识，官方未标注）**：DataV 数据源自高德，普遍认为是 GCJ-02（火星坐标）。
  叠加 WGS84 底图（ArcGIS 影像、天地图）时边界约有 300~600m 偏移；高德/阿里生态内叠加则相互匹配。
  对偏移敏感的场景需自行纠偏，或把底图也换成 GCJ-02 瓦片源。
- **国界即 `100000.json`**：单 feature MultiPolygon，含南海段线（实测最低纬度 3.4°N）；全国省级拼图用 `100000_full.json`。
- **体积参考**：全国 _full 约 569KB、省级 _full 100~200KB、市级 30~160KB——一次拉全国够轻，
  但不要在循环里逐县拉几百个请求，优先用上级 `_full` 一次拿全。
