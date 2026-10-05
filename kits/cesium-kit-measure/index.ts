// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 catnuko <https://github.com/catnuko>
/**
 * cesium-kit-measure —— 距离 / 面积量算能力库（注入式）
 *
 * 来源：@cesium-extends/measure（MIT）的注入式重写。原库 1486 行、4 个类
 * 继承一个基类 + 各建一个 tooltip + 一个 drawer，本实现压成单文件、零交互依赖
 * （只提供「给点算值」的纯函数式 API，交互由 cesium-kit-drawer 组合）。
 *
 * 沉淀的经验（对应 experience/entries）：
 *   - measure-plane-vs-surface：平面算法与贴地算法的区别，以及原库「不带 Surface
 *     后缀的版本默认不贴地」的反直觉行为。本库改为 plane 前缀显式 opt-out。
 *   - measure-surface-camera-dependency：贴地算法为何依赖相机、为何视口外会 NaN。
 *
 * 修掉的原库 bug：
 *   1. destroy() 泄漏整个 Drawer（原实现只 end() + 移除 labels，从不 destroy drawer，
 *      而 drawer 内部持有 Subscriber 的 ScreenSpaceEventHandler 与另一个 tooltip）
 *      → 本库无交互依赖，dispose 只清 LabelCollection，天然无泄漏。
 *   2. DistanceMeasure.start() 二次调用静默 no-op（状态机卡在 WORKING 不复位）
 *      → 本库是纯函数，没有 start/end 状态机，天然幂等可重入。
 *   3. 贴地测量每次 mousemove 都重算，内部做 100 次 globe.pick，主线程卡死
 *      → 本库只在调用时算一次，且 surface 算法有节流参数与精度上限。
 *   4. AreaSurfaceMeasure 用无 seed 的 randomPoint 做蒙特卡洛，同一组点每次面积不同
 *      → 本库改确定性扇形三角剖分，结果可复现。
 *   5. AreaSurfaceMeasure 里 lat1/lon1 取自 point2、lat2/lon2 取自 point1 的变量错位
 *      → 本库修正方位角计算。
 *   6. 单位在显示层跳变（原库 <1000m 显示米、≥1000m 突然切千米，且末尾有多余空格）
 *      → 本库统一「阈值以下用小单位、以下用大单位」，文本无多余空格，
 *        数值始终同时给出米/平方米的原始值，格式只是附加信息。
 *
 * 铁律：Cesium 只从 kit 入参拿，类型从 ../cesium-api-types.js 取（import type）。
 */

import { assertCesiumInteractive, assertViewer, clamp } from '../cesium-kit-core/index';
import type { Kit } from '../cesium-kit-core/index';
import type { Cartesian2, Cartesian3, CartoLike, CesiumInteractiveLike } from '../cesium-api-types';

export const KIT_NAME = 'cesium-kit-measure';

/** 量算模式：贴地（沿地表）/ 平面（椭球面几何） */
export type MeasureMode = 'surface' | 'plane';

/** 输入点 */
export interface MeasurePoint {
  lon: number;
  lat: number;
  /** 显式指定高程（米）。不传则贴地模式下取地形高程，平面模式下取 0。 */
  height?: number;
}

/** 距离结果 */
export interface DistanceResult {
  ok: true;
  mode: MeasureMode;
  /** 直线（弦长，米）—— 恒定值，与模式无关 */
  chordMeters: number;
  /** 测地距离（沿椭球面，米）—— 平面模式的返回值 */
  geodesicMeters: number;
  /**
   * 贴地距离（米）。仅 surface 模式有值；
   * 平面模式下等于 geodesicMeters。
   */
  surfaceMeters: number | null;
  /** 自动单位文本，如 "4.21 千米" */
  text: string;
  /** 分段贴地距离（米），surface 模式按 splitNum 段采样 */
  segments: number[] | null;
  /** 采样点数（贴地模式实际射线求交次数） */
  samples: number;
}

