# GeoAI

**GeoAI（npm 包名 `geoai-mcp`，`geoai` 已被占用）是一个 GIS 经验注入中间件——把一个经验丰富的 GIS 专家封装成 MCP 服务器。**

你的 harness（Claude Code / Cursor / ZCode / WorkBuddy 等任何支持 MCP 的客户端）接入它之后，写 GIS 代码不再从零摸索：

- **写之前**——`search_experience` 查真实踩坑的修法，`list_libs` 查已封装好的现成能力；
- **写的时候**——优先调用 `kit.*`，常见坑位（相机锁定、后台动画暂停、加载顺序……）已在库里修掉；
- **写完之后**——代码下发到真实地图环境执行验证（试炼场：Cesium / Leaflet / Mapbox / 高德，数据处理经验在宿主 shell 实证），失败自动捕获为经验草稿，跑通可固化为经验。

**接入即获得经验，不改变你现有的工作流。**

## 它是什么：三层能力 + 一个飞轮

```
你的 harness（Claude Code / Cursor / ZCode / WorkBuddy …）
   │  stdio (JSON-RPC)
   ▼
geoai MCP Server（经验注入中间件）
   ├── 经验层  search_experience / get_experience / save_experience
   │           50+ 条经验随包分发（坐标转换 / 瓦片方案等跨库通识 + 各库踩坑 + 数据处理 CLI），冷启动即专家
   ├── 能力层  list_libs / get_lib_doc / send_snippet
   │           kit.* 现成能力封装（相机飞行 / 影像地形 / 行政边界 / 高程采样），坑已在库里修掉
   └── 执行层  open_page / send_code / run_code
               试炼场页面（默认 Cesium 地球，可切 Leaflet / Mapbox / 高德；Monaco 编辑器 + WebSocket 执行）
                    │  WebSocket  ws://127.0.0.1:3001（可换端口；?session=xxx 多会话；可选 token 鉴权）
                    ▼
              页面执行代码 → 返回执行结果 / 报错
```

经验不是静态文档，而是一个飞轮：

```
 检索经验 ──► 带着经验写代码 ──► 真实 Cesium 环境执行验证
    ▲                                    │
    │   失败 → 自动捕获为坑位草稿          │
    └── 成功 → 固化为 verified 经验 ◄─────┘
```

为什么用 MCP 中间件而不是一份提示词或文档：

1. **经验可执行验证**——每条经验都来自本项目真实运行，写错会立刻在真地球上暴露，而不是纸面对错；
2. **经验自动生长**——`run_code` 失败自动落草稿、成功固化 verified、同名去重累加计数，越用越准；
3. **两层互导**——经验命中时告知「⚡ 已封装为库： kit.xxx」，模型拿到修法的同时知道该调哪个库；
4. **双通道分发**——MCP 之外，还支持把经验热集导出为 SKILL.md，不方便挂 MCP 的 harness 也能用（见第 5 节）。

**定位边界**：面向 GIS 开发的通用经验。经验按归属域组织（`lib` 字段）：`cesium`（主线）/ `leaflet` / `mapbox` / `amap` / `geo`（跨库通识：坐标系、瓦片方案、投影）/ `data`（数据处理与 CLI 工具：GDAL、tippecanoe、3d-tiles-tools，验证靠宿主 shell 真跑）。执行试炼场已有 Cesium / Leaflet / Mapbox / 高德四个（见 playgrounds/README.md）。不做数据库、不做登录、不接 LLM、不做沙箱，代码由 MCP 客户端通过 `send_code` 传入。

---

## 1. 环境要求

- Node.js >= 20（开发时使用 v22 / v24）
- 浏览器需能访问 CDN（jsDelivr）：Monaco Editor + CesiumJS

## 2. 安装与启动

### 方式 A：MCP 客户端直接使用（推荐，无需克隆仓库）

npm 包发布后，在 MCP 客户端配置里加一条即可（WorkBuddy 为 `~/.workbuddy/mcp.json`）：

