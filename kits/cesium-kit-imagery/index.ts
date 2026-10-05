// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 catnuko <https://github.com/catnuko>
/**
 * cesium-kit-imagery —— 影像与地形能力库（注入式）
 *
 * 沉淀的经验（对应 experience/entries 中的条目）：
 *   - arcgis-world-imagery-terrain3d：ArcGIS World_Imagery 影像 + Terrain3D 高程，
 *     免 key（2026-10 实测，精度按区域 1000m~50cm）。
 *   - base-layer-false：页面以 baseLayer:false 创建 Viewer 时没有首层影像，
 *     此时 addImageryProvider 加的第一层就是底图，无需再 add(baseLayer)。
 *   - domestic-imagery-traps：天地图 _c 层号从 1 起（配 GeographicTilingScheme）、
 *     _w 从 0 起（配 WebMercatorTilingScheme），错一个全盘 404/错位；
 *     4490 服务层号偏移因服务而异（customTags 兜底）；WMS 必给 transparent+png。
 *   - terrain-height-timing：sampleTerrainMostDetailed 只认弧度 Cartographic；
 *     globe.getHeight 只反映已加载瓦片，批量取高一律走异步采样。
 *
 * 合规说明：本库不提供境外直连瓦片（OSM 等）作为默认项。
 * 天地图需自行申请 key，走 addTianditu() / tiandituImagery() 显式传入。
 *
 * 铁律：Cesium 只从 kit 入参拿，类型从 ../cesium-api-types 取（import type）。
 */

import { assertCesium, assertViewer } from '../cesium-kit-core/index';
import type { Kit } from '../cesium-kit-core/index';
import type {
  HeightSample,
  ImageryAddResult,
  ImageryLayer,
  UrlTemplateImageryProvider,
  WebMapTileServiceImageryProvider,
} from '../cesium-api-types';

export const KIT_NAME = 'cesium-kit-imagery';

/** ArcGIS 在线服务（免 key，公开只读） */
export const ARCGIS = {
  /** 卫星影像底图 */
  worldImagery: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer',
  /** 3D 地形高程 */
  terrain3d: 'https://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/Terrain3D/ImageServer',
} as const;

/** 天地图图层（底图与注记成对：img+cia / vec+cva / ter+cta；ibo 全球境界） */
export type TiandituLayer = 'img' | 'cia' | 'vec' | 'cva' | 'ter' | 'cta' | 'ibo';

const TIANDITU_LAYERS: Record<TiandituLayer, string> = {
  img: '影像底图',
  cia: '影像注记',
  vec: '矢量底图',
  cva: '矢量注记',
  ter: '地形晕渲',
  cta: '地形注记',
  ibo: '全球境界',
};

/** 天地图投影：w=球面墨卡托（WebMercator，默认）/ c=经纬度（Geographic） */
export type TiandituProjection = 'w' | 'c';

/** 影像/地形操作结果 */
export interface OkResult {
  ok: true;
}

/** 移除结果 */
export interface RemoveResult extends OkResult {
  removed: number;
}

/** 批量高程采样结果（与入参点序一一对应，单位米） */
export interface HeightsSample {
  ok: true;
  heights: number[];
}

/** 剖面采样结果（沿线等分点，序同采样方向） */
export interface ProfileSample {
  ok: true;
  profile: Array<{ lon: number; lat: number; height: number }>;
}

/** 影像与地形能力库接口 */
export interface ImageryKit {
  KIT_NAME: typeof KIT_NAME;
  ARCGIS: typeof ARCGIS;
  addArcGisImagery(url?: string, opts?: { alpha?: number; brightness?: number }): Promise<ImageryAddResult>;
  addTianditu(
    token: string,
    opts?: {
      layer?: TiandituLayer;
      projection?: TiandituProjection;
      maximumLevel?: number;
      alpha?: number;
      brightness?: number;
    },
  ): Promise<ImageryAddResult>;
  tiandituImagery(
    token: string,
    opts?: { layer?: TiandituLayer; projection?: TiandituProjection; maximumLevel?: number },
  ): WebMapTileServiceImageryProvider;
  addWms(opts: { url: string; layers: string; parameters?: Record<string, string>; alpha?: number }): ImageryAddResult;
  add4490(
    url: string,
    opts?: {
      levelOffset?: number;
      minimumLevel?: number;
      maximumLevel?: number;
      subdomains?: string[];
      rectangle?: { west: number; south: number; east: number; north: number };
      alpha?: number;
    },
  ): ImageryAddResult;
  enableTerrain3D(url?: string): Promise<OkResult & { url: string }>;
  disableTerrain(): OkResult;
  sampleHeight(lon: number, lat: number): Promise<HeightSample>;
  sampleHeights(points: Array<{ lon: number; lat: number }>): Promise<HeightsSample>;
  sampleProfile(p1: { lon: number; lat: number }, p2: { lon: number; lat: number }, opts?: { samples?: number }): Promise<ProfileSample>;
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

