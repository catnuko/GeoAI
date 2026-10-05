// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 catnuko <https://github.com/catnuko>
/**
 * 类型接缝 —— 库层唯一的 Cesium 类型来源。
 *
 * 关键设计：全部用 `import type`（非 `import`），编译后被完全擦除，
 * 因此 cesium 只出现在 devDependencies（类型来源），不进运行时依赖、不进浏览器产物。
 * 页面侧仍用 CDN 的 window.Cesium —— 这正是注入式契约的类型层表达。
 *
 * 未来拆成独立 npm 包时，consumer 也从自己的 cesium 装类型，版本对齐即可；
 * 若消费方用 `window.Cesium` 全局（无 npm 包），可用 `src/env.d.ts` 里的
 * 全局类型声明兜住（见 GeoAIKit 全局注册）。
 *
 * 不要在这里 `import { ... } from 'cesium'` 取值 —— 那会产生运行时依赖，
 * 破坏「同一份库同时服务 CDN 全局与 npm cesium」的前提。
 */

import type {
  Viewer,
  Scene,
  Camera,
  Cartesian2,
  Cartesian3,
  HeadingPitchRange,
  ImageryLayer,
  TerrainProvider,
  ArcGisMapServerImageryProvider,
  UrlTemplateImageryProvider,
  ArcGISTiledElevationTerrainProvider,
  WebMapTileServiceImageryProvider,
  WebMapServiceImageryProvider,
  TilingScheme,
  Cartographic,
  Color,
  Entity,
  GeoJsonDataSource,
  LabelCollection,
  NearFarScalar,
  BoundingSphere,
  Occluder,
  EllipsoidGeodesic,
  Matrix4,
  Cesium3DTileset,
  CustomShader,
  BillboardCollection,
  PointPrimitiveCollection,
  SampledPositionProperty,
  VelocityOrientationProperty,
  JulianDate,
  TimeInterval,
  TimeIntervalCollection,
  Property,
  PostProcessStage,
  ClippingPlane,
  ClippingPlaneCollection,
  CallbackProperty,
} from 'cesium';

/**
 * 注入式库内部使用的「经纬高」结构。
 *
 * 刻意不用 Cesium 的 Cartographic 类型：它带 clone / equals / equalsEpsilon
 * 一堆实例方法，而库只需要 longitude / latitude / height 三个数值。
 * 这里定义一个纯数据结构，既让 globe.getHeight 的调用类型成立，
 * 又不把 Cesium 的类层次泄漏进库层。
 */
export interface CartoLike {
  longitude: number;
  latitude: number;
  height: number;
}

export type {
  Viewer,
  Scene,
  Camera,
  Cartesian2,
  Cartesian3,
  HeadingPitchRange,
  ImageryLayer,
  TerrainProvider,
  ArcGisMapServerImageryProvider,
  UrlTemplateImageryProvider,
  ArcGISTiledElevationTerrainProvider,
  WebMapTileServiceImageryProvider,
  WebMapServiceImageryProvider,
  TilingScheme,
  Cartographic,
  Color,
  Entity,
  GeoJsonDataSource,
  LabelCollection,
  NearFarScalar,
  BoundingSphere,
  Occluder,
  EllipsoidGeodesic,
  Matrix4,
  Cesium3DTileset,
  CustomShader,
  BillboardCollection,
  PointPrimitiveCollection,
  SampledPositionProperty,
  VelocityOrientationProperty,
  JulianDate,
  TimeInterval,
  TimeIntervalCollection,
  Property,
  PostProcessStage,
  ClippingPlane,
  ClippingPlaneCollection,
  CallbackProperty,
};

/**
 * Cesium 命名空间（值）的类型。
 *
 * 注意这里刻意**不**写成 `typeof import('cesium')` 的全量引用：
 * 库只用到其中很小一部分，用窄接口既能让类型检查真实生效，
 * 也能让「库实际依赖了哪些 Cesium 能力」在类型层面一目了然。
 */
