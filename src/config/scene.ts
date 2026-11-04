/**
 * 场景常量：相机、渲染器、灯光、OrbitControls 的全部参数。
 *
 * 为什么单独抽这一层：约定 §6 要求逻辑代码里不出现魔法数字，
 * 调参（换相机距离、改光比、改阻尼）应该只改这一个文件。
 */

/** 世界坐标三元组，用于避免把裸数组散落在各处 */
export type Vec3Tuple = readonly [x: number, y: number, z: number];

export interface CameraConfig {
  readonly fov: number;
  readonly near: number;
  readonly far: number;
  /** 相机初始位置；Phase 2 接入真实模型后会由包围盒尺寸自动计算覆盖 */
  readonly position: Vec3Tuple;
  /** 相机初始注视点；与 controls.target 保持一致 */
  readonly lookAt: Vec3Tuple;
}

export interface RendererConfig {
  readonly antialias: boolean;
  /** §7：像素比上限，避免 4K/高分屏上片元着色开销翻倍 */
  readonly maxPixelRatio: number;
  /** 画布清屏色，与 body 背景保持一致，避免加载期闪白 */
  readonly clearColor: string;
  readonly toneMappingExposure: number;
}

export interface ControlsConfig {
  readonly enableDamping: boolean;
  readonly dampingFactor: number;
  /** 近/远距离限制，防止相机穿进模型内部或缩到看不见 */
  readonly minDistance: number;
  readonly maxDistance: number;
  readonly target: Vec3Tuple;
}

export interface LightConfig {
  readonly hemisphere: {
    readonly skyColor: string;
    readonly groundColor: string;
    readonly intensity: number;
  };
  readonly key: {
    readonly color: string;
    readonly intensity: number;
    readonly position: Vec3Tuple;
  };
  readonly fill: {
    readonly color: string;
    readonly intensity: number;
    readonly position: Vec3Tuple;
  };
}

export const CAMERA_CONFIG: CameraConfig = {
  fov: 45,
  near: 0.1,
  far: 100,
  position: [6, 4, 8],
  lookAt: [0, 0, 0],
};

export const RENDERER_CONFIG: RendererConfig = {
  antialias: true,
  maxPixelRatio: 2,
  clearColor: '#0b0d10',
  toneMappingExposure: 1,
};

export const CONTROLS_CONFIG: ControlsConfig = {
  enableDamping: true,
  dampingFactor: 0.05,
  minDistance: 3,
  maxDistance: 20,
  target: [0, 0, 0],
};

/**
 * Phase 1 的临时布光：一个半球光打底 + 主光造型 + 冷色补光提轮廓。
 * Phase 2 会换成环境贴图（HDRI）以达到车漆质感，届时这组常量会整体重写。
 */
export const LIGHT_CONFIG: LightConfig = {
  hemisphere: {
    skyColor: '#bfd6ff',
    groundColor: '#2a2a2a',
    intensity: 1.2,
  },
  key: {
    color: '#ffffff',
    intensity: 2.6,
    position: [5, 8, 6],
  },
  fill: {
    color: '#7aa2ff',
    intensity: 0.8,
    position: [-6, 3, -4],
  },
};
