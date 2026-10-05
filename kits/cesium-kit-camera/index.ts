// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 catnuko <https://github.com/catnuko>
/**
 * cesium-kit-camera —— 相机能力库（注入式）
 *
 * 沉淀的经验（对应 experience/entries 中的坑位条目）：
 *   - lookat-unlock：lookAt 会把相机切进「目标跟随」变换，之后 flyTo/setView 失效，
 *     必须 camera.lookAtTransform(Matrix4.IDENTITY) 解锁。本库在每次飞行前自动解锁。
 *   - flyto-moveend：Cesium 1.121 的 camera.flyTo 返回 undefined（不是 Promise），
 *     camera 也不是 Node EventEmitter、没有 .once/.on，等待动画结束要用
 *     camera.moveEnd.addEventListener（Cesium.Event，返回解绑函数）。
 *     本库所有会「等动画」的方法统一返回真正 resolve 的 Promise。
 *   - background-raf：动画依赖 requestAnimationFrame，页面切后台时不推进。
 *     故所有等待都带超时，超时错误信息里点明这个前提。
 *
 * 铁律：Cesium 只从 kit 入参拿，类型从 ../cesium-api-types.js 取（import type，不产生运行时依赖）。
 */

import { assertCesium, assertViewer, clamp, EARTH_RADIUS } from '../cesium-kit-core/index';
import type { Kit } from '../cesium-kit-core/index';
import type { Cartesian3 } from '../cesium-api-types';

export const KIT_NAME = 'cesium-kit-camera';

/** 默认等待动画结束的时限（ms）。超时抛错，不无限挂起。 */
const DEFAULT_MOVE_TIMEOUT_MS = 30_000;

/** 经纬度范围 */
export interface BoundingBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** 飞行可选参数 */
export interface FlyOptions {
  /** 动画时长（秒），0 = 瞬时 */
  duration?: number;
  /** 等待动画结束的超时（ms） */
  timeoutMs?: number;
  /** 飞行结束后的朝向 */
  orientation?: unknown;
}

/** 相机快照（纯 JSON，可安全回传 MCP） */
export interface CameraSnapshot {
  position: { lon: number; lat: number; height: number };
  heading: number;
  pitch: number;
  roll: number;
  magnitude: number;
  lookAtLocked: boolean;
}

/** flyTo / flyToPoint / flyToRegion 的返回 */
export interface FlyResult {
  ok: true;
  duration: number;
  /** 本次飞行是否顺带解除了 lookAt 锁定 */
  unlocked: boolean;
  /** 仅 flyToRegion 返回 */
  center?: { lon: number; lat: number };
  /** 仅 flyToRegion 返回 */
  height?: number;
}

/** lookAt 可选参数 */
export interface LookAtOptions {
  /** 相机到目标点的距离（米） */
  range?: number;
  /** 航向（弧度） */
  heading?: number;
  /** 俯仰（弧度，负值俯视） */
  pitch?: number;
  /** 目标点高程（米） */
  height?: number;
}

/** 相机能力库接口 */
export interface CameraKit {
  KIT_NAME: typeof KIT_NAME;
  readonly lookAtLocked: boolean;
  flyTo(destination: unknown, opts?: FlyOptions): Promise<FlyResult>;
  flyToPoint(lon: number, lat: number, height?: number, opts?: FlyOptions): Promise<FlyResult>;
  flyToRegion(bbox: BoundingBox, opts?: FlyOptions & { padding?: number }): Promise<FlyResult>;
  lookAtPoint(lon: number, lat: number, opts?: LookAtOptions): { ok: true; lon: number; lat: number; range: number; locked: true };
  unlock(): { unlocked: boolean; wasLocked: boolean };
  snapshot(): CameraSnapshot;
  dispose(): void;
}

/**
 * 创建相机能力库。
 * @param kit 由 createKit 传入（含已注入的 Cesium 与 viewer）
 */
