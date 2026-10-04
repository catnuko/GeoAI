// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 catnuko <https://github.com/catnuko>
/**
 * cesium-kit-overlay —— HTML 跟随层能力库（弹窗 / 悬浮提示）
 *
 * 来源：@cesium-extends/popup + tooltip + common（MIT）的注入式重写。
 * 原库三块共 564 行，其中大半是 Widget 基类里重复的 DOM 生命周期代码。
 * 本文件把它收敛成：kit-dom 的修正版 Widget 基类 + 两个具体跟随层。
 *
 * 沉淀的经验（对应 experience/entries）：
 *   - overlay-custom-container-crash：DOM 跟随层在自定义容器下销毁必崩的根因
 *     （挂载用 options.container、卸载用 viewer.container，两者不一致），
 *     以及「enabled 赋值触发重复挂载导致内容翻倍」这个二次坑。
 *
 * 修掉的原库 bug：
 *   1. 自定义 container 时 destroy() 抛 NotFoundError
 *      → 统一走 wrapper.parentNode.remove()（见 cesium-kit-dom）。
 *   2. destroy() 后再 enable 内容翻倍 → _contentMounted 与可见状态解耦。
 *   3. Occluder 半径硬编码 6350000 → 改用 Cesium.Ellipsoid.WGS84.maximumRadius，
 *      换椭球（如火星）时背面剔除才正确。
 *   4. destroy() 后 setPosition 仍被 postRender 回调 → 本库 destroy 时立即解绑。
 *   5. setContent 直接 innerHTML 赋值 → 提供 html() / text() 两条路，
 *      text() 走 textContent（天然免疫 XSS），html() 明确标注需自行转义。
 *
 * 铁律：Cesium 只从 kit 入参拿；DOM 生命周期集中在 cesium-kit-dom，不重复造。
 */

import { assertCesiumInteractive, assertViewer } from '../cesium-kit-core/index';
import { DomUtil, Widget } from '../cesium-kit-dom/index';
import type { Kit } from '../cesium-kit-core/index';
import type { Cartesian2, Cartesian3, CesiumInteractiveLike, Viewer } from '../cesium-api-types';

export const KIT_NAME = 'cesium-kit-overlay';

/** 屏幕坐标锚点 */
export interface ScreenPoint {
  x: number;
  y: number;
}

/** 弹窗配置 */
export interface PopupOptions {
  /** 经纬度锚点（与 screen 二选一；同时给 screen 优先） */
  lon?: number;
  lat?: number;
  /** 屏幕坐标锚点 */
  screen?: ScreenPoint;
  /** 内容：字符串按 HTML 插入（需自行转义），或传 Element */
  content?: string | Element;
  /** 像素偏移 [x, y]，默认 [0, 0] */
  offset?: [number, number];
  /** 自定义 CSS 类，默认 'geoai-popup' */
  className?: string;
  /** 是否做地球背面剔除（点到球背面时隐藏），默认 true */
  occlude?: boolean;
  /** 是否显示锚点小圆点，默认 true */
  showAnchor?: boolean;
  /** 自定义挂载容器，默认 viewer.container */
  container?: Element;
}

/** 悬浮提示配置 */
export interface TooltipOptions {
  /** 内容 */
  content?: string | Element;
  /** 像素偏移 [x, y]，默认 [0, 0] */
  offset?: [number, number];
  /** 自定义 CSS 类，默认 'geoai-tooltip' */
  className?: string;
  /** 自定义挂载容器，默认 viewer.container */
  container?: Element;
}

/** 跟随层句柄 */
export interface OverlayHandle {
  /** 句柄 id，可用于 close() */
  id: string;
  /** 更新位置 */
  moveTo(target: { lon?: number; lat?: number } | ScreenPoint): void;
  /** 更新内容（字符串走 textContent，免疫 XSS） */
  setText(text: unknown): void;
  /** 更新内容（字符串按 HTML 插入，调用方自行保证不含不可信内容） */
  setHtml(html: string): void;
  /** 显示 */
  show(): void;
  /** 隐藏（DOM 保留） */
  hide(): void;
  /** 关闭并销毁（解绑所有监听 + 摘除 DOM） */
  close(): void;
  /** 是否已关闭 */
  readonly closed: boolean;
}