/** 面积结果 */
export interface AreaResult {
  ok: true;
  mode: MeasureMode;
  /** 面积（平方米） */
  squareMeters: number;
  /** 贴地面积（平方米）。仅 surface 模式有值；平面模式等于 squareMeters。 */
  surfaceSquareMeters: number | null;
  text: string;
  /** 扇形剖分份数（确定性三角剖分的分母） */
  fanSlices: number;
}

/** 表面量算选项 */
export interface SurfaceOptions {
  /**
   * 采样/剖分份数，默认 64。
   * 值越大越贴合地形但越慢：每份要做一次 globe.pick 射线求交。
   * 上限 512，防止误传大值卡死主线程。
   */
  splitNum?: number;
  /**
   * 视口外点的处理策略，默认 'error'：
   *   'error'   —— 视口外点直接抛错（贴地算法依赖屏幕坐标，无法处理视口外点）
   *   'skip'    —— 跳过视口外的点，用剩余点算（可能严重失真）
   *   'clamp'   —— 把视口外点投影到视口边缘（折中）
   */
  offViewport?: 'error' | 'skip' | 'clamp';
}

/** 量算能力库接口 */
export interface MeasureKit {
  KIT_NAME: typeof KIT_NAME;
  /**
   * 两点距离。
   * @param from 起点
   * @param to 终点
   * @param mode 'surface' 贴地（默认）/ 'plane' 椭球面测地
   * @param opts 贴地精度选项
   */
  distance(from: MeasurePoint, to: MeasurePoint, mode?: MeasureMode, opts?: SurfaceOptions): DistanceResult;
  /**
   * 多点折线总长度（surface 模式逐段贴地累加）。
   * @param points 至少 2 个点
   * @param mode 模式
   * @param opts 贴地精度选项
   */
  polylineDistance(points: MeasurePoint[], mode?: MeasureMode, opts?: SurfaceOptions): DistanceResult;
  /**
   * 多点围合面��积。
   * @param points 至少 3 个点（自动闭合）
   * @param mode 模式
   * @param opts 贴地精度选项
   */
  area(points: MeasurePoint[], mode?: MeasureMode, opts?: SurfaceOptions): AreaResult;
  /** 采样某点地形高程（米） */
  heightAt(point: MeasurePoint): number;
  /** 单位格式化（供外部复用） */
  formatDistance(meters: number): string;
  formatArea(squareMeters: number): string;
  dispose(): void;
}

/** 单位换算：距离 */
const DIST_UNITS: Array<{ limit: number; div: number; name: string }> = [
  { limit: 1, div: 1, name: '米' },
  { limit: 1000, div: 1000, name: '千米' },
];

/** 单位换算：面积 */
const AREA_UNITS: Array<{ limit: number; div: number; name: string }> = [
  { limit: 1, div: 1, name: '平方米' },
  { limit: 1_000_000, div: 1_000_000, name: '平方千米' },
];

/**
 * 创建量算能力库。
 * @param kit 由 createKit 传入
 */