```json
{
  "mcpServers": {
    "geoai": {
      "command": "npx",
      "args": ["-y", "geoai-mcp"]
    }
  }
}
```

首次调用会自动下载并启动，无需手动安装、构建。

### 方式 B：克隆源码运行

```bash
git clone https://github.com/catnuko/GeoAI.git && cd GeoAI
npm install        # prepare 钩子自动执行 vite build，装完即有 dist/，无需手动构建
npm start          # MCP Server + HTTP(3000) + WebSocket(3001)
```

MCP 客户端配置见第 4 节。

### 开发辅助

```bash
npm run dev:web    # 前端热更新 http://127.0.0.1:5173（open_page 仍指向 3000，见已知限制 #4）
npm run typecheck # 库层类型检查（tsc --noEmit）
npm test           # 内置自测客户端，自动拉起 server.js 驱动全流程
npm run test:libs  # 能力库层自测（list_libs / get_lib_doc / send_snippet / kit.* 真飞/真拉）
npm run test:multi # 多试炼场自测（leaflet 真飞 + open_page playground 参数 + lib 检索/落库）
npm run test:data  # data 域自测（ogr2ogr / tippecanoe 真跑；未装工具时优雅跳过）
```

启动后：
- HTTP 静态服务： http://127.0.0.1:3000/playgrounds/cesium/ （托管 `dist/`，页面通过 `/config.json` 获取 WS 地址）
- WebSocket： ws://127.0.0.1:3001
- 端口被占用或想并行多实例时，用环境变量 `GEOAI_HTTP_PORT` / `GEOAI_WS_PORT` 覆盖（见第 4 节）。

> 若 `dist/` 不存在，3000 端口会返回 503 并提示构建命令，不会静默白屏。

## 3. 目录结构

在本仓库开发（或让 AI 改代码）时，**工程红线与修改指南统一见 [AGENTS.md](AGENTS.md)**；本节只讲仓库布局与构建边界。

```
GeoAI/                # 仓库根目录即项目根
  package.json
  vite.config.js      # Vite 构建配置（MPA：一个试炼场一个入口）
  playgrounds/        # 试炼场：沉淀经验的真实执行环境（一个目标地图库一个页面，详见 playgrounds/README.md）
    cesium/           #   CesiumJS 试炼场（当前主线）
      index.html        # 页面入口（CDN 引入 Monaco / Cesium，加载顺序敏感）
      main.js           # Cesium Viewer / Monaco / WebSocket / 代码执行 / kit 装配
      style.css
  kits/               # 能力库层（注入式 TypeScript，详见第 5.1 节）
    index.ts            # 装配入口：mountKits({ Cesium, viewer }) → kit 对象
    registry.json       # 能力清单事实源（id / intents / apis / signature / snippet）
    registry-schema.ts  # registry.json 的 TS 类型定义
    cesium-api-types.ts # 唯一的 Cesium 类型接缝（全部 import type，编译期擦除）
    cesium-kit-core/    # 契约层：createKit + 生命周期 + 断言
    cesium-kit-camera/  # 相机：flyToRegion / lookAtPoint / unlock / snapshot
    cesium-kit-imagery/ # 影像与地形：ArcGIS 免 key 底图/ 3D 地形 / 高程采样
    cesium-kit-geojson/ # 行政边界：DataV 中国区划 GeoJSON 取数/加载/摘取下级
  scripts/            # Node 侧程序（npm 发布运行时 + 工具，内部互相相对导入）
    server.js           # MCP stdio + WebSocket + HTTP 静态服务（三合一进程，不参与构建）
    experience.js       # 经验库存储（Markdown 事实源 + index 缓存 + 检索/去重/自动捕获）
    experience-cli.js   # 经验库校验/创建流水线（lint 硬校验 / new 脚手架 / from-note 笔记转化）
    lib-registry.js     # 能力清单的 Node 侧读取与检索（供 MCP 工具 list_libs / get_lib_doc 用）
    skill-export.js     # 经验热集导出为 SKILL.md
    expert-export.js    # 经验热集导出为 WorkBuddy 专家包（.codebuddy-plugin）
  experience/
    entries/          # 经验库事实源（每条一个 md，随仓库提交即分发；index.json 为 gitignore 缓存）
  tests/
    test-client.js    # 模拟 MCP 客户端的端到端自测脚本
    test-libs.js      # 能力库层端到端自测（list_libs / get_lib_doc / send_snippet / kit.* 真飞）
  tsconfig.json       # 库层类型检查配置（strict + noUncheckedIndexedAccess，只覆盖 kits/）
  dist/               # Vite 构建产物（gitignore；按源码目录布局 dist/playgrounds/cesium/…，npm 发布时经 files 白名单随包分发）
  website/            # 项目官网（独立静态站，Vercel 部署，不参与 npm 包）
  AGENTS.md           # 仓库工程约定（红线 / 目录速查 / 工作流，AI agent 与贡献者通用）
  README.md
```

