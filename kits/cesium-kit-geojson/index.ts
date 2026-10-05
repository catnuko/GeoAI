// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 catnuko <https://github.com/catnuko>
/**
 * cesium-kit-geojson —— 中国行政边界 GeoJSON 能力库（注入式）
 *
 * 数据源：阿里 DataV.GeoJSON 在线服务（免 key，公开只读）
 *   https://datav.aliyun.com/portal/school/atlas/area_selector
 *   https://geo.datav.aliyun.com/areas_v3/bound/{adcode}.json        单个区域轮廓
 *   https://geo.datav.aliyun.com/areas_v3/bound/{adcode}_full.json   区域 + 全部直接下级
 *
 * 对应经验条目：2026-10-05-datav-china-geojson（URL 规律 / adcode 层级 / 坑位清单）。
 *
 * 已封装的坑：
 *   - _full 只在有下级时存在：叶子区域（childrenNum === 0）请求 _full 返回 404；
 *     fetchAdmin/loadAdmin 按返回的 childrenNum 自动降级为单区域文件。
 *   - _full 的 features 是「直接下级」而非自身：要看自身轮廓必须再取不带 _full 的那份；
 *     loadAdmin 的返回值把两者都给你（selfUrl / fullUrl）。
 *   - 坐标系：DataV 数据官方未标注，社区共识是源自高德（GCJ-02）；叠加 WGS84 底图
 *     （ArcGIS 影像 / 天地图）时边界约有 300~600m 偏移，高德/阿里生态内叠加则相互匹配。
 *
 * 铁律：Cesium 只从 kit 入参拿，类型从 ../cesium-api-types.js 取（import type）。
 */

import { assertCesium, assertViewer } from '../cesium-kit-core/index';
import type { Kit } from '../cesium-kit-core/index';
import type { Color, GeoJsonDataSource } from '../cesium-api-types';

export const KIT_NAME = 'cesium-kit-geojson';

/** DataV.GeoJSON 行政边界服务（免 key，公开只读） */
export const DATAV = {
  /** 服务根路径，拼法：`${base}/${adcode}.json` 或 `${base}/${adcode}_full.json` */
  base: 'https://geo.datav.aliyun.com/areas_v3/bound',
  /** 中国（country）。取省级清单用 adminUrl(100000, { full: true }) */
  china: 100000,
} as const;

/** 常用 adcode 速查（省级行政区，完整清单用 fetchAdmin(100000, { full: true }) 自查） */
export const ADCODE_HINTS = {
  北京: 110000,
  天津: 120000,
  上海: 310000,
  重庆: 500000,
  河北: 130000,
  山西: 140000,
  内蒙古: 150000,
  辽宁: 210000,
  吉林: 220000,
  黑龙江: 230000,
  江苏: 320000,
  浙江: 330000,
  安徽: 340000,
  福建: 350000,
  江西: 360000,
  山东: 370000,
  河南: 410000,
  湖北: 420000,
  湖南: 430000,
  广东: 440000,
  广西: 450000,
  海南: 460000,
  四川: 510000,
  贵州: 520000,
  云南: 530000,
  西藏: 540000,
  陕西: 610000,
  甘肃: 620000,
  青海: 630000,
  宁夏: 640000,
  新疆: 650000,
  香港: 810000,
  澳门: 820000,
  台湾: 710000,
} as const;

/** 拼 DataV 行政边界 URL。full=true 取「含全部直接下级」的版本（叶子区域无此文件，会自动降级）。 */
export function adminUrl(adcode: number | string, opts: { full?: boolean } = {}): string {
  const code = String(adcode).trim();
  if (!/^\d{1,6}$/.test(code)) {
    throw new Error(
      `[${KIT_NAME}] adcode 应为 1~6 位数字（如 100000 全国 / 420000 湖北 / 420100 武汉），收到：${adcode}`,
    );
  }
  return `${DATAV.base}/${code}${opts.full ? '_full' : ''}.json`;
}

/** DataV properties 的常用字段（其余字段原样保留在 properties 上） */
export interface AdminProperties {
  adcode?: number;
  name?: string;
  level?: string;
  childrenNum?: number;
  center?: [number, number];
  centroid?: [number, number];
  parent?: { adcode: number | null };
  [key: string]: unknown;
}

