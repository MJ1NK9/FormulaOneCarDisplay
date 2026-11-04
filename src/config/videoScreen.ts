/**
 * 车头前墙视频大屏 —— 媒体源、赛事信息与播控层参数。
 *
 * 屏幕本体（位置、尺寸、3D 控制台）在 `config/showroom.ts` 的 `videoWall` 里；
 * 这里只放「播什么、这块屏属于哪个比赛周末、投影层什么时候收起」。
 *
 * ───────────── 视频源 ─────────────
 *
 * 开发期读 `public/videos/Ver2024.mp4`，线上读 COS 上的同名文件
 * （地址解析见 `config/assets.ts`）；1280×720、H.264 + AAC、8:46。
 * 两种情况下都是浏览器直接解码的原生 <video>，不经过 <iframe>：
 *
 * - 直接操作 HTMLVideoElement，父页面能读写 `video.currentTime / paused / volume`，
 *   所以播放 / 暂停 / 拖动进度 / 音量都是「真实状态」；
 * - 文件体积 66 MB，首屏不下载：屏幕第一次进入相机视锥后由
 *   `core/props/videoWall.ts` 才开始拉流（见 `loadAfterVisibleSeconds`），
 *   默认机位背对前墙，所以不会和车模抢带宽；
 * - 线上是跨域请求：video 元素必须声明 `crossorigin="anonymous"`，COS 桶也必须
 *   配好 CORS，否则画面进不了 WebGL 贴图（texImage2D 会抛 SecurityError）；
 * - 来源：B 站 UP 主「一只萌萌哒chara」的《"Where is Max?"》
 *   （https://www.bilibili.com/video/BV1AJgP6GEPo/，原片 4K）；本项目只是转码成本地
 *   720p 文件用于非商业展示。视频版权归 UP 主与哔哩哔哩所有，本项目不声明任何权利，
 *   署名见页面左上角、「素材与授权」与「致谢」三处。
 *
 * ───────────── 赛事信息 ─────────────
 *
 * 这里不是「贴一段随便的标题」：完整的比赛周末数据（官方名称、轮次、赛道、
 * 冲刺赛周末的时间表、车手 / 车队 / 车号）都由下面这份配置驱动。换一站比赛
 * 只需要改 `event` 和 `driver` 两块，UI 不需要动。
 */
export interface VideoEventSession {
  /** 环节缩写，例如 FP1 / SPRINT / QUALI / RACE */
  readonly label: string;
  /** 当地时间，HH:mm */
  readonly time: string;
}

export interface VideoEventDay {
  /** 星期缩写，例如 FRI */
  readonly label: string;
  /** 日期，例如 01 NOV */
  readonly date: string;
  readonly sessions: readonly VideoEventSession[];
}

export interface VideoEventInfo {
  /** 赛事系列全称，显示在官方名称上方 */
  readonly series: string;
  /** 官方赛事名称（含冠名赞助商），这是整块屏的主标题 */
  readonly officialName: string;
  /** 不带冠名赞助商的展示名，车手信息条使用 */
  readonly displayName: string;
  /** 短名称，窄屏 / 小投影时使用 */
  readonly shortName: string;
  /** 分站轮次，例如 ROUND 21 */
  readonly round: string;
  /** 轮次数字，单独用于左侧大号车号块 */
  readonly roundNumber: string;
  /** 赛道官方名称 */
  readonly circuit: string;
  /** 城市 / 国家，用于第二行元信息 */
  readonly location: string;
  /** 比赛周末日期范围 */
  readonly dateRange: string;
  /** 正赛圈数 */
  readonly laps: string;
  /** 赛道长度 */
  readonly circuitLength: string;
  /** 弯道数量 */
  readonly corners: string;
  /** DRS 区域数量 */
  readonly drsZones: string;
  /** 赛道最快圈记录，只作为赛事信息展示 */
  readonly lapRecord: string;
  /** 当前播放内容的类型，例如 RACE REPLAY / SPRINT HIGHLIGHTS */
  readonly session: string;
  /** 转播信号来源，例如 F1 WORLD FEED */
  readonly broadcast: string;
  /** 比赛周末时间表：三行，正好铺满顶部 ticker */
  readonly weekend: readonly VideoEventDay[];
}

