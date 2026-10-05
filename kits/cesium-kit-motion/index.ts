// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 catnuko <https://github.com/catnuko>
/**
 * cesium-kit-motion —— 轨迹动画能力库（注入式）
 *
 * 沉淀的经验（对应 experience/entries 中的条目）：
 *   - should-animate-clock：时间驱动动画不动，先查 viewer.clock.shouldAnimate——
 *     CZML / SampledPositionProperty / glTF 动画 / 粒子全被它卡住，本库自动置 true。
 *   - JulianDate.fromDate(new Date()) 按 UTC 解析，比北京时间慢 8 小时，需 addHours 补回。
 *   - entity 的 availability 必须覆盖当前时间区间，否则整段不可见（不是停在起点）。
 *   - frame-listener-leak：不挂每帧监听（SampledPositionProperty 由时钟驱动），
 *     stop() 摘实体并恢复接入前的时钟状态。
 *
 * 命名说明：对外叫 kit.motion（Kit 契约的 track(fn) 已被"清理函数登记"占用，避免撞名）。
 *
 * 铁律：Cesium 只从 kit 入参拿，类型从 ../cesium-api-types 取（import type）。
 */

import { assertCesium, assertViewer } from '../cesium-kit-core/index';
import type { Kit } from '../cesium-kit-core/index';
import type { CesiumTimeLike, Entity } from '../cesium-api-types';

export const KIT_NAME = 'cesium-kit-motion';

/** 路径点（按列表顺序匀速插值） */
export interface MotionPoint {
  lon: number;
  lat: number;
  /** 米，默认 0 */
  height?: number;
}

/** animatePath() 的选项 */
export interface MotionOptions {
  /** 整段路径走完的秒数（时钟倍速为 multiplier 时，实际播放时长 = duration / multiplier） */
  duration?: number;
  /** 时钟倍速，默认 1 */
  multiplier?: number;
  /** 播完是否循环，默认 true（false 则播到终点停在 CLAMPED） */
  loop?: boolean;
  /** 时区修正小时数。JulianDate.fromDate 按 UTC 解析，默认 8 补回北京时间 */
  utcOffsetHours?: number;
  /** 朝向：velocity=沿速度方向（默认）/ fixed=不设朝向 */
  orientation?: 'velocity' | 'fixed';
  /** 是否显示轨迹线，默认 true */
  showPath?: boolean;
}

/** animatePath() 的句柄 */
export interface MotionHandle {
  /** 实体 id（viewer.entities.getById 可取回） */
  id: string;
  /** 停止并摘除实体，恢复接入前的时钟 */
  stop(): { ok: true; id: string };
}

/** 停止结果 */
export interface MotionStopResult {
  ok: true;
  stopped: number;
}

/** 轨迹动画能力库接口 */
export interface MotionKit {
  KIT_NAME: typeof KIT_NAME;
  animatePath(points: MotionPoint[], opts?: MotionOptions): MotionHandle;
  orbitAround(
    target: { lon: number; lat: number; height?: number },
    opts?: { radius?: number; degreesPerSecond?: number; pitch?: number },
  ): MotionHandle;
  limitPitch(opts?: { minPitch?: number; maxPitch?: number }): MotionHandle;
  stopAll(): MotionStopResult;
  dispose(): MotionStopResult;
}

/** track 库需要 SampledPositionProperty/JulianDate 运算/TimeInterval——缺了在入口报 */
function assertMotionApi(Cesium: unknown, who: string = KIT_NAME): CesiumTimeLike {
  const ns = Cesium as Partial<CesiumTimeLike>;
  if (
    typeof ns.SampledPositionProperty !== 'function' ||
    typeof ns.VelocityOrientationProperty !== 'function' ||
    typeof ns.JulianDate !== 'function' ||
    typeof ns.JulianDate?.fromDate !== 'function' ||
    typeof ns.TimeIntervalCollection !== 'function'
  ) {
    throw new Error(
      `[${who}] Cesium 实例缺少 SampledPositionProperty / VelocityOrientationProperty / ` +
        'JulianDate / TimeIntervalCollection，无法做轨迹动画。请检查 Cesium.js 是否完整加载。',
    );
  }
  return Cesium as CesiumTimeLike;
}

/**
 * 创建轨迹动画能力库。
 * @param kit 由 createKit 传入
 */