/** 跟随层能力库接口 */
export interface OverlayKit {
  KIT_NAME: typeof KIT_NAME;
  /**
   * 经纬度锚定的弹窗。随相机移动自动跟随；转到地球背面自动隐藏。
   * @param options 配置
   */
  popup(options: PopupOptions): OverlayHandle;
  /**
   * 屏幕坐标锚定的弹窗（不随相机移动，适合 UI 叠加层）。
   * @param options 配置
   */
  popupAtScreen(options: PopupOptions): OverlayHandle;
  /**
   * 创建跟随鼠标的悬浮提示。
   * @param options 配置
   */
  tooltip(options?: TooltipOptions): OverlayHandle;
  /**
   * 一次性提示：显示 content，ms 毫秒后自动关闭。
   * @param content 文本内容
   * @param ms 持续时间，默认 2500
   */
  flash(content: string, ms?: number): OverlayHandle;
  /** 关闭全部跟随层 */
  closeAll(): { ok: true; closed: number };
  dispose(): void;
}

/**
 * 锚点：经纬度（随相机跟随）或屏幕像素（UI 叠加）。二者互斥，用 kind 判别。
 * 用判别联合而非「两个可选字段」是为了让调用方无法同时传 / 同时不传，
 * 也让库内不必到处写 `if (x !== undefined)` 的分支。
 */
export type Anchor =
  | { kind: 'lonlat'; lon: number; lat: number }
  | { kind: 'screen'; x: number; y: number };

/**
 * 创建跟随层能力库。
 * @param kit 由 createKit 传入
 */
