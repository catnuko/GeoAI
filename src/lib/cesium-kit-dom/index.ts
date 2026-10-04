// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 catnuko <https://github.com/catnuko>
/**
 * cesium-kit-dom —— DOM 跟随层的公共基类（注入式，无 Cesium 依赖）
 *
 * 存在意义：popup / tooltip / 悬浮提示这类「HTML 元素跟随地理坐标或屏幕坐标」
 * 的能力，都需要同一套生命周期管理 —— 挂载、显隐、跟随、销毁。
 * cesium-extends 把这套逻辑放在 @cesium-extends/common 的 Widget 基类里，
 * 本文件是它的修正版重写（不 import Cesium，可独立复用到任何 DOM 场景）。
 *
 * 修掉的原库 bug（对应经验条目 2026-10-04-overlay-custom-container-crash）：
 *   1. 自定义 container 时 destroy() 必崩。
 *      原实现卸载时写死 `viewer.container.removeChild(wrapper)`，而挂载时用的是
 *      options.container。两者不一致时 parentNode 不是 viewer.container，
 *      removeChild 抛 NotFoundError。本实现统一走 `wrapper.parentNode`。
 *   2. destroy() 后再次 enabled=true 会让内容翻倍。
 *      原实现的 _ready 在 destroy 时被置 false，而 _enableHook 里
 *      `if (!this._ready) this._mountContent()` 会把子节点再追加一遍。
 *      本实现用 `_contentMounted` 单独标记「内容是否已进 DOM」，
 *      与「是否显示」解耦：hide/show 不动 DOM 结构，mount 幂等。
 *   3. enabled setter 被赋同值时仍会重复 append / removeChild。
 *      本实现在值未变化时直接 return，避免多余的 DOM 抖动与事件重复绑定。
 *
 * 铁律：本目录不 import Cesium。DOM 是纯前端关注点，与地理引擎解耦。
 */

/** DOM 跟随层的挂载状态 */
export type WidgetState = 'detached' | 'mounted' | 'destroyed';

/** 通用 DOM 工具 */
export const DomUtil = {
  /**
   * 创建元素并（可选）挂到容器上。
   * @param tag 标签名，如 'div'
   * @param className class 名
   * @param container 父容器；不传则只创建不挂载
   */
  create(tag: string, className: string, container?: Element | null): HTMLElement {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (container) container.appendChild(el);
    return el;
  },

  /**
   * 由 HTML 字符串构造元素（不挂载）。
   * 注意：调用方若传入不可信 HTML，等于自建 XSS 面。
   * 库内凡是把外部字符串塞进 innerHTML 的地方，一律先走 escapeHtml()。
   * @param html HTML 字符串
   * @param className class 名
   */
  parse(html: string, className = ''): HTMLDivElement {
    const el = document.createElement('div');
    if (className) el.className = className;
    el.innerHTML = html;
    return el;
  },

  /**
   * HTML 转义。所有「用户数据 → innerHTML」的路径都必须过这里。
   * @param s 原始字符串
   */
  escapeHtml(s: unknown): string {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },
};

/**
 * 跟随层基类。
 *
 * 生命周期：new → mount（可选，默认自动）→ show/hide → destroy
 * 子类只需实现 `_build()`（构造一次内部 DOM）与 `_onShow()` / `_onHide()`（挂事件）。
 */
export abstract class Widget {
  /** 根元素。由子类在构造时创建。 */
  protected readonly _wrapper: HTMLElement;
  /** 默认挂载容器 */
  protected readonly _container: Element;

  private _state: WidgetState = 'detached';
  /** 内部内容是否已进 DOM（与显示状态解耦，避免重复挂载） */
  private _contentMounted = false;
  private _visible = false;
  private _disposed = false;

  /**
   * @param container 挂载容器，destroy 时元素从这里摘除
   * @param wrapper 根元素
   */
  constructor(container: Element, wrapper: HTMLElement) {
    this._container = container;
    this._wrapper = wrapper;
  }

  /** 当前状态 */
  get state(): WidgetState {
    return this._state;
  }

  /** 是否已显示 */
  get visible(): boolean {
    return this._visible;
  }

  /** 是否已销毁 */
  get destroyed(): boolean {
    return this._disposed;
  }

  /** 根元素，供调用方加自定义样式 / 绑定事件 */
  get element(): HTMLElement {
    return this._wrapper;
  }

  /**
   * 是否启用。赋同值不会触发任何 DOM 操作。
   * true → 确保挂载 + build + show；false → hide（DOM 保留，不销毁）
   */
  set enabled(on: boolean) {
    if (this._disposed) return;
    if (on === this._visible) return;
    this._visible = on;
    if (on) {
      this._mount();
      this._wrapper.style.display = 'block';
      this._onShow();
    } else {
      this._wrapper.style.display = 'none';
      this._onHide();
    }
  }

  get enabled(): boolean {
    return this._visible;
  }

  /**
   * 设置内容。字符串按 textContent 语义处理（调用方自行拼 HTML 时须先转义）。
   * @param content 字符串或元素
   */
  setContent(content: string | Element): this {
    if (typeof content === 'string') {
      this._wrapper.innerHTML = content;
    } else if (content instanceof Element) {
      this._wrapper.replaceChildren(content);
    }
    return this;
  }

  /** 设置文本内容（自动转义，安全）。 */
  setText(text: unknown): this {
    this._wrapper.textContent = String(text ?? '');
    return this;
  }

  /** 显示（等价 enabled = true）。 */
  show(): this {
    this.enabled = true;
    return this;
  }

  /** 隐藏（等价 enabled = false，DOM 保留）。 */
  hide(): this {
    this.enabled = false;
    return this;
  }

  /**
   * 销毁：解事件 → 从实际父节点摘除 → 置销毁态。可重复调用。
   * 子类的额外清理（Cesium 事件解绑等）在 _onDestroy 里做。
   */
  destroy(): void {
    if (this._disposed) return;
    this._disposed = true;
    this._visible = false;
    // 先解事件再摘 DOM：顺序反了会让仍在飞行的回调操作已脱离的节点
    this._onHide();
    this._onDestroy();
    this._wrapper.remove();
    this._state = 'destroyed';
  }

  /** 幂等挂载：建内容 → 进 DOM。重复调用不产生副作用。 */
  private _mount(): void {
    if (this._state === 'destroyed') return;
    if (!this._contentMounted) {
      this._build();
      this._contentMounted = true;
    }
    if (!this._wrapper.parentNode) {
      this._container.appendChild(this._wrapper);
    }
    this._state = 'mounted';
  }

  /** 子类构造内部 DOM，只在首次挂载时调用一次 */
  protected abstract _build(): void;

  /** 子类：显示时绑定事件（Cesium 事件 / DOM 事件） */
  protected _onShow(): void {}

  /** 子类：隐藏时解绑事件 */
  protected _onHide(): void {}

  /** 子类：额外资源清理（与显示状态无关，destroy 时必走） */
  protected _onDestroy(): void {}
}