export function createCameraKit(kit: Kit): CameraKit {
  const Cesium = assertCesium(kit.Cesium, KIT_NAME);
  const viewer = assertViewer(kit.viewer, KIT_NAME);
  const { camera } = viewer;

  /** 本库是否把相机留在 lookAt 变换模式中 */
  let lookAtLocked = false;

  /**
   * 等待一次相机移动结束。
   * camera.moveEnd 是 Cesium.Event：addEventListener 返回解绑函数，用完即拆。
   * @param timeoutMs 超时时限
   * @param what 用于超时错误信息的操作名
   */
  function waitMoveEnd(timeoutMs: number, what: string): Promise<void> {
    return new Promise((resolve, reject) => {
      let remove: (() => void) | undefined;
      const timer = setTimeout(() => {
        try {
          remove?.();
        } catch {
          /* 解绑失败无所谓，已经结束了 */
        }
        reject(
          new Error(
            `[${KIT_NAME}] ${what} 在 ${timeoutMs}ms 内未结束。` +
              '若页面已切到后台标签页，浏览器会暂停 requestAnimationFrame，相机动画不会推进 —— ' +
              '把页面前台后重试。',
          ),
        );
      }, timeoutMs);
      remove = camera.moveEnd.addEventListener(() => {
        clearTimeout(timer);
        try {
          remove?.();
        } catch {
          /* 同上 */
        }
        resolve();
      });
    });
  }

  /**
   * 解除 lookAt 变换，恢复自由相机。幂等。
   * @returns unlocked 本次是否真的执行了解锁；wasLocked 调用前是否处于锁定态
   */
  function unlock(): { unlocked: boolean; wasLocked: boolean } {
    const wasLocked = lookAtLocked;
    if (!lookAtLocked) {
      // 即便没有标记，也对齐一次 identity，避免外部代码留下的 lookAt 残留
      camera.lookAtTransform(Cesium.Matrix4.IDENTITY as never);
      return { unlocked: false, wasLocked: false };
    }
    camera.lookAtTransform(Cesium.Matrix4.IDENTITY as never);
    lookAtLocked = false;
    return { unlocked: true, wasLocked: true };
  }

  /**
   * 飞到任意 destination（Cartesian3 / Rectangle / 对象字面量均可）。
   * 飞行前自动解锁 lookAt，等待动画结束后 resolve。
   * @param destination 目标位置
   * @param opts 飞行参数
   */
  async function flyTo(destination: unknown, opts: FlyOptions = {}): Promise<FlyResult> {
    const duration = clamp(opts.duration ?? 2, 0, 600, 2);
    const timeoutMs = clamp(opts.timeoutMs ?? DEFAULT_MOVE_TIMEOUT_MS, 100, 600_000, DEFAULT_MOVE_TIMEOUT_MS);
    if (!destination) throw new Error(`[${KIT_NAME}] flyTo() 需要 destination。`);

    const { wasLocked } = unlock();
    camera.flyTo({ destination, orientation: opts.orientation, duration } as never);
    await waitMoveEnd(timeoutMs, 'camera.flyTo');
    return { ok: true, duration, unlocked: wasLocked };
  }

  /**
   * 飞到经纬度 + 高度。
   * @param lon 经度（度）
   * @param lat 纬度（度）
   * @param height 相机高程（米）
   * @param opts 飞行参数
   */
  async function flyToPoint(lon: number, lat: number, height = 10_000, opts: FlyOptions = {}): Promise<FlyResult> {
    if (!Number.isFinite(Number(lon)) || !Number.isFinite(Number(lat))) {
      throw new Error(`[${KIT_NAME}] flyToPoint() 的经纬度必须是数字，收到 lon=${lon} lat=${lat}。`);
    }
    const dest = Cesium.Cartesian3.fromDegrees(Number(lon), Number(lat), clamp(height, 1, 4e7, 10_000)) as Cartesian3;
    return flyTo(dest, opts);
  }

  /**
   * 按经纬度范围取景（自动估算高度，使范围恰好入画）。
   * @param bbox 西/南/东/北四至
   * @param opts 飞行参数 + padding（四周留白比例，0.2 = 各留 20%）
   */
  async function flyToRegion(
    bbox: BoundingBox,
    opts: FlyOptions & { padding?: number } = {},
  ): Promise<FlyResult> {
    const { west, south, east, north } = bbox ?? ({} as BoundingBox);
    for (const [k, v] of Object.entries({ west, south, east, north })) {
      if (!Number.isFinite(Number(v))) {
        throw new Error(`[${KIT_NAME}] flyToRegion() 的 bbox.${k} 必须是数字，收到 ${v}。`);
      }
    }
    if (Number(east) < Number(west) || Number(north) < Number(south)) {
      throw new Error(
        `[${KIT_NAME}] flyToRegion() 的 bbox 经纬顺序错误：需 west<=east 且 south<=north，收到 ${JSON.stringify(bbox)}。`,
      );
    }

    const padding = clamp(opts.padding ?? 0.2, 0, 3, 0.2);
    const lonSpan = (Number(east) - Number(west)) * (1 + padding);
    const latSpan = (Number(north) - Number(south)) * (1 + padding);
    const lon = (Number(west) + Number(east)) / 2;
    const lat = (Number(south) + Number(north)) / 2;

    // 球面跨度 → 米；取较大者作为取景依据，保证整个范围入画
    const spanM = (Math.max((lonSpan * Math.PI) / 180, (latSpan * Math.PI) / 180) * EARTH_RADIUS);
    const height = clamp(spanM * 1.6, 500, 3e7, 10_000);

    const res = await flyToPoint(lon, lat, height, opts);
    return { ...res, center: { lon, lat }, height: Math.round(height) };
  }

  /**
   * 对准目标点（进入跟随模式）。
   * 调用后相机被锁定，需显式 unlock() 或调用任何 flyTo* 方法恢复自由相机。
   * @param lon 经度
   * @param lat 纬度
   * @param opts range / heading / pitch / height
   */
  function lookAtPoint(
    lon: number,
    lat: number,
    opts: LookAtOptions = {},
  ): { ok: true; lon: number; lat: number; range: number; locked: true } {
    const range = clamp(opts.range ?? 800, 1, 1e7, 800);
    const heading = clamp(opts.heading ?? 0, -Math.PI, Math.PI, 0);
    const pitch = clamp(opts.pitch ?? -0.3, -Math.PI / 2, 0, -0.3);
    const height = clamp(opts.height ?? 0, 0, 1e6, 0);
    const target = Cesium.Cartesian3.fromDegrees(Number(lon), Number(lat), height);
    camera.lookAt(target as Cartesian3, new Cesium.HeadingPitchRange(heading, pitch, range));
    lookAtLocked = true;
    return { ok: true, lon: Number(lon), lat: Number(lat), range, locked: true };
  }

  /**
   * 当前相机状态快照（不返回 Cesium 内部对象，可安全 JSON 序列化）。
   */
  function snapshot(): CameraSnapshot {
    const c = camera;
    const carto = c.positionCartographic;
    return {
      position: {
        lon: Number(Cesium.Math.toDegrees(carto.longitude).toFixed(6)),
        lat: Number(Cesium.Math.toDegrees(carto.latitude).toFixed(6)),
        height: Math.round(carto.height),
      },
      heading: Number(c.heading.toFixed(4)),
      pitch: Number(c.pitch.toFixed(4)),
      roll: Number(c.roll.toFixed(4)),
      magnitude: Math.round(c.getMagnitude()),
      lookAtLocked,
    };
  }

  return {
    KIT_NAME,

    flyTo,
    flyToPoint,
    flyToRegion,
    lookAtPoint,
    unlock,
    snapshot,

    get lookAtLocked(): boolean {
      return lookAtLocked;
    },

    dispose(): void {
      // 退出时务必解除 lookAt 变换，否则页面下次拿到的是被锁死的相机
      try {
        unlock();
      } catch {
        /* viewer 已销毁时忽略 */
      }
    },
  };
}

export default createCameraKit;
