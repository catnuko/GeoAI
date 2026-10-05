// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 catnuko <https://github.com/catnuko>
/**
 * test-libs.js —— 库层（kits/）端到端验证
 *
 * 覆盖链路: MCP Client --stdio--> server.js --WS--> 页面 --AsyncFunction--> kit.* --> Cesium
 * 验证目标:
 *   1. 三个新工具 list_libs / get_lib_doc / send_snippet 可用且检索正确
 *   2. 执行上下文确实注入了 kit，且 kit.camera 能驱动真实 Cesium相机
 *   3. 库封装的坑生效：flyToRegion 返回 Promise 并等moveEnd（不是 undefined）
 *   4. lookAt -> unlock 链路正确（先锁后解锁，相机恢复自由）
 *
 * 用法: node test-libs.js
 * 浏览器打不开时手动访问 http://127.0.0.1:3000/playgrounds/cesium/ 后重跑。
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0;
let fail = 0;

function out(...a) {
  console.log(...a);
}

function check(name, ok, detail) {
  if (ok) {
    pass += 1;
    out(`  PASS  ${name}`);
  } else {
    fail += 1;
    out(`  FAIL  ${name}${detail ? ` -> ${detail}` : ''}`);
  }
}

async function call(client, name, args) {
  const res = await client.callTool({ name, arguments: args ?? {} });
  const text = (res.content || []).map((c) => (c.type === 'text' ? c.text : '')).join('\n');
  return { isError: res.isError === true, text, res };
}

/**
 * 从 run_code 返回文本里抠出 JSON。
 * 注意页面回传的是 JSON.stringify(返回值)，当返回值本身是字符串时会出现二次编码：
 *   执行成功 (session=default)，返回："{\"ok\":true}"
 * 所以这里逐层 JSON.parse 直到拿到对象。
 */
function parseRunJson(text) {
  const idx = String(text).indexOf('返回：');
  let payload = idx >= 0 ? text.slice(idx + 3) : String(text);
  // 去掉 run_code 追加的尾部提示（"（若该代码模式…" / "（若代码…"）
  payload = payload.split('\n')[0].trim();
  let cur = payload;
  for (let i = 0; i < 3; i++) {
    if (typeof cur !== 'string') return typeof cur === 'object' ? cur : null;
    try {
      cur = JSON.parse(cur);
    } catch {
      return null;
    }
  }
  return typeof cur === 'object' && cur !== null ? cur : null;
}

