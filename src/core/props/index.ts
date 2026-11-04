/**
 * 道具注册表：把配置里的 kind 映射到具体的构建函数。
 *
 * 为什么要这一层：
 * 新增一件道具只需要「写一个 builder + 注册表加一行 + 配置里加一行」，
 * Showroom 的组装逻辑完全不用改。
 */
import type { Object3D, PerspectiveCamera, Plane } from 'three';
import type { PropKind } from '../../config/showroom';
import { createPlinth } from './plinth';
import { createRaceWall } from './raceWall';
import { createTireWall } from './tireWall';
import { createToolCart } from './toolCart';
import { createToolWall } from './toolWall';
import { createTruss } from './truss';
import { createVideoWall, type VideoWallProp } from './videoWall';

/** 构建结果：几何 + 可选的每帧更新 / 额外释放（视频这类有生命周期的资源才需要） */
export interface BuiltProp {
  readonly object: Object3D;
  readonly update?: (elapsedSeconds: number, deltaSeconds: number) => void;
  readonly dispose?: () => void;
  /**
   * 前墙视频屏的控制器：Showroom 把它转交给 App，DOM 播控层靠它读播放状态、
   * 发播放 / 跳转 / 音量指令，并计算屏幕 / 控制台在视口里的投影四边形。
   */
  readonly videoWall?: VideoWallProp;
}

/** 道具共用的渲染上下文：地面裁剪面，以及视频屏投影要用的相机 */
export interface BuildContext {
  readonly floorClipPlane?: Plane;
  /** 前墙视频屏用它判断可见性 / 把屏幕四角投到视口；其他道具不使用 */
  readonly camera?: PerspectiveCamera;
}

export function buildProp(kind: PropKind, context: BuildContext = {}): BuiltProp {
  switch (kind) {
    case 'plinth':
      return { object: createPlinth(context.floorClipPlane) };
    case 'race-wall': {
      const wall = createRaceWall();
      return { object: wall.object, update: wall.update };
    }
    case 'video-wall': {
      const wall = createVideoWall(context.camera);
      return {
        object: wall.object,
        update: wall.update,
        dispose: wall.dispose,
        videoWall: wall,
      };
    }
    case 'truss':
      return { object: createTruss() };
    case 'tire-wall':
      return { object: createTireWall() };
    case 'tool-wall':
      return { object: createToolWall() };
    case 'tool-cart':
      return { object: createToolCart() };
    default: {
      // 联合类型已经穷尽，走到这里说明新增了 kind 却忘了加 case
      const exhaustive: never = kind;
      throw new Error(`未注册的道具类型: ${String(exhaustive)}`);
    }
  }
}