export interface CesiumLike {
  readonly VERSION?: string;
  readonly Cartesian3: {
    fromDegrees(lon: number, lat: number, height?: number): Cartesian3;
  };
  readonly Matrix4: {
    readonly IDENTITY: unknown;
  };
  readonly HeadingPitchRange: {
    new (heading: number, pitch: number, range: number): HeadingPitchRange;
  };
  readonly Rectangle: {
    fromDegrees(west: number, south: number, east: number, north: number): unknown;
    center(rectangle: unknown, result: Cartesian3): Cartesian3;
  };
  readonly Math: {
    toRadians(degrees: number): number;
    toDegrees(radians: number): number;
  };
  readonly EllipsoidTerrainProvider: new () => TerrainProvider;
  readonly UrlTemplateImageryProvider: new (opts: {
    url: string;
    subdomains?: string[];
    minimumLevel?: number;
    maximumLevel?: number;
    tilingScheme?: TilingScheme;
    rectangle?: unknown;
    /** 自定义占位符（4490 层号偏移等）。签名 (provider, x, y, level) => string */
    customTags?: Record<string, (provider: unknown, x: number, y: number, level: number) => string>;
  }) => UrlTemplateImageryProvider;
  readonly ArcGisMapServerImageryProvider: {
    fromUrl(url: string): Promise<ArcGisMapServerImageryProvider>;
  };
  readonly ArcGISTiledElevationTerrainProvider: {
    fromUrl(url: string): Promise<ArcGISTiledElevationTerrainProvider>;
  };
  /** WMTS 服务（天地图 / 各级 4490 切片的标准通道）。构造期即校验参数，缺 layer/format 直接抛错 */
  readonly WebMapTileServiceImageryProvider: new (opts: {
    url: string;
    layer: string;
    style?: string;
    format: string;
    tileMatrixSetID: string;
    /** 层号表。天地图 _c 从 1 起（(z+1)），_w 从 0 起（z）——错一个全盘 404/错位 */
    tileMatrixLabels?: string[];
    subdomains?: string[];
    tilingScheme?: TilingScheme;
    minimumLevel?: number;
    maximumLevel?: number;
  }) => WebMapTileServiceImageryProvider;
  /** WMS 服务。parameters 缺 transparent+png 会整幅不透明盖住底图（见 domestic-imagery-traps 条目） */
  readonly WebMapServiceImageryProvider: new (opts: {
    url: string;
    layers: string;
    parameters?: Record<string, string>;
  }) => WebMapServiceImageryProvider;
  readonly GeographicTilingScheme: new (opts?: {
    numberOfLevelZeroTilesX?: number;
    numberOfLevelZeroTilesY?: number;
  }) => TilingScheme;
  readonly WebMercatorTilingScheme: new (opts?: Record<string, unknown>) => TilingScheme;
  /** 度 → 弧度 Cartographic。sampleTerrain* 系列只认弧度（传度数结果错得离谱） */
  readonly Cartographic: {
    fromDegrees(lon: number, lat: number, height?: number): Cartographic;
  };
  sampleTerrainMostDetailed(
    terrainProvider: TerrainProvider,
    points: Cartographic[],
  ): Promise<Cartographic[]>;
  /** geojson 库需要：Color 常量取默认样式（withAlpha 等实例方法走完整 Color 类型） */
  readonly Color: {
    readonly CYAN: Color;
    readonly YELLOW: Color;
  };
  /** geojson 库需要：静态 load 入口，把 GeoJSON/TopoJSON 转成 DataSource */
  readonly GeoJsonDataSource: {
    load(
      data: unknown,
      opts?: {
        clampToGround?: boolean;
        fill?: Color;
        stroke?: Color;
        strokeWidth?: number;
      },
    ): Promise<GeoJsonDataSource>;
  };
}

