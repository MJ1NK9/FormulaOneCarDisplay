/**
 * 场景常量：相机、渲染器、灯光、OrbitControls 的全部参数。
 *
 * 为什么单独抽这一层：约定 §6 要求逻辑代码里不出现魔法数字，
 * 调参（换相机距离、改光比、改阻尼）应该只改这一个文件。
 *
 * ───────────── 读这个文件前，先记住 3 个 TS 概念 ─────────────
 *
 * 1) interface（接口）= 「形状合同」
 *    它只规定"一个对象应该长什么样"：有哪些字段、每个字段什么类型。
 *    它编译后会被完全擦除，运行时不存在，所以不占体积、不影响性能。
 *
 * 2) readonly = 「只读」
 *    加了它，这个字段赋值后就不能再改：CAMERA_CONFIG.fov = 60 会直接报错。
 *    配置常量本来就该锁死，谁改谁负责——把"不许改"交给编译器管，比靠自觉可靠。
 *
 * 3) 元组 [number, number, number] = 「定长 3 个数字的数组」
 *    如果写 number[]，编译器只知道"是数字数组"，不知道长度；
 *    写成元组后它知道"恰好 3 个"，于是 Vector3.set(...tuple) 这种展开传参才能通过类型检查。
 */

/* ───────────────────────── 相机 ───────────────────────── */

/** 世界坐标三元组（x, y, z），单位是 three 的"场景单位"，不是米也不是像素 */
export type Vec3Tuple = readonly [x: number, y: number, z: number];

export interface CameraConfig {
  /**
   * 垂直视野角度（fov = field of view），单位：度。
   * 数值越大 = 看得越广（广角，近处会被拉变形）；越小 = 越像长焦压缩。
   * 45 度接近人眼自然观感，也是三维展示最常用的中性值。
   * 为什么是 number：角度的大小本身就是一个数字，不需要特殊类型，单位写在注释里。
   */
  readonly fov: number;

  /**
   * 近裁剪面：离相机比这个距离更近的东西直接不渲染。
   * 0.1 意味着"贴到镜头前 0.1 个单位的东西会被切掉"。
   * 为什么是 number：距离，数字。
   * 注意：near 不能设得过小（如 0.001），否则远处会出现深度冲突（z-fighting，表面闪烁）。
   */
  readonly near: number;

  /**
   * 远裁剪面：比这个距离更远的物体不渲染，也是性能兜底。
   * 100 对一个边长约 4 单位的车模来说绰绰有余。
   * 为什么是 number：距离，数字。
   */
  readonly far: number;

  /**
   * 相机初始位置（世界坐标）。
   * [6, 4, 8] = 站在模型右前上方，斜 45° 往下看，这个角度能同时看到车头、车顶和侧面。
   * Phase 2 接入真实模型后，会按模型包围盒尺寸自动算出更好的距离并覆盖这里。
   * 为什么是 Vec3Tuple：三点定位必须成组出现，拆成三个变量容易错位。
   */
  readonly position: Vec3Tuple;

  /**
   * 相机看向的点（注视点），必须和下面 CONTROLS_CONFIG.target 一致。
   * 两者不一致时，首帧画面会"歪一下"再被 OrbitControls 纠正。
   * 为什么是 Vec3Tuple：同 position，坐标是三元组。
   */
  readonly lookAt: Vec3Tuple;
}

/* ───────────────────────── 渲染器 ───────────────────────── */

export interface RendererConfig {
  /**
   * 抗锯齿开关。开启后物体边缘不会出现" staircase（楼梯状）"锯齿。
   * 为什么是 boolean：它只有"开/关"两种状态，用 true/false 表达最直接。
   * 代价：显存和性能略微增加，但对这种单模型场景完全值得。
   */
  readonly antialias: boolean;

  /**
   * 设备像素比上限。实际使用 Math.min(devicePixelRatio, 这个值)。
   * 为什么是 number：它是个倍数（如 2 倍像素）。
   * 为什么要设上限：4K 屏上 devicePixelRatio 可能是 3 甚至 4，
   * 渲染像素数量是面积级增长（3 倍宽 × 3 倍高 = 9 倍工作量），性能会塌。
   */
  readonly maxPixelRatio: number;

  /**
   * 画布清屏色（十六进制 CSS 颜色字符串，如 '#0b0d10'）。
   * 用近黑色而不是纯黑，是因为纯黑看起来发灰、没有层次。
   * 为什么是 string 而不是 number：three 的 new Color('#0b0d10') 能直接解析
   * CSS 颜色写法；而写成 number（0x0b0d10）可读性差很多，改色也不方便。
   */
  readonly clearColor: string;

