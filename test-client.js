/**
 * test-client.js —— 模拟一个 MCP 客户端，端到端验证链路：
 *   MCP Client --stdio--> server.js --WS--> 浏览器页面 --new Function--> Cesium
 *
 * 用法:
 *   node test-client.js
 *   浏览器打不开时手动访问 http://127.0.0.1:3000 后重跑。
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function out(...a) {
  console.log(...a);
}

async function call(client, name, args) {
  out(`\n=== call_tool: ${name} ${JSON.stringify(args ?? {})}`);
  try {
    const res = await client.callTool({ name, arguments: args ?? {} });
    out(`isError=${res.isError === true}`);
    (res.content || []).forEach((c) => {
      if (c.type === 'text') out(c.text);
    });
    return res;
  } catch (err) {
    out(`ERROR: ${err.message}`);
    return null;
  }
}

async function main() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(__dirname, 'server.js')],
    stderr: 'inherit', // 让 server.js 的日志直接透出，便于观察
  });

  const client = new Client({ name: 'geoai-test-client', version: '0.2.0' });
  await client.connect(transport);
  out('MCP Client 已连接 server.js (stdio)');

  const tools = await client.listTools();
  out('可用工具: ' + tools.tools.map((t) => t.name).join(', '));

  // 1. 打开页面（会调 open() 拉起默认浏览器）
  const opened = await call(client, 'open_page');
  if (opened?.isError) {
    out('\n浏览器似乎未自动打开。请手动访问 http://127.0.0.1:3000 ，然后重新运行本脚本。');
  }

  out('\n等待 3 秒让页面完成初始化…');
  await sleep(3000);

  // 2. 连接状态
  await call(client, 'get_status');

  // 3. 推送代码
  const code = `// 来自 test-client.js：飞向上海东方明珠
const target = Cesium.Cartesian3.fromDegrees(121.4998, 31.2397, 3000);
viewer.camera.flyTo({ destination: target, duration: 2.0 });
viewer.camera.lookAt(target, new Cesium.HeadingPitchRange(0, -0.5, 5000));
return 'flying-to-shanghai';
`;
  await call(client, 'send_code', { code });

  // 4. 执行
  await call(client, 'run_code');
  out('\n等待 3 秒让相机飞行动画完成…');
  await sleep(3000);

  // 5. 最终状态
  await call(client, 'get_status');

  out('\n--- 自测流程结束。若浏览器已打开，请肉眼确认：');
  out('  1) 左侧 Monaco 出现 test-client.js 推送的代码');
  out('  2) 右侧 Cesium 相机飞向上海东方明珠（121.4998, 31.2397）');
  out('  3) 页面底部显示“执行成功”回执');

  await client.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('自测失败:', err);
  process.exit(1);
});
