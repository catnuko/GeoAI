// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 catnuko <https://github.com/catnuko>
/**
 * cesium-kit-analysis —— 地形分析库（开挖 / 淹没 / 通视，注入式）
 *
 * 沉淀的经验（对应 experience/entries 中的条目）：
 *   - polygon-height-semantics：淹没分析 = entity polygon 的 extrudedHeight 挂
 *     CallbackProperty 逐帧抬升，回调内必须 clamp 到目标水位（本库按真实时间推进并封顶）。
 *   - globe-clipping-excavate：globe.clippingPlanes 的裁剪语义——默认
 *     unionClippingRegions=false（交集），法线指向的一侧不被裁、反侧被裁；
 *     法线取 edgeDir × up 后按"指向质心与否"翻转到外侧，多边形绕向无关。
 *   - terrain-height-timing：通视/高程采样只认异步 sampleTerrainMostDetailed，
 *     输入弧度 Cartographic；椭球地形（无 availability）不支持 mostDetailed 采样。
 *   - 上游示例（Cesium-Skills 4.1.x 开挖/淹没完整版）是外部库的壳，本库为原生 API 自实现。
 *
 * 铁律：Cesium 只从 kit 入参拿，类型从 ../cesium-api-types 取（import type）。
 */

import { assertCesium, assertViewer } from '../cesium-kit-core/index';
import type { Kit } from '../cesium-kit-core/index';
import type { Cartesian3, CesiumAnalysisLike, ClippingPlane, ClippingPlaneCollection } from '../cesium-api-types';

export const KIT_NAME = 'cesium-kit-analysis';

/** 经纬度点 */
export interface LonLatPoint {
  lon: number;
  lat: number;
}

/** 通用操作结果 */
export interface AnalysisOpResult {
  ok: true;
}

/** 开挖句柄 */
export interface ExcavateHandle {
  /** 本次开挖用的裁剪面数量 */
  planes: number;
  /** 还原地形（移除本次添加的裁剪面） */
  restore(): AnalysisOpResult;
}

/** 淹没句柄 */
export interface FloodHandle {
  /** 水面实体 id */
  id: string;
  /** 停止并移除水面 */
  stop(): AnalysisOpResult;
}

/** 通视结果 */
export interface IntervisibilityResult {
  ok: true;
  /** 两点间是否被地形遮挡 */
  blocked: boolean;
  /** 第一个遮挡点（未遮挡为 null） */
  blocker: LonLatPoint & { height: number } | null;
  /** 视线高与地形高的最小净空（米，负值即被挡） */
  minClearance: number;
  /** 实际采样段数 */
  sampled: number;
}

/** 停止结果 */
export interface AnalysisStopResult {
  ok: true;
  stopped: number;
}

/** 分析库接口 */
export interface AnalysisKit {
  KIT_NAME: typeof KIT_NAME;
  excavate(region: LonLatPoint[], opts?: { edgeColor?: string }): ExcavateHandle;
  flood(
    region: LonLatPoint[],
    opts?: { startHeight?: number; endHeight?: number; seconds?: number; color?: string },
  ): FloodHandle;
  intervisibility(p1: LonLatPoint, p2: LonLatPoint, opts?: { samples?: number; eyeHeight?: number; tolerance?: number }): Promise<IntervisibilityResult>;
  stopAll(): AnalysisStopResult;
  dispose(): AnalysisStopResult;
}

function assertAnalysisApi(Cesium: unknown, who: string = KIT_NAME): CesiumAnalysisLike {
  const ns = Cesium as Partial<CesiumAnalysisLike>;
  if (typeof ns.ClippingPlaneCollection !== 'function' || typeof ns.ClippingPlane !== 'function') {
    throw new Error(`[${who}] Cesium 实例缺少 ClippingPlaneCollection / ClippingPlane，无法做地形开挖。`);
  }
  if (typeof ns.CallbackProperty !== 'function') {
    throw new Error(`[${who}] Cesium 实例缺少 CallbackProperty，无法做淹没动画。`);
  }
  return Cesium as CesiumAnalysisLike;
}

/**
 * 创建地形分析库。
 * @param kit 由 createKit 传入
 */
