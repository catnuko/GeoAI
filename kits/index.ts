// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 catnuko <https://github.com/catnuko>
/**
 * kits/index.ts —— 库层装配入口（页面侧唯一挂载点）
 *
 * 职责：
 *   1. 用 createKit 把 Cesium 实例注入到各能力库（注入式的"注入口"在这里）
 *   2. 汇总出一个 kit 对象，供 MCP 下发的代码通过 `kit.*` 访问
 *   3. 读取 registry.json，供页面日志与未来工具使用
 *
 * 边界：本文件是「库层」与「页面」之间唯一的接缝。
 * 未来若拆成独立 npm 包，本文件即包的 index.js，公开签名保持不变。
 *
 * 能力库一览（全部注入式，Cesium 从入参拿）：
 *   core    契约层：生命周期与断言
 *   camera  相机：飞行取景 / lookAt 跟随 / 等动画结束
 *   imagery 影像与地形：免 key 底图 / 3D 地形 / 高程采样
 *   geojson 行政边界：DataV 中国区划 fetch / load / 摘取下级
 *   drawer  绘图：点线面圆矩形 + 贴地拾取三分支
 *   measure 量算：距离与面积，平面 / 贴地双模式
 *   overlay 跟随层：经纬度锚定弹窗 / 鼠标悬浮提示
 */

import { createKit } from './cesium-kit-core/index';
import type { Kit } from './cesium-kit-core/index';
import { createCameraKit } from './cesium-kit-camera/index';
import type { CameraKit } from './cesium-kit-camera/index';
import { createImageryKit } from './cesium-kit-imagery/index';
import type { ImageryKit } from './cesium-kit-imagery/index';
import { createGeoJsonKit } from './cesium-kit-geojson/index';
import type { GeoJsonKit } from './cesium-kit-geojson/index';
import { createDrawerKit } from './cesium-kit-drawer/index';
import type { DrawerKit } from './cesium-kit-drawer/index';
import { createMeasureKit } from './cesium-kit-measure/index';
import type { MeasureKit } from './cesium-kit-measure/index';
import { createOverlayKit } from './cesium-kit-overlay/index';
import type { OverlayKit } from './cesium-kit-overlay/index';
import registryJson from './registry.json' with { type: 'json' };
import type { Registry } from './registry-schema';

export { createKit };
export { createCameraKit } from './cesium-kit-camera/index';
export { createImageryKit } from './cesium-kit-imagery/index';
export { createGeoJsonKit, adminUrl } from './cesium-kit-geojson/index';
export { createDrawerKit } from './cesium-kit-drawer/index';
export { createMeasureKit } from './cesium-kit-measure/index';
export { createOverlayKit } from './cesium-kit-overlay/index';
export { DomUtil, Widget } from './cesium-kit-dom/index';
export type { Kit, Disposable, CesiumLike, CreateKitOptions } from './cesium-kit-core/index';
export type { CameraKit, BoundingBox, FlyOptions, FlyResult, CameraSnapshot } from './cesium-kit-camera/index';
export type { ImageryKit, TiandituLayer } from './cesium-kit-imagery/index';
export type {
  GeoJsonKit,
  AdminProperties,
  AdminFeature,
  AdminFeatureCollection,
  AdminFeatureSummary,
  FetchAdminResult,
  LoadAdminResult,
  LoadAdminOptions,
} from './cesium-kit-geojson/index';
export type {
  DrawerKit,
  DrawOptions,
  DrawResult,
  DrawShapeType,
  DrawStatus,
  DrawStatusInfo,
  DrawStyle,
  LonLat,
  PickMode,
} from './cesium-kit-drawer/index';
export type {
  MeasureKit,
  MeasureMode,
  MeasurePoint,
  DistanceResult,
  AreaResult,
  SurfaceOptions,
} from './cesium-kit-measure/index';
export type {
  OverlayKit,
  OverlayHandle,
  PopupOptions,
  TooltipOptions,
  ScreenPoint,
  Anchor,
} from './cesium-kit-overlay/index';
export type { Registry, KitEntry, ExternalEntry } from './registry-schema';

/** 装配后的 kit：core 契约 + 各能力库 */
export interface GeoAIKit extends Kit {
  readonly camera: CameraKit;
  readonly imagery: ImageryKit;
  readonly geojson: GeoJsonKit;
  readonly drawer: DrawerKit;
  readonly measure: MeasureKit;
  readonly overlay: OverlayKit;
}

/**
 * 装配所有子库。Cesium 由调用方传入（CDN 全局或 npm 均可）。
 * @param args Cesium 命名空间与 viewer
 * @returns 带 camera / imagery / geojson / drawer / measure / overlay 的 kit 对象
 */
export function mountKits({ Cesium, viewer }: { Cesium: unknown; viewer: unknown }): GeoAIKit {
  const kit = createKit({ Cesium, viewer, name: 'geoai' });
  return Object.assign(kit, {
    camera: kit.use(createCameraKit),
    imagery: kit.use(createImageryKit),
    geojson: kit.use(createGeoJsonKit),
    drawer: kit.use(createDrawerKit),
    measure: kit.use(createMeasureKit),
    overlay: kit.use(createOverlayKit),
  });
}

/** @returns 能力清单（registry.json） */
export function getRegistry(): Registry {
  return registryJson as Registry;
}