Node 侧程序收在 `scripts/`（即 npm 发布运行时，`files` 白名单），`kits/`、`playgrounds/`、`tests/` 各归其位。

### 构建边界（刻意保持最小）

- **只有 `playgrounds/`（试炼场页面）与 `kits/`（能力库）参与 Vite 构建**。
- **Cesium 与 Monaco Editor 仍从 CDN 加载**，不进产物。原因：两者都依赖全局脚本
  加载顺序（见已知限制 #2），打包进来会破坏该顺序且引入 worker/资源路径问题。
  代价：离线环境不可用。
- **`kits/` 参与构建**（它是自有代码），库层用 **TypeScript** 编写。
  - **Cesium 只作为类型来源**：装在 `devDependencies`，库内只用 `import type`（编译期完全擦除），
    类型统一从 `kits/cesium-api-types.ts` 取。这保住了注入式契约的运行时独立性——
    页面侧仍用 CDN 的 `window.Cesium`，68MB 的 Cesium **不进产物**（实测 dist 14.5 kB）。
  - **禁止值导入**：库内不得出现 `import { ... } from 'cesium'`（会引入运行时依赖并导致双实例）。
  - 类型检查：`npm run typecheck`（strict + `noUncheckedIndexedAccess`）；
    `npm run build:check` = typecheck + build。
- **`server.js` 不参与构建**，它跑在 Node 侧，负责托管 `dist/`（根路径 `/` 重定向到默认试炼场）。
- **npm 发布内容**：`files` 白名单只带 `scripts/` + `kits/` + `dist/` + `experience/entries` + README；
  `prepare` 钩子在 `npm install` / `npm publish` 前自动完成构建。
- 上述边界的完整纪律（禁止值导入、类型接缝、加载顺序、白名单同步）集中在 [AGENTS.md](AGENTS.md)，改动构建相关代码前先读它。

## 4. MCP 客户端配置

npx 方式（包发布后推荐）：

```json
{
  "mcpServers": {
    "geoai": {
      "command": "npx",
      "args": ["-y", "geoai-mcp"]
    }
  }
}
```

本地源码方式（开发 / 未发包时）：

```json
{
  "mcpServers": {
    "geoai": {
      "command": "node",
      "args": ["/绝对路径/GeoAI/scripts/server.js"]
    }
  }
}
```

环境变量（全部可选，可任意组合）：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `GEOAI_HTTP_PORT` / `GEOAI_WS_PORT` | 3000 / 3001 | 端口覆盖（HTTP 与 WS 建议一起换，页面会通过 `/config.json` 自动拿到新 WS 地址） |
| `GEOAI_WS_TOKEN` | 空 | 设置后页面必须带 `?token=xxx` 才能连入 WS（`open_page` 自动携带；手动打开时请自行拼上） |
| `GEOAI_RUN_TIMEOUT_MS` | 30000 | `run_code` 等待页面执行回执的超时 |
| `GEOAI_EXPERIENCE_DIR` | `<包目录>/experience` | 经验库存储位置（默认随仓库分发；克隆使用时 git 提交即分发，npx 长期使用建议另指可写目录） |