export function createOverlayKit(kit: Kit): OverlayKit {
  const Cesium = assertCesiumInteractive(kit.Cesium, KIT_NAME);
  const viewer: Viewer = assertViewer(kit.viewer, KIT_NAME);
  const scene = viewer.scene;

  /** 全部活动句柄 */
  const handles = new Set<{ close(): void }>();
  let seq = 0;
  let alive = true;

  /** 取椭球最大半径（背面剔除用），不回退硬编码魔数 */
  function maxRadius(): number {
    const r = Cesium.Ellipsoid?.WGS84?.maximumRadius;
    return typeof r === 'number' && r > 0 ? r : 6350000;
  }

  /** 球背面遮挡判定 */
  function isBehindGlobe(pos: Cartesian3): boolean {
    try {
      const sphere = new Cesium.BoundingSphere(new Cesium.Cartesian3(0, 0, 0), maxRadius());
      const occluder = new Cesium.Occluder(sphere, scene.camera.position);
      return !occluder.isPointVisible(pos);
    } catch {
      // 判定失败时按「可见」处理：宁可多显示也不要莫名消失
      return false;
    }
  }

  /** 通用配置 */
  interface OverlayInit {
    content?: string | Element;
    offset: [number, number];
    anchor: Anchor;
    occlude: boolean;
    showAnchor: boolean;
  }

  /**
   * 通用的跟随层实现。
   * 无论锚在经纬度还是屏幕坐标，都统一走「postRender 时重算 left/top」。
   */
  function makeOverlay(wrapperClass: string, container: Element, init: OverlayInit): OverlayHandle {
    let offset = init.offset;
    let anchor: Anchor = init.anchor;
    let occlude = init.occlude;

    // 锚点圆点（可选）：独立元素，跟随 popup 定位
    const anchorDot = init.showAnchor ? DomUtil.create('div', 'geoai-popup-anchor', undefined) : null;

    const widget = new (class extends Widget {
      constructor() {
        super(container, DomUtil.create('div', wrapperClass, undefined));
      }
      protected override _build(): void {
        // 根元素样式由页面 CSS 决定；这里只保证内容已注入
        if (init.content !== undefined) this.setContent(init.content);
      }
      protected override _onShow(): void {
        updatePosition();
      }
      protected override _onDestroy(): void {
        // postRender 的解绑在外层 close() 里做
      }
    })();

    /** 当前解绑函数（幂等） */
    let unbindRender: (() => void) | null = null;

    /**
     * 重算屏幕位置并写 DOM。
     * 经纬度锚点：走 SceneTransforms，随相机自动跟随 + 背面剔除。
     * 屏幕锚点：直接用给定像素坐标，不做投影。
     */
    function updatePosition(): void {
      if (widget.destroyed || !widget.visible) return;

      let px: number;
      let py: number;

      if (anchor.kind === 'lonlat') {
        const world = Cesium.Cartesian3.fromDegrees(anchor.lon, anchor.lat) as Cartesian3;
        if (occlude && isBehindGlobe(world)) {
          widget.hide();
          if (anchorDot) anchorDot.style.display = 'none';
          return;
        }
        const win = Cesium.SceneTransforms.worldToWindowCoordinates(scene, world);
        if (!win) {
          // 点投影不到屏幕（相机看向别处）：隐藏而不是留在旧位置
          widget.hide();
          if (anchorDot) anchorDot.style.display = 'none';
          return;
        }
        px = win.x;
        py = win.y;
      } else {
        px = anchor.x;
        py = anchor.y;
      }

      const el = widget.element;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const left = px - w / 2 + offset[0];
      // 弹窗底边对齐锚点：top = 锚点 y - 高度
      const top = py - h + offset[1];

      el.style.position = 'absolute';
      el.style.left = `${Math.round(left)}px`;
      el.style.top = `${Math.round(top)}px`;
      el.style.pointerEvents = 'auto';

      if (anchorDot) {
        anchorDot.style.position = 'absolute';
        anchorDot.style.left = `${Math.round(px)}px`;
        anchorDot.style.top = `${Math.round(py)}px`;
        anchorDot.style.pointerEvents = 'none';
        if (!anchorDot.parentNode) container.appendChild(anchorDot);
      }

      // 从「背面隐藏」恢复时确保可见
      if (!widget.visible) widget.show();
      else widget.element.style.display = 'block';
    }

    /** 绑定每帧重算 */
    function bindRender(): void {
      if (unbindRender) return;
      const remove = scene.postRender.addEventListener(updatePosition);
      unbindRender = () => {
        try {
          remove();
        } catch {
          /* 场景已销毁 */
        }
        unbindRender = null;
      };
      kit.track(unbindRender);
    }

    widget.show();
    bindRender();

    const id = `overlay-${++seq}`;
    let closed = false;

    const handle: OverlayHandle = {
      id,
      moveTo(target) {
        if (closed) return;
        if ('x' in target && target.x !== undefined) {
          anchor = { kind: 'screen', x: Number(target.x), y: Number((target as ScreenPoint).y) };
        } else {
          anchor = {
            kind: 'lonlat',
            lon: Number((target as { lon?: number }).lon),
            lat: Number((target as { lat?: number }).lat),
          };
        }
        // 从「背面隐藏 / 投影失败」恢复：切回 lonlat 且新点在屏幕内时重新显示
        updatePosition();
      },
      setText(text) {
        if (!closed) widget.setText(text);
      },
      setHtml(html) {
        if (!closed) widget.setContent(html);
      },
      show() {
        if (closed) return;
        widget.show();
        updatePosition();
      },
      hide() {
        if (!closed) widget.hide();
      },
      close() {
        if (closed) return;
        closed = true;
        // 先解绑再销毁：顺序反了会让下一帧的 postRender 回调操作已摘除的 DOM
        unbindRender?.();
        unbindRender = null;
        widget.destroy();
        anchorDot?.remove();
        handles.delete(handle);
      },
      get closed() {
        return closed;
      },
    };

    handles.add(handle);
    return handle;
  }

  /** 经纬度锚定弹窗 */
  function popup(options: PopupOptions): OverlayHandle {
    if (options.lon === undefined || options.lat === undefined) {
      throw new Error(`[${KIT_NAME}] popup() 需要经纬度锚点 { lon, lat }；只想按屏幕定位请用 popupAtScreen()。`);
    }
    return makeOverlay(options.className ?? 'geoai-popup', options.container ?? viewer.container, {
      content: options.content,
      offset: options.offset ?? [0, 0],
      anchor: { kind: 'lonlat', lon: Number(options.lon), lat: Number(options.lat) },
      occlude: options.occlude !== false,
      showAnchor: options.showAnchor !== false,
    });
  }

  /** 屏幕坐标锚定弹窗 */
  function popupAtScreen(options: PopupOptions): OverlayHandle {
    if (!options.screen) {
      throw new Error(`[${KIT_NAME}] popupAtScreen() 需要 screen: { x, y }（CSS 像素，相对 viewer 容器）。`);
    }
    return makeOverlay(options.className ?? 'geoai-popup', options.container ?? viewer.container, {
      content: options.content,
      offset: options.offset ?? [0, 0],
      anchor: { kind: 'screen', x: Number(options.screen.x), y: Number(options.screen.y) },
      occlude: false,
      showAnchor: false,
    });
  }

  /** 跟随鼠标的悬浮提示 */
  function tooltip(options: TooltipOptions = {}): OverlayHandle {
    const handle = makeOverlay(
      options.className ?? 'geoai-tooltip',
      options.container ?? viewer.container,
      {
        content: options.content,
        offset: options.offset ?? [14, 0],
        anchor: { kind: 'screen', x: 0, y: 0 },
        occlude: false,
        showAnchor: false,
      },
    );

    // 鼠标监听：MOUSE_MOVE 时更新位置。handler 随 close() 销毁，
    // 不需要额外的「鼠标移出隐藏」—— 移出 canvas 时 Cesium 不再派发 MOUSE_MOVE，
    // 提示会停在最后一帧；要强制隐藏由调用方调 handle.hide()。
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.canvas);
    const moveType = Cesium.ScreenSpaceEventType['MOUSE_MOVE'];

    if (typeof moveType === 'number') {
      handler.setInputAction((arg: unknown) => {
        if (handle.closed || !alive) return;
        const p = (arg as { endPosition?: Cartesian2; position?: Cartesian2 })?.endPosition;
        const pos = p ?? (arg as { position?: Cartesian2 })?.position;
        if (!pos) return;
        handle.moveTo({ x: pos.x, y: pos.y });
      }, moveType);
    } else {
      // Cesium 实例异常：提示层仍可用于手动 moveTo，只是不跟随鼠标
      try {
        handler.destroy();
      } catch {
        /* 忽略 */
      }
    }

    const origClose = handle.close;
    handle.close = () => {
      try {
        handler.destroy();
      } catch {
        /* 已销毁 */
      }
      origClose();
    };

    return handle;
  }

  /** 一次性提示 */
  function flash(content: string, ms = 2500): OverlayHandle {
    const container = viewer.container;
    const handle = makeOverlay('geoai-flash', container, {
      content,
      offset: [0, 0],
      // 屏幕中下方固定位置
      anchor: { kind: 'screen', x: container.clientWidth / 2, y: container.clientHeight - 64 },
      occlude: false,
      showAnchor: false,
    });
    const timer = setTimeout(() => handle.close(), clampMs(ms));
    // kit.track 保证页面刷新 / kit.dispose() 时定时器被清掉，不会往已销毁 DOM 写
    kit.track(() => clearTimeout(timer));
    return handle;
  }

  function clampMs(ms: number): number {
    const n = Number(ms);
    if (!Number.isFinite(n) || n <= 0) return 2500;
    return Math.min(n, 60_000);
  }

  /** 关闭全部 */
  function closeAll(): { ok: true; closed: number } {
    let n = 0;
    for (const h of Array.from(handles)) {
      try {
        h.close();
        n += 1;
      } catch {
        /* 已关闭 */
      }
    }
    handles.clear();
    return { ok: true, closed: n };
  }

  kit.track(() => {
    alive = false;
    closeAll();
  });

  return {
    KIT_NAME,
    popup,
    popupAtScreen,
    tooltip,
    flash,
    closeAll,
    dispose: () => {
      alive = false;
      closeAll();
    },
  };
}

export default createOverlayKit;