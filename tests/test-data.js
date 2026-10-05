// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 catnuko <https://github.com/catnuko>
/**
 * test-data.js —— data 域（地理数据处理 / CLI 工具）经验的真跑验证
 *
 * 与 test-libs.js 的浏览器链路不同：data 域经验跑在宿主 shell（GDAL / tippecanoe 等 CLI）。
 * 本脚本检测工具可用性：装了哪个验哪个，全没装则优雅跳过（exit 0）——
 * 保证 CI / 干净机器上 npm test 体系不红，同时真正装了工具的环境能把对应经验实证为 verified。
 *
 * 覆盖:
 *   ogr2ogr     GeoJSON <-> GeoPackage 往返 + 重投影（2026-10-05-ogr2ogr-format-convert）
 *   tippecanoe  GeoJSON -> 矢量瓦片目录（2026-10-05-tippecanoe-mvt-generate）
 *
 * 用法: npm run test:data
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let pass = 0;
let fail = 0;
let skipped = 0;

function check(name, ok, detail) {
  if (ok) {
    pass += 1;
    console.log(`  PASS  ${name}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${name}${detail ? ` -> ${String(detail).slice(0, 200)}` : ''}`);
  }
}

function skip(name) {
  skipped += 1;
  console.log(`  SKIP  ${name}`);
}

function hasTool(cmd, args = ['--version']) {
  try {
    execFileSync(cmd, args, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function run(cmd, args, cwd) {
  return execFileSync(cmd, args, { stdio: 'pipe', cwd }).toString();
}

/** 简易两点 GeoJSON（武汉长江两岸），供转换/切片用 */
function fixtureGeojson() {
  return {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { name: '汉口', adcode: 420102 }, geometry: { type: 'Point', coordinates: [114.28, 30.60] } },
      { type: 'Feature', properties: { name: '武昌', adcode: 420106 }, geometry: { type: 'Point', coordinates: [114.32, 30.55] } },
    ],
  };
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'geoai-data-'));
try {
  console.log('\n【1】ogr2ogr 矢量格式往返');
  if (hasTool('ogr2ogr')) {
    const gjPath = path.join(TMP, 'in.geojson');
    fs.writeFileSync(gjPath, JSON.stringify(fixtureGeojson()), 'utf8');

    // GeoJSON -> GPKG -> GeoJSON 往返, 校验要素数与属性不丢
    const gpkgPath = path.join(TMP, 'out.gpkg');
    run('ogr2ogr', ['-f', 'GPKG', gpkgPath, gjPath, '-nln', 'poi']);
    const backPath = path.join(TMP, 'back.geojson');
    run('ogr2ogr', ['-f', 'GeoJSON', backPath, gpkgPath, 'poi']);
    const back = JSON.parse(fs.readFileSync(backPath, 'utf8'));
    check('GeoJSON -> GPKG -> GeoJSON 往返保持 2 要素', back.features?.length === 2, JSON.stringify(back).slice(0, 120));
    check('往返属性不丢（name/adcode）', back.features?.[0]?.properties?.name === '汉口' && back.features?.[0]?.properties?.adcode === 420102);

    // 重投影: 4549(CGCS2000 3度带投影, 米制) -> 4326, 坐标应落回武汉经纬度附近
    const mSrc = path.join(TMP, 'in_4549.geojson');
    const fs4549 = fixtureGeojson();
    // 手工把武汉经纬度推到 4549 米制近似坐标（误差不重要, 只验证转换通路与量级）
    fs4549.features[0].geometry.coordinates = [500000, 3388000];
    fs4549.features[1].geometry.coordinates = [504500, 3383000];
    fs.writeFileSync(mSrc, JSON.stringify(fs4549), 'utf8');
    const mOut = path.join(TMP, 'out_4326.geojson');
    run('ogr2ogr', ['-f', 'GeoJSON', mOut, mSrc, '-s_srs', 'EPSG:4549', '-t_srs', 'EPSG:4326']);
    const mBack = JSON.parse(fs.readFileSync(mOut, 'utf8'));
    const lon = mBack.features?.[0]?.geometry?.coordinates?.[0];
    const lat = mBack.features?.[0]?.geometry?.coordinates?.[1];
    check('4549 -> 4326 重投影落回武汉经纬度', typeof lon === 'number' && Math.abs(lon - 114.28) < 0.2 && Math.abs(lat - 30.6) < 0.2, `lon=${lon} lat=${lat}`);
  } else {
    skip('ogr2ogr 未安装（brew install gdal 后重跑可实证 ogr2ogr 条目）');
  }

  console.log('\n【2】tippecanoe 矢量瓦片');
  if (hasTool('tippecanoe', ['--version'])) {
    const gjPath = path.join(TMP, 'tiles-in.geojson');
    fs.writeFileSync(gjPath, JSON.stringify(fixtureGeojson()), 'utf8');
    const tilesDir = path.join(TMP, 'tiles');
    // 目录模式: z12-14, 不压缩（本地静态服务器友好）
    run('tippecanoe', ['-e', tilesDir, '-Z', '12', '-z', '14', '--no-tile-compression', '-l', 'poi', '--quiet', gjPath]);
    // 产物是 z/x/y.pbf 目录树, 校验至少落了一个瓦片且图层名生效
    const found = [];
    const walk = (d) => {
      for (const f of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, f.name);
        if (f.isDirectory()) walk(p);
        else if (f.name.endsWith('.pbf')) found.push(p);
      }
    };
    walk(tilesDir);
    check('tippecanoe 产出 z/x/y.pbf 瓦片目录', found.length >= 1, String(found.length));
    // MVT 头包含图层名（连续字节 "poi" 出现在瓦片二进制里）
    const head = fs.readFileSync(found[0]);
    check('瓦片内图层名为 -l 指定的 poi', head.includes(Buffer.from('poi')), found[0]);
  } else {
    skip('tippecanoe 未安装（brew install tippecanoe 后重跑可实证 MVT 条目）');
  }

  console.log(`\n===== 结果: ${pass} 通过, ${fail} 失败, ${skipped} 跳过 =====`);
  if (skipped > 0) console.log('（跳过项: 本机未装对应 CLI 工具；经验条目保持 draft, 装好后跑本脚本实证再改 verified）');
  process.exit(fail > 0 ? 1 : 0);
} finally {
  fs.rmSync(TMP, { recursive: true, force: true });
}
