// test-multi-lib.js —— 多试炼场（2D 库）与多域经验检索的端到端验证
// 覆盖: open_page 的 playground 参数、页面 WS 上报归属、leaflet 真飞、
//       search_experience 的 lib 聚焦、save_experience 的 lib 落库（临时条目用后即删）
// 用法: node tests/test-multi-lib.js （端口固定用 3100/3101, 与默认 server 不冲突）
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// save_experience 真写文件: 结束前清掉测试落库的临时条目, 保持经验库干净
function cleanupTempEntry() {
  const dir = path.join(__dirname, '..', 'experience', 'entries');
  for (const f of fs.readdirSync(dir)) {
    if (f.toLowerCase().includes('zzz-temp')) fs.rmSync(path.join(dir, f), { force: true });
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS ', name); }
  else { fail++; console.log('  FAIL ', name, detail ? '-> ' + String(detail).slice(0, 200) : ''); }
}
async function call(client, name, args) {
  const res = await client.callTool({ name, arguments: args ?? {} });
  const text = (res.content || []).map((c) => (c.type === 'text' ? c.text : '')).join('\n');
  return { isError: res.isError === true, text };
}
function parseRunJson(text) {
  const idx = String(text).indexOf('返回：');
  let payload = idx >= 0 ? text.slice(idx + 3) : String(text);
  payload = payload.split('\n')[0].trim();
  let cur = payload;
  for (let i = 0; i < 3; i++) {
    if (typeof cur !== 'string') return typeof cur === 'object' ? cur : null;
    try { cur = JSON.parse(cur); } catch { return null; }
  }
  return typeof cur === 'object' && cur !== null ? cur : null;
}

async function main() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(__dirname, '..', 'scripts', 'server.js')],
    stderr: 'inherit',
    env: { ...process.env, GEOAI_HTTP_PORT: '3100', GEOAI_WS_PORT: '3101' },
  });
  const client = new Client({ name: 'geoai-test-leaflet', version: '0.1.0' });
  await client.connect(transport);
  console.log('MCP Client 已连接 (ports 3100/3101)\n');

  // 1. open_page 用 playground 参数（session 自动取 playground 名）
  const opened = await call(client, 'open_page', { playground: 'leaflet' });
  check('open_page(playground=leaflet) 成功', !opened.isError, opened.text);
  check('返回了 leaflet 执行上下文说明', opened.text.includes('map / L'), opened.text.slice(0, 160));
  await sleep(5000); // 等 CDN 加载 + WS 连入

  // 2. 状态: session 与 playground 映射
  const st = await call(client, 'get_status', {});
  check('get_status 标注 playground=leaflet', st.text.includes('"playground":"leaflet"'), st.text.slice(0, 300));

  // 3. run_code 真飞: 加 marker + 读中心
  await call(client, 'send_code', {
    code: `L.circleMarker([31.2304, 121.4737], { radius: 8 }).addTo(map);
const c = map.getCenter();
return JSON.stringify({ zoom: map.getZoom(), lat: +c.lat.toFixed(4), lng: +c.lng.toFixed(4), layers: Object.keys(map._layers).length });`,
  });
  const run = await call(client, 'run_code', {});
  const r = parseRunJson(run.text);
  check('leaflet run_code 成功', !run.isError, run.text.slice(0, 200));
  check('地图中心在上海', r && Math.abs(r.lat - 31.23) < 0.01 && Math.abs(r.lng - 121.47) < 0.01, JSON.stringify(r));
  check('marker/circle 已加图层', r && r.layers >= 1, JSON.stringify(r));

  // 4. lib 检索: geo 域聚焦与跨域命中
  const geo = await call(client, 'search_experience', { query: '坐标系 转换 偏移', lib: 'geo', limit: 4 });
  check('lib=geo 优先返回 geo 条目', geo.text.includes('[geo/'), geo.text.slice(0, 300));
  const cesiumScoped = await call(client, 'search_experience', { query: '3dtiles', lib: 'cesium', limit: 4 });
  check('lib=cesium 命中 cesium 条目', cesiumScoped.text.includes('[cesium/'), cesiumScoped.text.slice(0, 300));
  const cross = await call(client, 'search_experience', { query: '瓦片 404', limit: 4 });
  check('不带 lib 跨域也能命中 geo 条目', cross.text.includes('[geo/'), cross.text.slice(0, 300));

  // 5. save_experience 带 lib + lang=bash（写一条临时经验再验证检索, 保持仓库干净用独特标题）
  const saved = await call(client, 'save_experience', {
    kind: 'snippet', title: 'ZZZ-TEMP-leaflet addMarker 校验样例', lib: 'leaflet',
    code: 'L.marker([31.23, 121.47]).addTo(map); return "ok";', tags: ['临时', '校验'], apis: ['L.marker'],
  });
  check('save_experience 接受 lib=leaflet', !saved.isError, saved.text);
  const del = await call(client, 'search_experience', { query: 'ZZZ-TEMP', limit: 1 });
  check('刚存的 leaflet 经验可检索且归属正确', del.text.includes('[leaflet/'), del.text.slice(0, 200));

  // 6. mapbox / amap 冒烟（无 key 也应连入: 页面不炸、执行上下文全局对象可用、map=null）
  for (const [pg, probe, expect] of [
    ['mapbox', 'return JSON.stringify({ lib: typeof mapboxgl, hasCreateMap: typeof createMap === "function", mapNull: map === null });', { lib: 'object', hasCreateMap: true, mapNull: true }],
    ['amap', 'return JSON.stringify({ loader: typeof AMapLoader, hasCreateMap: typeof createMap === "function", mapNull: map === null });', { loader: 'object', hasCreateMap: true, mapNull: true }],
  ]) {
    const op = await call(client, 'open_page', { playground: pg });
    check(`open_page(playground=${pg}) 成功`, !op.isError, op.text.slice(0, 160));
    await sleep(3500);
    await call(client, 'send_code', { code: probe });
    const r2 = await call(client, 'run_code', {});
    const j2 = parseRunJson(r2.text);
    const okAll = j2 && Object.entries(expect).every(([k, v]) => j2[k] === v);
    check(`${pg} 执行上下文可用且无 key 时 map=null`, okAll === true, JSON.stringify(j2));
  }
  await call(client, 'open_page', { playground: 'cesium' }); // 收尾切回默认试炼场
  await sleep(2500);

  console.log(`\n===== 结果: ${pass} 通过, ${fail} 失败 =====`);
  await client.close();
  cleanupTempEntry();
  process.exit(fail > 0 ? 1 : 0);
}
main().catch((e) => { console.error('验证失败:', e); process.exit(1); });
