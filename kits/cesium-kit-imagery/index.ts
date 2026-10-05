// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 catnuko <https://github.com/catnuko>
/**
 * cesium-kit-imagery —— 影像与地形能力库（注入式）
 *
 * 沉淀的经验（对应 experience/entries 中的已验证条目）：
 *   - arcgis-world-imagery-terrain3d：ArcGIS World_Imagery 影像 + Terrain3D 高程，
 *     免 key（2026-10 实测，精度按区域 1000m~50cm）。
 *   - base-layer-false：页面以 baseLayer:false 创建 Viewer 时没有首层影像，
 *     此时 addImageryProvider 加的第一层就是底图，无需再 add(baseLayer)。
 *
 * 合规说明：本库不提供境外直连瓦片（OSM 等）作为默认项。
 * 天地图需自行申请 key，走 tiandituImagery() 显式传入。
 *
 * 铁律：Cesium 只从 kit 入参拿，类型从 ../cesium-api-types.js 取（import type）。
 */

import { assertCesium, assertViewer } from '../cesium-kit-core/index';
import type { Kit } from '../cesium-kit-core/index';
import type {
  HeightSample,
  ImageryAddResult,
  ImageryLayer,
  UrlTemplateImageryProvider,
} from '../cesium-api-types';

export const KIT_NAME = 'cesium-kit-imagery';

/** ArcGIS 在线服务（免 key，公开只读） */
export const ARCGIS = {
  /** 卫星影像底图 */
  worldImagery: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer',
  /** 3D 地形高程 */
  terrain3d: 'https://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/Terrain3D/ImageServer',
} as const;

/** 天地图图层类型 */
export type TiandituLayer = 'img' | 'cia' | 'ter';

/** 影像/地形操作结果 */
export interface OkResult {
  ok: true;
}

/** 移除结果 */
export interface RemoveResult extends OkResult {
  removed: number;
}

/** 影像与地形能力库接口 */
export interface ImageryKit {
  KIT_NAME: typeof KIT_NAME;
  ARCGIS: typeof ARCGIS;
  addArcGisImagery(url?: string, opts?: { alpha?: number; brightness?: number }): Promise<ImageryAddResult>;
  tiandituImagery(token: string, opts?: { layer?: TiandituLayer }): UrlTemplateImageryProvider;
  enableTerrain3D(url?: string): Promise<OkResult & { url: string }>;
  disableTerrain(): OkResult;
  sampleHeight(lon: number, lat: number): Promise<HeightSample>;
  removeAll(): RemoveResult;
  dispose(): RemoveResult;
}

/**
 * 创建影像/地形能力库。
 * @param kit 由 createKit 传入
 */
export function createImageryKit(kit: Kit): ImageryKit {
  const Cesium = assertCesium(kit.Cesium, KIT_NAME);
  const viewer = assertViewer(kit.viewer, KIT_NAME);

  /**
   * 本库添加的图层引用，便于 removeAll / dispose。
   * 注意 Cesium 的 ImageryLayer 本身没有 remove()——移除要走 imageryLayers.remove(layer)，
   * 且必须传「原对象」而非 index，所以这里存对象本身。
   */
  const added: ImageryLayer[] = [];

  /**
   * 加一个 ArcGIS 影像服务。
   * @param url 服务地址，默认 World_Imagery
   * @param opts 图层透明度 / 亮度
   */
  async function addArcGisImagery(
    url: string = ARCGIS.worldImagery,
    opts: { alpha?: number; brightness?: number } = {},
  ): Promise<ImageryAddResult> {
    const provider = await Cesium.ArcGisMapServerImageryProvider.fromUrl(url);
    const layer = viewer.imageryLayers.addImageryProvider(provider);
    if (typeof opts.alpha === 'number') layer.alpha = opts.alpha;
    if (typeof opts.brightness === 'number') layer.brightness = opts.brightness;
    added.push(layer);
    return { ok: true, layerIndex: viewer.imageryLayers.indexOf(layer), url };
  }

  /**
   * 构造天地图影像 provider（需自备 key）。
   * 申请入口：http://lbs.tianditu.gov.cn/ → 控制台 → 创建应用 → 服务接口。
   * @param token 天地图 key
   * @param opts layer=img 影像 / cia 注记 / ter 地形晕渲
   */
  function tiandituImagery(token: string, opts: { layer?: TiandituLayer } = {}): UrlTemplateImageryProvider {
    const tk = String(token ?? '').trim();
    if (!tk) {
      throw new Error(
        `[${KIT_NAME}] tiandituImagery() 需要天地图 key。申请入口 http://lbs.tianditu.gov.cn/ → 控制台 → 创建新应用 → 服务接口。`,
      );
    }
    const layerName: TiandituLayer = opts.layer ?? 'img';
    return new Cesium.UrlTemplateImageryProvider({
      url:
        `https://t{s}.tianditu.gov.cn/${layerName}_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0` +
        `&LAYER=${layerName}&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles` +
        '&TILEMATRIX={TileMatrix}&TILEROW={TileRow}&TILECOL={TileCol}&tk=' +
        tk,
      subdomains: ['0', '1', '2', '3', '4', '5', '6', '7'],
      maximumLevel: 18,
    });
  }

  /**
   * 启用 3D 地形高程（免 key）。会替换当前 terrainProvider。
   * @param url ArcGIS Terrain3D 服务地址
   */
  async function enableTerrain3D(url: string = ARCGIS.terrain3d): Promise<OkResult & { url: string }> {
    viewer.terrainProvider = await Cesium.ArcGISTiledElevationTerrainProvider.fromUrl(url);
    return { ok: true, url };
  }

  /** 关闭 3D 地形（回到椭球）。 */
  function disableTerrain(): OkResult {
    viewer.terrainProvider = new Cesium.EllipsoidTerrainProvider();
    return { ok: true };
  }

  /**
   * 采样某点地形高程（米，正高）。
   * @param lon 经度
   * @param lat 纬度
   */
  async function sampleHeight(lon: number, lat: number): Promise<HeightSample> {
    const level = await Cesium.sampleTerrainMostDetailed(viewer.terrainProvider, [
      { lon, lat },
    ]);
    return { ok: true, height: level[0]?.height ?? 0 };
  }

  /** 移除本库添加的所有影像图层。 */
  function removeAll(): RemoveResult {
    let n = 0;
    while (added.length) {
      const layer = added.pop();
      try {
        if (layer) {
          viewer.imageryLayers.remove(layer);
          n += 1;
        }
      } catch {
        /* 图层已被外部移除 */
      }
    }
    return { ok: true, removed: n };
  }

  return {
    KIT_NAME,
    ARCGIS,
    addArcGisImagery,
    tiandituImagery,
    enableTerrain3D,
    disableTerrain,
    sampleHeight,
    removeAll,
    dispose: removeAll,
  };
}

export default createImageryKit;
