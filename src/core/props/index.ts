/**
 * 道具注册表：把配置里的 kind 映射到具体的构建函数。
 *
 * 为什么要这一层：
 * 新增一件道具只需要「写一个 builder + 注册表加一行 + 配置里加一行」，
 * Showroom 的组装逻辑完全不用改。
 */
import type { Object3D, Plane } from 'three';
import type { PropKind } from '../../config/showroom';
import { createPlinth } from './plinth';
import { createRaceWall } from './raceWall';
import { createTireWall } from './tireWall';
import { createToolCart } from './toolCart';
import { createToolWall } from './toolWall';
import { createTruss } from './truss';

/** 构建结果：几何 + 可选的每帧更新函数（大屏、计时这类会动的道具才需要） */
export interface BuiltProp {
  readonly object: Object3D;
  readonly update?: (elapsedSeconds: number) => void;
}

/** 道具共用的渲染上下文：目前只有「车底视角的地面裁剪面」需要往下传 */
export interface BuildContext {
  readonly floorClipPlane?: Plane;
}

export function buildProp(kind: PropKind, context: BuildContext = {}): BuiltProp {
  switch (kind) {
    case 'plinth':
      return { object: createPlinth(context.floorClipPlane) };
    case 'race-wall': {
      const wall = createRaceWall();
      return { object: wall.object, update: wall.update };
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
