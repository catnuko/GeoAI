// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 catnuko <https://github.com/catnuko>
/**
 * cesium-kit-core —— 能力库契约层（GeoAI 内部）
 *
 * 存在意义：所有 Cesium 能力库共用同一套「注入式」契约。
 *
 * 铁律（不可违反）
 *   1. 本目录下的任何文件都不得出现 `import ... from 'cesium'` 的**值**导入。
 *      Cesium 只能从入参拿 —— 这样同一个库才能同时服务于
 *      「GeoAI 页面用 CDN 全局 window.Cesium」和「Orillusion Geo 用 npm cesium」，
 *      并从根上避免页面里存在两份 Cesium 导致的 instanceof 失效 / 显存翻倍。
 *      （`import type` 是允许的：它在编译期被完全擦除，不产生运行时依赖。
 *      类型统一从 cesium-api-types 模块取（只用 import type，不产生运行时依赖）。
 *   2. 库不得写全局变量。所有挂载由调用方（页面侧）决定。
 *   3. 凡是会「订阅 Cesium 事件 / 注册 ScreenSpaceEventHandler / 挂 Primitive」的，
 *      必须提供 dispose()，且可重复调用。
 */

import type { CesiumLike, CesiumInteractiveLike, Viewer } from '../cesium-api-types';

export type { CesiumLike, CesiumInteractiveLike, Viewer };

/** 契约版本。破坏性变更时 +1，库与 registry 用它做兼容判断。 */
export const KIT_VERSION = '0.1.0';

/** 包名，供错误信息与 registry 交叉校验 */
export const KIT_NAME = 'cesium-kit-core';

/**
 * kit 根对象：所有能力库的构造入口与生命周期管理者。
 */
export interface Kit {
  readonly name: string;
  readonly version: string;
  readonly Cesium: CesiumLike;
  readonly viewer: Viewer;
  /** 是否已释放 */
  readonly disposed: boolean;

  /**
   * 挂载一个子库。子库若提供 dispose()，会随 kit.dispose() 一起清理。
   * @param factory 子库工厂，收到本 kit 作为唯一入参
   */
  use<T>(factory: (kit: Kit) => T): T;

  /**
   * 登记任一清理函数（事件解绑、handler 销毁等），随 dispose() 逆序执行。
   * @param fn 清理函数
   */
  track(fn: () => void): () => void;

  /** 释放全部子库与登记的清理函数。可重复调用。 */
  dispose(): void;
}

/** 可被 kit 挂载的子库契约（提供 dispose 即会被自动清理） */
export interface Disposable {
  dispose?(): void;
}

/**
 * 断言 Cesium 对象可用且具备最小 API 面。
 * 缺 Cesium 是最常见的失败原因（CDN 未加载 / 加载顺序错），
 * 所以这里给出可操作的提示，而不是让调用方在别处报 undefined。
 * @param Cesium 待校验的 Cesium 命名空间
 * @param who 调用方库名，用于错误定位
 */
export function assertCesium(Cesium: unknown, who: string = KIT_NAME): CesiumLike {
  if (!Cesium || typeof Cesium !== 'object') {
    throw new Error(
      `[${who}] 未拿到 Cesium 实例。` +
        'GeoAI 页面应传 window.Cesium；若为 undefined 请检查 index.html 中 Cesium.js 是否加载成功' +
        '（注意 Cesium.js 必须先于 monaco loader.js 加载）。',
    );
  }
  const ns = Cesium as Partial<CesiumLike>;
  if (typeof ns.Cartesian3?.fromDegrees !== 'function') {
    throw new Error(`[${who}] Cesium 实例不完整：缺少 Cartesian3.fromDegrees，可能加载到了非 Cesium 全局对象。`);
  }
  return Cesium as CesiumLike;
}

/**
 * 断言 viewer 是可用的 Cesium.Viewer。
 * @param viewer 待校验的 viewer
 * @param who 调用方库名
 */
export function assertViewer(viewer: unknown, who: string = KIT_NAME): Viewer {
  const v = viewer as Partial<Viewer> | null | undefined;
  if (!v || !v.camera || !v.scene) {
    throw new Error(`[${who}] 未拿到有效的 Cesium.Viewer（viewer.camera / viewer.scene 缺失）。`);
  }
  return viewer as Viewer;
}