/** 最小 GeoJSON 形状（纯数据结构，与库层的 CartoLike 同风格） */
export interface AdminFeature {
  type: 'Feature';
  properties: AdminProperties;
  geometry: { type: string; coordinates: unknown };
}

export interface AdminFeatureCollection {
  type: 'FeatureCollection';
  features: AdminFeature[];
}

/** 下级清单项（listFeatures 的返回） */
export interface AdminFeatureSummary {
  adcode: number | null;
  name: string | null;
  level: string | null;
  childrenNum: number | null;
  center: [number, number] | null;
}

/** fetchAdmin 的返回 */
export interface FetchAdminResult {
  ok: true;
  /** 实际请求成功的 URL（含自动降级后的） */
  url: string;
  /** 是否请求了 _full 版本（false = 被降级为单区域，或本来就要的单区域） */
  full: boolean;
  featureCount: number;
  /** 单区域请求时 = 区域自身属性；_full 请求时 = 第一个下级的属性 */
  properties: AdminProperties | null;
  geojson: AdminFeatureCollection;
}

/** loadAdmin 的返回 */
export interface LoadAdminResult extends FetchAdminResult {
  /** 加入 viewer 的数据源（同一实例，可用于后续移除） */
  dataSource: GeoJsonDataSource;
  /** 已飞到该数据范围（仅 flyTo: true 时） */
  flewTo: boolean;
}

/** loadAdmin 样式与行为选项 */
export interface LoadAdminOptions {
  /** 取 _full（含直接下级）。默认 false（单区域轮廓）。叶子区域传 true 会自动降级 */
  full?: boolean;
  /** 边界贴地（有 3D 地形时尤其需要）。默认 true */
  clampToGround?: boolean;
  fill?: Color;
  stroke?: Color;
  strokeWidth?: number;
  /** 加载后飞到数据范围。默认 false */
  flyTo?: boolean;
  /** 飞行动画时长（秒）。默认 2 */
  flyDuration?: number;
}

/** 移除结果 */
export interface RemoveResult {
  ok: true;
  removed: number;
}

/** 行政边界 GeoJSON 能力库接口 */
export interface GeoJsonKit {
  KIT_NAME: typeof KIT_NAME;
  DATAV: typeof DATAV;
  ADCODE_HINTS: typeof ADCODE_HINTS;
  adminUrl: typeof adminUrl;
  fetchAdmin(adcode: number | string, opts?: { full?: boolean }): Promise<FetchAdminResult>;
  loadAdmin(adcode: number | string, opts?: LoadAdminOptions): Promise<LoadAdminResult>;
  pickFeature(geojson: AdminFeatureCollection, match: string | number): AdminFeature | null;
  listFeatures(geojson: AdminFeatureCollection): AdminFeatureSummary[];
  removeAll(): RemoveResult;
  dispose(): RemoveResult;
}

/**
 * 创建行政边界 GeoJSON 能力库。
 * @param kit 由 createKit 传入
 */
