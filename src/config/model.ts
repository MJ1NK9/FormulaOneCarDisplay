/**
 * 模型常量：文件地址、摆正与归一化参数。
 *
 * 为什么单独一层而不是塞进 scene.ts：
 * scene.ts 回答「怎么看法」（相机、灯光、控制器），这里回答「看的是什么」（模型本身）。
 * 以后换车模只动这个文件，相机参数和布光不用跟着改。
 */

/** 用 BASE_URL 拼路径：部署到子路径（如 GitHub Pages 的 /repo/）时也能正确取到文件 */
const BASE_URL = import.meta.env.BASE_URL;

export interface ModelConfig {
  /** GLB 地址。文件放在 public/models/ 下，构建时原样拷贝，不打进 JS 包 */
  readonly url: string;

  /**
   * 归一化后的最长边尺寸（场景单位）。
   * 统一成固定值后，相机距离、控制器 min/max 都可以写死，不必为每个模型重算。
   */
  readonly targetSize: number;

  /**
   * 各向异性过滤的上限。
   * 默认值 1 时，斜看轮胎这种曲面会强行取低 mip，出现锯齿感/闪烁；
   * 上限取 8：桌面 GPU 一般支持到 16，但 8 已经能消掉大部分闪烁，性能代价更小。
   */
  readonly maxAnisotropy: number;
}

/**
 * 当前用的是未压缩模型（35.8 MB，贴图全 PNG）。
 * 之前那版 10.5 MB 的 Draco + KTX2 压缩模型留在 .tools/rb22-compressed.glb，
 * 以后想换回去，需要重新接回 DRACOLoader / KTX2Loader 并把解码器放回 public/。
 */
export const MODEL_CONFIG: ModelConfig = {
  url: `${BASE_URL}models/rb22.glb`,
  targetSize: 4,
  maxAnisotropy: 8,
};
