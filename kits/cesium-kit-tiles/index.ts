// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 catnuko <https://github.com/catnuko>
/**
 * cesium-kit-tiles —— 3D Tiles 能力库（注入式）
 *
 * 沉淀的经验（对应 experience/entries 中的条目）：
 *   - async-factory-migration：1.107+ 只认 await Cesium3DTileset.fromUrl(url)，
 *     同步构造器与 readyPromise 已是死路，本库全部走异步工厂。
 *   - 3dtiles-modelmatrix-enu：ECEF 轴不是"向上"，直接 Matrix4.fromTranslation([0,0,h])
 *     会让 tileset 斜着飞走——lift() 沿包围球中心的 ENU 竖直方向做差。
 *   - custom-shader：函数签名一字不差、varyings 放顶层、清除走 undefined（本库 clearShader）。
 *
 * 铁律：Cesium 只从 kit 入参拿，类型从 ../cesium-api-types 取（import type）。
 */

import { assertCesium, assertViewer } from '../cesium-kit-core/index';
import type { Kit } from '../cesium-kit-core/index';
import type { Cesium3DTileset, CesiumTilesLike } from '../cesium-api-types';

export const KIT_NAME = 'cesium-kit-tiles';

/** load() 的结果 */
export interface TilesLoadResult {
  ok: true;
  tileset: Cesium3DTileset;
  url: string;
  zoomed: boolean;
}

/** lift() / setShader() / clearShader() 的结果 */
export interface TilesOpResult {
  ok: true;
}

/** 移除结果 */
export interface TilesRemoveResult extends TilesOpResult {
  removed: number;
}

/** setShader() 的参数（CustomShader 的窄化，lightingModel 用字面量防拼错） */
export interface TilesShaderSpec {
  /** 片元入口，签名固定 void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) */
  fragmentShaderText: string;
  uniforms?: Record<string, unknown>;
  lightingModel?: 'UNLIT' | 'PBR';
}

/** 3D Tiles 能力库接口 */
export interface TilesKit {
  KIT_NAME: typeof KIT_NAME;
  load(
    url: string,
    opts?: { zoom?: boolean; maximumScreenSpaceError?: number; customShader?: unknown },
  ): Promise<TilesLoadResult>;
  lift(tileset: Cesium3DTileset, meters: number): TilesOpResult;
  setShader(tileset: Cesium3DTileset, spec: TilesShaderSpec): TilesOpResult;
  clearShader(tileset: Cesium3DTileset): TilesOpResult;
  removeAll(): TilesRemoveResult;
  dispose(): TilesRemoveResult;
}

/** tiles 库需要 Cesium3DTileset.fromUrl / CustomShader / Matrix4 运算——缺了在这里就报，别等深层 undefined */
function assertTilesApi(Cesium: unknown, who: string = KIT_NAME): CesiumTilesLike {
  const ns = Cesium as Partial<CesiumTilesLike>;
  if (typeof ns.Cesium3DTileset?.fromUrl !== 'function') {
    throw new Error(
      `[${who}] Cesium 实例缺少 Cesium3DTileset.fromUrl()。` +
        '1.107+ 只认异步工厂；若报错说明 Cesium 版本过老或加载不完整。',
    );
  }
  if (typeof ns.CustomShader !== 'function' || !ns.LightingModel) {
    throw new Error(`[${who}] Cesium 实例缺少 CustomShader（1.104+ 才有），无法做 3D Tiles 染色。`);
  }
  return Cesium as CesiumTilesLike;
}

/**
 * 创建 3D Tiles 能力库。
 * @param kit 由 createKit 传入
 */