export function createGeoJsonKit(kit: Kit): GeoJsonKit {
  const Cesium = assertCesium(kit.Cesium, KIT_NAME);
  const viewer = assertViewer(kit.viewer, KIT_NAME);

  if (typeof Cesium.GeoJsonDataSource?.load !== 'function') {
    throw new Error(
      `[${KIT_NAME}] Cesium 实例缺少 GeoJsonDataSource.load，可能是 CDN 版本不完整或加载了非 Cesium 全局对象。`,
    );
  }

  /** 本库加入 viewer 的数据源，便于 removeAll / dispose */
  const added: GeoJsonDataSource[] = [];

  /**
   * 拉取行政边界 GeoJSON（原始数据，不进 Cesium）。
   * 请求 _full 得到 404（叶子区域）时自动降级为单区域文件。
   * @param adcode 行政区划代码，1~6 位数字
   * @param opts.full 是否取含直接下级的 _full 版本
   */
  async function fetchAdmin(
    adcode: number | string,
    opts: { full?: boolean } = {},
  ): Promise<FetchAdminResult> {
    const wantFull = opts.full === true;
    const fullUrl = adminUrl(adcode, { full: true });
    const selfUrl = adminUrl(adcode);
    let url = wantFull ? fullUrl : selfUrl;
    let res = await fetch(url);
    if (wantFull && res.status === 404) {
      // 叶子区域没有 _full 文件——降级为单区域轮廓，而不是把 404 抛给上层
      url = selfUrl;
      res = await fetch(url);
    }
    if (!res.ok) {
      throw new Error(
        `[${KIT_NAME}] 拉取行政边界失败：HTTP ${res.status} @ ${url}` +
          '（adcode 是否存在可在 fetchAdmin(100000, { full: true }) 的下级清单里核对）',
      );
    }
    const geojson = (await res.json()) as AdminFeatureCollection;
    if (geojson?.type !== 'FeatureCollection' || !Array.isArray(geojson.features)) {
      throw new Error(`[${KIT_NAME}] 返回的不是 GeoJSON FeatureCollection @ ${url}`);
    }
    return {
      ok: true,
      url,
      full: url === fullUrl,
      featureCount: geojson.features.length,
      properties: geojson.features[0]?.properties ?? null,
      geojson,
    };
  }

  /**
   * 拉取并加载为 Cesium 数据源（默认贴地）。
   * @param adcode 行政区划代码
   * @param opts 样式（fill/stroke/strokeWidth）、贴地、是否 flyTo
   */
  async function loadAdmin(
    adcode: number | string,
    opts: LoadAdminOptions = {},
  ): Promise<LoadAdminResult> {
    const fetched = await fetchAdmin(adcode, { full: opts.full });
    const dataSource = await Cesium.GeoJsonDataSource.load(fetched.geojson, {
      clampToGround: opts.clampToGround ?? true,
      fill: opts.fill ?? Cesium.Color.CYAN.withAlpha(0.2),
      stroke: opts.stroke ?? Cesium.Color.CYAN,
      strokeWidth: opts.strokeWidth,
    });
    await viewer.dataSources.add(dataSource);
    added.push(dataSource);
    let flewTo = false;
    if (opts.flyTo) {
      await viewer.flyTo(dataSource, { duration: opts.flyDuration ?? 2 });
      flewTo = true;
    }
    return { ...fetched, dataSource, flewTo };
  }

  /**
   * 从 FeatureCollection 里按名称或 adcode 摘一个 feature（跨级提取常用：
   * 如从 100000_full 里摘「湖北省」）。名称先精确匹配，再包含匹配。
   * @param geojson fetchAdmin 返回的 geojson
   * @param match adcode（number）或名称（string）
   */
  function pickFeature(geojson: AdminFeatureCollection, match: string | number): AdminFeature | null {
    const features = geojson?.features ?? [];
    if (typeof match === 'number') {
      return features.find((f) => f.properties.adcode === match) ?? null;
    }
    const key = match.trim();
    return (
      features.find((f) => f.properties.name === key) ??
      features.find((f) => (f.properties.name ?? '').includes(key)) ??
      null
    );
  }

  /**
   * 列出 FeatureCollection 里各 feature 的摘要（_full 数据即「下级清单」，
   * 是 adcode 自查的入口：fetchAdmin(100000, { full: true }) → listFeatures）。
   */
  function listFeatures(geojson: AdminFeatureCollection): AdminFeatureSummary[] {
    return (geojson?.features ?? []).map((f) => ({
      adcode: f.properties.adcode ?? null,
      name: f.properties.name ?? null,
      level: f.properties.level ?? null,
      childrenNum: f.properties.childrenNum ?? null,
      center: f.properties.center ?? null,
    }));
  }

  /** 移除本库加载的所有数据源。 */
  function removeAll(): RemoveResult {
    let n = 0;
    while (added.length) {
      const ds = added.pop();
      try {
        if (ds && viewer.dataSources.contains(ds)) {
          viewer.dataSources.remove(ds, true);
          n += 1;
        }
      } catch {
        /* 已被外部移除 */
      }
    }
    return { ok: true, removed: n };
  }

  return {
    KIT_NAME,
    DATAV,
    ADCODE_HINTS,
    adminUrl,
    fetchAdmin,
    loadAdmin,
    pickFeature,
    listFeatures,
    removeAll,
    dispose: removeAll,
  };
}

export default createGeoJsonKit;
