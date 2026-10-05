// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 catnuko <https://github.com/catnuko>
/**
 * registry.json 的 TypeScript 形状定义。
 *
 * 单独成文件而非写进 index.ts：JSON 模块的 import 断言与类型断言需要
 * 一个稳定的目标类型，且这份schema 未来会被 Node 侧（lib-registry.js）
 * 与导出物（skill-export.js）共同引用。
 */

/** kit 状态 */
export type KitStatus = 'ready' | 'planned' | string;

/** 来源类型 */
export type KitSource = 'local' | 'npm' | 'script' | string;

/** 一个能力库条目 */
export interface KitEntry {
  /** 唯一标识，get_lib_doc / send_snippet 用它索引 */
  id: string;
  /** npm 包名（拆包后即为真实包名） */
  package: string;
  /** local=自建 / npm=外部包 / script=外部 script 引入 */
  source: KitSource;
  /** ready=已挂载可用 / planned=规划中勿调用 */
  status: KitStatus;
  /** 归属域：目标地图库（cesium/leaflet/mapbox/amap），与经验条目 lib 字段对齐；缺省 cesium */
  lib?: 'cesium' | 'leaflet' | 'mapbox' | 'amap' | 'geo' | 'data' | string;
  /** 展示标题 */
  title: string;
  /** 一句话说明能做什么 */
  summary: string;
  /** 意图关键词（模型按场景检索） */
  intents?: string[];
  /** 覆盖的地图库原生 API 名（与经验库 apis 字段对齐） */
  apis?: string[];
  /** 调用签名 */
  signature: string;
  /** 可直接下发的示例代码 */
  snippet?: string;
  /** 关联的经验条目 id（双向跳转的依据） */
  experience?: string[];
}

/** 外部包登记（只记录，不深链） */
export interface ExternalEntry {
  id: string;
  source: KitSource;
  package: string;
  status: string;
  note: string;
}

/** registry.json 根结构 */
export interface Registry {
  version: string;
  kits: KitEntry[];
  external?: ExternalEntry[];
}