```json
{
  "mcpServers": {
    "geoai": {
      "command": "npx",
      "args": ["-y", "geoai-mcp"],
      "env": { "GEOAI_HTTP_PORT": "3002", "GEOAI_WS_PORT": "3003", "GEOAI_WS_TOKEN": "换成你的随机串" }
    }
  }
}
```

在 WorkBuddy 中即为 `~/.workbuddy/mcp.json`。配置后需在连接器管理页右上角的自定义连接器入口点「信任」才会生效。

## 5. 工具说明

| 工具 | 参数 | 行为 |
| --- | --- | --- |
| `open_page` | `playground?`, `sessionId?` | 用默认浏览器打开试炼场页面（`playground` 可选 `cesium`（默认）/ `leaflet` / `mapbox` / `amap`；指定时默认用 playground 名作会话），并等待页面 WebSocket 连入（超时 10s）；配置了 `GEOAI_WS_TOKEN` 时自动携带 token |
| `list_libs` | `query?`, `lib?` | 列出能力库（kit）；带 query 时按场景/API 名过滤，带 lib 时按归属域过滤。**写代码前先查这里**——库已封装常见坑位，优先 `kit.*` 而非裸写库 API |
| `get_lib_doc` | `id` | 读取某个 kit 的用法、签名与可运行示例 |
| `send_snippet` | `id`, `sessionId?` | 把某个 kit 的示例代码直接推送到编辑器（不执行），随后 `run_code` |
| `send_code` | `code: string`，`sessionId?` | 把 JS 推送到目标页面的 Monaco（不执行）；`sessionId` 不填则发给最近连入的页面 |
| `run_code` | `sessionId?` | 通知目标页面执行编辑器当前代码并**等待回执**：成功返回执行返回值，失败返回报错信息并**自动捕获为经验草稿**（按页面所属试炼场标注归属域），超时默认 30s |
| `get_status` | 无 | 返回 `{ pageConnected, sessions(含 playground), lastSession, playgrounds, http, websocket }` |
| `search_experience` | `query: string`，`limit?`, `lib?` | 检索经验库（坑位修法 / 已验证代码 / 用法要点），覆盖 cesium/leaflet/mapbox/amap/geo/data 各域；写代码前建议先检索，支持场景词、API/CLI 工具名、报错关键词；`lib` 聚焦本域（不硬过滤） |
| `get_experience` | `id: string` | 读取单条经验全文（含已验证代码） |
| `save_experience` | `kind, title, code?...`, `lib?`, `lang?` | 固化经验（Markdown 文件）；run_code 成功后模型可自存，同名自动去重并累加成功次数；`lib` 不填按当前页面归属推断（geo/data 域必须显式指定），shell 命令用 `lang: "bash"` |

**资源**：`geoai://status`（连接状态）、`geoai://experience/index`（经验库清单）、`geoai://libs/index`（能力库清单 + 外部包登记）。

**多会话**：页面以 `?session=<id>` 打开即可多开（如 `http://127.0.0.1:3000/playgrounds/cesium/?session=dev`）；同一 id 后连入的页面会替换先连入的，未指定时均归属 `default` 会话。

### 经验库（经验注入中间件的核心）

geoai 不只是执行通道，更是经验沉淀层——这是它区别于普通「MCP 桥接 Cesium」方案的地方：模型据此写代码 → 运行 → 运行结果沉淀为新经验。

