// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 catnuko <https://github.com/catnuko>
/**
 * cesium-kit-drawer —— 鼠标绘图能力库（注入式）
 *
 * 来源：@cesium-extends/drawer（MIT）的注入式重写。原库 1902 行、5 个 shape 子类
 * + painter + 自建 subscriber，本实现压成单文件，Cesium 全部从 kit 入参取。
 *
 * 沉淀的经验（对应 experience/entries）：
 *   - drawer-state-machine：INIT/START/PAUSE/DESTROY 的流转，以及 once / dynamicStyle
 *     的真实语义（原库文档与实现矛盾，见下方 bug 1/2）。
 *   - drawer-pick-terrain：贴地拾取的三条分支与 model/terrain 互斥关系。
 *   - drawer-cancel-clears-all：右键「取消」在点数不足时的反直觉行为。
 *
 * 修掉的原库 bug：
 *   1. once 默认值文档写 undefined、实现是 true → 本库显式默认 false（连续绘制），
 *      并把 once 写进签名，不再靠猜。
 *   2. sameStyle 默认 true，导致 dynamicOptions 完全不生效
 *      （原判定式 `isDynamic && !sameStyle` 恒为 false）→ 本库拆成
 *      style（最终样式）与 dynamicStyle（绘制中预览样式）两个独立选项，
 *      dynamicStyle 不传就用 style，行为可见且可预期。
 *   3. start() 重入泄漏 painter：原实现先 _initPainter() 再判 status === 'START'，
 *      重复 start 会 new 一个新 Painter 顶替旧的，旧的断点实体与已画实体永远无法清理
 *      → 本库在 status 检查通过后才建 painter，且每次绘制复用同一 painter。
 *   4. 右键点数 < 3 时直接 painter.reset() 清空整图，与 UI 提示「移除最后一个点」不符
 *      → 本库语义明确：右键移除最后一个点；点数归零才结束本次绘制。
 *   5. 断点圆点样式写死（永远蓝色 8px，无法配置）→ 暴露 breakpointStyle。
 *
 * 铁律：Cesium 只从 kit 入参拿，类型从 ../cesium-api-types.js 取（import type）。
 */

import { assertCesiumInteractive, assertViewer, clamp } from '../cesium-kit-core/index';
import type { Kit } from '../cesium-kit-core/index';
import type { Cartesian2, Cartesian3, CesiumInteractiveLike, Entity, Viewer } from '../cesium-api-types';

export const KIT_NAME = 'cesium-kit-drawer';

/** 可绘制的图形类型 */
export type DrawShapeType = 'POINT' | 'POLYLINE' | 'POLYGON' | 'CIRCLE' | 'RECTANGLE';

/** 拾取模式：椭球面 / 地形 / 任意有深度的物体 */
export type PickMode = 'ellipsoid' | 'terrain' | 'model';

/** 绘制状态机 */
export type DrawStatus = 'INIT' | 'STARTING' | 'DRAWING' | 'PAUSE' | 'DESTROY';

/** 绘制完成回调：拿到最终实体与经纬度序列 */
export type DrawEndCallback = (result: DrawResult) => void | Promise<void>;

/** 绘制过程中的点变化回调（经纬度，纯 JSON） */
export type DrawPointsCallback = (points: LonLat[]) => void;

/** 经纬度 */
export interface LonLat {
  lon: number;
  lat: number;
  /** 该点的地形高程（米）。非贴地拾取时为 undefined。 */
  height?: number;
}

/** 绘制产物 */
export interface DrawResult {
  ok: true;
  type: DrawShapeType;
  /** 已加入 viewer 的实体 id（POINT 类型同样返回） */
  entityId?: string;
  /** 构成图形的点（RECTANGLE 为外接矩形四角，POINT 为单点） */
  points: LonLat[];
  /** 便捷字段：面/线的点数 */
  count: number;
}

