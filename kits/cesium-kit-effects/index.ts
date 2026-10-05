// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 catnuko <https://github.com/catnuko>
/**
 * cesium-kit-effects —— 全屏后处理特效库（雨 / 雪 / 雾，注入式）
 *
 * 沉淀的经验（对应 experience/entries 中的条目）：
 *   - webgl2-shader：新 Cesium 默认 WebGL2，PPS 里 texture2D/gl_FragColor 直接编译失败——
 *     本库 shader 一律 texture() / out_FragColor / in varying，并自带编译期常量循环上界。
 *   - postprocess-uniform：stage 只有 add/remove 没有替换语义，重挂前必须 remove——
 *     本库句柄化，remove()/stopAll() 走 postProcessStages.remove。
 *   - 上游示例（Cesium-Skills 5.1.x 雨雪雾）是外部 weatherEffects.js 的壳，库源码不在仓库，
 *     本库 shader 为自写实现：程序化生成，无纹理资源依赖。
 *
 * 铁律：Cesium 只从 kit 入参拿，类型从 ../cesium-api-types 取（import type）。
 */

import { assertCesium, assertViewer } from '../cesium-kit-core/index';
import type { Kit } from '../cesium-kit-core/index';
import type { CesiumEffectsLike, PostProcessStage } from '../cesium-api-types';

export const KIT_NAME = 'cesium-kit-effects';

/** 特效名 */
export type EffectName = 'rain' | 'snow' | 'fog';

/** 单个特效句柄 */
export interface EffectHandle {
  name: EffectName;
  /** 摘除该特效（postProcessStages.remove） */
  remove(): { ok: true; removed: number };
}

/** 停止结果 */
export interface EffectsStopResult {
  ok: true;
  stopped: number;
}

/** 雨/雪公共参数 */
export interface PrecipitationOptions {
  /** 下落速度（行/帧），雨默认 0.05，雪默认 0.008 */
  speed?: number;
  /** 网格列数，越大雨丝/雪花越密。雨默认 120，雪默认 60 */
  cols?: number;
  /** 网格行数。雨默认 15，雪默认 40 */
  rows?: number;
  /** 强度 0~1。雨默认 0.35，雪默认 0.6 */
  alpha?: number;
}

/** 雾参数 */
export interface FogOptions {
  /** 雾色 CSS 字符串，默认 '#c8d1d8' */
  color?: string;
  /** 浓度系数（指数雾），默认 0.00012（约 8km 起明显） */
  density?: number;
}

/** 全屏特效能力库接口 */
export interface EffectsKit {
  KIT_NAME: typeof KIT_NAME;
  rain(opts?: PrecipitationOptions): EffectHandle;
  snow(opts?: PrecipitationOptions): EffectHandle;
  fog(opts?: FogOptions): EffectHandle;
  stopAll(): EffectsStopResult;
  dispose(): EffectsStopResult;
}

function assertEffectsApi(Cesium: unknown, who: string = KIT_NAME): CesiumEffectsLike {
  const ns = Cesium as Partial<CesiumEffectsLike>;
  if (typeof ns.PostProcessStage !== 'function') {
    throw new Error(`[${who}] Cesium 实例缺少 PostProcessStage，无法做全屏特效。请检查 Cesium.js 是否完整加载。`);
  }
  return Cesium as CesiumEffectsLike;
}

/* GLSL 公共块：颜色采样输入（PPS wrapper 注入 v_textureCoordinates，这里声明后使用） */
const FS_HEAD = /* glsl */ `
uniform sampler2D colorTexture;
in vec2 v_textureCoordinates;
float geoaiHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
`;

const RAIN_FS = /* glsl */ `${FS_HEAD}
uniform float u_speed; uniform float u_angle; uniform float u_cols; uniform float u_rows; uniform float u_alpha;
void main(void) {
  vec3 base = texture(colorTexture, v_textureCoordinates).rgb;
  vec2 uv = v_textureCoordinates;
  uv.x += uv.y * u_angle;                                   // 斜雨
  vec2 g = vec2(uv.x * u_cols, uv.y * u_rows);
  vec2 cell = floor(g);
  vec2 f = fract(g);
  float r = geoaiHash(cell);
  float lineY = fract(f.y - czm_frameNumber * u_speed - r); // 雨丝随帧下移
  float streak = smoothstep(0.18, 0.0, abs(lineY - 0.5));
  float on = step(0.78, r);                                 // 约 1/4 的格子有雨丝
  float drop = streak * on * smoothstep(0.05, 0.015, abs(f.x - (0.3 + 0.4 * geoaiHash(cell + 1.7))));
  out_FragColor = vec4(mix(base, vec3(0.65, 0.72, 0.85), clamp(drop * u_alpha, 0.0, 1.0)), 1.0);
}
`;