- **存储**：默认就在**包目录的 `experience/`**——克隆使用时即仓库内，模型运行沉淀的经验直接落盘该目录，`git commit` 即分发（`GEOAI_EXPERIENCE_DIR` 可另指位置；以 `npx` 运行时写入的是包缓存，易失，长期使用建议克隆或另指目录）。**事实源是每条经验一个 Markdown 文件**（`experience/entries/*.md`，frontmatter 元数据 + 正文），人可直接编辑；`index.json` 为可重建缓存（gitignore）。
- **三个来源**：① `run_code` 失败时自动落一条 draft 坑位（同一报错不重复捕获）；② 模型跑通后调 `save_experience` 主动固化（返回文本里有提示）；③ 人工直接编辑文件（改完下次检索立即生效，无需重启）。
- **检索**：关键词打分（标题 5 / 报错签名 4 / tags 3 / API 3 / 正文 1），同分按成功次数排序；`lib` 参数聚焦归属域（cesium / leaflet / mapbox / amap / geo / data，命中优先返回本域、不硬过滤）。条目按**意图**组织（tags 里写场景关键词 + API 名/CLI 工具名 + 报错签名），不按 API 类组织。
- **冷启动**：`experience/entries/` 内置 50+ 条经验随仓库/包分发（本项目真实踩坑 + 实测：lookAt 解锁、后台 rAF、CDN 离线、Cesium/Monaco 加载顺序、ArcGIS 免费影像/地形、DataV 中国行政边界、量测与绘制状态机、cesium-extends 集成等；geo 域的坐标系转换 / 瓦片方案经 node 实测为 verified；data 域 CLI 条目为待实证 draft），新库直接可用，无需安装步骤。
- **治理**：同名去重累加计数；draft 被修复固化后升级 verified；条目按成功次数与新鲜度淘汰（软上限 200，超出时提示清理）。
- **校验与创建流水线**（组织模式对照 WorkBuddy expert-manager）：
  `npm run lint:exp` 硬校验条目与导出物——frontmatter 严格 `key: value` 格式（防「冒号后丢空格静默失效」）、
  id 与文件名一致、kind/status 白名单、缺 `## 什么时候用` 节、`[[相关条目]]` 与 registry 双向引用断链、导出物过期；
  ERROR 退出码非零，WARN 仅提示。`node scripts/experience-cli.js new <slug> --title "..."` 生成 draft 脚手架（TODO 占位）；
  `node scripts/experience-cli.js from-note <note.md> [--dry-run]` 把笔记 / WorkBuddy memory 片段启发式提取为 draft
  （标题 / 报错行 / 修法章节 / js 代码块），补不齐的字段留 TODO，人工确认后入库。
- **与库层互导（A 方案）**：经验检索命中后若该条已被库封装，返回里会附一行
  「⚡ 已封装为库: kit.xxx —— 优先用库」；反向 `list_libs` 也会带出该库对应的坑位标题。
  两层因此不会各说各话，模型拿到坑位修法的同时知道该调哪个库。
- **导出为 Skill（可选加速）**：对支持 skills 的 harness（Claude Code / ZCode 等），可把经验库热集导出为自动触发的 SKILL.md：

```bash
npm run export-skill                    # 输出 ./geoai-cesium-experience/SKILL.md（按成功次数取 top 12）
node scripts/skill-export.js --out <dir> --top 20
```

  导出物是经验库的"热集视图"，**不是事实源**——skill 正文末尾会引导模型对长尾经验调用 `search_experience`；库更新后重新导出即可。事实源始终在经验库目录。
  导出物按固定章节组织：`## 使命` / `## 红线` / `## 工作流`（写码纪律与四步工作流）→ `## 能力库清单` → 坑位 → 范例 → `## 试试这样问我`（固定 3 条高频意图入口）；写盘前自动结构校验（frontmatter 严格格式 + 关键章节），失败不写盘。

- **导出为 WorkBuddy 专家包（可选分发）**：`npm run export-expert [--install]` 生成 `.codebuddy-plugin` 专家包
  （plugin.json 元数据 + agents/ 人格 + 内置经验热集 skill + 占位头像），规格对齐 WorkBuddy expert-manager
  （tags / quickPrompts 固定 3 个、defaultInitPrompt 与第一条一致、displayDescription 中文 40-50 字、agents md 禁 tools 字段），
  生成后自动包校验；`--install` 直装 `~/.workbuddy/plugins/marketplaces/my-experts/plugins/` 供 WorkBuddy 检测。
  事实源不变，包只是导出视图；上架开放平台前需替换占位头像。