/**
 * 交互类能力库（drawer / measure / overlay）额外需要的 Cesium API 面。
 *
 * 与 CesiumLike 分开声明的原因：这三个库要做鼠标交互，必须拿到
 * ScreenSpaceEventHandler / Entity / CallbackProperty 这些**值**（class、枚举），
 * 而 CesiumLike 只覆盖 camera / imagery 用到的那一小撮。
 * 分开后 camera / imagery 两个库不必为不需要的 API 背类型断言。
 *
 * 全部成员都是必填的运行时实体，因此注入时必须来自同一个 Cesium 实例
 * —— 双 Cesium（CDN 一份 + npm 一份）会导致 instanceof 与枚举比较全部失效。
 */
export interface CesiumInteractiveLike extends CesiumLike {
  readonly Cartesian2: {
    new (x?: number, y?: number): Cartesian2;
    magnitude(cartesian: Cartesian2): number;
    subtract(left: Cartesian2, right: Cartesian2, result: Cartesian2): Cartesian2;
    clone(cartesian: Cartesian2, result: Cartesian2): Cartesian2;
  };
  readonly Cartesian3: CesiumLike['Cartesian3'] & {
    new (x?: number, y?: number, z?: number): Cartesian3;
    distance(left: Cartesian3, right: Cartesian3): number;
    equals(left: Cartesian3, right: Cartesian3): boolean;
  };
  readonly Color: CesiumLike['Color'] & {
    new (red?: number, green?: number, blue?: number, alpha?: number): Color;
    fromCssColorString(css: string): Color | undefined;
    fromRandomRgb(options?: unknown): Color;
    readonly WHITE: Color;
    readonly BLACK: Color;
    readonly YELLOW: Color;
    readonly BLUE: Color;
    readonly RED: Color;
    readonly GREEN: Color;
    readonly ORANGE: Color;
    readonly DARKTURQUOISE: Color;
    readonly TRANSPARENT: Color;
    fromRadians(alpha?: number): Color;
  };
  /** Entity 是 class：注入式下用它做 instanceof 判断（必须与 viewer 同源） */
  readonly Entity: new (options?: Record<string, unknown>) => Entity;
  readonly CallbackProperty: {
    new (callback: (time: unknown) => unknown, isConstant?: boolean): unknown;
  };
  readonly JulianDate: {
    now(): unknown;
  };
  readonly PolygonHierarchy: new (positions?: unknown[], holes?: unknown[]) => unknown;
  readonly Rectangle: CesiumLike['Rectangle'] & {
    fromCartesianArray(cartesians: Cartesian3[], result?: unknown): unknown;
  };
  readonly HeightReference: {
    readonly NONE: number;
    readonly CLAMP_TO_GROUND: number;
    readonly RELATIVE_TO_GROUND: number;
  };
  readonly LabelStyle: {
    readonly FILL: number;
    readonly OUTLINE: number;
    readonly FILL_AND_OUTLINE: number;
  };
  readonly LabelCollection: new (options?: { scene?: unknown }) => LabelCollection;
  readonly ArcType: {
    readonly GEODESIC: number;
    readonly RHUMB: number;
  };
  readonly ClassificationType: {
    readonly TERRAIN: number;
    readonly CESIUM_3D_TILE: number;
    readonly BOTH: number;
  };
  readonly ScreenSpaceEventType: Record<string, number>;
  readonly ScreenSpaceEventHandler: new (element: unknown) => ScreenSpaceEventHandlerLike;
  readonly SceneMode: {
    readonly SCENE2D: number;
    readonly MORPHING: number;
    readonly SCENE3D: number;
    readonly COLUMBUS_VIEW: number;
  };
  readonly SceneTransforms: {
    worldToWindowCoordinates(scene: unknown, position: Cartesian3): Cartesian2 | undefined;
    wgs84ToWindowCoordinates(scene: unknown, position: Cartesian3): Cartesian2 | undefined;
  };
  readonly BoundingSphere: new (center?: Cartesian3, radius?: number) => BoundingSphere;
  readonly Occluder: new (occluderBoundingSphere: BoundingSphere, cameraPosition: Cartesian3) => Occluder;
  readonly EllipsoidGeodesic: new (start: Cartesian3, end: Cartesian3, ellipsoid?: unknown) => EllipsoidGeodesic & {
    readonly surfaceDistance: number;
  };
  readonly Ellipsoid: {
    readonly WGS84: {
      maximumRadius: number;
      cartesianToCartographic(cartesian: Cartesian3): CartoLike;
      cartographicToCartographic(cartographic: CartoLike): Cartesian3;
    };
  };
}