  /**
   * 色调映射曝光度。1 = 基准亮度，小于 1 变暗，大于 1 变亮。
   * 配合 SceneManager 里的 ACESFilmic 色调映射使用，避免高光过曝成一片白。
   * 为什么是 number：亮度倍率，数字。
   */
  readonly toneMappingExposure: number;
}

/* ──────────────── 相机控制器（OrbitControls） ──────────────── */

export interface ControlsConfig {
  /**
   * 惯性阻尼开关。开启后松开鼠标，相机会"滑行"一小段再停，手感更自然。
   * 为什么是 boolean：开 / 关。
   * 副作用：开启后必须每帧调用 controls.update()，否则松手不会衰减——
   * 这也是 SceneManager 渲染循环里那行 update() 存在的原因。
   */
  readonly enableDamping: boolean;

  /**
   * 阻尼系数（0~1）。越小越"滑"、停得越慢；越大越"紧"、停得越快。
   * 0.05 是社区常用值：足够顺滑，又不会让人觉得失控。
   * 为什么是 number：它是个 0~1 的比率。
   */
  readonly dampingFactor: number;

  /**
   * 相机离注视点的最近距离。小于它就不让再靠近，防止相机穿进模型内部（穿模）。
   * 3 这个值是按"模型归一化后约 4 个单位长"估的，Phase 2 会随模型尺寸调整。
   * 为什么是 number：距离。
   */
  readonly minDistance: number;

  /**
   * 相机离注视点的最远距离。防止用户滚轮缩得太远，模型变成一个小点。
   * 为什么是 number：距离。
   */
  readonly maxDistance: number;

  /**
   * 旋转中心（鼠标拖拽时绕着转的那个点），与相机 lookAt 保持一致。
   * 为什么是 Vec3Tuple：坐标三元组。
   */
  readonly target: Vec3Tuple;
}

/* ───────────────────────── 灯光 ───────────────────────── */

export interface LightConfig {
  /**
   * 半球光：模拟"天光 + 地面反射"的环境光。
   * 它没有位置，只看物体法线朝向——朝上的一面染天空色，朝下的一面染地面色。
   * 作用：给暗部补一层环境色，避免背光面死黑。
   */
  readonly hemisphere: {
    /** 天空颜色：偏冷蓝，模拟户外的天光 */ readonly skyColor: string;
    /** 地面颜色：深灰，代表地面反弹回来的弱光 */ readonly groundColor: string;
    /** 强度：1.2 是"柔和打底"的量级 */ readonly intensity: number;
  };

  /**
   * 主光（key light）：负责造型，决定明暗交界线在哪，是全场景最重要的一盏。
   * 相当于摄影棚里的主灯。
   */
  readonly key: {
    /** 颜色：纯白，不偏色，让模型呈现它本身的颜色 */ readonly color: string;
    /**
     * 强度：2.6。
     * 注意 three r155 之后灯光改用物理正确单位，强度不再是 0~1 的"比例"，
     * 所以看到 2.6 这种大于 1 的值是正常的，不要以为写错了。
     */
    readonly intensity: number;
    /** 位置：右上前方，从斜上方压下来，塑造立体感 */ readonly position: Vec3Tuple;
  };

  /**
   * 补光（fill light）：放在主光的反侧，把主光照不到的暗面提亮一点，
   * 避免暗部糊成一团。强度明显低于主光，否则会抵消造型感。
   */
  readonly fill: {
    /** 颜色：冷蓝，和主光的白形成冷暖对比，画面更有层次 */ readonly color: string;
    /** 强度：0.8，只做辅助，抢戏就错了 */ readonly intensity: number;
    /** 位置：左后下方，与主光大致相对 */ readonly position: Vec3Tuple;
  };
}

/* ───────────────────────── 实际取值 ───────────────────────── */

/**
 * 注意这三处写法：`export const CAMERA_CONFIG: CameraConfig = {...}`
 * 等号左边的 `: CameraConfig` 是「类型标注」，它带来两个好处：
 *
 *   1. 少写字段 / 拼错字段名 → 编译期立刻报错，而不是运行时莫名不生效
 *      （比如把 dampingFactor 拼成 dampingfactor，TS 会说"对象字面量只能指定已知属性"）
 *   2. 编辑器里写 `CAMERA_CONFIG.` 会有自动补全
 *
 * 为什么不用 `as const`（另一种写法）：
 *   `as const` 会把 45 推断成"字面量类型 45"，而不是 number，
 *   以后想让 fov 支持"由代码计算出来"就会处处别扭。这里用 interface 更合适。
 */

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