- **含能力库清单（B 方案）**：导出物同时包含 `## 能力库清单` 一节（ready 状态的 kit +
  签名 + 示例代码 + 适用场景），置于经验热集**之前**，让 harness 一读就知道有哪些现成能力；
  各经验条目下也会标「⚡ 已封装为库: kit.xxx」。
  好处：支持 skills 但不方便挂 MCP 的 harness 也能用上库。
  注意：**库代码本身仍需 MCP 或 npm 才能获得**，SKILL.md 只提供「有什么、怎么调」。

页面执行上下文提供三个变量：
- `viewer` — `Cesium.Viewer` 实例
- `Cesium` — CesiumJS 全局对象
- `kit` — 能力库层对象（见 5.1）

```js
viewer.camera.flyTo({
  destination: Cesium.Cartesian3.fromDegrees(116.39, 39.9, 10000000),
  duration: 2.0,
});
```

### 5.1 能力库层（`kit`）

经验库记的是「坑与用法」，能力库记的是「**可直接调用的能力**」。两者互补：
`list_libs` 回答「该调什么」，`search_experience` 回答「会踩什么坑」。

**注入式契约（关键设计）**：所有库都从**入参**拿 Cesium，代码里不 `import 'cesium'`。

```ts
// kits/cesium-kit-camera/index.ts（节选）
import type { Kit } from '../cesium-kit-core/index';

export function createCameraKit(kit: Kit): CameraKit {
  const Cesium = assertCesium(kit.Cesium, KIT_NAME); // Cesium 从入参来，不是 import
  const { camera } = assertViewer(kit.viewer, KIT_NAME);
  ...
}
```

这样同一个库既能服务「GeoAI 页面用 CDN 全局 `window.Cesium`」，也能服务
「其他项目 `import * as Cesium from 'cesium'`」，并从根上避免页面里同时存在两份 Cesium
导致的 `instanceof` 失效 / 显存翻倍。

**TypeScript 与类型来源**：库层是 TS，但**不把 Cesium 作为运行时依赖**——
`cesium` 装在 `devDependencies` 只提供类型（`@types/cesium` 停留在 1.70，与当前 1.121 差距过大，故用官方包自带的
`Source/Cesium.d.ts`），库内一律 `import type`，编译期被完全擦除。
所有类型引用收敛到 `kits/cesium-api-types.ts` 这一个接缝，便于未来拆包时统一切换类型来源。

**当前可用能力**（`list_libs` 可查，事实源 `kits/registry.json`）：

| kit | 方法 | 封装的坑 |
| --- | --- | --- |
| `kit.camera` | `flyTo` / `flyToPoint` / `flyToRegion` / `lookAtPoint` / `unlock` / `snapshot` | `flyTo` 不返回 Promise（内部等 `moveEnd`）；`lookAt` 后相机锁定（飞行前自动解锁）；后台标签页 rAF 暂停（超时提示） |
| `kit.imagery` | `addArcGisImagery` / `enableTerrain3D` / `disableTerrain` / `sampleHeight` / `tiandituImagery` / `removeAll` | ArcGIS 免 key 服务的 URL 与精度边界；天地图需自备 key |
| `kit.geojson` | `fetchAdmin` / `loadAdmin` / `pickFeature` / `listFeatures` / `adminUrl` / `removeAll` | DataV 免 key 行政边界 URL 规律（adcode 三级实测）；叶子区域 `_full` 404 自动降级；`_full` 不含自身轮廓；GCJ-02 偏移提示 |

```js
// 优先用库，而不是每次重写
const r = await kit.camera.flyToRegion(
  { west: 121.2, south: 31.0, east: 121.7, north: 31.5 },
  { duration: 2 },
);
// → { ok: true, center: { lon, lat }, height, snapshot }
```

**外部包处理**（`registry.json` 的 `external` 段，只登记不深链）：