/**
 * ScreenSpaceEventHandler 的窄接口。
 * 只需 setInputAction / removeInputAction / destroy —— 这三个是创建、解绑、销毁的最小集。
 */
export interface ScreenSpaceEventHandlerLike {
  setInputAction(action: (arg: unknown) => void, type: number): void;
  removeInputAction(type: number): void;
  destroy(): void;
}

/** 影像图层构造参数的公共形状（天地图/自定义 UrlTemplate 都走它） */
export interface ImageryOptions {
  alpha?: number;
  brightness?: number;
}

/** 地形采样结果 */
export interface HeightSample {
  ok: true;
  height: number;
}

/** 影像图层添加结果 */
export interface ImageryAddResult {
  ok: true;
  layerIndex: number;
  url: string;
}

/* ------------------------------------------------------------------ *
 * 域扩展接口（沿用 CesiumInteractiveLike 的先例）：
 * 每类能力库只为自己需要的 Cesium 值面建窄接口，
 * 让「库实际依赖了哪些 Cesium 能力」在类型层面一目了然。
 * 注入方永远是同一个真实 window.Cesium，运行时全量满足。
 * ------------------------------------------------------------------ */

/** tiles 库（3D Tiles 加载/抬升/染色）需要的 Cesium 值面 */
export interface CesiumTilesLike extends CesiumLike {
  readonly Cartesian3: CesiumLike['Cartesian3'] & {
    new (x?: number, y?: number, z?: number): Cartesian3;
    fromRadians(lon: number, lat: number, height?: number, ellipsoid?: unknown, result?: Cartesian3): Cartesian3;
    subtract(left: Cartesian3, right: Cartesian3, result: Cartesian3): Cartesian3;
  };
  readonly Cartographic: CesiumLike['Cartographic'] & {
    fromCartesian(cartesian: Cartesian3, ellipsoid?: unknown, result?: Cartographic): Cartographic;
  };
  readonly Matrix4: CesiumLike['Matrix4'] & {
    new (): Matrix4;
    fromTranslation(translation: Cartesian3, result?: Matrix4): Matrix4;
    multiply(left: Matrix4, right: Matrix4, result: Matrix4): Matrix4;
  };
  readonly Cesium3DTileset: {
    fromUrl(url: string, opts?: Record<string, unknown>): Promise<Cesium3DTileset>;
  };
  readonly CustomShader: new (opts?: {
    uniforms?: Record<string, unknown>;
    lightingModel?: unknown;
    fragmentShaderText?: string;
    vertexShaderText?: string;
  }) => CustomShader;
  readonly LightingModel: { readonly UNLIT: unknown; readonly PBR: unknown };
}

/** points 库（海量点位 Collection）需要的 Cesium 值面 */
export interface CesiumPointsLike extends CesiumLike {
  readonly BillboardCollection: new (opts?: { scene?: unknown }) => BillboardCollection;
  readonly PointPrimitiveCollection: new (opts?: { scene?: unknown }) => PointPrimitiveCollection;
  readonly LabelCollection: new (opts?: { scene?: unknown }) => LabelCollection;
  readonly NearFarScalar: new (near: number, nearValue: number, far: number, farValue: number) => NearFarScalar;
  readonly HeightReference: {
    readonly NONE: number;
    readonly CLAMP_TO_GROUND: number;
    readonly RELATIVE_TO_GROUND: number;
  };
  readonly Color: CesiumLike['Color'] & {
    fromCssColorString(css: string): Color | undefined;
    readonly RED: Color;
    readonly WHITE: Color;
  };
}

