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
   * 超采样倍数：实际渲染分辨率 = devicePixelRatio × renderScale，再被 maxPixelRatio 截断。
   * 1 = 不超采样。1x 屏上如果觉得轮胎、字标这类高频细节有锯齿，调到 1.5 会明显干净，
   * 代价是像素量按平方增长（1.5 倍 → 2.25 倍填充率）。
   */
  readonly renderScale: number;

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
   * 相机离注视点的最远距离。
   * 房间墙距原点 6.8，这里留 0.4 的余量：拉到最远也只是「贴到墙边」，
   * 不会再穿到房间外面去。为什么是 number：距离。
   */
  readonly maxDistance: number;

  /**
   * 旋转中心（鼠标拖拽时绕着转的那个点），与相机 lookAt 保持一致。
   * 为什么是 Vec3Tuple：坐标三元组。
   */
  readonly target: Vec3Tuple;

  /**
   * 极角限位（弧度，0 = 正上方，PI/2 = 水平）。
   * 上限 2.0（约 114°）越过水平线，镜头可以沉到地面以下从车底往上看；
   * 下沉时地板/展台会被 UNDERBODY_CLIP_CONFIG 自动裁掉，不会挡住车底。
   * 下限 1.05（约 60°）仍保留一点俯视余量，避免镜头贴到天花板。
   */
  readonly minPolarAngle: number;
  readonly maxPolarAngle: number;
}

/* ───────────────────── 相机自适应（模型接入后） ───────────────────── */

export interface CameraFitConfig {
  /**
   * 包围球半径 → 相机距离的留白系数。
   * 相机距离 = 半径 × padding / sin(fov/2)，padding=1 时球正好顶满画面，
   * 大于 1 才有呼吸空间；太小会显得车贴着画面边缘。
   */
  readonly padding: number;

  /** 最近距离 = 包围球半径 × 这个系数：防止滚轮推到车内部穿模 */
  readonly minDistanceRatio: number;

  /** 最远距离 = 包围球半径 × 这个系数：防止滚轮拉远到车变成一个小点 */
  readonly maxDistanceRatio: number;

  /**
   * 取景目标相对包围球中心的额外上移量。
   * 为什么需要：车只有 0.89 高，如果死盯着车心，画面会全给地板和展台，
   * 背墙和顶部结构全在画外。把注视点抬 0.45，车自然落到画面下半部，
   * 上面留出背墙和灯桁架——这是「展示间」和「产品特写」的区别。
   */
  readonly targetOffsetY: number;
}

export const CAMERA_FIT_CONFIG: CameraFitConfig = {
  // 0.88：比「刚好装下包围球」再收一点，车在画面里更有存在感；
  // 房间只有 13.6 见方，收太多车头车尾会顶到画面边缘
  padding: 0.88,
  // 1.1：允许再靠近一点看细节，同时不会穿进车身
  minDistanceRatio: 0.7,
  // 包围球半径约 2.14，×3.0 ≈ 6.4；墙在 6.8，镜头拉到最远也只贴到墙边
  maxDistanceRatio: 3.0,
  targetOffsetY: 0.45
};

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
   * 现在是 SpotLight（聚光灯），不再是平行光——这是「展示间」和「棚拍」的分水岭：
   * 平行光照亮整间屋子，聚光只照亮车所在的圆，四周自然压暗，画面才有舞台感。
   */
  readonly key: {
    /** 颜色：纯白，不偏色，让模型呈现它本身的颜色 */ readonly color: string;
    /**
     * 强度：200（坎德拉）。
     * three r155 之后灯光是物理单位，聚光强度的量级由「距离²」决定：
     * 8.3 米处的照度 ≈ 200 / 8.3² ≈ 2.9，和原来平行光的 2.8 大致等价。
     */
    readonly intensity: number;
    /** 位置：右上前方，从斜上方压下来，塑造立体感 */ readonly position: Vec3Tuple;
    /** 照射目标：车中心略上方 */ readonly target: Vec3Tuple;
    /** 光锥半角（弧度）：0.42 ≈ 24°，地面光斑半径约 3.7，刚好罩住车 */ readonly angle: number;
    /** 边缘羽化：0 是硬边舞台灯，1 完全柔和；0.7 保留一点光斑形状但不生硬 */ readonly penumbra: number;
    /** 衰减指数：2 是物理正确的平方反比 */ readonly decay: number;
    /** 照射距离上限：0 表示不限制 */ readonly distance: number;
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

  /**
   * 轮廓光（rim light）：从车后斜上方打过来的冷色光。
   * 作用是把车从深色墙背景里「剥」出来——没有它，深色车漆会和墙糊成一片。
   * 背墙变亮之后，这盏灯也要跟着加强，否则车的边缘会被背墙吃掉。
   */
  readonly rim: {
    readonly color: string;
    readonly intensity: number;
    readonly position: Vec3Tuple;
  };

  /** 环境贴图强度：车漆反射靠它，但调太高会把墙也一起照亮，光池就没了 */
  readonly environmentIntensity: number;

  /**
   * 实用光（practical）：模拟灯带自身溢出的光。
   * 灯带只是 emissive 面片，本身不照亮任何东西；不补这两盏点光，
   * 灯带在墙上就是两条「冷冷的色块」，而不是「发光体」。
   */
  readonly practical: readonly PracticalLightConfig[];
}