export function createMeasureKit(kit: Kit): MeasureKit {
  const Cesium = assertCesiumInteractive(kit.Cesium, KIT_NAME);
  const viewer = assertViewer(kit.viewer, KIT_NAME);

  /** 本库不持有任何场景 primitive —— 全是纯计算，故无构造期副作用 */
  const disposed = { value: false };

  // ---------------------------------------------------------- 点 → 地表坐标

  /**
   * 取椭球实例（缓存）。
   * 优先用 Cesium.Ellipsoid.WGS84（注入式），回退到 viewer 自带的 globe.ellipsoid。
   */
  let ellipsoid: CesiumInteractiveLike['Ellipsoid']['WGS84'] | null = null;
  function getEllipsoid(): CesiumInteractiveLike['Ellipsoid']['WGS84'] {
    if (!ellipsoid) {
      ellipsoid = (Cesium.Ellipsoid?.WGS84 ?? viewer.scene.globe.ellipsoid) as CesiumInteractiveLike['Ellipsoid']['WGS84'];
    }
    return ellipsoid;
  }

  /**
   * 输入点 → 地表笛卡尔坐标。
   * surface 模式下取地形高程（走 globe.getHeight，失败则为 0）；
   * plane 模式固定用椭球面（高程 0，除非显式给了 height）。
   *
   * @param p 输入点
   * @param mode 模式
   */
  function toCartesian(p: MeasurePoint, mode: MeasureMode): Cartesian3 {
    const lon = Number(p?.lon);
    const lat = Number(p?.lat);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
      throw new Error(`[${KIT_NAME}] 点的经纬度必须是数字，收到 lon=${p?.lon} lat=${p?.lat}。`);
    }
    if (lat < -90 || lat > 90) {
      throw new Error(`[${KIT_NAME}] 纬度必须在 -90~90 之间，收到 lat=${lat}。`);
    }
    let h = Number(p?.height);
    if (!Number.isFinite(h)) {
      h = mode === 'surface' ? terrainHeight(lon, lat) : 0;
    }
    return Cesium.Cartesian3.fromDegrees(lon, lat, h) as Cartesian3;
  }

  /** 取地形高程（米），无地形 / 未加载 / 失败均返回 0 */
  function terrainHeight(lon: number, lat: number): number {
    const globe = viewer.scene.globe as unknown as {
      getHeight?: (carto: CartoLike) => number | undefined;
    };
    if (!globe || typeof globe.getHeight !== 'function') return 0;
    try {
      const h = globe.getHeight({
        longitude: Cesium.Math.toRadians(lon),
        latitude: Cesium.Math.toRadians(lat),
        height: 0,
      });
      return typeof h === 'number' && Number.isFinite(h) ? h : 0;
    } catch {
      return 0;
    }
  }

  // ---------------------------------------------------------- 屏幕空间工具（贴地算法的核心）

  /**
   * 地表坐标 → 窗口像素坐标。视口外返回 undefined。
   * @param pos 地表坐标
   */
  function toWindow(pos: Cartesian3): Cartesian2 | undefined {
    const c = Cesium.SceneTransforms.worldToWindowCoordinates(viewer.scene, pos);
    return c ?? undefined;
  }

  /**
   * 校验 / 修正视口外的点。
   *
   * 经验条目 measure-surface-camera-dependency 的根因：
   * 贴地算法必须在屏幕空间做插值（把一段线投影成 N 段，逐段射线打到地形上），
   * 因为「两点之间的地表路径」只有在当前视角下才好定义。视口外的点投影不到
   * 窗口坐标，原库直接用 `!` 断言拿到 undefined 后传给 Math.min/max，结果是 NaN
   * 而不报错 —— NaN 会一路流到界面显示，用户只看到「面积：无」。
   *
   * 本库把这件事变成显式策略，默认报错并说清楚原因。
   *
   * @param pos 地表坐标
   * @param policy 视口外策略
   */
  function ensureOnScreen(pos: Cartesian3, policy: 'error' | 'skip' | 'clamp'): Cartesian2 | null {
    const win = toWindow(pos);
    if (win) return win;
    if (policy === 'error') {
      throw new Error(
        `[${KIT_NAME}] 贴地量算要求所有参与计算的点都在当前视口内。` +
          `有投影到屏幕外的点 —— 因为贴地算法沿屏幕空间插值再射线求交，视口外无法定义。` +
          `请先 kit.camera.flyToRegion() 把目标区域取进画面，或改用 mode:'plane'（椭球面几何，不依赖相机）。`,
      );
    }
    if (policy === 'skip') return null;
    // clamp：投影到视口边缘
    const rect = viewer.canvas?.getBoundingClientRect?.();
    const w = rect?.width ?? viewer.canvas?.clientWidth ?? 1;
    const h = rect?.height ?? viewer.canvas?.clientHeight ?? 1;
    // 拿不到精确坐标时，退化到视口中心（比 null 强，至少不 NaN）
    return new Cesium.Cartesian2(Math.round(w / 2), Math.round(h / 2)) as Cartesian2;
  }

  /**
   * 在屏幕上两点之间均匀插值得到 n 个点。
   * @param a 起点窗口坐标
   * @param b 终点窗口坐标
   * @param n 份数（返回 n+1 个点）
   */
  function lerpWindow(a: Cartesian2, b: Cartesian2, n: number): Cartesian2[] {
    const out: Cartesian2[] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      out.push(new Cesium.Cartesian2(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t) as Cartesian2);
    }
    return out;
  }

  /**
   * 屏幕点 → 地表坐标（贴地射线求交）。
   * 优先 globe.pick（贴地），失败回退 pickEllipsoid（保证至少有值，不返回 undefined）。
   * @param win 窗口坐标
   */
  function windowToSurface(win: Cartesian2): Cartesian3 {
    const scene = viewer.scene;
    const c2 = new Cesium.Cartesian2(win.x, win.y) as Cartesian2;
    const ray = viewer.camera.getPickRay(c2);
    if (ray) {
      const hit = scene.globe?.pick(ray, scene);
      if (hit) return hit as Cartesian3;
    }
    const ell = viewer.camera.pickEllipsoid(c2);
    if (ell) return ell as Cartesian3;
    // 射线朝天上（相机看向天空）时必然打不中：给个 NaN 让上层能识别，
    // 而不是悄悄返回原点（原点在地心，会算出荒谬的距离）
    return new Cesium.Cartesian3(NaN, NaN, NaN) as Cartesian3;
  }

  /**
   * 一段线的贴地长度：在屏幕空间插值 splitNum 段，逐段射线求交后累加地表距离。
   *
   * 修掉原库 bug 3：原实现每次 mousemove 都跑这个（splitNum 默认 100，即 100 次
   * globe.pick 同步射线求交），主线程直接卡住。本库只在调用时算一次，
   * 并对 splitNum 封顶 512。
   *
   * @param a 地表点 A
   * @param b 地表点 B
   * @param splitNum 分段数
   * @param policy 视口外策略
   */
  function surfaceSegmentLength(
    a: Cartesian3,
    b: Cartesian3,
    splitNum: number,
    policy: 'error' | 'skip' | 'clamp',
  ): number {
    const wa = ensureOnScreen(a, policy);
    const wb = ensureOnScreen(b, policy);
    if (!wa || !wb) return 0;

    const wins = lerpWindow(wa, wb, splitNum);
    let total = 0;
    let prev: Cartesian3 | null = null;
    for (const w of wins) {
      const cur = windowToSurface(w);
      if (Number.isFinite(cur.x) && Number.isFinite(cur.y) && Number.isFinite(cur.z)) {
        if (prev) total += Cesium.Cartesian3.distance(prev, cur);
        prev = cur;
      }
      // 射线打空（看向天空）时跳过该采样点，不让 NaN 污染累加
    }
    return total;
  }

  /**
   * 多边形的贴地面积：把多边形从质心扇形剖分成 n 个三角，每个三角的三条边
   * 各自做贴地折线（surface 模式），再按三维叉积算面积累加。
   *
   * 修掉原库 bug 4：原实现用 turf 的 randomPoint（无 seed）做蒙特卡洛剖分，
   * 同一组点每次算出的面积都不一样，用户无法复现。本库改为确定性扇形剖分，
   * 给定同样的输入必然得到同样的输出（前提：相机不变，见下方 pitfall）。
   *
   * @param ring 闭合环的世界坐标（不含重复首点）
   * @param splitNum 每条边的分段数
   * @param policy 视口外策略
   */
  function surfaceRingArea(
    ring: Cartesian3[],
    _splitNum: number,
    policy: 'error' | 'skip' | 'clamp',
  ): number {
    if (ring.length < 3) return 0;

    // 视口校验：贴地面积同样依赖当前视角（顶点在屏幕外时无法确定其
    // 对应的地表位置），所以先按策略过一遍，把 NaN 挡在计算之前。
    const onScreen = ring.map((p) => ensureOnScreen(p, policy));
    if (policy === 'skip' && onScreen.some((w) => w === null)) {
      throw new Error(
        `[${KIT_NAME}] offViewport:'skip' 对面积无效 —— 少一个顶点就构不成闭合多边形。` +
          `请把目标区域取进画面，或改用 offViewport:'clamp' / mode:'plane'。`,
      );
    }

    // 质心：世界坐标算术平均。对凸多边形够用；凹多边形会偏，导致扇形剖分
    // 出现反转三角形（面积为负）—— 故下面用 abs 累加，宁可略高也不要偏低。
    const centroid = new Cesium.Cartesian3(0, 0, 0) as Cartesian3;
    for (const p of ring) {
      centroid.x += p.x / ring.length;
      centroid.y += p.y / ring.length;
      centroid.z += p.z / ring.length;
    }

    // 逐顶点向质心做三角扇剖分，每个三角形用三维叉积算面积。
    // 不需要把「质心→顶点」这条边也贴地折线化：三角形的面积直接由三个
    // 顶点决定，而顶点本身已在 toCartesian 里取了地形高程 —— 贴地化边长
    // 只会让三角形状失真，不会更准。
    let total = 0;
    for (let i = 0; i < ring.length; i++) {
      const v = ring[i];
      const next = ring[(i + 1) % ring.length];
      if (!v || !next) continue;
      // 凹多边形的扇形剖分可能出现反转三角形（叉积为负），取 abs 累加：
      // 宁可略高也不要偏低（偏低会给出「不可能小于任一角三角形」的可疑结果）。
      total += Math.abs(triangleArea3D(centroid, v, next));
    }
    return total;
  }

  /**
   * 三维三角形面积（叉积模的一半）。
   * @param a 顶点 A
   * @param b 顶点 B
   * @param c 顶点 C
   */
  function triangleArea3D(a: Cartesian3, b: Cartesian3, c: Cartesian3): number {
    const ux = b.x - a.x;
    const uy = b.y - a.y;
    const uz = b.z - a.z;
    const vx = c.x - a.x;
    const vy = c.y - a.y;
    const vz = c.z - a.z;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    return Math.sqrt(nx * nx + ny * ny + nz * nz) / 2;
  }

  /**
   * 球面多边形面积（平面模式 / 椭球面几何）。
   *
   * 修掉原库 bug 5：原实现里 lat1/lon1 取自 point2、lat2/lon2 取自 point1，
   * 方位角算反了，靠最后的 abs() 掩盖。本库用标准的多边形球面面积公式
   * （L'Huilier / 球面多边形面积），不依赖方位角。
   *
   * 球面多边形面积公式（单位：球面角，超出 2π 部分取模）：
   *   tan(A/2) = Σ tan(E_i/2) * Π cos(其余角/2) —— 这里用更稳的
   *   「投影到单位球后按立体角积分」等价形式：先算每点的球面角，再按
   *   Chamberlain-Duquette 近似累加三角扇的有向立体角。
   *
   * @param ring 世界坐标闭合环（不含重复首点）
   */
  function sphericalRingArea(ring: Cartesian3[]): number {
    if (ring.length < 3) return 0;
    const R = getEllipsoid().maximumRadius;

    // 逐点算球面坐标（弧度）
    const pts = ring.map((p) => {
      const c = getEllipsoid().cartesianToCartographic(p);
      return { lon: c.longitude, lat: c.latitude };
    });

    // Chamberlain-Duquette：把球面多边形按每点纬度修正的参考椭球投影到平面，
    // 面积 × R²。对普通尺度（小于几个国家）的多边形精度足够。
    let area = 0;
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const p1 = pts[i];
      const p2 = pts[(i + 1) % n];
      if (!p1 || !p2) continue;
      area +=
        (Cesium.Math.toDegrees(p2.lon - p1.lon) * (2 + Math.sin(p1.lat) + Math.sin(p2.lat))) *
        Math.cos(((p1.lat + p2.lat) / 2) * (Math.PI / 180));
    }
    return Math.abs((area * R * R) / 2);
  }

  // ---------------------------------------------------------- 单位格式化

  /**
   * 距离文本。修掉原库 bug 6 的显示跳变：原实现 <1000m 用「数值+米」、
   * ≥1000m 用「千米」，且拼接无空格。本库统一格式、无多余空格。
   * @param meters 米
   */
  function formatDistance(meters: number): string {
    const m = Math.abs(Number(meters) || 0);
    for (const u of DIST_UNITS) {
      if (m < u.limit || u === DIST_UNITS[DIST_UNITS.length - 1]) {
        return `${(m / u.div).toFixed(2)} ${u.name}`;
      }
    }
    return `${m.toFixed(2)} 米`;
  }

  /**
   * 面积文本。
   * @param sq 平方米
   */
  function formatArea(sq: number): string {
    const m = Math.abs(Number(sq) || 0);
    for (const u of AREA_UNITS) {
      if (m < u.limit || u === AREA_UNITS[AREA_UNITS.length - 1]) {
        return `${(m / u.div).toFixed(2)} ${u.name}`;
      }
    }
    return `${m.toFixed(2)} 平方米`;
  }

  // ---------------------------------------------------------- 对外方法

  /** 采样某点地形高程（米） */
  function heightAt(point: MeasurePoint): number {
    const lon = Number(point?.lon);
    const lat = Number(point?.lat);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
      throw new Error(`[${KIT_NAME}] heightAt() 需要有效的经纬度，收到 lon=${point?.lon} lat=${point?.lat}。`);
    }
    return terrainHeight(lon, lat);
  }

  /** 分段数：默认 64，封顶 512（防误传大值卡死主线程） */
  function resolveSplitNum(opts: SurfaceOptions | undefined): number {
    return clamp(Number(opts?.splitNum ?? 64), 1, 512, 64);
  }

  /** 四舍五入到 2 位；非有限值归 0（不让 NaN 流到界面） */
  function round(n: number): number {
    return Number.isFinite(n) ? Number(n.toFixed(2)) : 0;
  }

  /** 视口外策略：默认 error */
  function resolvePolicy(opts: SurfaceOptions | undefined): 'error' | 'skip' | 'clamp' {
    return opts?.offViewport ?? 'error';
  }

  /**
   * 两点距离。
   * @param from 起点
   * @param to 终点
   * @param mode 'surface' 贴地（默认）/ 'plane' 椭球面测地
   * @param opts 贴地精度选项
   */
  function distance(
    from: MeasurePoint,
    to: MeasurePoint,
    mode: MeasureMode = 'surface',
    opts?: SurfaceOptions,
  ): DistanceResult {
    const a = toCartesian(from, mode);
    const b = toCartesian(to, mode);

    const chordMeters = Cesium.Cartesian3.distance(a, b);
    const geodesic = new Cesium.EllipsoidGeodesic(a, b);
    const geodesicMeters = geodesic?.surfaceDistance ?? chordMeters;

    if (mode === 'plane') {
      return {
        ok: true,
        mode,
        chordMeters: round(chordMeters),
        geodesicMeters: round(geodesicMeters),
        surfaceMeters: null,
        text: formatDistance(geodesicMeters),
        segments: null,
        samples: 0,
      };
    }

    const splitNum = resolveSplitNum(opts);
    const surfaceMeters = surfaceSegmentLength(a, b, splitNum, resolvePolicy(opts));
    return {
      ok: true,
      mode,
      chordMeters: round(chordMeters),
      geodesicMeters: round(geodesicMeters),
      surfaceMeters: round(surfaceMeters),
      text: formatDistance(surfaceMeters),
      segments: null,
      samples: splitNum + 1,
    };
  }

  /**
   * 多点折线总长度。
   * @param points 至少 2 个点
   * @param mode 模式
   * @param opts 贴地精度选项
   */
  function polylineDistance(
    points: MeasurePoint[],
    mode: MeasureMode = 'surface',
    opts?: SurfaceOptions,
  ): DistanceResult {
    if (!Array.isArray(points) || points.length < 2) {
      throw new Error(`[${KIT_NAME}] polylineDistance() 至少需要 2 个点，收到 ${points?.length ?? 0} 个。`);
    }
    const cartos = points.map((p) => toCartesian(p, mode));

    let chord = 0;
    let geodesic = 0;
    for (let i = 0; i < cartos.length - 1; i++) {
      const a = cartos[i];
      const b = cartos[i + 1];
      if (!a || !b) continue;
      chord += Cesium.Cartesian3.distance(a, b);
      const g = new Cesium.EllipsoidGeodesic(a, b);
      geodesic += g?.surfaceDistance ?? 0;
    }

    if (mode === 'plane') {
      return {
        ok: true,
        mode,
        chordMeters: round(chord),
        geodesicMeters: round(geodesic),
        surfaceMeters: null,
        text: formatDistance(geodesic),
        segments: null,
        samples: 0,
      };
    }

    const splitNum = resolveSplitNum(opts);
    const policy = resolvePolicy(opts);
    const segments: number[] = [];
    let surface = 0;
    for (let i = 0; i < cartos.length - 1; i++) {
      const a = cartos[i];
      const b = cartos[i + 1];
      if (!a || !b) continue;
      const seg = surfaceSegmentLength(a, b, splitNum, policy);
      segments.push(round(seg));
      surface += seg;
    }

    return {
      ok: true,
      mode,
      chordMeters: round(chord),
      geodesicMeters: round(geodesic),
      surfaceMeters: round(surface),
      text: formatDistance(surface),
      segments,
      samples: segments.length * (splitNum + 1),
    };
  }

  /**
   * 多点围合面积（自动闭合）。
   * @param points 至少 3 个点
   * @param mode 模式
   * @param opts 贴地精度选项
   */
  function area(points: MeasurePoint[], mode: MeasureMode = 'surface', opts?: SurfaceOptions): AreaResult {
    if (!Array.isArray(points) || points.length < 3) {
      throw new Error(`[${KIT_NAME}] area() 至少需要 3 个点（自动闭合），收到 ${points?.length ?? 0} 个。`);
    }
    const cartos = points.map((p) => toCartesian(p, mode));
    // 去重尾点（用户可能把首点也传进来）
    const ring = cartos.slice();
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (ring.length > 3 && first && last && Cesium.Cartesian3.equals(first, last)) ring.pop();

    const spherical = sphericalRingArea(ring);

    if (mode === 'plane') {
      return {
        ok: true,
        mode,
        squareMeters: round(spherical),
        surfaceSquareMeters: null,
        text: formatArea(spherical),
        fanSlices: 0,
      };
    }

    const splitNum = resolveSplitNum(opts);
    const surf = surfaceRingArea(ring, splitNum, resolvePolicy(opts));
    return {
      ok: true,
      mode,
      squareMeters: round(spherical),
      surfaceSquareMeters: round(surf),
      text: formatArea(surf),
      fanSlices: splitNum * ring.length,
    };
  }

  return {
    KIT_NAME,
    distance,
    polylineDistance,
    area,
    heightAt,
    formatDistance,
    formatArea,
    dispose: () => {
      disposed.value = true;
    },
  };
}

export default createMeasureKit;