/**
 * 断言 Cesium 具备「交互类」库所需的 API 面。
 *
 * 与 assertCesium 的区别：这里额外要求 ScreenSpaceEventHandler 与 Entity。
 * 交互类库（drawer / measure / overlay）全靠这两个干活，缺了它们时
 * 错误发生在事件注册的最深处，很难定位，所以在入口就拦下并说明修法。
 * @param Cesium 待校验的 Cesium 命名空间
 * @param who 调用方库名
 */
export function assertCesiumInteractive(Cesium: unknown, who: string = KIT_NAME): CesiumInteractiveLike {
  const ns = assertCesium(Cesium, who) as Partial<CesiumInteractiveLike>;
  if (typeof ns.ScreenSpaceEventHandler !== 'function') {
    throw new Error(
      `[${who}] Cesium 实例缺少 ScreenSpaceEventHandler，无法进行鼠标交互。` +
        '这通常意味着 Cesium 未完整加载 —— 请检查 index.html 中 Cesium.js 是否加载成功，' +
        '以及页面里是否存在两份 Cesium（CDN 一份 + npm 一份）。' +
        '双 Cesium 会让 instanceof 与枚举比较全部失效，是最难排查的一类问题。',
    );
  }
  if (typeof ns.Entity !== 'function') {
    throw new Error(`[${who}] Cesium 实例缺少 Entity，无法创建图形实体。请检查 Cesium 是否完整加载。`);
  }
  return Cesium as CesiumInteractiveLike;
}

/** createKit 的入参 */
export interface CreateKitOptions {
  /** Cesium 命名空间：CDN 的 window.Cesium 或 npm 的 import * as Cesium */
  Cesium: unknown;
  /** Cesium.Viewer 实例 */
  viewer: unknown;
  /** kit 名，默认 geoai */
  name?: string;
}

/**
 * 创建 kit 根对象。
 *
 * 用法（页面侧）：
 * ```ts
 * const kit = createKit({ Cesium: window.Cesium, viewer });
 * const camera = kit.use(createCameraKit);
 * kit.dispose();
 * ```
 *
 * @param args Cesium + viewer（由调用方注入，库不自己找）
 */
export function createKit({ Cesium, viewer, name = 'geoai' }: CreateKitOptions): Kit {
  const cesium = assertCesium(Cesium, name);
  const cesiumViewer = assertViewer(viewer, name);

  /** @type {Array<() => void>} 逆序执行的清理栈 */
  const disposers: Array<() => void> = [];
  let disposed = false;

  const kit: Kit = {
    name,
    version: KIT_VERSION,
    Cesium: cesium,
    viewer: cesiumViewer,

    use<T>(factory: (k: Kit) => T): T {
      if (disposed) throw new Error(`[${name}] kit 已 dispose，无法再挂载子库。`);
      if (typeof factory !== 'function') {
        throw new Error(`[${name}] kit.use() 需要传入工厂函数，收到 ${typeof factory}。`);
      }
      const sub = factory(kit);
      const maybeDisposable = sub as Disposable | null;
      if (maybeDisposable && typeof maybeDisposable.dispose === 'function') {
        disposers.push(() => maybeDisposable.dispose?.());
      }
      return sub;
    },

    track(fn: () => void): () => void {
      if (typeof fn === 'function') disposers.push(fn);
      return fn;
    },

    get disposed(): boolean {
      return disposed;
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      while (disposers.length) {
        const fn = disposers.pop();
        try {
          fn?.();
        } catch (err) {
          // 清理失败不应阻断其他清理；记到 stderr（MCP 协议占用 stdout）
          console.error(`[${name}] dispose 失败: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    },
  };

  return kit;
}

/**
 * 数值夹取，避免 NaN 传播到 Cesium 造成静默黑屏。
 * @param v 待夹取值
 * @param min 下界
 * @param max 上界
 * @param fallback 非数字时的兜底值
 */
export function clamp(v: number, min: number, max: number, fallback: number = min): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** 地球长半轴（WGS84），用于经纬度跨度 ↔ 米估算 */
export const EARTH_RADIUS = 6378137;