export function createMotionKit(kit: Kit): MotionKit {
  const Cesium = assertMotionApi(assertCesium(kit.Cesium, KIT_NAME));
  const viewer = assertViewer(kit.viewer, KIT_NAME);

  /** 活跃句柄（含恢复用时钟快照），stopAll / dispose 全量回收 */
  const active = new Set<{ entity: Entity; prev: ClockSnapshot }>();
  /** 漫游类功能的 onTick 清理函数（绕点飞行 / 限俯仰），stopAll 全量回收 */
  const roams = new Set<() => void>();

  interface ClockSnapshot {
    startTime: unknown;
    stopTime: unknown;
    currentTime: unknown;
    clockRange: unknown;
    multiplier: number;
    shouldAnimate: boolean;
  }

  /**
   * 绕固定点环绕飞行（巡检/展示）。每帧 onTick 里 setView 对准中心再 moveBackward 拉开半径。
   * 依赖时钟推进（shouldAnimate 自动开启）；页面在后台时 onTick 不跑——动画同样冻结
   * （见 background-raf 条目）。上游示例的 onTick 监听从不移除，本库 stop() 负责摘干净。
   *
   * @param target 环绕中心
   * @param opts radius 环绕半径（米，默认 50000）；degreesPerSecond 角速度（默认 12°/s）；
   *             pitch 俯仰角（度，默认 -30）
   */
  function orbitAround(
    target: { lon: number; lat: number; height?: number },
    opts: { radius?: number; degreesPerSecond?: number; pitch?: number } = {},
  ): MotionHandle {
    const radius = opts.radius ?? 50000;
    const degreesPerSecond = opts.degreesPerSecond ?? 12;
    const pitch = Cesium.Math.toRadians(opts.pitch ?? -30);
    if (!(radius > 0)) throw new Error(`[${KIT_NAME}] orbitAround() 的 radius 必须是正数（米）。`);
    if (!Number.isFinite(target?.lon) || !Number.isFinite(target?.lat)) {
      throw new Error(`[${KIT_NAME}] orbitAround() 的 target 缺 lon/lat。`);
    }

    const clock = viewer.clock;
    const prev: ClockSnapshot = {
      startTime: clock.startTime,
      stopTime: clock.stopTime,
      currentTime: clock.currentTime,
      clockRange: clock.clockRange,
      multiplier: clock.multiplier,
      shouldAnimate: clock.shouldAnimate,
    };
    const start = Cesium.JulianDate.fromDate(new Date());
    clock.startTime = start;
    clock.currentTime = start;
    clock.clockRange = Cesium.ClockRange.UNBOUNDED;
    clock.shouldAnimate = true; // 时钟不走, 环绕也不动

    const center = Cesium.Cartesian3.fromDegrees(target.lon, target.lat, target.height ?? 0);
    const initHeading = viewer.camera.heading;
    const onTick = () => {
      const t = Cesium.JulianDate.secondsDifference(clock.currentTime, clock.startTime);
      viewer.camera.setView({
        destination: center,
        orientation: { heading: initHeading + Cesium.Math.toRadians(t * degreesPerSecond), pitch },
      });
      viewer.camera.moveBackward(radius);
    };
    const removeOnTick = clock.onTick.addEventListener(onTick);

    const cleanup = () => {
      removeOnTick();
      Object.assign(clock, prev);
      roams.delete(cleanup);
    };
    roams.add(cleanup);
    return { id: 'orbit', stop: () => { cleanup(); return { ok: true as const, id: 'orbit' }; } };
  }

  /**
   * 限制相机俯仰范围（每帧 onTick 校正；只改朝向不挪位置）。
   * 上游示例在这里有个逗号表达式坑（`a, enableLook = false` 根本没赋值），照抄即踩。
   * @returns 句柄——stop() 摘除每帧校正
   */
  function limitPitch(opts: { minPitch?: number; maxPitch?: number } = {}): MotionHandle {
    const minPitch = opts.minPitch ?? -90;
    const maxPitch = opts.maxPitch ?? -10;
    if (!(minPitch < maxPitch)) {
      throw new Error(`[${KIT_NAME}] limitPitch() 需要 minPitch < maxPitch（单位度，俯视为负）。`);
    }
    const onTick = () => {
      const pitchDeg = Cesium.Math.toDegrees(viewer.camera.pitch);
      if (pitchDeg < minPitch || pitchDeg > maxPitch) {
        viewer.camera.setView({
          orientation: {
            heading: viewer.camera.heading,
            pitch: Cesium.Math.toRadians(Math.min(Math.max(pitchDeg, minPitch), maxPitch)),
            roll: viewer.camera.roll,
          },
        });
      }
    };
    const removeOnTick = viewer.clock.onTick.addEventListener(onTick);
    const cleanup = () => {
      removeOnTick();
      roams.delete(cleanup);
    };
    roams.add(cleanup);
    return { id: 'limitPitch', stop: () => { cleanup(); return { ok: true as const, id: 'limitPitch' }; } };
  }

  /**
   * 沿经纬度点列做匀速轨迹动画。
   *
   * 封装三个必踩的坑：shouldAnimate 置 true（不开整条时间轴静止）、
   * JulianDate 的 UTC 偏移补回北京时间、availability 覆盖整段时间（不覆盖则实体整段不可见）。
   *
   * @param points 路径点列表（≥2 个，按顺序匀速插值）
   * @param opts duration 每段 10 秒为默认；multiplier 倍速；loop 默认循环
   * @returns 句柄——stop() 摘实体并恢复接入前的时钟
   */
  function animatePath(points: MotionPoint[], opts: MotionOptions = {}): MotionHandle {
    if (!Array.isArray(points) || points.length < 2) {
      throw new Error(`[${KIT_NAME}] animatePath() 至少需要 2 个路径点 [{ lon, lat, height? }]。`);
    }
    const duration = opts.duration ?? 10 * (points.length - 1);
    if (!(duration > 0) || !Number.isFinite(duration)) {
      throw new Error(`[${KIT_NAME}] duration 必须是正数（秒）。`);
    }
    for (const p of points) {
      if (!Number.isFinite(p?.lon) || !Number.isFinite(p?.lat)) {
        throw new Error(`[${KIT_NAME}] 路径点缺 lon/lat 或不是数字: ${JSON.stringify(p)}`);
      }
    }

    // JulianDate.fromDate(new Date()) 按 UTC 解析，比北京时间慢 8 小时——默认补回
    const offset = opts.utcOffsetHours ?? 8;
    const start = Cesium.JulianDate.addHours(Cesium.JulianDate.fromDate(new Date()), offset, new Cesium.JulianDate());
    const stop = Cesium.JulianDate.addSeconds(start, duration, new Cesium.JulianDate());

    const clock = viewer.clock;
    const prev: ClockSnapshot = {
      startTime: clock.startTime,
      stopTime: clock.stopTime,
      currentTime: clock.currentTime,
      clockRange: clock.clockRange,
      multiplier: clock.multiplier,
      shouldAnimate: clock.shouldAnimate,
    };
    clock.startTime = start;
    clock.stopTime = stop;
    clock.currentTime = start;
    clock.clockRange = opts.loop === false ? Cesium.ClockRange.CLAMPED : Cesium.ClockRange.LOOP_STOP;
    clock.multiplier = opts.multiplier ?? 1;
    clock.shouldAnimate = true; // 不开则整条时间轴静止

    const prop = new Cesium.SampledPositionProperty();
    const n = points.length;
    points.forEach((p, i) => {
      const t = Cesium.JulianDate.addSeconds(start, (duration * i) / (n - 1), new Cesium.JulianDate());
      prop.addSample(t, Cesium.Cartesian3.fromDegrees(p.lon, p.lat, p.height ?? 0));
    });

    const entity = viewer.entities.add({
      availability: new Cesium.TimeIntervalCollection([new Cesium.TimeInterval({ start, stop })]),
      position: prop,
      orientation: opts.orientation === 'fixed' ? undefined : new Cesium.VelocityOrientationProperty(prop),
      path:
        opts.showPath === false
          ? undefined
          : { show: true, width: 2, material: Cesium.Color.CYAN, leadTime: 0, trailTime: duration },
    });

    const rec = { entity, prev };
    active.add(rec);
    return {
      id: entity.id,
      stop() {
        viewer.entities.remove(entity);
        Object.assign(clock, rec.prev);
        active.delete(rec);
        return { ok: true, id: entity.id };
      },
    };
  }

  /** 停掉全部动画/漫游并恢复时钟。 */
  function stopAll(): MotionStopResult {
    let n = 0;
    for (const rec of [...active]) {
      viewer.entities.remove(rec.entity);
      Object.assign(viewer.clock, rec.prev);
      active.delete(rec);
      n += 1;
    }
    for (const cleanup of [...roams]) {
      cleanup();
      n += 1;
    }
    return { ok: true, stopped: n };
  }

  return {
    KIT_NAME,
    animatePath,
    orbitAround,
    limitPitch,
    stopAll,
    dispose: stopAll,
  };
}

export default createMotionKit;