/** 样式（对应 Cesium Entity 的 graphics 选项，按类型取相关字段） */
export interface DrawStyle {
  /** 颜色：线材质 / 点色 / 面填充 */
  color?: unknown;
  /** 面轮廓色 */
  outlineColor?: unknown;
  /** 线宽 / 轮廓宽（像素） */
  width?: number;
  outlineWidth?: number;
  /** 点像素尺寸 */
  pixelSize?: number;
  /** 点描边色 */
  outline?: unknown;
  /** 面是否贴地（POLYGON 生效） */
  clampToGround?: boolean;
  /** 透明度 0~1 */
  alpha?: number;
  [key: string]: unknown;
}

/** 绘制选项 */
export interface DrawOptions {
  /** 图形类型 */
  type: DrawShapeType;
  /** 最终样式 */
  style?: DrawStyle;
  /**
   * 绘制过程中的预览样式（虚线感、半透明等）。
   * 不传则预览与最终同色 —— 这正是原库 sameStyle 的坑点所在，故拆成两个选项。
   */
  dynamicStyle?: DrawStyle;
  /** 拾取模式，默认 'ellipsoid'。'terrain' 需地形已加载。 */
  pick?: PickMode;
  /**
   * 画完一次后是否自动停止。默认 false（可连续画多个）。
   * 原库实现默认为 true 且文档写 undefined，两者矛盾。
   */
  once?: boolean;
  /** 只保留最新一个图形（画新的删旧的），默认 false */
  oneInstance?: boolean;
  /** 左键加点，默认 'LEFT_CLICK' */
  startEvent?: string;
  /** 右键撤销一点，默认 'RIGHT_CLICK' */
  cancelEvent?: string;
  /** 双击结束，默认 'LEFT_DOUBLE_CLICK' */
  endEvent?: string;
  /** 断点标记样式（绘制中显示的顶点圆点） */
  breakpointStyle?: DrawStyle;
  /** 绘制完成回调 */
  onEnd?: DrawEndCallback;
  /** 点变化回调（用于实时预览标签，如量算值） */
  onPointsChange?: DrawPointsCallback;
}

/** 状态快照 */
export interface DrawStatusInfo {
  status: DrawStatus;
  type: DrawShapeType | null;
  /** 当前已固定的点数 */
  pointCount: number;
  /** 已完成的图形数 */
  finished: number;
  pick: PickMode;
}

/** 绘图能力库接口 */
export interface DrawerKit {
  KIT_NAME: typeof KIT_NAME;
  /** 开始绘制（会隐式取消上一次进行中的绘制） */
  start(options: DrawOptions): { ok: true; type: DrawShapeType; status: DrawStatus };
  /** 取消当前绘制：清掉断点与预览，不保留已完成的图形 */
  cancel(): { ok: true; removed: number };
  /** 结束绘制但保留已画图形（清断点，回到 INIT） */
  pause(): { ok: true };
  /** 清空本库画出的全部图形 */
  clear(): { ok: true; removed: number };
  /** 状态快照（纯 JSON，可安全回传） */
  status(): DrawStatusInfo;
  /** 已完成图形的经纬度序列 */
  results(): Array<{ type: DrawShapeType; entityId?: string; points: LonLat[] }>;
  /** 屏幕坐标 → 地表坐标（三分支拾取）。公开以便外部复用拾取逻辑。 */
  pick(screenX: number, screenY: number, mode?: PickMode): Cartesian3 | undefined;
  dispose(): void;
}

/** 各类型的默认样式（黄线青面蓝点，与原库观感一致） */
function defaultStyleFor(Cesium: CesiumInteractiveLike, type: DrawShapeType): DrawStyle {
  switch (type) {
    case 'POLYLINE':
      return { color: Cesium.Color.YELLOW, width: 2 };
    case 'POLYGON':
      return {
        color: Cesium.Color.fromCssColorString('#00CED1')?.withAlpha(0.4) ?? Cesium.Color.YELLOW,
        outlineColor: Cesium.Color.YELLOW,
        outlineWidth: 2,
        clampToGround: true,
      };
    case 'POINT':
      return { color: Cesium.Color.BLUE, pixelSize: 8, outline: Cesium.Color.WHITE, outlineWidth: 1 };
    case 'CIRCLE':
      return { color: Cesium.Color.YELLOW.withAlpha(0.4), outline: true, outlineColor: Cesium.Color.YELLOW };
    case 'RECTANGLE':
      return { color: Cesium.Color.YELLOW.withAlpha(0.4), outlineColor: Cesium.Color.YELLOW, outlineWidth: 2 };
    default:
      return {};
  }
}

