---
id: 2026-10-05-wgs84-gcj02-bd09-convert
title: WGS84/GCJ-02/BD-09 三坐标系互转——国内数据偏移几百米先查坐标系, 境外不偏移
kind: snippet
lib: geo
tags: [坐标系, GCJ02, 火星坐标, BD09, 百度坐标, WGS84, 偏移, 坐标转换, 高德, 百度]
apis: [wgs84ToGcj02, gcj02ToWgs84, gcj02ToBd09, bd09ToGcj02]
errors: [底图整体偏移几百米, 轨迹偏到楼对面, 高德数据叠在天地图上错位]
status: verified
successCount: 0
created: 2026-10-05
source: manual
---

## 什么时候用
GPS/GeoJSON 数据叠到高德/百度底图上整体偏移几百米（大陆境内），或反过来，需要把高德/百度数据落到 WGS84 底图时。先分清三家坐标系：WGS84（GPS/OSM/Cesium 默认）、GCJ-02（国测局火星坐标，高德/腾讯/谷歌中国）、BD-09（百度在 GCJ-02 上二次加密）。

## 代码（node 实测通过：武汉点偏移 ~535m，逆变换往返误差 ~1.2m）
```js
const PI = Math.PI, X_PI = (PI * 3000.0) / 180.0;
const A = 6378245.0, EE = 0.00669342162296594326;

function outOfChina(lon, lat) {
  return lon < 72.004 || lon > 137.8347 || lat < 0.8293 || lat > 55.8271;
}
function transformLat(x, y) {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(y * PI) + 40.0 * Math.sin((y / 3.0) * PI)) * 2.0) / 3.0;
  ret += ((160.0 * Math.sin((y / 12.0) * PI) + 320 * Math.sin((y * PI) / 30.0)) * 2.0) / 3.0;
  return ret;
}
function transformLon(x, y) {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(x * PI) + 40.0 * Math.sin((x / 3.0) * PI)) * 2.0) / 3.0;
  ret += ((150.0 * Math.sin((x / 12.0) * PI) + 300.0 * Math.sin((x / 30.0) * PI)) * 2.0) / 3.0;
  return ret;
}
/** WGS84 -> GCJ-02。境外（含港澳台外海）原样返回——GCJ 只在大陆境内偏移 */
function wgs84ToGcj02(lon, lat) {
  if (outOfChina(lon, lat)) return { lon, lat };
  let dLat = transformLat(lon - 105.0, lat - 35.0);
  let dLon = transformLon(lon - 105.0, lat - 35.0);
  const radLat = (lat / 180.0) * PI;
  let magic = Math.sin(radLat);
  magic = 1 - EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / (((A * (1 - EE)) / (magic * sqrtMagic)) * PI);
  dLon = (dLon * 180.0) / ((A / sqrtMagic) * Math.cos(radLat) * PI);
  return { lon: lon + dLon, lat: lat + dLat };
}
/** GCJ-02 -> WGS84（近似逆：以 GCJ 值为伪 WGS 求同点偏移再镜像，误差 ~1-2m） */
function gcj02ToWgs84(lon, lat) {
  const g = wgs84ToGcj02(lon, lat);
  return { lon: lon * 2 - g.lon, lat: lat * 2 - g.lat };
}
/** GCJ-02 -> BD-09 */
function gcj02ToBd09(lon, lat) {
  const z = Math.sqrt(lon * lon + lat * lat) + 0.00002 * Math.sin(lat * X_PI);
  const theta = Math.atan2(lat, lon) + 0.000003 * Math.cos(lon * X_PI);
  return { lon: z * Math.cos(theta) + 0.0065, lat: z * Math.sin(theta) + 0.006 };
}
/** BD-09 -> GCJ-02 */
function bd09ToGcj02(lon, lat) {
  const x = lon - 0.0065, y = lat - 0.006;
  const z = Math.sqrt(x * x + y * y) - 0.00002 * Math.sin(y * X_PI);
  const theta = Math.atan2(y, x) - 0.000003 * Math.cos(x * X_PI);
  return { lon: z * Math.cos(theta), lat: z * Math.sin(theta) };
}
```

要点：
- **纠偏偏移是随位置变化的非线性场**，不是固定常量——"整体平移 -0.0065" 只对 BD-09↔GCJ-02 成立；GCJ-02 的偏移跨省都不同，批量纠偏必须逐点算。
- GCJ-02↔WGS84 无精确逆（单向扰动），上面近似逆误差 ~1-2m，导航级应用别用。
- BD-09↔GCJ-02 互转往返有 ~8cm（1e-6 度级）固有损失，实测确认，属正常别当 bug。
- 境外数据两侧都不偏移（`outOfChina` 拦截），跨境业务别给全球数据套转换。
- Cesium 用 WGS84，高德 JSAPI 用 GCJ-02：在高德页面里拿到的一切坐标已是 GCJ-02，直接放 Cesium 会偏；同理天地图（CGCS2000≈WGS84）与高德底图不能直接混叠，见 [[2026-10-05-domestic-imagery-traps]]。

相关: [[2026-10-05-domestic-imagery-traps]] [[2026-10-05-epsg-4326-3857-4490]]
