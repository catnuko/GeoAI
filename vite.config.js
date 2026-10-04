import { defineConfig } from 'vite';

/**
 * mini-mcp-cesium 前端构建配置
 *
 * 边界（刻意保持最小）：
 *   - 只构建自有代码（src/main.js、src/style.css、index.html）
 *   - Cesium 与 Monaco Editor 仍从 CDN 加载（见 index.html），不进产物
 *     原因：Cesium 的 Workers/Assets 走 CESIUM_BASE_URL 动态加载，
 *     Monaco 用 AMD loader，两者都依赖全局脚本顺序，打包进来反而易碎。
 *   - server.js（MCP stdio + WebSocket + HTTP）不参与构建，仍是 Node 侧独立进程
 *
 * 端口约定：Vite dev 用 5173，express 仍 3000，WebSocket 仍 3001。
 */
export default defineConfig({
  // build 时 Cesium/VectorTile 之类无需转译，纯 ESM 输出
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Cesium 走 CDN，产物本身很小，无需放宽告警阈值
    chunkSizeWarningLimit: 500,
  },

  server: {
    port: 5173,
    strictPort: true,
    host: '127.0.0.1',
  },

  preview: {
    port: 4173,
  },
});
