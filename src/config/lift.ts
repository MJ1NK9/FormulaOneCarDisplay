/**
 * 升降换模舞台的参数：升降台、升降井、双开滑动地板、时序。
 *
 * 和 config/showroom.ts 的分工：
 * - showroom 描述「房间陈设」：地面、展台、道具。升降口尺寸也在那里，
 *   因为地面开口和展台开口必须是同一组数字（写歪一点就会露出台阶或缝隙）；
 * - 本文件描述「换模机构」：只有切换画质时才会动起来的那部分。
 *
 * 「车辆切换中」全息提示是 DOM 层（ui/SwapHologram.vue）：只有屏幕空间锚定
 * 才能保证水平居中、不随相机透视歪斜、且永远压在闸口 / 地板上方。
 * 这里只留它的时序参数。
 *
 * 坐标约定：展台在原点、不旋转。升降台的原点是「台面顶面」，
 * 台面顶面 = 展台高度 + 台面板厚的一半（见 SHOWROOM_CONFIG.plinth）。
 */

/** 升降台：车模直接站在它上面 */
export interface LiftPlatformConfig {
  /** 台面（含面板 + 侧裙）的总厚度，从台面顶面往下算 */
  readonly thickness: number;
  /** 台面颜色：必须和展台 topColor 一致，升起后两处台面看不出材质断裂 */
  readonly topColor: string;
  readonly sideColor: string;
  /** 台沿灯条：切换动画时才会亮起来，静止时几乎看不见 */
  readonly edgeColor: string;
  readonly edgeIdleIntensity: number;
  readonly edgeActiveIntensity: number;
  /** 台面上的扫描光条颜色 */
  readonly scanColor: string;
}

/** 升降井：车降下去之后藏身的方井 */
export interface LiftShaftConfig {
  /** 从展台顶面往下的深度。必须大于 travel + 台面厚度，否则台面会穿出井底 */
  readonly depth: number;
  /** 井壁相对开口的外扩量：避免和展台内壁共面产生 z-fighting */
  readonly clearance: number;
  readonly wallColor: string;
  /** 井壁导光条：下降/升起时亮起，给「井有深度」一个参照 */
  readonly ribColor: string;
  readonly ribIdleIntensity: number;
  readonly ribActiveIntensity: number;
  readonly floorGlowColor: string;
}

/** 双开地板：两块从左右滑进台沿「口袋」、在中间合缝的地板 */
export interface LiftHatchConfig {
  readonly thickness: number;
  /**
   * 每扇门往侧面滑出的距离。
   * 开口半宽 0.9，展台左右台沿有 1.0：滑 0.94 后门板内边缘退到 0.94，
   * 完全让开井口（台面半宽 0.894），外边缘 1.84 仍在台面板（到 1.88）下面。
   */
  readonly slide: number;
  /** 合拢后门扇顶面相对展台顶面的下沉量，避免和台面板共面闪烁 */
  readonly topGap: number;
  /** 门扇顶面颜色：和展台台面同色，合拢后就是一块完整的地板 */
  readonly topColor: string;
  /** 中缝合拢时亮起的一条线，强调「闸口闭合」 */
  readonly seamColor: string;
  readonly edgeIdleIntensity: number;
  readonly edgeActiveIntensity: number;
}

/** 动画时序（秒）。全部集中在这里，调快慢不用翻逻辑代码 */
export interface LiftTimingConfig {
  readonly descendSeconds: number;
  readonly gateCloseSeconds: number;
  readonly gateOpenSeconds: number;
  readonly riseSeconds: number;
  /**
   * 下降行程走到这个比例（0~1）时「车辆切换中」全息淡入。
   * 0.5 = 车下到一半全息就出来，不等车辆完全到底。
   */
  readonly hologramShowAtProgress: number;
  readonly hologramFadeInSeconds: number;
  readonly hologramFadeOutSeconds: number;
  /** 全息从完全显示起的最短停留：资源再快也要让用户看清「切换中」 */
  readonly hologramMinSeconds: number;
  /**
   * 全息进度条的模拟参数。
   *
   * 进度不是「0→90 然后跳满」的两段式：真实下载进度是主驱动，时间保底曲线让
   * 真实进度不动时条子也一直在缓慢爬；两条曲线都持续增长，条子不会硬停在某个档位。
   * 加载完成的那一刻目标切到 100%，用同一套「越近越慢」的速度模型继续走，
   * 位置和速度都连续，不会有第二段动画的感觉。
   */
  readonly progress: {
    /** 加载完成前最多显示到多少（0~1）：100% 只留给真正加载完成之后 */
    readonly cap: number;
    /** 加载中的最高推进速度（每秒）：真实进度再快也不会一秒冲顶 */
    readonly loadingSpeed: number;
    /** 加载完成后的最高收尾速度（每秒） */
    readonly finishSpeed: number;
    /** 时间保底曲线的时间常数（秒）：真实进度长时间不动时条子按它慢慢爬 */
    readonly floorSeconds: number;
    /** 追赶时间常数（秒）：越大越柔、越小越紧跟目标 */
    readonly responseSeconds: number;
  };
  /** 「切换成功」完全出现后的留存时间 */
  readonly successHoldSeconds: number;
  /** 闸口完全让开后到台面起升之间的停顿：让「门开」和「车升」是两个节拍 */
  readonly riseDelaySeconds: number;
  readonly hotspotFadeOutSeconds: number;
  readonly hotspotFadeInSeconds: number;
}