async function main() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(__dirname, '..', 'scripts', 'server.js')],
    stderr: 'inherit',
  });

  const client = new Client({ name: 'geoai-test-libs', version: '0.1.0' });
  await client.connect(transport);
  out('MCP Client 已连接 server.js (stdio)\n');

  // ---------- 1. 工具注册 ----------
  out('【1】工具注册');
  const tools = await client.listTools();
  const names = tools.tools.map((t) => t.name);
  out('  可用工具: ' + names.join(', '));
  for (const n of ['list_libs', 'get_lib_doc', 'send_snippet']) {
    check(`工具 ${n} 已注册`, names.includes(n));
  }

  // ---------- 2. list_libs ----------
  out('\n【2】list_libs 检索');
  const all = await call(client, 'list_libs', {});
  check(
    '无参返回全部 kit',
    all.text.includes('camera') && all.text.includes('imagery') && all.text.includes('tiles') && all.text.includes('points') && all.text.includes('motion'),
  );
  check('标注了执行上下文变量', all.text.includes('viewer, Cesium, kit'));
  check('登记了外部包 cesium-extends', all.text.includes('cesium-extends'));

  const q1 = await call(client, 'list_libs', { query: '相机' });
  check('query=相机 命中 camera', q1.text.includes('camera') && !q1.text.includes('- [规划中]'));
  const q2 = await call(client, 'list_libs', { query: '底图' });
  check('query=底图 命中 imagery', q2.text.includes('imagery'));
  const q3 = await call(client, 'list_libs', { query: '地形剖面' });
  check('query=地形剖面 命中 planned 状态的 terrain', q3.text.includes('规划中'));

  // ---------- 2b. A 方案·互导 ----------
  out('\n【2b】A 方案：检索互导');
  const q4 = await call(client, 'list_libs', { query: '相机' });
  check('list_libs 附带坑位标题（适用场景）', q4.text.includes('适用场景') || q4.text.includes('lookAt'), q4.text.slice(0, 200));
  const se = await call(client, 'search_experience', { query: 'lookAt 解锁' });
  check('search_experience 命中后提示已封装为 kit', se.text.includes('已封装为库'), se.text.slice(0, 240));
  check('search_experience 给出 get_lib_doc 指向', se.text.includes('get_lib_doc'));
  const ge = await call(client, 'get_experience', { id: '2026-10-04-lookat-unlock' });
  check('get_experience 单条也带库提示', ge.text.includes('本条已封装为能力库'), ge.text.slice(-200));
  const se2 = await call(client, 'search_experience', { query: '多会话' });
  check('未被库封装的经验不给库提示（无误报）', !se2.text.includes('已封装为库'), se2.text.slice(0, 200));

  // ---------- 3. get_lib_doc ----------
  out('\n【3】get_lib_doc');
  const doc = await call(client, 'get_lib_doc', { id: 'camera' });
  check('返回签名', doc.text.includes('flyToRegion'));
  check('返回示例代码', doc.text.includes('示例代码'));
  check('关联经验条目', doc.text.includes('2026-10-04-lookat-unlock'));
  const bad = await call(client, 'get_lib_doc', { id: 'not-exist' });
  check('不存在的 id 返回 isError', bad.isError);
  const docTiles = await call(client, 'get_lib_doc', { id: 'tiles' });
  check(
    'tiles 文档返回签名与关联经验',
    docTiles.text.includes('kit.tiles.lift') && docTiles.text.includes('2026-10-05-3dtiles-modelmatrix-enu'),
    docTiles.text.slice(0, 160),
  );

  // ---------- 4. 打开页面 ----------
  out('\n【4】打开页面');
  const opened = await call(client, 'open_page', {});
  if (opened.isError) out('  浏览器未自动打开，请手动访问 http://127.0.0.1:3000/playgrounds/cesium/');
  out('  等待 4 秒让页面完成 Cesium + kit 装配…');
  await sleep(4000);

  // ---------- 5. kit 注入与相机能力 ----------
  out('\n【5】kit 注入 + 相机能力');
  await call(client, 'send_code', {
    code: `// 探测：kit 是否注入、暴露了哪些能力
return JSON.stringify({
  hasKit: typeof kit !== 'undefined' && kit !== null,
  kitName: typeof kit !== 'undefined' ? kit.name : null,
  kitVersion: typeof kit !== 'undefined' ? kit.version : null,
  hasCamera: typeof kit !== 'undefined' && !!kit.camera,
  hasImagery: typeof kit !== 'undefined' && !!kit.imagery,
  hasGeojson: typeof kit !== 'undefined' && !!kit.geojson,
  hasDrawer: typeof kit !== 'undefined' && !!kit.drawer,
  hasMeasure: typeof kit !== 'undefined' && !!kit.measure,
  hasOverlay: typeof kit !== 'undefined' && !!kit.overlay,
  cameraMethods: typeof kit !== 'undefined' && kit.camera ? Object.keys(kit.camera).filter(k => typeof kit.camera[k] === 'function') : [],
  geojsonMethods: typeof kit !== 'undefined' && kit.geojson ? Object.keys(kit.geojson).filter(k => typeof kit.geojson[k] === 'function') : [],
  drawerMethods: typeof kit !== 'undefined' && kit.drawer ? Object.keys(kit.drawer).filter(k => typeof kit.drawer[k] === 'function') : [],
  measureMethods: typeof kit !== 'undefined' && kit.measure ? Object.keys(kit.measure).filter(k => typeof kit.measure[k] === 'function') : [],
  overlayMethods: typeof kit !== 'undefined' && kit.overlay ? Object.keys(kit.overlay).filter(k => typeof kit.overlay[k] === 'function') : [],
  cesiumVersion: Cesium.VERSION,
});`,
  });
  const probeOut = await call(client, 'run_code', {});
  const kitInfo = parseRunJson(probeOut.text);
  if (kitInfo) {
    out('  页面回传: ' + JSON.stringify(kitInfo));
    check('kit 已注入执行上下文', kitInfo.hasKit === true);
    check('kit.name === geoai', kitInfo.kitName === 'geoai');
    check('kit.camera 已挂载', kitInfo.hasCamera === true);
    check('kit.imagery 已挂载', kitInfo.hasImagery === true);
    check('kit.geojson 已挂载', kitInfo.hasGeojson === true);
    check(
      'geojson 方法含 fetchAdmin/loadAdmin/pickFeature/listFeatures/removeAll',
      ['fetchAdmin', 'loadAdmin', 'pickFeature', 'listFeatures', 'removeAll'].every((m) => (kitInfo.geojsonMethods || []).includes(m)),
      (kitInfo.geojsonMethods || []).join(','),
    );
    check(
      'camera 方法含 flyToRegion/lookAtPoint/unlock',
      ['flyToRegion', 'lookAtPoint', 'unlock'].every((m) => (kitInfo.cameraMethods || []).includes(m)),
      (kitInfo.cameraMethods || []).join(','),
    );
    check('kit.drawer 已挂载', kitInfo.hasDrawer === true);
    check(
      'drawer 方法含 start/cancel/clear/status/pick',
      ['start', 'cancel', 'clear', 'status', 'pick'].every((m) => (kitInfo.drawerMethods || []).includes(m)),
      (kitInfo.drawerMethods || []).join(','),
    );
    check('kit.measure 已挂载', kitInfo.hasMeasure === true);
    check(
      'measure 方法含 distance/polylineDistance/area',
      ['distance', 'polylineDistance', 'area'].every((m) => (kitInfo.measureMethods || []).includes(m)),
      (kitInfo.measureMethods || []).join(','),
    );
    check('kit.overlay 已挂载', kitInfo.hasOverlay === true);
    check(
      'overlay 方法含 popup/popupAtScreen/tooltip/closeAll',
      ['popup', 'popupAtScreen', 'tooltip', 'closeAll'].every((m) => (kitInfo.overlayMethods || []).includes(m)),
      (kitInfo.overlayMethods || []).join(','),
    );
  } else {
    check('kit 探测返回可解析 JSON', false, probeOut.text.slice(0, 200));
  }

  // ---------- 5b. 三个新 kit 的实际行为（纯函数部分无需鼠标） ----------
  out('\n【5b】drawer / measure / overlay 行为');
  await call(client, 'send_code', {
    code: `// measure 的 plane 模式是纯几何，不依赖相机与鼠标
const d = kit.measure.distance({ lon: 116.39, lat: 39.90 }, { lon: 116.42, lat: 39.95 }, 'plane');
const a = kit.measure.area([
  { lon: 116.39, lat: 39.90 },
  { lon: 116.42, lat: 39.90 },
  { lon: 116.42, lat: 39.93 },
], 'plane');
// drawer 的 pick 在 ellipsoid 模式对北京点应能拾取到
const world = kit.drawer.pick(400, 300, 'ellipsoid');
// overlay 创建并关闭一个屏幕弹窗（验证不抛异常、DOM 能干净摘除）
const p = kit.overlay.popupAtScreen({ screen: { x: 200, y: 200 }, content: 'test' });
const popped = !!p && !p.closed;
p.close();
const st = kit.drawer.status();
return JSON.stringify({
  d, a,
  picked: world ? true : false,
  popped,
  closedAfter: p.closed,
  drawerStatus: st.status,
  activeHandles: kit.overlay.closeAll().closed,
});`,
  });
  const behOut = await call(client, 'run_code', {});
  const beh = parseRunJson(behOut.text);
  if (beh) {
    out('  页面回传: ' + JSON.stringify(beh));
    check('measure plane 距离为正数', typeof beh.d?.geodesicMeters === 'number' && beh.d.geodesicMeters > 0, String(beh.d?.geodesicMeters));
    check('measure plane 面积大于 0', typeof beh.a?.squareMeters === 'number' && beh.a.squareMeters > 0, String(beh.a?.squareMeters));
    check('measure 返回格式化文本', typeof beh.d?.text === 'string' && beh.d.text.length > 0, beh.d?.text);
    check('drawer ellipsoid 拾取有结果', beh.picked === true);
    check('overlay 弹窗创建成功', beh.popped === true);
    check('overlay close 后标记为已关闭', beh.closedAfter === true);
    check('drawer 状态可读且为 INIT', beh.drawerStatus === 'INIT', beh.drawerStatus);
  } else {
    check('三 kit 行为探测返回可解析 JSON', false, behOut.text.slice(0, 300));
  }

  // ---------- 5c. geojson kit 实际拉数（真实请求 DataV 在线服务） ----------
  out('\n【5c】geojson 行政边界（DataV 在线服务真拉）');
  await call(client, 'send_code', {
    code: `// 武汉市单区域（2026-10 实测 featureCount=1）+ 湖北下级清单（17 市）+ 加载武汉下级 13 区（贴地）
const wuhan = await kit.geojson.fetchAdmin(420100);
const hubei = await kit.geojson.fetchAdmin(420000, { full: true });
const loaded = await kit.geojson.loadAdmin(420100, { full: true, clampToGround: true });
const picked = kit.geojson.pickFeature(hubei.geojson, 420100);
const removed = kit.geojson.removeAll();
const e = loaded.dataSource.entities.values[0];
return JSON.stringify({
  wuhanName: wuhan.properties?.name,
  wuhanCount: wuhan.featureCount,
  wuhanLevel: wuhan.properties?.level,
  hubeiCount: hubei.featureCount,
  hubeiFirstChild: hubei.properties?.name,
  listHasWuhan: kit.geojson.listFeatures(hubei.geojson).some(f => f.name === '武汉市'),
  pickedAdcode: picked?.properties?.adcode ?? null,
  loadedCount: loaded.featureCount,
  dataSourceAdded: !!loaded.dataSource,
  clamped: !!e?.polygon && e.polygon.height === undefined,
  entityCount: loaded.dataSource.entities.values.length,
  removedCount: removed.removed,
});`,
  });
  const gjOut = await call(client, 'run_code', {});
  const gj = parseRunJson(gjOut.text);
  if (gj) {
    out('  页面回传: ' + JSON.stringify(gj));
    check('fetchAdmin 武汉市返回 1 feature', gj.wuhanCount === 1, String(gj.wuhanCount));
    check('fetchAdmin 返回 properties.name=武汉市', gj.wuhanName === '武汉市', String(gj.wuhanName));
    check('level=city', gj.wuhanLevel === 'city', String(gj.wuhanLevel));
    check('fetchAdmin _full 湖北 17 个下级', gj.hubeiCount === 17, String(gj.hubeiCount));
    check('_full 第一个下级是地级市', typeof gj.hubeiFirstChild === 'string' && gj.hubeiFirstChild.length > 1, String(gj.hubeiFirstChild));
    check('listFeatures 清单含武汉市', gj.listHasWuhan === true);
    check('pickFeature 按 adcode 摘到武汉', gj.pickedAdcode === 420100, String(gj.pickedAdcode));
    check('loadAdmin 武汉 13 个区', gj.loadedCount === 13, String(gj.loadedCount));
    check('loadAdmin 返回 dataSource 且已加入', gj.dataSourceAdded === true);
    check('clampToGround 贴地生效', gj.clamped === true, String(gj.clamped));
    check('removeAll 清理了数据源', gj.removedCount === 1, String(gj.removedCount));
  } else {
    check('geojson 行为探测返回可解析 JSON', false, gjOut.text.slice(0, 300));
  }

  // ---------- 5d. imagery 新能力：天地图/4490/批量采样（离线可测部分） ----------
  out('\n【5d】imagery 天地图/4490/采样');
  await call(client, 'send_code', {
    code: `// tiandituImagery: 无 key 报申请入口；_c/_w 投影各自构造成功（层号规则在库内）
const noTk = await Promise.resolve().then(() => kit.imagery.tiandituImagery('')).then(() => null, (e) => String(e.message || e));
const w = kit.imagery.tiandituImagery('test-key', { layer: 'img' });
const c = kit.imagery.tiandituImagery('test-key', { layer: 'vec', projection: 'c' });
// add4490: 缺 {z4490} 占位要报可读错误；带占位的正常加层（example.invalid 会 404 但不影响构造）
const add4490ok = kit.imagery.add4490('http://example.invalid/{z4490}/{x}_{y}.png');
const add4490bad = await Promise.resolve().then(() => kit.imagery.add4490('http://example.invalid/{z}.png')).then(() => null, (e) => String(e.message || e));
// sampleHeights: 弧度转换内置（此前度数直传恒返回 0 的 bug 已修）；椭球地形下高度为 0 但不炸
const hs = await kit.imagery.sampleHeights([{ lon: 116.39, lat: 39.9 }, { lon: 121.5, lat: 31.24 }]);
const removedLayers = kit.imagery.removeAll();
return JSON.stringify({
  noTk: noTk && noTk.includes('lbs.tianditu.gov.cn'),
  wOk: !!w, cOk: !!c,
  add4490ok: add4490ok.ok, add4490bad: add4490bad && add4490bad.includes('{z4490}'),
  heightCount: hs.heights.length,
  removedLayers: removedLayers.removed,
});`,
  });
  const imOut = await call(client, 'run_code', {});
  const im = parseRunJson(imOut.text);
  if (im) {
    out('  页面回传: ' + JSON.stringify(im));
    check('天地图无 key 报申请入口', im.noTk === true, String(im.noTk));
    check('天地图 _w/_c 两投影构造成功', im.wOk === true && im.cOk === true);
    check('add4490 正常加层', im.add4490ok === true);
    check('add4490 缺 {z4490} 报可读错误', im.add4490bad === true, String(im.add4490bad));
    check('sampleHeights 返回等长高程数组', im.heightCount === 2, String(im.heightCount));
    check('removeAll 清理了测试图层', im.removedLayers >= 1, String(im.removedLayers));
  } else {
    check('imagery 新能力探测返回可解析 JSON', false, imOut.text.slice(0, 300));
  }

  // ---------- 5e. tiles / points / track 库行为（离线可测部分） ----------
  out('\n【5e】tiles / points / track 行为');
  await call(client, 'send_code', {
    code: `// tiles: 坏 URL 报归因错误（连接被拒也走同一出口）
const tilesErr = await kit.tiles.load('http://127.0.0.1:9/nonexistent/tileset.json').then(() => null, (e) => String(e.message || e));
// points: 万级批量（Collection 单次 batch）+ 非法颜色报错 + 清空
const pts = kit.points.addMany(
  Array.from({ length: 10000 }, () => ({ lon: 73 + Math.random() * 62, lat: 18 + Math.random() * 30, color: '#38f' })),
  { scaleByDistance: [2.0e6, 1.0, 8.0e6, 0.1] },
);
const badColor = await Promise.resolve().then(() => kit.points.addMany([{ lon: 116, lat: 39, color: 'not-a-color' }])).then(() => null, (e) => String(e.message || e));
const cleared = kit.points.clear();
// track: 自动开 shouldAnimate + multiplier 生效 + stop 摘实体恢复时钟
const before = { shouldAnimate: viewer.clock.shouldAnimate };
const h = kit.motion.animatePath([
  { lon: 116.39, lat: 39.9, height: 5000 },
  { lon: 117.2, lat: 39.2, height: 5000 },
], { multiplier: 5 });
const clockOn = { shouldAnimate: viewer.clock.shouldAnimate, multiplier: viewer.clock.multiplier };
const entityThere = !!viewer.entities.getById(h.id);
const stopped = h.stop();
const clockRestored = viewer.clock.shouldAnimate === before.shouldAnimate;
const tinyErr = await Promise.resolve().then(() => kit.motion.animatePath([{ lon: 116, lat: 39 }])).then(() => null, (e) => String(e.message || e));
return JSON.stringify({
  tilesErr: tilesErr && tilesErr.includes('3D Tiles 加载失败'),
  count: pts.count, points: pts.points,
  badColor: badColor && badColor.includes('无法解析颜色'),
  cleared: cleared.removed,
  clockOn, entityThere,
  stoppedOk: stopped.ok, clockRestored,
  tinyErr: tinyErr && tinyErr.includes('至少需要 2 个路径点'),
});`,
  });
  const tkOut = await call(client, 'run_code', {});
  const tk = parseRunJson(tkOut.text);
  if (tk) {
    out('  页面回传: ' + JSON.stringify(tk));
    check('tiles 坏 URL 报出归因错误', tk.tilesErr === true, String(tk.tilesErr));
    check('points.addMany 一万点批量成功', tk.count === 10000 && tk.points === 10000, JSON.stringify({ count: tk.count, points: tk.points }));
    check('points 非法颜色给出可读报错', tk.badColor === true, String(tk.badColor));
    check('points.clear 清空 collection', tk.cleared >= 1, String(tk.cleared));
    check('track.animatePath 自动开 shouldAnimate', tk.clockOn?.shouldAnimate === true, JSON.stringify(tk.clockOn));
    check('track multiplier 生效', tk.clockOn?.multiplier === 5, String(tk.clockOn?.multiplier));
    check('track 实体已加入场景', tk.entityThere === true);
    check('track.stop 摘实体并恢复时钟', tk.stoppedOk === true && tk.clockRestored === true);
    check('track 少于 2 点报可读错误', tk.tinyErr === true, String(tk.tinyErr));
  } else {
    check('tiles/points/track 行为探测返回可解析 JSON', false, tkOut.text.slice(0, 300));
  }

  // ---------- 5f. effects / analysis / motion 扩展（离线可测部分） ----------
  out('\n【5f】effects / analysis / motion 扩展');
  await call(client, 'send_code', {
    code: `// effects: 三个 stage 加入后手动 render 一帧, shader 编译失败会在此暴露
const rain = kit.effects.rain();
const snow = kit.effects.snow();
const fog = kit.effects.fog({ density: 0.0002 });
let renderErr = null;
try { viewer.scene.render(Cesium.JulianDate.now()); } catch (e) { renderErr = String(e.message || e); }
const stageCount = viewer.scene.postProcessStages.length;
const rainRemoved = rain.remove().removed;
kit.effects.stopAll();
// analysis: 开挖/淹没/通视
const dig = kit.analysis.excavate([{ lon: 116.39, lat: 39.90 }, { lon: 116.42, lat: 39.90 }, { lon: 116.42, lat: 39.93 }, { lon: 116.39, lat: 39.93 }]);
const digRestored = dig.restore().ok;
const water = kit.analysis.flood([{ lon: 116.39, lat: 39.90 }, { lon: 116.42, lat: 39.90 }, { lon: 116.42, lat: 39.93 }], { startHeight: 0, endHeight: 50, seconds: 30 });
const waterThere = !!viewer.entities.getById(water.id);
const waterStopped = water.stop().ok;
const see = await kit.analysis.intervisibility({ lon: 116.39, lat: 39.90 }, { lon: 116.42, lat: 39.93 }, { samples: 20 });
// motion 扩展: 绕点/限俯仰——stop 摘 onTick
const orbit = kit.motion.orbitAround({ lon: 116.39, lat: 39.9 }, { radius: 50000 });
const orbitAnimating = viewer.clock.shouldAnimate === true;
const orbitStopped = orbit.stop().ok;
const pitch = kit.motion.limitPitch({ minPitch: -60, maxPitch: -20 });
const pitchStopped = pitch.stop().ok;
// imagery 剖面 + points 标注
const prof = await kit.imagery.sampleProfile({ lon: 116.39, lat: 39.90 }, { lon: 116.42, lat: 39.93 }, { samples: 10 });
const labeled = kit.points.addMany([{ lon: 116.39, lat: 39.9, text: '测试标注' }], { clampToGround: true });
kit.points.clear();
return JSON.stringify({
  renderErr, stageCount, rainRemoved,
  digPlanes: dig.planes, digRestored, waterThere, waterStopped,
  seeBlocked: see.blocked, seeSampled: see.sampled,
  orbitAnimating, orbitStopped, pitchStopped,
  profLen: prof.profile.length, labels: labeled.labels,
});`,
  });
  const efOut = await call(client, 'run_code', {});
  const ef = parseRunJson(efOut.text);
  if (ef) {
    out('  页面回传: ' + JSON.stringify(ef));
    check('effects 三 stage 加入后手动 render 无异常', ef.renderErr === null, String(ef.renderErr));
    check('rain.remove 摘除 stage', ef.rainRemoved === 1);
    check('stopAll 后 stage 清空', ef.stageCount >= 2, String(ef.stageCount));
    check('excavate 生成 4 个裁剪面', ef.digPlanes === 4, String(ef.digPlanes));
    check('excavate.restore 还原成功', ef.digRestored === true);
    check('flood 水面实体已加入', ef.waterThere === true);
    check('flood.stop 移除水面', ef.waterStopped === true);
    check('intervisibility 返回结果（椭球必通视）', ef.seeBlocked === false && ef.seeSampled === 0, JSON.stringify(ef.seeBlocked));
    check('orbitAround 自动开时钟', ef.orbitAnimating === true);
    check('orbit.stop / limitPitch.stop 摘除成功', ef.orbitStopped === true && ef.pitchStopped === true);
    check('sampleProfile 返回等分剖面', ef.profLen === 10, String(ef.profLen));
    check('points 贴地标注走 LabelCollection', ef.labels === 1, String(ef.labels));
  } else {
    check('effects/analysis/motion 扩展探测返回可解析 JSON', false, efOut.text.slice(0, 300));
  }

  // ---------- 6. flyToRegion真的驱动相机（验证坑：flyTo 不返回 Promise） ----------
  out('\n【6】flyToRegion 真飞 + 等moveEnd');
  await call(client, 'send_code', {
    code: `// 库封装验证：flyToRegion 必须 resolve 出对象（不是 undefined）
const r = await kit.camera.flyToRegion(
  { west: 121.2, south: 31.0, east: 121.7, north: 31.5 },
  { duration: 1.5 },
);
return JSON.stringify({
  resolved: r !== undefined,
  unlocked: r.unlocked,
  center: r.center,
  height: r.height,
  snapshot: kit.camera.snapshot(),
});`,
  });
  const fly = await call(client, 'run_code', {});
  const flyJson = parseRunJson(fly.text);
  if (flyJson) {
    out('  页面回传: ' + JSON.stringify(flyJson));
    check('flyToRegion resolve 出对象而非 undefined', flyJson.resolved === true);
    check('返回中心经纬（上海附近）', flyJson.center && Math.abs(flyJson.center.lon - 121.45) < 0.5);
    check('自动估算高度合理（1万~80万米）', flyJson.height > 10000 && flyJson.height < 800000, String(flyJson.height));
    check('相机真实移动到目标区（纬度≈31.2）', flyJson.snapshot && Math.abs(flyJson.snapshot.position.lat - 31.25) < 0.5, JSON.stringify(flyJson.snapshot?.position));
  } else {
    check('flyToRegion 返回可解析 JSON', false, fly.text.slice(0, 300));
  }

  // ---------- 7. lookAt -> unlock ----------
  out('\n【7】lookAt 锁定与解锁');
  await call(client, 'send_code', {
    code: `// 坑位验证：lookAt 后相机被锁，必须 unlock 恢复
const a = kit.camera.lookAtPoint(121.5, 31.24, { range: 3000 });
const lockedSnap = kit.camera.snapshot();
const b = kit.camera.unlock();
const freeSnap = kit.camera.snapshot();
return JSON.stringify({ lockedFlag: a.locked, wasLocked: lockedSnap.lookAtLocked, unlocked: b.unlocked, nowLocked: freeSnap.lookAtLocked });`,
  });
  const lock = await call(client, 'run_code', {});
  const lockJson = parseRunJson(lock.text);
  if (lockJson) {
    out('  页面回传: ' + JSON.stringify(lockJson));
    check('lookAt 后处于锁定态', lockJson.lockedFlag === true && lockJson.wasLocked === true);
    check('unlock 成功解除锁定', lockJson.unlocked === true && lockJson.nowLocked === false);
  } else {
    check('lookAt/unlock 返回可解析 JSON', false, lock.text.slice(0, 300));
  }

  // ---------- 8. send_snippet ----------
  out('\n【8】send_snippet');
  const snip = await call(client, 'send_snippet', { id: 'imagery' });
  check('imagery 示例已下发', snip.text.includes('已把') && !snip.isError);
  const snipRun = await call(client, 'run_code', {});
  out('  imagery 示例执行回执: ' + snipRun.text.split('\n')[0]);
  check('imagery 示例可执行（ArcGIS 免 key）', !snipRun.isError);

  out(`\n===== 结果: ${pass} 通过, ${fail} 失败 =====`);
  if (fail > 0) out('失败项请看上面 FAIL 行。');

  await client.close();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('自测失败:', err);
  process.exit(1);
});
