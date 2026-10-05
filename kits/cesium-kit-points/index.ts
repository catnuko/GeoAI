// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 catnuko <https://github.com/catnuko>
/**
 * cesium-kit-points —— 海量点位能力库（注入式）
 *
 * 沉淀的经验（对应 experience/entries 中的条目）：
 *   - mass-points-collections：上万点位别逐个 add Entity（一次 drawcall 一个 entity），
 *     必须走 BillboardCollection / PointPrimitiveCollection 直入 scene.primitives 单次 batch。
 *   - clamp-to-ground-scope：贴地点要双保险——heightReference: CLAMP_TO_GROUND 之外
 *     还要 disableDepthTestDistance: POSITIVE_INFINITY，否则被地形/建筑深度盖住时隐时现。
 *   - frame-listener-leak：Collection 的持有者要能干净移除（clear/dispose 走 primitives.remove）。
 *
 * 铁律：Cesium 只从 kit 入参拿，类型从 ../cesium-api-types 取（import type）。
 */

import { assertCesium, assertViewer } from '../cesium-kit-core/index';
import type { Kit } from '../cesium-kit-core/index';
import type {
  BillboardCollection,
  Color,
  CesiumPointsLike,
  LabelCollection,
  NearFarScalar,
  PointPrimitiveCollection,
} from '../cesium-api-types';

export const KIT_NAME = 'cesium-kit-points';

/** 单个点位。带 image 走 Billboard（图标），带 text 走 Label（标注），否则走 PointPrimitive（纯色点，更快） */
export interface PointItem {
  lon: number;
  lat: number;
  /** 米；clampToGround 时忽略 */
  height?: number;
  /** CSS 颜色（#rrggbb / rgba()），仅纯色点生效 */
  color?: string;
  /** 纯色点直径（像素），默认 8 */
  pixelSize?: number;
  /** 图标 URL（走 Billboard） */
  image?: string;
  /** 图标缩放 */
  scale?: number;
  /** 文字标注（走 LabelCollection，同样支持贴地双保险） */
  text?: string;
}

/** addMany() 的选项 */
export interface PointsAddOptions {
  /** 按相机远近缩放 [near, nearValue, far, farValue]，如 [2e6, 1.0, 8e6, 0.1] */
  scaleByDistance?: [number, number, number, number];
  /** 贴地（忽略 height，自动配防遮挡双保险，需地形就绪） */
  clampToGround?: boolean;
}

/** addMany() 的结果 */
export interface PointsAddResult {
  ok: true;
  count: number;
  billboards: number;
  points: number;
  labels: number;
}

/** 移除结果 */
export interface PointsRemoveResult {
  ok: true;
  removed: number;
}

/** 海量点位能力库接口 */
export interface PointsKit {
  KIT_NAME: typeof KIT_NAME;
  addMany(items: PointItem[], opts?: PointsAddOptions): PointsAddResult;
  clear(): PointsRemoveResult;
  dispose(): PointsRemoveResult;
}

/** points 库需要 Collection/NearFarScalar/HeightReference——缺了在入口报，别等 add 时 undefined */
function assertPointsApi(Cesium: unknown, who: string = KIT_NAME): CesiumPointsLike {
  const ns = Cesium as Partial<CesiumPointsLike>;
  if (typeof ns.BillboardCollection !== 'function' || typeof ns.PointPrimitiveCollection !== 'function') {
    throw new Error(
      `[${who}] Cesium 实例缺少 BillboardCollection / PointPrimitiveCollection，` +
        '无法渲染海量点。请检查 Cesium.js 是否完整加载（注意勿混入两份 Cesium）。',
    );
  }
  if (typeof ns.NearFarScalar !== 'function') {
    throw new Error(`[${who}] Cesium 实例缺少 NearFarScalar，无法配置按距离缩放。`);
  }
  return Cesium as CesiumPointsLike;
}

/**
 * 创建海量点位能力库。
 * @param kit 由 createKit 传入
 */
