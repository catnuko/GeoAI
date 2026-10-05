# AGENTS.md — 仓库工程约定

写给在本仓库写代码的 AI agent 与贡献者。

- 产品定位 / 安装配置 / MCP 工具说明 → [README.md](README.md)
- 贡献流程（CLA / PR / 第三方代码）→ [CONTRIBUTING.md](CONTRIBUTING.md)
- 使用侧的已知限制清单 → README 第 7 节

## 使命

GeoAI（npm 包 `geoai-mcp`）是 GIS 经验注入中间件：向模型注入经验 → 模型写代码 → 真实 Cesium 地球执行验证 → 结果沉淀为新经验。仓库三层与三个目录一一对应：

- `experience/` — 经验层（Markdown 条目是唯一事实源）
- `kits/` — 能力层（注入式 TS，registry.json 是清单事实源）
- `playgrounds/` — 执行层（试炼场，一个目标地图库一个页面）

本仓库的开发纪律与产品理念一致：**改错会在真实地球上立刻暴露，所以改完必须真跑**（见「工作流 → 验证」）。

## 红线（违反会直接造成破坏）

1. **stdout 严禁 `console.log`**：server.js 的 stdout 是 MCP stdio 协议通道；日志一律走 `console.error`（server.js 已封装 `log()`）。
2. **`kits/` 内禁止值导入 `cesium`**：只许 `import type`（cesium 在 devDependencies 仅为类型）；类型统一从 `kits/cesium-api-types.ts` 取。值导入会引入运行时依赖并导致页面出现两份 Cesium（`instanceof` 失效 / 显存翻倍）。
3. **加载顺序：Cesium 必须先于 Monaco AMD loader**（改 `playgrounds/*/index.html` 时勿调换）。机制与症状见 README 已知限制 #2 与 `playgrounds/cesium/README.md`。
4. **构建边界**：只有 `playgrounds/`（页面）与 `kits/`（能力库）参与 Vite 构建；Cesium / Monaco 走 CDN 不进产物；`server.js` 不参与构建（Node 侧进程）。
5. **`scripts/` 下的 `.js` 是 npm 发布运行时**（`files` 白名单 + `main`/`bin` 引用这些路径）：移动、改名或新增时必须同步 `package.json`，并用 `npm pack --dry-run` 核对；脚本对仓库其他资源的引用一律相对各自文件解析（`__dirname`/`import.meta.url` 在 `scripts/` 里，向根要加 `..`）。
6. **导出物不是事实源**：`geoai-cesium-experience/`、`geoai-cesium-expert/`（均 gitignore）是 `export-skill` / `export-expert` 的生成视图，勿手改；改了经验或 `kits/registry.json` 后需重新导出。
7. **全仓库 AGPL-3.0-only**：新文件带 SPDX 头（照抄现有文件头两行）；不引入与 AGPL 不兼容的代码。

## 目录速查

| 要改什么 | 去哪 |
| --- | --- |
| MCP 工具 / WebSocket / HTTP 静态服务 | `scripts/server.js` |
| 能力库（kit 实现） | `kits/cesium-kit-*/`，装配在 `kits/index.ts` |
| 能力清单（工具返回的元数据） | `kits/registry.json`（Node 侧读取在 `scripts/lib-registry.js`） |
| 经验条目 | `experience/entries/*.md`（校验/脚手架：`scripts/experience-cli.js`） |
| 试炼场页面 | `playgrounds/<name>/`（多试炼场规则见 `playgrounds/README.md`） |
| 构建 / 端口配置 | `vite.config.js`（MPA：一个试炼场一个 input） |
| 端到端自测脚本 | `tests/` |
| 官网（独立静态站） | `website/`（Vercel 部署，不进 npm 包） |

## 常用命令

```bash
npm run build:check     # typecheck + vite build —— 改完必跑
npm test                # 端到端（自动拉起 server.js，经真实浏览器跑通全链路）
npm run test:libs       # 库层自测（list_libs / get_lib_doc / send_snippet / kit.* 真飞）
npm run lint:exp        # 经验库硬校验 —— 改经验后必跑
npm run export-skill    # 重新导出 SKILL.md（改经验/registry 后）
npm run export-expert   # 重新导出专家包（同上）
```

## 工作流

### 动手前

- 接入了 geoai MCP 时，先 `search_experience` 再写代码；改哪个模块就搜哪个模块的坑。
- 保持改动最小、注释中文、与现有文件风格一致（含注释密度）。

### 新增能力库（kit）

1. 新建 `kits/cesium-kit-<name>/index.ts`，导出 `create<Name>Kit(kit: Kit): <Name>Kit`；类型从 `../cesium-api-types` 取（**只用 `import type`**，见红线 2）；
2. 在 `kits/index.ts` 的 `mountKits()` 里 `kit.use(create<Name>Kit)`；
3. 在 `kits/registry.json` 加一条（含 `intents` 意图词、`apis`、`signature`、`snippet`）；
4. `npm run build:check` 通过后 `npm run test:libs` 验证。

### 新增试炼场

复制 `playgrounds/cesium/` 三件套 → `vite.config.js` 注册 input →（可选）切 `server.js` 的 `DEFAULT_PLAYGROUND`。四步详情见 `playgrounds/README.md`。注意：`vite.config.js` 的块注释里不能出现 `*/` 字样（会提前终止注释，构建报语法错误）。

### 新增 / 修改经验条目

- 事实源是 `experience/entries/*.md`；脚手架 `node scripts/experience-cli.js new <slug>`，笔记转化 `from-note`，校验 `npm run lint:exp`。
- 条目按意图组织（场景词 + API 名 + 报错签名），不按 API 类组织；`[[互链]]` 要双向可达。
- **写 `status: verified` 前必须真跑过**——本项目反复验证过：没跑过的"已验证"经验会被运行证伪。

### 验证与自测

- `npm test` / `test:libs` 会用 `open()` 拉起默认浏览器；无 GUI 环境需手动打开页面（地址见 `npm test` 输出）。
- 相机动画依赖 `requestAnimationFrame`：**后台标签页不推进动画**，验证飞行时保持页面前台。
- 页面 WebSocket 断开不会自动重连，刷新页面即恢复。
- 手动调试 server.js 时注意：**stdin 关闭会触发 MCP 优雅退出**（协议行为）。脱离 MCP 客户端长跑需保住 stdin，如 `sleep 600 | node scripts/server.js`。
- 页面 WS 地址来自 express 下发的 `/config.json`（页面侧绝对路径 fetch），不是硬编码；`DEFAULT_PLAYGROUND` 决定 `open_page` 与根路径 `/` 的重定向目标。