| 类型 | 例子 | 说明 |
| --- | --- | --- |
| npm 依赖 | `cesium-extends` | 内部 `import from 'cesium'`，只能用于 Cesium 走 npm 的项目。其 tooltip/popup/measure/drawer 能力计划以注入式重写进本仓库 kits |
| script 引入 | 任意 CDN `<script>` 插件 | 全局变量 + 加载顺序敏感（见已知限制 #2）。只做登记，MCP 不能保证 `run_code` 可用，需先在试炼场的 `index.html` 手动加 script |

**扩展一个新 kit**：四步流程（新建 kit 目录 → `mountKits()` 装配 → `registry.json` 登记 → typecheck + 真飞验证）见 [AGENTS.md](AGENTS.md)「工作流」。

## 6. 底图与合规说明

需求原稿使用 `OpenStreetMapImageryProvider` + `tile.openstreetmap.org`。**境外 OSM 直连瓦片不符合国内地图合规要求，因此本项目未采用**，改为：

- **默认（无需 key）**：不加载影像瓦片，渲染纯色地球 + 经纬网 + 大气效果。
  桥接链路、Monaco 注入、代码执行、相机飞行全部可正常验证，不影响本项目目标。
- **可选（合规影像）**：在 `playgrounds/cesium/main.js` 顶部把 `TIANDITU_TK` 的占位字符串替换为你自己的天地图 Key，即启用天地图影像底图。
  申请入口：天地图官网 http://lbs.tianditu.gov.cn/ → 控制台 → 创建新应用 → 服务接口 → 申请 Key。

未配置时页面日志会明确提示「未配置天地图 key」，不会静默失败。

## 7. 已知限制（重要）

1. **无沙箱**：页面用 `AsyncFunction("viewer","Cesium", code)` 包装执行 MCP 客户端下发的代码（支持顶层 await）。
   该代码拥有页面同源的全部权限（DOM、网络、存储）。**本项目仅限本地验证用途，生产必须替换为 iframe sandbox + postMessage，或 Web Worker + 独立 origin。**
2. **Cesium.js 必须先于 monaco loader.js 加载**（顺序敏感，改动 `playgrounds/cesium/index.html` 时勿调换）：
   Cesium 打包产物内含 UMD 模块（如 `ipv6`），会检测全局 `define.amd`。
   若 Monaco AMD loader 先执行并注入 `define`，Cesium 会走 `define(t)` 分支，
   而 Monaco loader 拒绝匿名 define（`Can only have one anonymous define call per script file`），
   导致 Cesium 脚本抛错中断、`window.Cesium` 未定义、右侧地球全黑。
   症状隐蔽（无控制台错误提示），`playgrounds/cesium/main.js` 已加显式检查并给出该提示。
3. **依赖 CDN，离线不可用**：Cesium / Monaco 走 jsDelivr（见第 3 节「构建边界」）。
   内网或离线环境需改为 npm 依赖 + `vite-plugin-static-copy` 复制 Cesium 资源，
   但必须重新验证上面第 2 条的加载顺序。
4. **`dev:web` 与 `open_page` 端口不同**：Vite dev server 在 5173，而 MCP 工具
   `open_page` 打开的是 express 的 3000。开发时要么 `npm run build` 后用 3000，
   要么手动访问 `http://127.0.0.1:5173/playgrounds/cesium/`（此时 MCP 仍能连上：
   WS 地址优先从 express 的 `/config.json` 获取，Vite 下没有该端点时回退默认 3001，
   因此要求 express 侧用默认端口在跑）。
5. **未接 LLM**：不自动生成代码，代码由客户端 `send_code` 传入。
6. **默认端口 3000/3001，可用环境变量覆盖**：`GEOAI_HTTP_PORT` / `GEOAI_WS_PORT`，
   仅绑定 127.0.0.1。端口被占用时 server 会打印明确错误并退出（`lsof -ti :3000 | xargs kill` 可清理）。
   WS 鉴权默认关闭（仅回环监听，风险低），需要隔离时设 `GEOAI_WS_TOKEN`。