export function createPointsKit(kit: Kit): PointsKit {
  const Cesium = assertPointsApi(assertCesium(kit.Cesium, KIT_NAME));
  const viewer = assertViewer(kit.viewer, KIT_NAME);

  /** 本库创建的 Collection，供 clear / dispose（必须存原对象：primitives.remove 只认原引用） */
  const collections: Array<BillboardCollection | PointPrimitiveCollection | LabelCollection> = [];

  function parseColor(css?: string): Color | undefined {
    if (!css) return undefined;
    const c = Cesium.Color.fromCssColorString(css);
    if (!c) {
      throw new Error(`[${KIT_NAME}] 无法解析颜色 "${css}" —— 用 #rrggbb 或 rgba() 格式。`);
    }
    return c;
  }

  /**
   * 批量加点位（万级无压力：Collection 单次 batch，别用 Entity 逐个 add）。
   * 带 image 的项走 BillboardCollection，其余走 PointPrimitiveCollection。
   * @param items 点位列表
   * @param opts scaleByDistance 按远近缩放；clampToGround 贴地 + 防遮挡双保险
   */
  function addMany(items: PointItem[], opts: PointsAddOptions = {}): PointsAddResult {
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error(`[${KIT_NAME}] addMany() 需要至少一个点位 [{ lon, lat, height?, color? | image? }]。`);
    }
    const scaleByDistance = opts.scaleByDistance
      ? new Cesium.NearFarScalar(...opts.scaleByDistance)
      : undefined;
    // 贴地双保险：只设 CLAMP_TO_GROUND 会被地形/建筑深度盖住（时隐时现）
    const heightReference = opts.clampToGround
      ? Cesium.HeightReference.CLAMP_TO_GROUND
      : undefined;
    const disableDepthTestDistance = opts.clampToGround ? Number.POSITIVE_INFINITY : undefined;

    let billboards = 0;
    let points = 0;
    let labels = 0;
    let billboardColl: BillboardCollection | undefined;
    let pointColl: PointPrimitiveCollection | undefined;
    let labelColl: LabelCollection | undefined;

    for (const item of items) {
      if (!Number.isFinite(item?.lon) || !Number.isFinite(item?.lat)) {
        throw new Error(`[${KIT_NAME}] 点位缺 lon/lat 或不是数字: ${JSON.stringify(item)}`);
      }
      const position = Cesium.Cartesian3.fromDegrees(item.lon, item.lat, opts.clampToGround ? undefined : item.height ?? 0);
      if (item.text) {
        // 贴地标注同样是双保险：CLAMP_TO_GROUND + disableDepthTestDistance（见 clamp-to-ground-scope 条目）
        if (!labelColl) labelColl = viewer.scene.primitives.add(new Cesium.LabelCollection()) as LabelCollection;
        labelColl.add({
          position,
          text: item.text,
          font: '14pt sans-serif',
          showBackground: true,
          scaleByDistance,
          heightReference,
          disableDepthTestDistance,
        });
        labels += 1;
      } else if (item.image) {
        // primitives.add 的类型声明返回 any, 不断言收窄的话 TS 视为仍可能 undefined
        if (!billboardColl) billboardColl = viewer.scene.primitives.add(new Cesium.BillboardCollection()) as BillboardCollection;
        billboardColl.add({
          position,
          image: item.image,
          scale: item.scale,
          scaleByDistance,
          heightReference,
          disableDepthTestDistance,
        });
        billboards += 1;
      } else {
        if (!pointColl) pointColl = viewer.scene.primitives.add(new Cesium.PointPrimitiveCollection()) as PointPrimitiveCollection;
        pointColl.add({
          position,
          pixelSize: item.pixelSize ?? 8,
          color: parseColor(item.color) ?? Cesium.Color.RED,
          scaleByDistance,
          heightReference,
          disableDepthTestDistance,
        });
        points += 1;
      }
    }
    if (billboardColl) collections.push(billboardColl);
    if (pointColl) collections.push(pointColl);
    if (labelColl) collections.push(labelColl);
    return { ok: true, count: billboards + points + labels, billboards, points, labels };
  }

  /** 移除本库创建的所有 Collection。 */
  function clear(): PointsRemoveResult {
    let n = 0;
    while (collections.length) {
      const coll = collections.pop();
      try {
        if (coll && viewer.scene.primitives.remove(coll)) n += 1;
      } catch {
        /* 已被外部移除 */
      }
    }
    return { ok: true, removed: n };
  }

  return {
    KIT_NAME,
    addMany,
    clear,
    dispose: clear,
  };
}

export default createPointsKit;
