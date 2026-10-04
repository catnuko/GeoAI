# 第三方组件许可（Third-Party Licenses）

本项目（GeoAI / `geoai-mcp`）核心代码以 **AGPL-3.0-only** 开源。以下第三方组件**不**受本项目 AGPL 许可约束，它们各自遵循上游许可。请在使用、再分发、衍生时遵守各自条款。

> 本文件为归属说明，不构成对任何第三方许可的重新授权。任何第三方组件的许可权能均来自其上游作者。

## 1. 运行时 npm 依赖（均宽松许可，与 AGPL 兼容）

| 包 | 版本范围（见 package.json） | 许可 | 说明 |
|---|---|---|---|
| `@modelcontextprotocol/sdk` | ^1.12.0 | MIT | MCP TypeScript SDK |
| `express` | ^4.21.2 | MIT | HTTP 服务 |
| `open` | ^10.1.0 | MIT | 打开浏览器 |
| `ws` | ^8.18.0 | MIT | WebSocket 服务 |
| `zod` | ^3.25.0 | MIT | 参数校验 |
| `vite` | ^8.3.2（devDependency） | MIT | 前端构建 |

完整依赖树与各自许可可由 `npx license-checker --production` 生成。

## 2. 前端 CDN 运行时依赖（不随包分发，运行时从 CDN 加载）

- **CesiumJS**（`cesium`）：**Apache-2.0**。运行页面通过 import map 从 jsDelivr 加载，不在仓库内 vendored。
- **Monaco Editor**：**MIT**。通过 CDN 加载。

## 3. 商业再授权的边界

`COMMERCIAL-LICENSE.md` 描述的商业授权**仅覆盖本项目 AGPL 核心代码中、版权归本项目维护者所有的部分**。上述第三方组件（含 CesiumJS、Monaco、各 npm 依赖）**不在**商业再授权范围内，仍须遵守其各自上游许可。