/** track 库（时间轴轨迹动画）需要的 Cesium 值面 */
export interface CesiumTimeLike extends CesiumLike {
  readonly JulianDate: {
    new (): JulianDate;
    fromDate(date: Date): JulianDate;
    addHours(date: JulianDate, hours: number, result: JulianDate): JulianDate;
    addSeconds(date: JulianDate, seconds: number, result: JulianDate): JulianDate;
    secondsDifference(left: JulianDate, right: JulianDate): number;
  };
  readonly ClockRange: {
    readonly LOOP_STOP: number;
    readonly CLAMPED: number;
    readonly UNBOUNDED: number;
  };
  readonly TimeInterval: new (opts: { start: JulianDate; stop: JulianDate }) => TimeInterval;
  readonly TimeIntervalCollection: new (intervals?: TimeInterval[]) => TimeIntervalCollection;
  readonly SampledPositionProperty: new (interpolationDegree?: number) => SampledPositionProperty;
  readonly VelocityOrientationProperty: new (position: Property) => VelocityOrientationProperty;
  readonly Color: CesiumLike['Color'] & {
    readonly CYAN: Color;
  };
}

/** effects 库（雨雪雾等全屏后处理）需要的值面。PPS shader 必须按 WebGL2 书写（texture/out_FragColor） */
export interface CesiumEffectsLike extends CesiumLike {
  readonly PostProcessStage: new (opts: {
    fragmentShader: string;
    uniforms?: Record<string, unknown>;
  }) => PostProcessStage;
  readonly Color: CesiumLike['Color'] & {
    fromCssColorString(css: string): Color | undefined;
    readonly WHITE: Color;
  };
}

/** analysis 库（地形开挖/淹没）需要的值面 */
export interface CesiumAnalysisLike extends CesiumLike {
  readonly Cartesian3: CesiumLike['Cartesian3'] & {
    new (x?: number, y?: number, z?: number): Cartesian3;
    fromRadians(lon: number, lat: number, height?: number, ellipsoid?: unknown, result?: Cartesian3): Cartesian3;
    subtract(left: Cartesian3, right: Cartesian3, result: Cartesian3): Cartesian3;
    add(left: Cartesian3, right: Cartesian3, result: Cartesian3): Cartesian3;
    multiplyByScalar(left: Cartesian3, scalar: number, result: Cartesian3): Cartesian3;
    cross(left: Cartesian3, right: Cartesian3, result: Cartesian3): Cartesian3;
    normalize(left: Cartesian3, result: Cartesian3): Cartesian3;
    dot(left: Cartesian3, right: Cartesian3): number;
  };
  readonly Cartographic: CesiumLike['Cartographic'] & {
    fromCartesian(cartesian: Cartesian3, ellipsoid?: unknown, result?: Cartographic): Cartographic;
  };
  readonly Ellipsoid: {
    readonly WGS84: {
      geodeticSurfaceNormal(cartesian: Cartesian3, result?: Cartesian3): Cartesian3;
    };
  };
  readonly ClippingPlane: new (normal: Cartesian3, distance: number) => ClippingPlane;
  readonly ClippingPlaneCollection: new (opts?: {
    planes?: ClippingPlane[];
    enabled?: boolean;
    edgeColor?: Color;
    edgeWidth?: number;
  }) => ClippingPlaneCollection;
  readonly CallbackProperty: new (callback: (time: unknown) => unknown, isConstant?: boolean) => CallbackProperty;
  readonly Color: CesiumLike['Color'] & {
    new (red?: number, green?: number, blue?: number, alpha?: number): Color;
    fromCssColorString(css: string): Color | undefined;
    readonly RED: Color;
  };
}
