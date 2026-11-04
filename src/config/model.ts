/**
 * 模型常量：文件地址、摆正与归一化参数、画质档位。
 *
 * 为什么单独一层而不是塞进 scene.ts：
 * scene.ts 回答「怎么看法」（相机、灯光、控制器），这里回答「看的是什么」（模型本身）。
 * 以后换车模只动这个文件，相机参数和布光不用跟着改。
 */

/** 用 BASE_URL 拼路径：部署到子路径（如 GitHub Pages 的 /repo/）时也能正确取到文件 */
const BASE_URL = import.meta.env.BASE_URL;

/**
 * 画质档位。
 *
 * high：原始车模，贴图全 PNG（含三张 4096、两张 2048），36 MB。
 * lite：glTF Transform 重新导出的一版 —— 贴图压到 2048 的 WebP、几何量化为
 *       i16/i8、网格按误差容限简化到 62%，6.6 MB。
 *
 * 为什么 lite 不用 Draco + KTX2：那条路要带 1.3 MB 解码器，而且在没有硬件压缩纹理
 * 支持的设备上得靠 wasm 现场转码——实测软件渲染环境里 4096 的 ETC1S 转了一百秒还没转完，
 * 主线程全程卡死。WebP + KHR_mesh_quantization 是浏览器原生能力，零解码器、零转码。
 *
 * 两档来自同一个源模型，包围盒一致（实测差值 < 0.0001），
 * 所以热点坐标与相机取景可以共用，不需要各写一套。
 */
export type ModelQuality = 'high' | 'lite';

export interface ModelVariant {
  /** GLB 地址。文件放在 public/models/ 下，构建时原样拷贝，不打进 JS 包 */
  readonly url: string;
  /** 界面上显示的档位名 */
  readonly label: string;
  /** 文件体积（字节），用于在切换控件上标注下载量 */
  readonly bytes: number;
}

export const MODEL_VARIANTS: Record<ModelQuality, ModelVariant> = {
  high: {
    url: `${BASE_URL}models/rb22.glb`,
    label: '高精度',
    bytes: 37_516_152,
  },
  lite: {
    url: `${BASE_URL}models/rb22-lite.glb`,
    label: '低精度',
    bytes: 6_638_688,
  },
};

/**
 * 切换控件的排列顺序：低精度在前，和「进入页面默认低精度」保持一致，
 * 用户一眼就能看出当前停在哪一档。
 */
export const MODEL_QUALITIES: readonly ModelQuality[] = ['lite', 'high'];

export interface ModelConfig {
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

export const MODEL_CONFIG: ModelConfig = {
  targetSize: 4,
  maxAnisotropy: 8,
};