  /** 添加 provider 的公共收口：调 alpha/brightness、登记引用、回 layerIndex */
  function addProvider(provider: unknown, opts: { alpha?: number; brightness?: number }, url: string): ImageryAddResult {
    const layer = viewer.imageryLayers.addImageryProvider(provider as never);
    if (typeof opts.alpha === 'number') layer.alpha = opts.alpha;
    if (typeof opts.brightness === 'number') layer.brightness = opts.brightness;
    added.push(layer);
    return { ok: true, layerIndex: viewer.imageryLayers.indexOf(layer), url };
  }

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
    return addProvider(provider, opts, url);
  }

  /**
   * 构造天地图 WMTS provider（需自备 key）。
   * 申请入口：http://lbs.tianditu.gov.cn/ → 控制台 → 创建应用 → 服务接口。
   *
   * 层号规则（天地图最容易踩的坑，见 domestic-imagery-traps 条目）：
   *   _c（经纬度投影）TileMatrix 从 1 开始 → labels 取 (z+1)，配 GeographicTilingScheme；
   *   _w（墨卡托投影）TileMatrix 从 0 开始 → labels 取 z，配 WebMercatorTilingScheme。
   * tilingScheme 与层号错一个，全盘 404 或整体错位。
   *
   * @param token 天地图 key
   * @param opts layer 图层 / projection 投影 / maximumLevel 层级上限
   */
  function tiandituImagery(
    token: string,
    opts: { layer?: TiandituLayer; projection?: TiandituProjection; maximumLevel?: number } = {},
  ): WebMapTileServiceImageryProvider {
    const tk = String(token ?? '').trim();
    if (!tk) {
      throw new Error(
        `[${KIT_NAME}] tiandituImagery() 需要天地图 key。申请入口 http://lbs.tianditu.gov.cn/ → 控制台 → 创建新应用 → 服务接口。`,
      );
    }
    const layer = String(opts.layer ?? 'img') as TiandituLayer;
    if (!(layer in TIANDITU_LAYERS)) {
      throw new Error(
        `[${KIT_NAME}] 未知的天地图图层 "${layer}"。可选: ${Object.keys(TIANDITU_LAYERS).join(' / ')}（底图与注记成对叠加，如 img + cia）。`,
      );
    }
    const projection: TiandituProjection = opts.projection === 'c' ? 'c' : 'w';
    const maximumLevel = opts.maximumLevel ?? 18;
    const mercator = projection === 'w';
    return new Cesium.WebMapTileServiceImageryProvider({
      url:
        `https://t{s}.tianditu.gov.cn/${layer}_${projection}/wmts?service=WMTS&version=1.0.0&request=GetTile` +
        `&tilematrix={TileMatrix}&layer=${layer}&style=default&tilerow={TileRow}&tilecol={TileCol}` +
        `&tilematrixset=${projection}&format=tiles&tk=${tk}`,
      layer,
      style: 'default',
      format: 'tiles',
      tileMatrixSetID: projection,
      subdomains: ['0', '1', '2', '3', '4', '5', '6', '7'],
      tileMatrixLabels: Array.from({ length: maximumLevel + 1 }, (_, z) => String(mercator ? z : z + 1)),
      tilingScheme: mercator ? new Cesium.WebMercatorTilingScheme() : new Cesium.GeographicTilingScheme(),
      maximumLevel,
    });
  }

  /**
   * 加一层天地图影像（key 必填）。底图 + 注记两连调：
   *   await kit.imagery.addTianditu(tk, { layer: 'img' });
   *   await kit.imagery.addTianditu(tk, { layer: 'cia' });
   */
  async function addTianditu(
    token: string,
    opts: {
      layer?: TiandituLayer;
      projection?: TiandituProjection;
      maximumLevel?: number;
      alpha?: number;
      brightness?: number;
    } = {},
  ): Promise<ImageryAddResult> {
    const layer = String(opts.layer ?? 'img');
    const projection = opts.projection ?? 'w';
    const provider = tiandituImagery(token, opts);
    return addProvider(provider, opts, `tianditu:${layer}_${projection}`);
  }

  /**
   * 加一层 WMS 服务。缺 transparent + image/png 会整幅不透明盖住底图
   * （本库已默认补上，见 domestic-imagery-traps 条目）。
   */
  function addWms(opts: {
    url: string;
    layers: string;
    parameters?: Record<string, string>;
    alpha?: number;
  }): ImageryAddResult {
    if (!opts?.url || !opts?.layers) {
      throw new Error(`[${KIT_NAME}] addWms() 需要 { url, layers }。layers 是 WMS 图层名（geoserver 里形如 topp:states）。`);
    }
    const provider = new Cesium.WebMapServiceImageryProvider({
      url: opts.url,
      layers: opts.layers,
      parameters: { transparent: 'true', format: 'image/png', ...opts.parameters },
    });
    return addProvider(provider, opts, opts.url);
  }

  /**
   * 加一层 4490/CGCS2000 经纬度切片（UrlTemplate）。
   * 切片方案同 4326（第 0 级 2×1）；很多服务 TileMatrix 层号有 ±1 偏移且因服务而异，
   * url 里写 {z4490} 占位，404 就调 levelOffset: 1 / -1 / 0 逐个试（见 domestic-imagery-traps 条目）。
   */
  function add4490(
    url: string,
    opts: {
      levelOffset?: number;
      minimumLevel?: number;
      maximumLevel?: number;
      subdomains?: string[];
      rectangle?: { west: number; south: number; east: number; north: number };
      alpha?: number;
    } = {},
  ): ImageryAddResult {
    if (!url || !url.includes('{z4490}')) {
      throw new Error(
        `[${KIT_NAME}] add4490() 的 url 必须包含 {z4490} 层号占位符` +
          '（TileCol={x}&TileRow={y}&TileMatrix={z4490}），404 时用 levelOffset 调偏移。',
      );
    }
    const provider = new Cesium.UrlTemplateImageryProvider({
      url,
      // 4490 与 4326 同为经纬度切片，第 0 级 2×1
      tilingScheme: new Cesium.GeographicTilingScheme({ numberOfLevelZeroTilesX: 2, numberOfLevelZeroTilesY: 1 }),
      customTags: { z4490: (_p, _x, _y, level) => String(level + (opts.levelOffset ?? 0)) },
      minimumLevel: opts.minimumLevel,
      maximumLevel: opts.maximumLevel,
      subdomains: opts.subdomains,
      rectangle: opts.rectangle
        ? Cesium.Rectangle.fromDegrees(opts.rectangle.west, opts.rectangle.south, opts.rectangle.east, opts.rectangle.north)
        : undefined,
    });
    return addProvider(provider, opts, url);
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
   * 内部把度转成弧度 Cartographic——sampleTerrainMostDetailed 只认弧度，
   * 直接传 {lon, lat} 度数对象会拿到错误结果（见 terrain-height-timing 条目）。
   * 未启用 3D 地形（椭球）时高程恒 0——要真实高程先 enableTerrain3D()。
   * @param lon 经度
   * @param lat 纬度
   */
  async function sampleHeight(lon: number, lat: number): Promise<HeightSample> {
    const updated = await sampleMostDetailed([Cesium.Cartographic.fromDegrees(lon, lat)]);
    return { ok: true, height: updated[0]?.height ?? 0 };
  }

  /** 批量采样地形高程（与入参点序一一对应）。点位没飞到过也能采——异步接口不依赖当前视口瓦片。 */
  async function sampleHeights(points: Array<{ lon: number; lat: number }>): Promise<HeightsSample> {
    if (!Array.isArray(points) || points.length === 0) {
      throw new Error(`[${KIT_NAME}] sampleHeights() 需要至少一个点 [{ lon, lat }]。`);
    }
    const updated = await sampleMostDetailed(points.map((p) => Cesium.Cartographic.fromDegrees(p.lon, p.lat)));
    return { ok: true, heights: updated.map((c) => c?.height ?? 0) };
  }

  /**
   * 沿两点连线等分采样地形高程（剖面图/坡度计算的数据源）。
   * 经纬度线性插值——短距离内可用，长距离大圆线会有偏差（可先 turf/测地线加密再走 sampleHeights）。
   * 未启用 3D 地形时高程恒 0（椭球面，见 sampleMostDetailed 说明）。
   */
  async function sampleProfile(
    p1: { lon: number; lat: number },
    p2: { lon: number; lat: number },
    opts: { samples?: number } = {},
  ): Promise<ProfileSample> {
    const samples = Math.max(2, Math.floor(opts.samples ?? 100));
    const line: Array<{ lon: number; lat: number }> = [];
    for (let i = 0; i < samples; i++) {
      const t = i / (samples - 1);
      line.push({
        lon: p1.lon + (p2.lon - p1.lon) * t,
        lat: p1.lat + (p2.lat - p1.lat) * t,
      });
    }
    const heights = await sampleHeights(line);
    return {
      ok: true,
      profile: line.map((p, i) => ({ lon: p.lon, lat: p.lat, height: heights.heights[i] ?? 0 })),
    };
  }

  /**
   * mostDetailed 采样的统一入口。
   * EllipsoidTerrainProvider 没有 availability，不支持 mostDetailed 采样
   * （会炸 computeMaximumLevelAtPosition undefined）——椭球面高程恒 0，直接返回，不发采样请求。
   */
  async function sampleMostDetailed(cartos: unknown[]): Promise<Array<{ height: number }>> {
    const provider = viewer.terrainProvider as unknown as { availability?: unknown };
    if (!provider || !provider.availability) {
      return cartos.map(() => ({ height: 0 }));
    }
    return Cesium.sampleTerrainMostDetailed(viewer.terrainProvider, cartos as never);
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
    addTianditu,
    tiandituImagery,
    addWms,
    add4490,
    enableTerrain3D,
    disableTerrain,
    sampleHeight,
    sampleHeights,
    sampleProfile,
    removeAll,
    dispose: removeAll,
  };
}

export default createImageryKit;