export function createAnalysisKit(kit: Kit): AnalysisKit {
  const Cesium = assertAnalysisApi(assertCesium(kit.Cesium, KIT_NAME));
  const viewer = assertViewer(kit.viewer, KIT_NAME);

  /** 本库添加的裁剪面（可能挂在共享 collection 上），restore / stopAll 逐面移除 */
  const addedPlanes: ClippingPlane[] = [];
  /** 本库创建的 collection（首个 excavate 创建；之前已有则复用外部的） */
  let ownedCollection: ClippingPlaneCollection | undefined;
  /** 活跃淹没实体清理函数 */
  const floods = new Set<() => void>();

  function validateRegion(region: LonLatPoint[], min: number): Cartesian3[] {
    if (!Array.isArray(region) || region.length < min) {
      throw new Error(`[${KIT_NAME}] region 至少需要 ${min} 个点 [{ lon, lat }]。`);
    }
    return region.map((p) => {
      if (!Number.isFinite(p?.lon) || !Number.isFinite(p?.lat)) {
        throw new Error(`[${KIT_NAME}] region 点缺 lon/lat 或不是数字: ${JSON.stringify(p)}`);
      }
      return Cesium.Cartesian3.fromDegrees(p.lon, p.lat);
    });
  }

  /**
   * 地形开挖：沿多边形边界生成竖直裁剪面（法线指向多边形外侧），
   * 裁掉区域内的地形——表现即为"挖坑"（非凸区域按凸包语义）。
   * 裁剪语义依据：默认 unionClippingRegions=false 时，只有在"所有平面的负侧"的才被裁，
   * 法线指向外侧时区域内部恰好全部处于每个面的负侧。
   */
  function excavate(region: LonLatPoint[], opts: { edgeColor?: string } = {}): ExcavateHandle {
    const cartesians = validateRegion(region, 3);
    const n = cartesians.length;

    // 质心（ECEF 平均）——用于把法线统一翻转到多边形外侧
    let centroid = new Cesium.Cartesian3(0, 0, 0);
    for (const c of cartesians) centroid = Cesium.Cartesian3.add(centroid, c, centroid);
    centroid = Cesium.Cartesian3.multiplyByScalar(centroid, 1 / n, centroid);

    const planes: ClippingPlane[] = [];
    for (let i = 0; i < n; i++) {
      const start = cartesians[i] as Cartesian3;
      const end = cartesians[(i + 1) % n] as Cartesian3;
      const mid = Cesium.Cartesian3.multiplyByScalar(
        Cesium.Cartesian3.add(start, end, new Cesium.Cartesian3()),
        0.5,
        new Cesium.Cartesian3(),
      );
      const up = Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(mid, new Cesium.Cartesian3());
      const dir = Cesium.Cartesian3.normalize(
        Cesium.Cartesian3.subtract(end, start, new Cesium.Cartesian3()),
        new Cesium.Cartesian3(),
      );
      let normal = Cesium.Cartesian3.normalize(
        Cesium.Cartesian3.cross(dir, up, new Cesium.Cartesian3()),
        new Cesium.Cartesian3(),
      );
      // dir × up 的朝向随多边形绕向变化——按"背离质心"统一翻到外侧
      const toCentroid = Cesium.Cartesian3.subtract(centroid, mid, new Cesium.Cartesian3());
      if (Cesium.Cartesian3.dot(normal, toCentroid) > 0) {
        normal = Cesium.Cartesian3.multiplyByScalar(normal, -1, normal);
      }
      // Hessian 法向式: dot(normal, p) + distance = 0 → 平面过棱上点 E 时 distance = -dot(normal, E)
      planes.push(new Cesium.ClippingPlane(normal, -Cesium.Cartesian3.dot(normal, start)));
    }

    let collection = viewer.scene.globe.clippingPlanes as ClippingPlaneCollection | undefined;
    const createdHere = !collection;
    if (!collection) {
      collection = new Cesium.ClippingPlaneCollection({
        edgeColor: Cesium.Color.fromCssColorString(opts.edgeColor ?? '#ffffff') ?? undefined,
      });
      ownedCollection = collection;
      viewer.scene.globe.clippingPlanes = collection;
    }
    for (const plane of planes) {
      collection.add(plane);
      addedPlanes.push(plane);
    }

    return {
      planes: planes.length,
      restore() {
        // 只摘本库加的面；整个 collection 是本库创建且已清空时，连同引用一起还原
        for (const plane of planes) {
          collection?.remove(plane);
          const idx = addedPlanes.indexOf(plane);
          if (idx >= 0) addedPlanes.splice(idx, 1);
        }
        if (createdHere && ownedCollection && ownedCollection.length === 0) {
          // cesium 类型把 globe.clippingPlanes 标成非可选, 实际可置 undefined 还原
          (viewer.scene.globe as { clippingPlanes?: ClippingPlaneCollection | undefined }).clippingPlanes = undefined;
          ownedCollection = undefined;
        }
        return { ok: true };
      },
    };
  }

  /**
   * 淹没分析：region 内生成水面多边形，extrudedHeight 挂 CallbackProperty
   * 按真实时间从 startHeight 匀速涨到 endHeight（回调内 clamp，见 polygon-height-semantics 条目）。
   * @param opts startHeight 起始水位（米）；endHeight 目标水位；seconds 涨满耗时；color 水色
   */
  function flood(
    region: LonLatPoint[],
    opts: { startHeight?: number; endHeight?: number; seconds?: number; color?: string } = {},
  ): FloodHandle {
    const startHeight = opts.startHeight ?? 0;
    const endHeight = opts.endHeight ?? 10;
    const seconds = opts.seconds ?? 60;
    if (!(endHeight > startHeight)) {
      throw new Error(`[${KIT_NAME}] endHeight(${endHeight}) 必须大于 startHeight(${startHeight})。`);
    }
    const color = Cesium.Color.fromCssColorString(opts.color ?? 'rgba(64, 157, 253, 0.6)');
    if (!color) {
      throw new Error(`[${KIT_NAME}] 无法解析水色 "${opts.color}" —— 用 #rrggbb 或 rgba() 格式。`);
    }

    const positions = validateRegion(region, 3).map((c) => {
      const carto = Cesium.Cartographic.fromCartesian(c);
      return Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude);
    });

    const t0 = Date.now();
    let height = startHeight;
    const extruded = new Cesium.CallbackProperty(() => {
      // 按真实时间推进并封顶——不 clamp 水位会无限涨
      height = Math.min(startHeight + ((Date.now() - t0) / 1000 / seconds) * (endHeight - startHeight), endHeight);
      return height;
    }, false);

    const entity = viewer.entities.add({
      polygon: {
        hierarchy: positions,
        material: color,
        extrudedHeight: extruded,
      },
    });

    const stopFlood = () => {
      viewer.entities.remove(entity);
      floods.delete(stopFlood);
      return { ok: true as const };
    };
    floods.add(stopFlood);
    return { id: entity.id, stop: stopFlood };
  }

  /**
   * 通视分析：两点间沿线采样地形高，与"视线高"（端点地形高 + eyeHeight 的线性插值）比较，
   * 任一采样点地形高于视线即被遮挡。只考虑地形——3D Tiles / 建筑不参与（需深度纹理方案）。
   * @param opts samples 采样段数（默认 100）；eyeHeight 视点离地高（默认 1.8m）；tolerance 净空容差（默认 1m）
   */
  async function intervisibility(
    p1: LonLatPoint,
    p2: LonLatPoint,
    opts: { samples?: number; eyeHeight?: number; tolerance?: number } = {},
  ): Promise<IntervisibilityResult> {
    const samples = Math.max(2, Math.floor(opts.samples ?? 100));
    const eyeHeight = opts.eyeHeight ?? 1.8;
    const tolerance = opts.tolerance ?? 1;
    for (const [name, p] of [['p1', p1], ['p2', p2]] as const) {
      if (!Number.isFinite(p?.lon) || !Number.isFinite(p?.lat)) {
        throw new Error(`[${KIT_NAME}] ${name} 缺 lon/lat 或不是数字。`);
      }
    }

    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    const line: Array<{ lon: number; lat: number }> = [];
    for (let i = 0; i < samples; i++) {
      const t = i / (samples - 1);
      line.push({ lon: lerp(p1.lon, p2.lon, t), lat: lerp(p1.lat, p2.lat, t) });
    }

    // 椭球地形（无 availability）不支持 mostDetailed 采样——高程全 0，两点必然通视
    const provider = viewer.terrainProvider as unknown as { availability?: unknown };
    if (!provider || !provider.availability) {
      return { ok: true, blocked: false, blocker: null, minClearance: eyeHeight, sampled: 0 };
    }

    const updated = await Cesium.sampleTerrainMostDetailed(
      viewer.terrainProvider,
      line.map((p) => Cesium.Cartographic.fromDegrees(p.lon, p.lat)),
    );
    const heights = updated.map((c) => c?.height ?? 0);

    // 视线高：两端点"地形高 + 视点离地高"之间线性插值
    const losStart = (heights[0] ?? 0) + eyeHeight;
    const losEnd = (heights[heights.length - 1] ?? 0) + eyeHeight;

    let blocker: IntervisibilityResult['blocker'] = null;
    let minClearance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < samples; i++) {
      const t = i / (samples - 1);
      const los = lerp(losStart, losEnd, t);
      const terrainH = heights[i] ?? 0;
      const clearance = los - terrainH;
      if (clearance < minClearance) minClearance = clearance;
      if (!blocker && clearance < -tolerance) {
        const p = line[i] as { lon: number; lat: number };
        blocker = { lon: p.lon, lat: p.lat, height: terrainH };
      }
    }
    return { ok: true, blocked: blocker !== null, blocker, minClearance, sampled: samples };
  }

  /** 还原全部开挖并移除全部水面。 */
  function stopAll(): AnalysisStopResult {
    for (const plane of [...addedPlanes]) {
      viewer.scene.globe.clippingPlanes?.remove(plane);
    }
    addedPlanes.length = 0;
    if (ownedCollection) {
      (viewer.scene.globe as { clippingPlanes?: ClippingPlaneCollection | undefined }).clippingPlanes = undefined;
      ownedCollection = undefined;
    }
    for (const stop of [...floods]) stop();
    return { ok: true, stopped: floods.size };
  }

  return {
    KIT_NAME,
    excavate,
    flood,
    intervisibility,
    stopAll,
    dispose: stopAll,
  };
}

export default createAnalysisKit;
