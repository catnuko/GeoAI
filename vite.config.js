// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 catnuko <https://github.com/catnuko>
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

/**
 * geoai 前端构建配置（MPA：一个试炼场一个入口）
 *
 * 试炼场（playgrounds/）：沉淀经验的真实执行环境，每个目标地图库一个页面。
 *   - 新增试炼场：在 playgrounds/<name>/ 放 index.html + main.js + style.css，
 *     并在下面 input 里注册一行（详见 playgrounds/README.md）。
 *   - 产物路径与源码目录一致：playgrounds/cesium/index.html → dist/playgrounds/cesium/index.html，
 *     即 http://127.0.0.1:3000/playgrounds/cesium/ （根路径由 server.js 重定向到默认试炼场）。
 *
 * 边界（刻意保持最小）：
 *   - 只构建自有代码（playgrounds/ 下各试炼场页面 + kits/ 能力库）
 *   - Cesium 与 Monaco Editor 仍从 CDN 加载（见试炼场的 index.html），不进产物
 *     原因：Cesium 的 Workers/Assets 走 CESIUM_BASE_URL 动态加载，
 *     Monaco 用 AMD loader，两者都依赖全局脚本顺序，打包进来反而易碎。
 *   - server.js（MCP stdio + WebSocket + HTTP）不参与构建，仍是 Node 侧独立进程
 *
 * 端口约定：Vite dev 用 5173，express 仍 3000，WebSocket 仍 3001。
 */
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Cesium 走 CDN，产物本身很小，无需放宽告警阈值
    chunkSizeWarningLimit: 500,
    rollupOptions: {
      input: {
        cesium: fileURLToPath(new URL('./playgrounds/cesium/index.html', import.meta.url)),
        leaflet: fileURLToPath(new URL('./playgrounds/leaflet/index.html', import.meta.url)),
        mapbox: fileURLToPath(new URL('./playgrounds/mapbox/index.html', import.meta.url)),
        amap: fileURLToPath(new URL('./playgrounds/amap/index.html', import.meta.url)),
      },
    },
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