export interface VideoScreenConfig {
  /** 相对 `public/` 的视频路径，不带前导斜杠；换片时只改这里 */
  readonly src: string;
  /**
   * 加载 / 失败海报的底图（相对 `public/`，不带前导斜杠）。
   * 它来自同一条视频的封面，只作为屏幕还没出画时的暗化背景；
   * 图片 404 也不影响海报本身（海报主体是程序化 canvas）。
   */
  readonly posterUrl: string;
  /** 影片标题，显示在控制台的 NOW PLAYING 行 */
  readonly title: string;
  /** hover / 读屏用的补充说明 */
  readonly subtitle: string;
  /** 赛事信息：官方名称、轮次、周末时间表 */
  readonly event: VideoEventInfo;
  /**
   * 默认静音：浏览器对静音视频的自动播放限制最宽松，
   * 展示区也不该一进页面就出声。用户点音量键后才开声音。
   */
  readonly defaultMuted: boolean;
  /** 默认音量（0~1）：首次取消静音时恢复到这个音量 */
  readonly defaultVolume: number;
  /**
   * 默认自动播放：静音 + 本地文件，浏览器允许自动播放；
   * 屏幕出画后自动开始播，看起来才像一块真正在工作的转播屏。
   * 用户按过暂停之后，旋转视角离开再回来也不会强行续播。
   */
  readonly defaultPlaying: boolean;
  /** 是否循环：展示屏不循环会停在最后一帧，用户以为卡死 */
  readonly loop: boolean;
  /**
   * 元数据到达之前播控台显示的总时长（秒）。
   * 真实值以 `video.duration` 为准；526.35 来自当前文件的 ffprobe 读数。
   */
  readonly durationSeconds: number;
  /**
   * 屏幕连续可见多久才开始加载（秒）。
   * 快速甩镜头经过前墙时不会白拉 66 MB；0.25s 对「转过去看屏」几乎无感。
   */
  readonly loadAfterVisibleSeconds: number;
  /**
   * 加载停滞超时（秒）：多长时间没有新数据进来就回退静态海报。
   * 不是总时长超时——每次 progress 都会续期，66 MB 在慢网下也不会被误判。
   */
  readonly loadTimeoutSeconds: number;
  /** 加载态海报的重绘间隔（秒）：只在屏幕可见时生效，约 12fps */
  readonly posterRefreshSeconds: number;
  /** 播控层（DOM）的投影可见性阈值 */
  readonly overlay: VideoOverlayConfig;
}

/**
 * 播控层的收起条件。
 *
 * 播控层不是固定 HUD，而是每帧跟着 3D 屏幕 / 3D 控制台的投影四边形走。
 * 屏幕太偏、太远或斜得没法操作时整层收起，避免半截按钮悬在视口边缘。
 */
export interface VideoOverlayConfig {
  /** 屏幕投影底边短于这个值就收起屏幕上方的赛事图形 */
  readonly minScreenWidthPx: number;
  /** 屏幕投影高度低于这个值也收起（避免远处一条看不清的细线） */
  readonly minScreenHeightPx: number;
  /** 屏幕底边倾角超过这个角度（侧视）就收起屏幕图形 */
  readonly maxTiltDegrees: number;
  /** 控制台投影短于这个值就收起播控按钮 */
  readonly minConsoleWidthPx: number;
  /** 控制台投影高度低于这个值就收起（远处按钮太小，点不中） */
  readonly minConsoleHeightPx: number;
  /** 控制台是另一个平面，允许比屏幕多斜一点 */
  readonly maxConsoleTiltDegrees: number;
}

export const VIDEO_SCREEN_CONFIG: VideoScreenConfig = {
  src: 'videos/Ver2024.mp4',
  posterUrl: 'videos/sao-paulo-2024-cover.jpg',
  title: 'Where is Max?',
  subtitle: '2024 圣保罗大奖赛 · Verstappen 车载集锦',
  event: {
    series: 'FIA FORMULA ONE WORLD CHAMPIONSHIP',
    // 官方名称（含冠名赞助商）：F1 转播里这就是赛事标题行的标准写法
    officialName: 'LENOVO SÃO PAULO GRAND PRIX 2024',
    displayName: 'SÃO PAULO GRAND PRIX',
    shortName: 'SÃO PAULO GP',
    round: 'ROUND 21',
    roundNumber: '21',
    circuit: 'AUTÓDROMO JOSÉ CARLOS PACE',
    location: 'INTERLAGOS · SÃO PAULO, BRAZIL',
    dateRange: '01–03 NOV 2024',
    laps: '69',
    circuitLength: '4.309 KM',
    corners: '15',
    drsZones: '4',
    lapRecord: '1:10.540',
    session: 'RACE REPLAY',
    broadcast: 'F1 WORLD FEED',
    // 2024 圣保罗站是冲刺赛周末：周五排位冲刺、周六冲刺赛+排位、周日正赛
    weekend: [
      {
        label: 'FRI',
        date: '01 NOV',
        sessions: [
          { label: 'FP1', time: '15:30' },
          { label: 'SPRINT Q', time: '19:30' },
        ],
      },
      {
        label: 'SAT',
        date: '02 NOV',
        sessions: [
          { label: 'SPRINT', time: '15:00' },
          { label: 'QUALI', time: '19:00' },
        ],
      },
      {
        label: 'SUN',
        date: '03 NOV',
        sessions: [{ label: 'RACE', time: '14:00' }],
      },
    ],
  },
  defaultMuted: true,
  defaultVolume: 0.8,
  defaultPlaying: true,
  loop: true,
  durationSeconds: 526.35,
  loadAfterVisibleSeconds: 0.25,
  // 本地 66 MB 文件从磁盘 / 局域网读，30s 还没首帧基本就是文件缺失或解码失败
  loadTimeoutSeconds: 30,
  // 约 12fps：加载态只有扫描线和进度条，不需要 60fps 重画 2048×1024 的贴图
  posterRefreshSeconds: 1 / 12,
  overlay: {
    minScreenWidthPx: 340,
    minScreenHeightPx: 110,
    maxTiltDegrees: 42,
    minConsoleWidthPx: 300,
    // 竖屏观看模式为了装下整块 16:9 画面会退得比较远，控制台高度约 20px；
    // 阈值压到 16，播控条在手机上也保留，不会被误判成「太小」而整层收起。
    minConsoleHeightPx: 16,
    maxConsoleTiltDegrees: 48,
  },
};
