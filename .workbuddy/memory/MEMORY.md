# GeoAI（npm 包 geoai-mcp）· 长期记忆

> ZCode 侧项目记忆沉淀（2026-10-05 同步）。工程红线 / 目录速查 / 工作流的**权威源是仓库 `AGENTS.md`**（对人类与 AI agent 同样生效），本文件记状态、决策与待办；当日工作流水看同目录日期文件。

## 定位与北极星

- **GeoAI = GIS 经验注入中间件**：把经验丰富的 GIS 专家封装成 MCP 服务器。harness（Claude Code / Cursor / ZCode / WorkBuddy 等任何 MCP 客户端）接入即获得经验——写前 `search_experience` / `list_libs`，写时优先 `kit.*`，写完 `run_code` 在真实 Cesium 地球验证并沉淀。npm 包名 `geoai-mcp`（`geoai` 已被占用），全仓库 AGPL-3.0-only。
- **北极星（2026-10-04 用户明确）**：让各类用户通过各类 harness 生成 GIS 代码并运行——这是「LLM 生成任意 JS 代码」路线的验证项目。
- **核心论点**：只有会执行模型代码的架构才能产生「运行验证过的经验」——这是对 cesium-mcp（静态词典）的差异化。经验是飞轮：检索 → 写码 → 真跑 → 失败自动落 draft / 成功固化 verified。
- **定位边界**：不做数据库、不做登录、不接 LLM、不做沙箱（代码由 MCP 客户端 `send_code` 传入）。

## 目录结构（2026-10-05 重组后，提交 4c19b99）

| 目录 | 职责 |
|---|---|
| `playgrounds/<name>/` | **试炼场**：沉淀经验的真实执行环境，一个目标地图库一个页面（index.html + main.js + style.css 三件套）；当前只有 `cesium/`，新增四步见 `playgrounds/README.md` |
| `kits/` | 能力库层（注入式 TS）；清单事实源 `kits/registry.json` |
| `scripts/` | Node 侧程序 = npm 发布运行时：server.js（MCP+WS+HTTP 三合一）、experience.js、experience-cli.js、lib-registry.js、skill-export.js、expert-export.js |
| `tests/` | 端到端自测（test-client / test-libs） |
| `experience/entries/` | 经验库事实源（每条一个 md，git commit 即分发；index.json 是 gitignore 缓存） |
| `website/` | 官网（独立静态站，Vercel 部署，不进 npm 包） |

- 页面地址：`http://127.0.0.1:3000/playgrounds/cesium/`；`scripts/server.js` 顶部 `DEFAULT_PLAYGROUND` 决定 `open_page` 目标与根路径 `/` 的 302 重定向。
- 页面 WS 地址来自 express 下发的 `/config.json`（绝对路径 fetch），**不是硬编码**；端口用 `GEOAI_HTTP_PORT` / `GEOAI_WS_PORT` 覆盖。
- vite 是 MPA：一个试炼场一个 `rollupOptions.input`，产物按源码布局（`dist/playgrounds/cesium/`）。

## 版本里程碑

v0.2 开箱即用（bin / files 白名单 / prepare 自动构建）→ v0.3 run_code 请求-响应化 + 多会话 + 可选 token → v0.4–0.5 经验库 store + 三工具 + `export-skill` → 12c2c3f 经验库入仓库（**砍掉种子拷贝机制**：模型沉淀的经验直接写仓库目录，git commit 即分发）→ 45076b2 / d51d055 能力库层（kit + registry.json + 三工具，DataV 行政边界数据源）→ 6978a8b 经验库 lint / new / from-note 流水线 → 803b91f WorkBuddy 专家包导出（`export-expert --install` 直装 my-experts）→ 4c19b99 目录重组 + AGENTS.md。**尚未 `npm publish`**（需用户 npm login）。

## 关键决策（为什么这样做，勿反复）

- **Markdown 是经验唯一事实源**：终态是人读知识资产（git 版本化 / 多机同步 / 人可直接编辑）；JSON/SQLite 弃用。检索走加权关键词（标题5/报错签名4/tags3/API3/正文1）+ successCount 排序。
- **条目按意图组织，不按 API 类**：tags 同时存场景关键词（中英）+ API 名 + 报错签名——坑位条目要靠报错文本被命中。
- **知识型文件用语义名，日期前缀冗余**：主访问路径是检索不看文件名，时间由 frontmatter `created` 承担；id（如 `lookat-unlock`）是贯穿 search / get / `[[互链]]` 的句柄。经验文件去日期前缀改名已论证成立、**待实施**。
- **kit 注入式契约**：库内只许 `import type`（cesium 仅 devDependencies 类型来源），类型收敛到 `kits/cesium-api-types.ts`；值导入会导致页面双 Cesium 实例（`instanceof` 失效 / 显存翻倍）。
- **stdout = MCP stdio 协议通道**：所有日志只走 `console.error`（server.js 已封装 `log()`），`console.log` 会破坏协议。
- **导出物非事实源**：`geoai-cesium-experience/`（SKILL.md）、`geoai-cesium-expert/`（专家包）是生成视图（gitignore）；改了经验或 registry.json 后须重新 `export-skill` / `export-expert`。
- **「verified 必须真跑过」**：血泪教训——预标 verified 的经验被运行证伪过（flyTo 不返回 Promise、camera 无 `.once`、后台 rAF 暂停、`new Function` 不支持顶层 await）。

## 已知 bug 与待办

- **measure plane 已知 bug（test-libs 唯一红项）**：plane 模式把 Cartesian3 传给 `EllipsoidGeodesic`（它要 Cartographic 弧度）→ geodesicMeters 恒 0；polyline / area 的 plane 分支同源代码可能同病。修时宜同步沉淀经验条目。
- 待办清单：`npm publish`（发包后 npx 配置才真正可用）；iframe 沙箱替换 `AsyncFunction`（当前仅限本地验证）；页面 WS 自动重连；经验检索语义化（条目过千后）；经验文件去日期前缀；**run_code 回执带 console 输出**（页面侧拦截 console，已提议待确认）。

## 参考与互补

- **gaopengbin/cesium-mcp**（npm `cesium-mcp-runtime`）：同赛道反向路线——62 个结构化命令、不让模型写代码；端口不冲突可共存；其子包 cesium-mcp-dev（CesiumJS API 知识库）对「生成代码」路线有参考价值。
- **WorkBuddy 专家机制**：专家 = 插件包（agents/*.md 人格 + skills + avatars），运行时 persona 全文内联系统提示词 + 分层记忆；geoai 的 `export-expert` 规格对齐 expert-manager（tags / quickPrompts 固定 3、agents md 禁 tools 字段、**包只有放 `~/.workbuddy/plugins/marketplaces/my-experts/plugins/` 才被客户端检测**）。
