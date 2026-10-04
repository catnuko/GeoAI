# 贡献指南（Contributing）

欢迎为 **GeoAI / `geoai-mcp`** 做贡献！

## 许可证与 CLA

本项目核心以 **AGPL-3.0-only** 开源，并存在商业授权（见 `COMMERCIAL-LICENSE.md`）。接受你的贡献即表示你同意：

- 以 AGPL-3.0-only 条款提供你的贡献；
- 签署 **[CLA.md](./CLA.md)**（贡献者许可协议）。首个 PR 会触发 CLA Assistant，点击签署一次即可。

## 贡献方式

- 🐛 Bug 修复、新 MCP 工具、前端改进
- 📚 文档
- 🧠 **经验库（`experience/entries/*.md`）——这是一等贡献面**。把你踩过的坑、验证过的代码沉淀成条目，所有人都能检索复用。

### 经验库条目规则

- 每条一个 Markdown 文件，置于 `experience/entries/`，文件名 `YYYY-MM-DD-<slug>.md`。
- 使用 YAML frontmatter：

```yaml
---
id: lookat-unlock
title: 解锁 lookAt 后相机被锁死
kind: pitfall            # pitfall | snippet | usage
status: verified         # verified | draft
tags: [camera, lookAt, 解锁]
apis: [Camera.lookAt, Camera.lookAtTransform]
errors: ["camera is locked"]
successCount: 3
created: 2026-10-04
source: run_code          # run_code | manual | model
---
```

- `status: verified` 需附带真实可复现的代码或明确修法；`index.json` 是生成缓存（已 gitignore），**勿手改、勿提交**。
- 检索按意图组织（场景词 + API 名 + 报错签名），不要按 API 类组织。

## 开发环境

- Node.js >= 20
- `npm install`（会触发 `prepare` 自动 `vite build`）
- `npm run dev:web` 前端热更新（http://127.0.0.1:5173）
- `npm start` 启动 MCP Server + HTTP(3000) + WebSocket(3001)
- `npm test` 端到端自测
- `npm run export-skill` 导出经验库为 SKILL.md

## 代码规范

- 新写的自有源文件必须带 SPDX 头（见现有文件）。
- 日志纪律：`server.js` 的 stdout 属于 MCP 协议通道，只走 `console.error`，禁止 `console.log`。
- 提交信息建议遵循 Conventional Commits（如 `feat:`, `fix:`, `docs:`）。

## 第三方代码

- 不得引入 GPL/AGPL 不兼容的代码。
- 引入第三方片段须在 PR 中注明来源与许可。

## PR 流程

1. Fork / 分支 → 改动 → 本地自测通过
2. 提交 PR，等待 CLA 签署与 review
3. 合并后由维护者发布

## 行为准则

请友善、建设性地沟通。举报与联系见维护者 GitHub。