export interface PracticalLightConfig {
  readonly color: string;
  readonly intensity: number;
  readonly position: Vec3Tuple;
  /** 影响半径：再远就衰减到看不见，避免白白给整间屋子上色 */
  readonly distance: number;
}

/* ───────────────────────── 氛围与阴影 ───────────────────────── */

export interface AtmosphereConfig {
  /** 雾的起始距离：近处车身上不挂雾，只让墙和地坪远处淡出 */
  readonly fogNear: number;
  /** 雾的结束距离：超过它在视觉上完全融进背景色 */
  readonly fogFar: number;
}

export const ATMOSPHERE_CONFIG: AtmosphereConfig = {
  // 房间只有 13.6 见方，雾要往后推，不然四面墙会被雾洗成一片灰
  fogNear: 8,
  fogFar: 26
};

export interface ShadowConfig {
  /** 阴影贴图分辨率：2048 对一辆车足够，再高只是浪费显存 */
  readonly mapSize: number;
  readonly near: number;
  readonly far: number;
  /** 深度偏移，消除自阴影的条纹（shadow acne） */
  readonly bias: number;
  /** 沿法线方向再推一点，处理薄片（翼片、端板）的漏光 */
  readonly normalBias: number;
  /** PCF 采样半径（像素）：越大阴影越软，太大边缘会发虚 */
  readonly radius: number;
}

export const SHADOW_CONFIG: ShadowConfig = {
  mapSize: 2048,
  near: 1,
  // 聚光灯在 7.4 高、目标在 0.6，深度范围 25 足够覆盖车、展台和工具
  far: 25,
  bias: -0.0004,
  normalBias: 0.02,
  radius: 3
};

/* ───────────────────── 车底视角裁剪 ───────────────────── */

export interface UnderbodyClipConfig {
  /**
   * 裁剪面相对相机高度留的余量（场景单位）。
   * 相机低于地面时，用一个「跟随相机高度」的水平裁剪面把地板、展台切掉，
   * 否则从下往上看车底时，地面/底座会横在镜头和车之间。
   * 留 0.02 是为了不把正踩在地面上的那一帧也切掉。
   */
  readonly margin: number;
}

export const UNDERBODY_CLIP_CONFIG: UnderbodyClipConfig = {
  margin: 0.02
};

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
  // 45°：房间封顶之后需要比 40° 更广一点，四面墙和天花板才进得来
  fov: 45,
  near: 0.1,
  far: 100,
  position: [5.2, 2.6, 7.2],
  lookAt: [0, 0, 0]
};

export const RENDERER_CONFIG: RendererConfig = {
  antialias: true,
  maxPixelRatio: 2,
  renderScale: 1,
  clearColor: "#0b0d10",
  toneMappingExposure: 1.05
};

export const CONTROLS_CONFIG: ControlsConfig = {
  enableDamping: true,
  dampingFactor: 0.05,
  minDistance: 2.4,
  // 墙在 6.8，相机最远 6.4，刚好停在墙边、不会穿出去
  maxDistance: 6.4,
  target: [0, 0.55, 0],
  minPolarAngle: 1.05,
  // 2.0 rad ≈ 114.6°：越过水平线，配合地面裁剪可以钻到车底看底盘
  maxPolarAngle: 2.0
};

/**
 * 布光：半球光打底 + 主光造型 + 冷色补光提轮廓。
 * 车漆/碳纤维的反射主要来自 SceneManager 里生成的 RoomEnvironment 环境贴图，
 * 这三盏灯负责明暗关系与轮廓，不替代环境贴图。
 */
export const LIGHT_CONFIG: LightConfig = {
  hemisphere: {
    skyColor: "#bfd6ff",
    // 地面换成白色环氧地坪后，地面反弹回来的光不再是深灰：
    // 这层偏暖的亮灰同时负责把车底/暗部托起来，白地板才不会「只亮地面不亮车」
    groundColor: "#8a8880",
    // 0.40：比旧地板时期略高，但仍是「柔和打底」，不抢主光
    intensity: 0.4
  },
  key: {
    color: "#ffffff",
    // 灯从 y=4.6 打下来（天花板 5.2，必须在室内），到车约 5.7 米：95/32.7 ≈ 2.9
    intensity: 95,
    // 略微偏左前方：和机位保持约 25° 夹角，车正面有明暗，又不会把可见面压成黑的
    position: [0.8, 4.6, 4.0],
    target: [0, 0.6, 0],
    angle: 0.46,
    penumbra: 0.7,
    decay: 2,
    distance: 0
  },
  fill: {
    color: "#7aa2ff",
    intensity: 0.45,
    position: [-6, 3, -4]
  },
  rim: {
    color: "#8fb0ff",
    intensity: 2.4,
    position: [5, 6, -8]
  },
  environmentIntensity: 0.75,
  practical: [
    // 左墙灯带的溢光：照亮轮胎墙和地坪左半边
    { color: "#cfe3ff", intensity: 6, position: [-5.6, 2.2, -3], distance: 7 },
    // 右前工具墙一侧：离墙远一点、抬高一点，避免在穿孔板上打出一个死白的光斑
    { color: "#cfe3ff", intensity: 4.5, position: [4.9, 2.6, -1], distance: 8 }
  ]
};