7. **无重连**：页面 WebSocket 断开后不会自动重连，刷新页面才恢复。
8. **同会话单页面**：同一 `session` id 只保留最后连入的页面（后连替换先连）；需要并行多页面时用 `?session=<id>` 区分。
9. **stdio 单通道**：`server.js` 的 stdout 属于 MCP 协议通道，所有日志强制走 `console.error`（stderr）。
   往 server.js 加日志时务必不要使用 `console.log`，否则会破坏 MCP 协议。
10. **`open_page` 依赖 GUI**：无桌面环境 / 沙箱中 `open()` 会失败，此时需手动访问 http://127.0.0.1:3000/playgrounds/cesium/。
11. **后台标签页不推进动画**：浏览器把页面切到后台时 `requestAnimationFrame` 暂停，
    `camera.flyTo` 动画会停住（代码已下发并执行，只是画面不推进）。保持页面前台即可。

## 8. 自测步骤

```bash
npm test
```

脚本会依次执行 `open_page` → 等待 3s → `get_status` → `send_code`（飞向上海东方明珠）→ `run_code` → `get_status`，并打印每次返回。

浏览器未自动打开时：手动访问 http://127.0.0.1:3000/playgrounds/cesium/ 后重跑 `npm test`，肉眼确认：
1. 左侧 Monaco 显示 test-client 推送的代码
2. 右侧 Cesium 相机飞向上海东方明珠（121.4998, 31.2397）
3. 页面底部显示「执行成功」

## 9. 发布到 npm（维护者）

```bash
npm login
npm publish        # prepare 钩子先自动重新构建；files 白名单保证包内只有运行时文件
```

> **License**：本项目整体采用 **GNU Affero General Public License v3.0 only（AGPL-3.0-only）**，
> **不包含任何 MIT 授权部分**。`package.json`、`LICENSE`、`COMMERCIAL-LICENSE.md` 为准。
>
> 采用 open-core 双许可：AGPL 已足够绝大多数场景；不满足 AGPL §13（网络交互须公开源码）
> 的业务可向维护者购买商业授权，在不开放自有专有代码的前提下使用。
>
> **范围覆盖整个仓库**，包括 `kits/` 能力库层与 `experience/` 经验库——
> 库与 MCP 服务同为 AGPL，不做 license 分层。
>
> ⚠️ **拆包提示**：若将来把 `kits/` 拆成独立 npm 包发布到公共 registry，
> 消费方（含Orillusion Geo 等私有项目）将受 AGPL 约束。
> 私有项目可选择：① 保持 monorepo 内部依赖不单独发包；
> ② 商业授权；③ 仅参考源码自行重写（注意 AGPL 不允许仅"借鉴"绕过许可）。

## 10. 路线图

围绕「经验注入中间件」的定位，按优先级：

| 方向 | 说明 |
| --- | --- |
| 经验领域扩展（进行中） | 经验库已支持归属域（`lib` 字段）：`geo` 跨库通识（坐标系转换、瓦片方案、投影/格式选型）与 `data` 数据处理域（ogr2ogr、tippecanoe、3d-tiles-tools，`npm run test:data` 实证）已建立；后续持续沉淀条目并扩 OGC 服务、空间分析 |
| 多试炼场（一期完成） | 已有 cesium / leaflet / mapbox / amap 四个试炼场共享同一经验库与飞轮（`open_page` 的 `playground` 参数切换，新增步骤见 playgrounds/README.md）；deck.gl 等按需再加 |
| 扩充能力库 | 实体与图层管理、地形剖面、时间轴、量测绘制（cesium-extends 的 tooltip/popup/measure/drawer 以注入式重写进 kits）；新库 kit 按经验密度结晶（同一坑位修两次以上再封装） |
| iframe 沙箱 | 把用户代码放进 `sandbox` iframe，`allow-scripts` + `postMessage` 返回结果/错误，替换 `new Function` |
| 语义检索 | 经验检索从关键词打分升级为向量/语义检索（条目过千后再做） |
| 自动重连 | 页面 WebSocket 断开后指数退避重连，替代「刷新页面恢复」 |
| HTTP 传输 | 参考 cesium-mcp-runtime 增加 Streamable HTTP 传输，支持远程/云端 MCP host |