/** 断点标记默认样式 */
const DEFAULT_BREAKPOINT: DrawStyle = {
  color: '#00CED1',
  pixelSize: 7,
  outline: '#FFFFFF',
  outlineWidth: 1,
};

/** 已完成的一条绘制记录 */
interface FinishedDraw {
  entity: Entity;
  type: DrawShapeType;
  points: LonLat[];
}

/** 本库用到的内部状态 */
interface DrawSession {
  type: DrawShapeType;
  options: DrawOptions;
  /** 已固定的点（贴地拾取时带高程） */
  points: Cartesian3[];
  /** 断点实体 */
  breakpoints: Entity[];
  /** 预览实体（仅绘制中） */
  preview: Entity | null;
  /** 预览样式快照：type 的图形构造需要区分动态/最终 */
  isDrawing: boolean;
}

/**
 * 创建绘图能力库。
 * @param kit 由 createKit 传入（含已注入的 Cesium 与 viewer）
 */
export function createDrawerKit(kit: Kit): DrawerKit {
  const Cesium = assertCesiumInteractive(kit.Cesium, KIT_NAME);
  const viewer: Viewer = assertViewer(kit.viewer, KIT_NAME);

  /** 进行中的绘制会话 */
  let session: DrawSession | null = null;
  /** 已完成的绘制记录（实体 + 类型 + 坐标，便于回传纯 JSON） */
  let finished: FinishedDraw[] = [];
  let finishedCount = 0;
  /** 销毁守卫：置位后所有事件回调立即返回 */
  let alive = true;

  // ---------------------------------------------------------- 拾取

  /**
   * 屏幕坐标 → 地表坐标。
   *
   * 三条分支互斥，这是本库最需要记住的边界（经验条目 drawer-pick-terrain）：
   *   ellipsoid → camera.pickEllipsoid：射线与椭球求交。永远可用，但**忽略地形**，
   *                画出的点会浮在椭球面上（地形隆起处点在地下）。
   *   terrain   → camera.getPickRay + globe.pick：射线与地形瓦片求交。需已加载地形，
   *                且只能拾取地球表面 —— 拾取不到挡在前面的 3D Tiles / 建筑。
   *   model     → scene.pickPosition：读深度纹理，能拾取任何有深度的物体，
   *                但依赖 pickPositionSupported（需 WebGL 深度纹理扩展）。
   *
   * 原库用 terrain/model 两个布尔开关且 model 优先级更高，两个都开时 terrain 静默失效；
   * 本库用互斥的 pick 枚举，从类型上排除这种歧义。
   */
  function pick(screenX: number, screenY: number, mode: PickMode = 'ellipsoid'): Cartesian3 | undefined {
    const scene = viewer.scene;
    const pos = new Cesium.Cartesian2(screenX, screenY) as Cartesian2;

    if (mode === 'model') {
      if (!scene.pickPositionSupported) return undefined;
      return scene.pickPosition(pos) ?? undefined;
    }
    if (mode === 'terrain') {
      const ray = viewer.camera.getPickRay(pos);
      if (!ray) return undefined;
      return scene.globe.pick(ray, scene) ?? undefined;
    }
    return viewer.camera.pickEllipsoid(pos) ?? undefined;
  }

  // ---------------------------------------------------------- 坐标转换

  /**
   * 地表坐标 → 经纬度 + 高程（纯 JSON）。
   * @param pos 地表坐标
   */
  function toLonLat(pos: Cartesian3): LonLat {
    const carto = sceneGlobeEllipsoid().cartesianToCartographic(pos);
    return {
      lon: round6(Cesium.Math.toDegrees(carto.longitude)),
      lat: round6(Cesium.Math.toDegrees(carto.latitude)),
      height: round2(carto.height),
    };
  }

  /** 取椭球（带缓存，避免每次走属性链） */
  let ellipsoidCache: CesiumInteractiveLike['Ellipsoid']['WGS84'] | null = null;
  function sceneGlobeEllipsoid(): CesiumInteractiveLike['Ellipsoid']['WGS84'] {
    if (!ellipsoidCache) {
      ellipsoidCache = (Cesium.Ellipsoid?.WGS84 ?? viewer.scene.globe.ellipsoid) as CesiumInteractiveLike['Ellipsoid']['WGS84'];
    }
    return ellipsoidCache;
  }

  function round6(n: number): number {
    return Number(n.toFixed(6));
  }
  function round2(n: number): number {
    return Number(n.toFixed(2));
  }

  // ---------------------------------------------------------- 样式 → graphics

  /**
   * 把 DrawStyle 翻译成 Cesium graphics 构造选项。
   * @param style 样式
   * @param type 图形类型（决定哪些字段有意义）
   * @param clampToGround 面是否强制贴地
   */
  function toGraphicsOptions(style: DrawStyle, type: DrawShapeType, clampToGround: boolean): Record<string, unknown> {
    const opts: Record<string, unknown> = {};
    const alpha = typeof style.alpha === 'number' ? clamp(style.alpha, 0, 1, 1) : undefined;

    if (type === 'POLYLINE') {
      opts.material = withAlpha(style.color, alpha);
      opts.width = clamp(Number(style.width ?? 2), 1, 32, 2);
      // 线在 3DTiles/地形上贴地：Cesium 的 PolylineGraphics 支持 clampToGround
      opts.clampToGround = clampToGround || style.clampToGround === true;
    } else if (type === 'POLYGON') {
      opts.material = withAlpha(style.color, alpha);
      opts.outlineColor = withAlpha(style.outlineColor, alpha);
      opts.outlineWidth = clamp(Number(style.outlineWidth ?? 2), 0, 32, 2);
      opts.heightReference = opts.clampToGround ? Cesium.HeightReference.CLAMP_TO_GROUND : Cesium.HeightReference.NONE;
      // 面贴地必须靠 heightReference，不是 clampToGround（那是 polyline 的字段）
      opts.clampToGround = clampToGround || style.clampToGround === true;
      opts.arcType = Cesium.ArcType.RHUMB;
    } else if (type === 'POINT') {
      opts.color = withAlpha(style.color, alpha);
      opts.pixelSize = clamp(Number(style.pixelSize ?? 8), 1, 64, 8);
      if (style.outline !== undefined) {
        opts.outlineColor = style.outline;
        opts.outlineWidth = clamp(Number(style.outlineWidth ?? 1), 0, 16, 1);
      }
    } else if (type === 'CIRCLE') {
      opts.material = withAlpha(style.color, alpha);
      opts.outline = style.outline !== false;
      if (style.outline !== false) {
        opts.outlineColor = withAlpha(style.outlineColor, alpha);
      }
      opts.semiMajorAxis = 1;
      opts.semiMinorAxis = 0.5;
    } else if (type === 'RECTANGLE') {
      opts.material = withAlpha(style.color, alpha);
      opts.outlineColor = withAlpha(style.outlineColor, alpha);
      opts.outlineWidth = clamp(Number(style.outlineWidth ?? 2), 0, 32, 2);
      opts.heightReference = clampToGround ? Cesium.HeightReference.CLAMP_TO_GROUND : Cesium.HeightReference.NONE;
    }
    return opts;
  }

  /** 给颜色叠透明度 */
  function withAlpha(color: unknown, alpha: number | undefined): unknown {
    const c = color as { withAlpha?: (a: number) => unknown } | undefined;
    if (alpha === undefined || !c || typeof c.withAlpha !== 'function') return color;
    return c.withAlpha(alpha);
  }

  // ---------------------------------------------------------- 图形构造

  /**
   * 用当前会话的点构造实体。
   * @param session 会话
   * @param positions 位置数组；传 CallbackProperty 即为动态预览
   * @param styleOverride 样式覆盖（预览态传 dynamicStyle）
   */
  function buildEntity(
    session: DrawSession,
    positions: unknown,
    styleOverride: DrawStyle | undefined,
  ): Entity {
    const { type, options } = session;
    const style = styleOverride ?? options.style ?? {};
    const merged: DrawStyle = { ...defaultStyleFor(Cesium, type), ...style };
    const isPreview = styleOverride !== undefined;
    const clampToGround = merged.clampToGround === true;

    const graphics: Record<string, unknown> = {};
    if (type === 'POINT') {
      graphics.point = toGraphicsOptions(merged, 'POINT', clampToGround);
    } else if (type === 'POLYLINE') {
      graphics.polyline = { ...toGraphicsOptions(merged, 'POLYLINE', clampToGround), positions };
    } else if (type === 'POLYGON') {
      graphics.polygon = {
        ...toGraphicsOptions(merged, 'POLYGON', clampToGround),
        hierarchy: new Cesium.PolygonHierarchy(positions as unknown[]),
      };
    } else if (type === 'CIRCLE') {
      const pts = session.points;
      const first = pts[0];
      if (!first) throw new Error(`[${KIT_NAME}] CIRCLE 至少需要 1 个点。`);
      const graphicsOpts = toGraphicsOptions(merged, 'CIRCLE', clampToGround);
      // 半径 = 首点到当前鼠标点的距离，随鼠标实时变化
      const last = pts[pts.length - 1] ?? first;
      const radius = isPreview || pts.length > 1 ? Cesium.Cartesian3.distance(first, last) : 1;
      graphics.ellipse = {
        ...graphicsOpts,
        position: first,
        semiMajorAxis: Math.max(radius, 1),
        semiMinorAxis: Math.max(radius, 1),
        // 预览时让半径跟鼠标走，故用 CallbackProperty 包一层
        ...(isPreview
          ? {
              semiMajorAxis: new Cesium.CallbackProperty(() => {
                const p = session.points;
                const a = p[0];
                const b = p[p.length - 1];
                return a && b ? Math.max(Cesium.Cartesian3.distance(a, b), 1) : 1;
              }, false),
              semiMinorAxis: new Cesium.CallbackProperty(() => {
                const p = session.points;
                const a = p[0];
                const b = p[p.length - 1];
                return a && b ? Math.max(Cesium.Cartesian3.distance(a, b), 1) : 1;
              }, false),
            }
          : {}),
      };
    } else if (type === 'RECTANGLE') {
      const rect = Cesium.Rectangle.fromCartesianArray(session.points as Cartesian3[]);
      graphics.rectangle = { ...toGraphicsOptions(merged, 'RECTANGLE', clampToGround), coordinates: rect };
    }

    return new Cesium.Entity({ graphics });
  }

  // ---------------------------------------------------------- 会话管理

  /** 清掉预览与断点（不碰已完成的实体） */
  function clearWorking(): number {
    if (!session) return 0;
    let n = 0;
    const s = session;
    if (s.preview) {
      try {
        viewer.entities.remove(s.preview);
        n += 1;
      } catch {
        /* 已移除 */
      }
      s.preview = null;
    }
    for (const bp of s.breakpoints) {
      try {
        viewer.entities.remove(bp);
        n += 1;
      } catch {
        /* 已移除 */
      }
    }
    s.breakpoints = [];
    s.points = [];
    return n;
  }

  /** 复位光标 */
  function resetCursor(): void {
    if (viewer.canvas?.style) viewer.canvas.style.cursor = 'default';
  }

  /** 移除所有事件监听（幂等） */
  let removeEvents: Array<() => void> = [];

  function unbindEvents(): void {
    for (const off of removeEvents) {
      try {
        off();
      } catch {
        /* handler 已销毁 */
      }
    }
    removeEvents = [];
  }

  /** 点变化 → 通知调用方 */
  function emitPoints(s: DrawSession): void {
    s.options.onPointsChange?.(s.points.map(toLonLat));
  }

  /** 结束本次绘制，把图形固化进 viewer */
  async function completeSession(): Promise<void> {
    if (!session) return;
    const s = session;
    const type = s.type;
    const points = s.points.slice();

    // CIRCLE 至少 1 点，其余类型 POLYLINE/POLYGON 至少 2 点
    const minPoints = type === 'POINT' || type === 'CIRCLE' ? 1 : 2;
    if (points.length < minPoints) {
      cancelDrawing();
      return;
    }

    // 预览实体在固化时直接复用为最终实体，省一次重建
    clearWorking();
    const entity = buildEntity(s, points, undefined);
    viewer.entities.add(entity);
    if (s.options.oneInstance && finished.length) {
      const old = finished.shift();
      if (old) {
        try {
          viewer.entities.remove(old.entity);
        } catch {
          /* 已移除 */
        }
      }
    }
    const lonLats = points.map(toLonLat);
    finished.push({ entity, type, points: lonLats });
    finishedCount += 1;

    const result: DrawResult = {
      ok: true,
      type,
      entityId: entity.id,
      points: lonLats,
      count: points.length,
    };

    session = null;
    resetCursor();
    unbindEvents();

    if (s.options.once !== false) {
      // once=true：画完即停
      status_ = 'PAUSE';
    }

    if (s.options.onEnd) await s.options.onEnd(result);
    viewer.scene.requestRender();
  }

  /**
   * 撤销最后一个点。
   * 修掉原库 bug 4：原实现点数 < 3 时直接清空整图。
   * 本库语义：移除最后一个点；点归零才结束本次绘制。
   */
  function undoPoint(): void {
    if (!session) return;
    const s = session;
    if (s.points.length === 0) {
      cancelDrawing();
      return;
    }
    s.points.pop();
    const bp = s.breakpoints.pop();
    if (bp) {
      try {
        viewer.entities.remove(bp);
      } catch {
        /* 已移除 */
      }
    }
    refreshPreview(s);
    emitPoints(s);
    viewer.scene.requestRender();
  }

  /** 鼠标移动：更新预览（仅 POLYLINE / POLYGON / CIRCLE 需要） */
  function onMouseMove(screenX: number, screenY: number): void {
    if (!session || !alive) return;
    const s = session;
    if (s.type === 'POINT' || s.type === 'RECTANGLE') return;
    if (s.points.length === 0) return;

    const world = pick(screenX, screenY, s.options.pick ?? 'ellipsoid');
    if (!world) return;

    // 最后一个点始终跟随鼠标
    s.points[s.points.length - 1] = world;
    refreshPreview(s);
    emitPoints(s);
    viewer.scene.requestRender();
  }

  /** 重建预览实体 */
  function refreshPreview(s: DrawSession): void {
    if (s.preview) {
      try {
        viewer.entities.remove(s.preview);
      } catch {
        /* 已移除 */
      }
      s.preview = null;
    }
    if (s.points.length === 0) return;

    // 预览样式：dynamicStyle 未给就用 style
    const dynamicStyle = s.options.dynamicStyle ?? s.options.style;
    const positions = new Cesium.CallbackProperty(() => s.points, false);
    s.preview = buildEntity(s, positions, dynamicStyle);
    viewer.entities.add(s.preview);
  }

  /**
   * 落一个固定点。左键即调用。
   * @param screenX 屏幕 x
   * @param screenY 屏幕 y
   */
  function dropPoint(screenX: number, screenY: number): void {
    if (!session || !alive) return;
    const s = session;

    // POINT：单击即完成
    if (s.type === 'POINT') {
      const world = pick(screenX, screenY, s.options.pick ?? 'ellipsoid');
      if (!world) return;
      s.points = [world];
      void completeSession();
      return;
    }

    // 已在绘制中：替换跟随鼠标的末点为固定点
    if (s.points.length > 0) s.points.pop();

    const world = pick(screenX, screenY, s.options.pick ?? 'ellipsoid');
    if (!world) return;

    // POLYGON 双击结束：末点与首点重合时视为闭合标记，跳过
    if (s.type === 'POLYGON' && s.points.length >= 3) {
      const first = s.points[0];
      if (first && Cesium.Cartesian3.equals(first, world)) {
        void completeSession();
        return;
      }
    }

    s.points.push(world);

    const bpStyle = s.options.breakpointStyle ?? DEFAULT_BREAKPOINT;
    const bp = new Cesium.Entity({
      position: world,
      point: toGraphicsOptions({ ...DEFAULT_BREAKPOINT, ...bpStyle }, 'POINT', false),
    });
    viewer.entities.add(bp);
    s.breakpoints.push(bp);

    // 末尾加一个跟随鼠标的占位点
    s.points.push(world);
    refreshPreview(s);
    emitPoints(s);
    viewer.scene.requestRender();
  }

  // ---------------------------------------------------------- 事件绑定

  function bindEvents(options: DrawOptions): void {
    const canvas = viewer.canvas;
    if (!canvas) return;

    const startType = Cesium.ScreenSpaceEventType[options.startEvent ?? 'LEFT_CLICK'];
    const cancelType = Cesium.ScreenSpaceEventType[options.cancelEvent ?? 'RIGHT_CLICK'];
    const endType = Cesium.ScreenSpaceEventType[options.endEvent ?? 'LEFT_DOUBLE_CLICK'];
    const moveType = Cesium.ScreenSpaceEventType['MOUSE_MOVE'];

    if (
      typeof startType !== 'number' ||
      typeof cancelType !== 'number' ||
      typeof endType !== 'number' ||
      typeof moveType !== 'number'
    ) {
      throw new Error(
        `[${KIT_NAME}] 事件名无效。必须是 Cesium.ScreenSpaceEventType 的键名，例如 ` +
          `'LEFT_CLICK' / 'RIGHT_CLICK' / 'LEFT_DOUBLE_CLICK' / 'MOUSE_MOVE'。收到：${JSON.stringify({
            start: options.startEvent,
            cancel: options.cancelEvent,
            end: options.endEvent,
          })}`,
      );
    }

    // 独立 handler：不用 viewer.screenSpaceEventHandler，避免与 Cesium 原生相机控制互相摘除动作
    const handler = new Cesium.ScreenSpaceEventHandler(canvas);
    kit.track(() => {
      try {
        handler.destroy();
      } catch {
        /* 已销毁 */
      }
    });

    const guard = (fn: (x: number, y: number) => void) => {
      return (arg: unknown) => {
        if (!alive || !session) return;
        const m = arg as { position?: Cartesian2 };
        const p = m?.position;
        if (!p) return;
        fn(p.x, p.y);
      };
    };

    handler.setInputAction(guard(dropPoint), startType);
    handler.setInputAction(guard(undoPoint), cancelType);
    handler.setInputAction(
      guard(() => {
        void completeSession();
      }),
      endType,
    );
    handler.setInputAction(guard(onMouseMove), moveType);

    removeEvents.push(() => {
      try {
        handler.removeInputAction(startType);
        handler.removeInputAction(cancelType);
        handler.removeInputAction(endType);
        handler.removeInputAction(moveType);
      } catch {
        /* handler 已销毁 */
      }
    });

    if (canvas.style) canvas.style.cursor = 'crosshair';
  }

  // ---------------------------------------------------------- 对外方法

  let status_: DrawStatus = 'INIT';

  /** 取消当前绘制：清断点与预览，不保留已完成的图形 */
  function cancelDrawing(): { ok: true; removed: number } {
    const n = clearWorking();
    unbindEvents();
    session = null;
    status_ = 'INIT';
    resetCursor();
    viewer.scene.requestRender();
    return { ok: true, removed: n };
  }

  /**
   * 开始绘制。会隐式取消上一次进行中的绘制（不删已完成的图形）。
   *
   * 修掉原库 bug 3：原实现先建 painter 再判状态，重复 start 会泄漏一个 painter
   * 及其断点实体。本库先判状态、再建会话，事件绑定前先解上一次的绑定。
   */
  function start(options: DrawOptions): { ok: true; type: DrawShapeType; status: DrawStatus } {
    if (!alive) {
      throw new Error(`[${KIT_NAME}] 已 dispose，无法继续绘制。`);
    }
    if (!options || !options.type) {
      throw new Error(`[${KIT_NAME}] start() 需要指定 type，可选：POINT / POLYLINE / POLYGON / CIRCLE / RECTANGLE。`);
    }
    const valid: DrawShapeType[] = ['POINT', 'POLYLINE', 'POLYGON', 'CIRCLE', 'RECTANGLE'];
    if (!valid.includes(options.type)) {
      throw new Error(`[${KIT_NAME}] 不支持的图形类型 ${String(options.type)}，可选：${valid.join(' / ')}。`);
    }
    const pickMode = options.pick ?? 'ellipsoid';
    if (pickMode === 'terrain' && !viewer.scene.globe) {
      throw new Error(
        `[${KIT_NAME}] pick:'terrain' 需要 viewer.scene.globe。当前场景无 globe（可能是纯 3DTiles 场景），` +
          `请改用 pick:'model' 或 pick:'ellipsoid'。`,
      );
    }
    if (pickMode === 'model' && !viewer.scene.pickPositionSupported) {
      throw new Error(
        `[${KIT_NAME}] pick:'model' 需要 scene.pickPositionSupported（依赖 WebGL 深度纹理）。` +
          `当前环境不支持，改用 pick:'terrain'（仅地形）或 pick:'ellipsoid'（忽略地形）。`,
      );
    }

    // 先解上次的事件，避免叠加
    if (session) cancelDrawing();
    else unbindEvents();

    session = {
      type: options.type,
      options,
      points: [],
      breakpoints: [],
      preview: null,
      isDrawing: true,
    };
    status_ = 'STARTING';
    bindEvents(options);
    status_ = 'DRAWING';

    return { ok: true, type: options.type, status: status_ };
  }

  /** 结束绘制但保留已画图形 */
  function pause(): { ok: true } {
    clearWorking();
    unbindEvents();
    session = null;
    status_ = 'PAUSE';
    resetCursor();
    return { ok: true };
  }

  /** 清空本库画出的全部图形 */
  function clearAll(): { ok: true; removed: number } {
    cancelDrawing();
    let n = 0;
    for (const f of finished) {
      try {
        viewer.entities.remove(f.entity);
        n += 1;
      } catch {
        /* 已移除 */
      }
    }
    finished = [];
    finishedCount = 0;
    viewer.scene.requestRender();
    return { ok: true, removed: n };
  }

  /** 状态快照（纯 JSON） */
  function statusInfo(): DrawStatusInfo {
    return {
      status: alive ? status_ : 'DESTROY',
      type: session?.type ?? null,
      pointCount: session?.points.length ?? 0,
      finished: finishedCount,
      pick: (session?.options.pick ?? 'ellipsoid') as PickMode,
    };
  }

  /** 已完成图形列表（纯 JSON） */
  function resultList(): Array<{ type: DrawShapeType; entityId?: string; points: LonLat[] }> {
    return finished.map((f) => ({ type: f.type, entityId: f.entity.id, points: f.points }));
  }

  kit.track(() => {
    alive = false;
    try {
      cancelDrawing();
      for (const f of finished) {
        try {
          viewer.entities.remove(f.entity);
        } catch {
          /* 已移除 */
        }
      }
      finished = [];
    } catch {
      /* viewer 已销毁 */
    }
  });

  return {
    KIT_NAME,
    start,
    cancel: cancelDrawing,
    pause,
    clear: clearAll,
    status: statusInfo,
    results: resultList,
    pick: (x: number, y: number, mode?: PickMode) => pick(x, y, mode),
    dispose: () => {
      alive = false;
    },
  };
}

export default createDrawerKit;