const SNOW_FS = /* glsl */ `${FS_HEAD}
uniform float u_speed; uniform float u_cols; uniform float u_rows; uniform float u_alpha;
void main(void) {
  vec3 base = texture(colorTexture, v_textureCoordinates).rgb;
  vec2 uv = v_textureCoordinates;
  uv.x += 0.12 * sin(czm_frameNumber * 0.02 + uv.y * 6.2831); // 飘摆
  vec2 g = vec2(uv.x * u_cols, uv.y * u_rows);
  vec2 cell = floor(g);
  vec2 f = fract(g);
  float r = geoaiHash(cell);
  float y = fract(f.y + czm_frameNumber * u_speed + r);
  float d = length(vec2(f.x - (0.2 + 0.6 * geoaiHash(cell + 3.1)), y - 0.5));
  float flake = smoothstep(0.14, 0.0, d) * step(0.5, r);
  out_FragColor = vec4(mix(base, vec3(0.95, 0.96, 1.0), clamp(flake * u_alpha, 0.0, 1.0)), 1.0);
}
`;

const FOG_FS = /* glsl */ `
uniform sampler2D colorTexture;
uniform sampler2D depthTexture;
in vec2 v_textureCoordinates;
uniform vec3 u_fogColor;
uniform float u_density;
void main(void) {
  vec4 base = texture(colorTexture, v_textureCoordinates);
  float depth = czm_unpackDepth(texture(depthTexture, v_textureCoordinates));
  if (depth == 0.0) { out_FragColor = base; return; }       // 天空/无几何不加雾
  vec4 eye = czm_windowToEyeCoordinates(gl_FragCoord.xy, depth);
  float dist = length(eye.xyz / eye.w);                     // 视距（米）
  float fogFactor = 1.0 - exp(-u_density * dist);
  out_FragColor = vec4(mix(base.rgb, u_fogColor, clamp(fogFactor, 0.0, 1.0)), base.a);
}
`;

/**
 * 创建全屏特效库。
 * @param kit 由 createKit 传入
 */
export function createEffectsKit(kit: Kit): EffectsKit {
  const Cesium = assertEffectsApi(assertCesium(kit.Cesium, KIT_NAME));
  const viewer = assertViewer(kit.viewer, KIT_NAME);

  /** 活跃 stage，供 stopAll / dispose（stage 没有"替换"语义，重挂前必须先摘） */
  const active = new Set<{ name: EffectName; stage: PostProcessStage }>();

  function add(name: EffectName, fragmentShader: string, uniforms: Record<string, unknown>): EffectHandle {
    // add 的类型签名返回 PostProcessStage | PostProcessStageComposite, 本库只挂单 stage
    const stage = viewer.scene.postProcessStages.add(
      new Cesium.PostProcessStage({ fragmentShader, uniforms }),
    ) as PostProcessStage;
    const rec = { name, stage };
    active.add(rec);
    return {
      name,
      remove() {
        const removed = viewer.scene.postProcessStages.remove(stage) ? 1 : 0;
        active.delete(rec);
        return { ok: true, removed };
      },
    };
  }

  /** 全屏雨（程序化雨丝，随帧下落；对天空无效区也着色——纯屏幕空间特效） */
  function rain(opts: PrecipitationOptions = {}): EffectHandle {
    return add('rain', RAIN_FS, {
      u_speed: opts.speed ?? 0.05,
      u_angle: 0.2,
      u_cols: opts.cols ?? 120,
      u_rows: opts.rows ?? 15,
      u_alpha: opts.alpha ?? 0.35,
    });
  }

  /** 全屏雪（程序化雪花，带左右飘摆） */
  function snow(opts: PrecipitationOptions = {}): EffectHandle {
    return add('snow', SNOW_FS, {
      u_speed: opts.speed ?? 0.008,
      u_cols: opts.cols ?? 60,
      u_rows: opts.rows ?? 40,
      u_alpha: opts.alpha ?? 0.6,
    });
  }

  /** 指数高度雾（基于深度纹理的视距雾；depth==0 的天空不加雾，见 webgl2-shader 条目） */
  function fog(opts: FogOptions = {}): EffectHandle {
    const c = Cesium.Color.fromCssColorString(opts.color ?? '#c8d1d8') ?? Cesium.Color.WHITE;
    return add('fog', FOG_FS, {
      u_fogColor: [c.red, c.green, c.blue],
      u_density: opts.density ?? 0.00012,
    });
  }

  /** 摘除本库全部特效。 */
  function stopAll(): EffectsStopResult {
    let n = 0;
    for (const rec of [...active]) {
      if (viewer.scene.postProcessStages.remove(rec.stage)) n += 1;
      active.delete(rec);
    }
    return { ok: true, stopped: n };
  }

  return {
    KIT_NAME,
    rain,
    snow,
    fog,
    stopAll,
    dispose: stopAll,
  };
}

export default createEffectsKit;
