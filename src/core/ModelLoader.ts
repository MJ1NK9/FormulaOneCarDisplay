/**
 * ModelLoader —— 车模加载与「摆正」的唯一入口。
 *
 * 职责：
 * 1. 用 GLTFLoader 加载 GLB（当前用的是未压缩模型：贴图 PNG，没有 Draco/KTX2）
 * 2. 给贴图开各向异性过滤（轮胎、字标这类斜看细节靠它压锯齿）
 * 3. 按包围盒居中、归一化，让相机参数不依赖模型原始比例
 *
 * 不做的事：不创建 Scene / Camera，不碰 DOM，也不知道进度条长什么样——
 * 进度通过回调交给上层（App.vue → LoadingBar），这里只负责把数字抛出去。
 *
 * 注意：如果以后换回压缩模型（Draco 几何 / KTX2 贴图），需要重新接上
 * DRACOLoader + KTX2Loader，并把解码器文件放进 public/。
 */
import { Box3, Group, Mesh, Texture, Vector3, type Material, type WebGLRenderer } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MODEL_CONFIG } from '../config/model';

/**
 * 给材质上的所有贴图打开各向异性过滤。
 *
 * 为什么需要：贴图与视线夹角越大（轮胎侧壁、地坪），一个像素覆盖的纹素就越多。
 * anisotropy = 1 时 GPU 只能选一个 mip 层，斜看就会出现锯齿和闪烁；
 * 开大以后沿视线方向多采几组样，远处斜看会干净很多。
 */
function applyAnisotropy(material: Material, anisotropy: number): void {
  const record = material as unknown as Record<string, unknown>;
  for (const value of Object.values(record)) {
    if (value instanceof Texture) value.anisotropy = anisotropy;
  }
}

/** 下载进度。total 为 0 时说明响应没有 Content-Length，算不出百分比 */
export interface LoadProgress {
  readonly loaded: number;
  readonly total: number;
  /** 0~1 的比例；无法计算时为 0，UI 据此切换成「不确定进度」的动画 */
  readonly ratio: number;
}

export interface LoadedModel {
  /** 已摆正、居中、缩放好的容器对象，直接 scene.add() 即可 */
  readonly object: Group;
  /** 归一化之后的包围盒尺寸（场景单位），可用于日志或调试 */
  readonly size: Vector3;
}

export class ModelLoader {
  private readonly gltfLoader = new GLTFLoader();
  private readonly maxAnisotropy: number;

  /** @param renderer 用来查这张显卡支持的最大各向异性倍数 */
  constructor(renderer: WebGLRenderer) {
    // 不同显卡支持的上限不同（常见 16），再和自己的预算取小值
    this.maxAnisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), MODEL_CONFIG.maxAnisotropy);
  }

  /**
   * 加载并摆正模型。
   *
   * 坐标系转换放在最前面，因为包围盒必须在「已摆正」的坐标里量，
   * 否则量到的长宽高还是 Z-up 下的轴序，归一化会把车「竖起来」算。
   */
  async load(onProgress: (progress: LoadProgress) => void): Promise<LoadedModel> {
    const gltf = await this.gltfLoader.loadAsync(MODEL_CONFIG.url, (event) => {
      const total = event.total;
      const loaded = event.loaded;
      onProgress({
        loaded,
        total,
        ratio: total > 0 ? Math.min(loaded / total, 1) : 0,
      });
    });

    // 这份 GLB 的根节点自带 +90° X 旋转（导出时就做过 Z-up → Y-up），
    // 所以这里不再补坐标轴旋转，只做「居中 + 归一化」两件事。
    const model = gltf.scene;

    // 车身投到地坪上的影子是「贴地感」的一半，receiveShadow 留给地面就行，
    // 车身自阴影容易出条纹，这里不开
    model.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      object.castShadow = true;

      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        applyAnisotropy(material, this.maxAnisotropy);
      }
    });

    // holder 负责统一缩放；模型自己只负责平移，两件事分开，互不干扰
    const holder = new Group();
    holder.name = 'rb22';
    holder.add(model);

    const box = new Box3().setFromObject(holder);
    const size = box.getSize(new Vector3());
    const center = box.getCenter(new Vector3());

    // 只居中 X/Z，Y 不动：这个模型导出时就是「底面贴地」，一旦把 Y 也对到原点，
    // 半辆车会陷进地坪里，轮胎只剩上半截，看起来像悬空。
    // position 写在 model 上、缩放写在 holder 上：先平移后缩放，最终底面仍然贴地。
    model.position.set(-center.x, 0, -center.z);

    const longestSide = Math.max(size.x, size.y, size.z);
    const scale = MODEL_CONFIG.targetSize / longestSide;
    holder.scale.setScalar(scale);

    return { object: holder, size: size.clone().multiplyScalar(scale) };
  }
}