export interface LiftConfig {
  /** 升降行程：台面从齐平位置往下走多少 */
  readonly travel: number;
  /** 开口四周的深色接缝贴条：盖住台面与展台之间的那道缝 */
  readonly seamRing: {
    readonly inner: number;
    readonly outer: number;
    readonly color: string;
    /** 贴条相对台面的抬升量，避免和台面共面闪烁 */
    readonly lift: number;
  };
  readonly platform: LiftPlatformConfig;
  readonly shaft: LiftShaftConfig;
  readonly hatch: LiftHatchConfig;
  readonly timing: LiftTimingConfig;
}

export const LIFT_CONFIG: LiftConfig = {
  // 2.3 的行程：台面落到 -2.19，车顶（0.89 高）在 -1.3 左右，
  // 完全低于地面，舱门合拢时看不到任何车身
  travel: 2.3,

  // 台面比开口小 0.012（单边 6mm），这条缝肉眼几乎不可见；
  // 再用一圈 0.05 宽的深色贴条压住缝和台面边缘，关灯后就是一道机加工接缝
  seamRing: {
    inner: 0.03,
    outer: 0.02,
    color: '#04060a',
    lift: 0.0012,
  },

  platform: {
    thickness: 0.14,
    topColor: '#16202c',
    sideColor: '#0a0f15',
    edgeColor: '#e10600',
    edgeIdleIntensity: 0.35,
    edgeActiveIntensity: 4.2,
    scanColor: '#63e9ff',
  },

  shaft: {
    // 井底 = 0.11 - 2.72 = -2.61；台面最低点 -2.19，下面还留 0.42 的余量
    depth: 2.72,
    // 0.07：井壁比开口退进一圈，台面（半宽 0.894）才有空间和导光条共存
    clearance: 0.07,
    wallColor: '#070b10',
    ribColor: '#3fd6f5',
    ribIdleIntensity: 0.12,
    ribActiveIntensity: 2.4,
    floorGlowColor: '#0e3444',
  },

  hatch: {
    thickness: 0.055,
    // 0.94：门板内边缘退到 0.94，让开台面（半宽 0.894）；外边缘 1.84 仍在台面板下
    slide: 0.94,
    topGap: 0.0008,
    topColor: '#16202c',
    seamColor: '#e10600',
    edgeIdleIntensity: 0.18,
    edgeActiveIntensity: 3.6,
  },

  timing: {
    // 下降 2.2s、合闸 1.4s、升起 2.4s：动作看得清，也不至于拖沓
    descendSeconds: 2.2,
    gateCloseSeconds: 1.4,
    gateOpenSeconds: 1.4,
    riseSeconds: 2.4,
    // 车下到一半全息就淡入，不等车辆完全到底
    hologramShowAtProgress: 0.5,
    hologramFadeInSeconds: 0.45,
    hologramFadeOutSeconds: 0.35,
    // 完全显示后至少停 2s：加载命中缓存时也要让「切换中」被看到
    hologramMinSeconds: 2,
    // 加载中最多显示到 96%，且推进速度有上限：不会一秒冲顶，也不会硬停在 90%
    progress: {
      cap: 0.96,
      loadingSpeed: 0.34,
      finishSpeed: 0.62,
      floorSeconds: 10,
      responseSeconds: 0.25,
    },
    successHoldSeconds: 1,
    // 门完全让开后停 0.16s：先看清井口，再由台面把车托上来
    riseDelaySeconds: 0.16,
    hotspotFadeOutSeconds: 0.26,
    hotspotFadeInSeconds: 0.42,
  },
};