export function createTilesKit(kit: Kit): TilesKit {
  const Cesium = assertTilesApi(assertCesium(kit.Cesium, KIT_NAME));
  const viewer = assertViewer(kit.viewer, KIT_NAME);

  /** 本库加载的 tileset，供 removeAll / dispose */
  const loaded: Cesium3DTileset[] = [];

  /**
   * 加载一个 3D Tiles（tileset.json）。
   * 失败时把三类常见原因（404 路径 / CORS / 网络不通）写进报错，而不是裸抛 fetch 错误。
   * @param url tileset.json 地址
   * @param opts zoom 加载后飞到模型；maximumScreenSpaceError 精度阈值（越小越精细越吃性能，默认 16）
   */
  async function load(
    url: string,
    opts: { zoom?: boolean; maximumScreenSpaceError?: number; customShader?: unknown } = {},
  ): Promise<TilesLoadResult> {
    if (!url || typeof url !== 'string') {
      throw new Error(`[${KIT_NAME}] load() 需要 tileset.json 的 url。`);
    }
    let tileset: Cesium3DTileset;
    try {
      const factoryOpts: Record<string, unknown> = {
        maximumScreenSpaceError: opts.maximumScreenSpaceError ?? 16,
      };
      if (opts.customShader) factoryOpts.customShader = opts.customShader;
      tileset = await Cesium.Cesium3DTileset.fromUrl(url, factoryOpts);
    } catch (e) {
      throw new Error(
        `[${KIT_NAME}] 3D Tiles 加载失败: ${url} —— 常见原因: ` +
          '① tileset.json 404 / 路径不对（浏览器直接访问该地址确认）' +
          '② 服务端 CORS 未放行 ③ 网络不通。' +
          `原始报错: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    viewer.scene.primitives.add(tileset);
    loaded.push(tileset);
    let zoomed = false;
    if (opts.zoom) {
      await viewer.zoomTo(tileset);
      zoomed = true;
    }
    return { ok: true, tileset, url, zoomed };
  }

  /**
   * 整体抬升/下沉 tileset（米，正数抬高）。
   * 直接 Matrix4.fromTranslation([0,0,h]) 沿的是 ECEF 轴——在球面上不是"向上"，
   * tileset 会斜着飞走；这里用包围球中心算出该点的 ENU 竖直方向再平移。
   * 可叠加调用（与已有 modelMatrix 复合）。
   */
  function lift(tileset: Cesium3DTileset, meters: number): TilesOpResult {
    if (!Number.isFinite(meters) || meters === 0) {
      throw new Error(`[${KIT_NAME}] lift() 的 meters 必须是非零有限数值（米，正数抬高）。`);
    }
    const carto = Cesium.Cartographic.fromCartesian(tileset.boundingSphere.center);
    const surface = Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, 0);
    const target = Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, meters);
    const translation = Cesium.Cartesian3.subtract(target, surface, new Cesium.Cartesian3());
    // 与已有 modelMatrix 复合，重复 lift 逐次叠加
    tileset.modelMatrix = Cesium.Matrix4.multiply(
      Cesium.Matrix4.fromTranslation(translation),
      tileset.modelMatrix,
      new Cesium.Matrix4(),
    );
    return { ok: true };
  }

  /**
   * 给 tileset 挂 CustomShader（整体染色/渐变/扫光）。
   * fragmentMain 签名固定；要让自定义 diffuse 可见默认走 UNLIT，否则 PBR 光照会冲掉效果。
   * 动态调参直接改 shader.uniforms.u_xxx.value，不必重建。
   */
  function setShader(tileset: Cesium3DTileset, spec: TilesShaderSpec): TilesOpResult {
    if (!spec?.fragmentShaderText) {
      throw new Error(
        `[${KIT_NAME}] setShader() 需要 fragmentShaderText。` +
          '入口签名固定: void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) —— 错一个词整片黑。',
      );
    }
    tileset.customShader = new Cesium.CustomShader({
      uniforms: spec.uniforms ?? {},
      lightingModel: spec.lightingModel === 'PBR' ? Cesium.LightingModel.PBR : Cesium.LightingModel.UNLIT,
      fragmentShaderText: spec.fragmentShaderText,
    });
    return { ok: true };
  }

  /** 清除 CustomShader。赋 undefined 即恢复原始材质（Cesium3DTileset 的 setter 原生支持）。 */
  function clearShader(tileset: Cesium3DTileset): TilesOpResult {
    (tileset as unknown as { customShader?: unknown }).customShader = undefined;
    return { ok: true };
  }

  /** 移除本库加载的所有 tileset（从 scene.primitives 摘除并释放）。 */
  function removeAll(): TilesRemoveResult {
    let n = 0;
    while (loaded.length) {
      const tileset = loaded.pop();
      try {
        if (tileset && viewer.scene.primitives.remove(tileset)) n += 1;
      } catch {
        /* 已被外部移除 */
      }
    }
    return { ok: true, removed: n };
  }

  return {
    KIT_NAME,
    load,
    lift,
    setShader,
    clearShader,
    removeAll,
    dispose: removeAll,
  };
}

export default createTilesKit;
