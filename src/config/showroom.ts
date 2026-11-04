/**
 * 「车队工房展示间」的空间与道具参数 —— 唯一数据源。
 *
 * 和旧的 garage.ts 的区别：
 * 1. 以前只有地坪 / 墙 / 灯带 / 几个道具，位置散落在代码里；
 * 2. 现在把「房间」和「每一件道具」都写成带 position / rotationY 的配置块，
 *    渲染代码只负责按配置搭几何，挪道具 = 改这里的数字。
 *
 * 布局约定（详见 docs/showroom-plan.md）：
 * - 车长轴 = Z，车头朝 +Z，原点在车中心正下方；
 * - 四面墙围成 13.6 × 13.6 的封闭房间（墙距原点 6.8），360° 环绕也不会看到「墙外」；
 * - 默认机位在右前方，所以 +X / +Z 象限保持空旷，立体道具全部贴墙；
 *   工具车收在后墙右下角（+X / -Z 角落），不挡默认视线的车。
 */
import type { Vec3Tuple } from './scene';
import { RACE_REPLAY_CONFIG } from './raceReplay';

/** 一件道具的摆放：位置 + 绕 Y 轴旋转（弧度） */
export interface PropPlacement {
  readonly position: Vec3Tuple;
  readonly rotationY: number;
}

/** 升降口尺寸（场景单位） */
export interface LiftOpening {
  readonly width: number;
  readonly depth: number;
}

/**
 * 升降口的唯一数据源：地坪开口和展台开口必须完全一致。
 *
 * 两处各写一份数字是这块最容易出的 bug——地面挖 1.8、展台挖 1.7，
 * 边缘就会露出一条能看进井里的缝；反过来则地面和展台互相穿插。
 *
 * 1.8 宽是「刚好能过车」的宽度：车宽 1.41，单边留 0.195。
 * 再宽，两扇地板的门板就要跟着变宽，展台得整体加宽才能开出同样宽的侧向口袋。
 */
export const LIFT_OPENING: LiftOpening = {
  width: 1.8,
  depth: 5.0,
};

/** 房间本体：地坪、墙、灯带、配色 */
export interface RoomConfig {
  readonly floor: {
    readonly size: number;
    readonly color: string;
    readonly roughness: number;
    readonly metalness: number;
    readonly envMapIntensity: number;
    /** 升降口在地坪上挖出的矩形开口（展台正下方） */
    readonly opening: LiftOpening;
    readonly texture: {
      readonly size: number;
      readonly repeat: number;
      /** 大块极淡的斑驳数量：环氧地坪在灯下不会是一块死板的纯色 */
      readonly mottleCount: number;
      /** 细颗粒数量：远看是均匀的浅灰，近看才有水泥/环氧的颗粒感 */
      readonly noiseDots: number;
    };
  };
  readonly walls: {
    readonly color: string;
    /** 墙宽 = 房间边长；四面墙在这条边上闭合 */
    readonly width: number;
    readonly height: number;
    /** 墙到原点的距离（房间半边长） */
    readonly distance: number;
    /** 墙脚踢脚线：一条深色窄带，能让墙和地坪「接住」，不然像两个面片插在一起 */
    readonly skirtingHeight: number;
    readonly skirtingColor: string;
  };
  /** 天花板：封顶之后相机往上抬也看不到「虚空」，房间才成立 */
  readonly ceiling: {
    readonly color: string;
    readonly height: number;
    readonly stripColor: string;
    readonly stripIntensity: number;
  };
  readonly led: {
    readonly color: string;
    readonly thickness: number;
    readonly intensity: number;
  };
  readonly accent: {
    readonly red: string;
    readonly yellow: string;
  };
}

/** 发光展台：整个构图的底座，车的阴影落在它上面 */
export interface PlinthConfig extends PropPlacement {
  readonly width: number;
  readonly depth: number;
  readonly height: number;
  /**
   * 台面开口：升降台从这里穿过。必须和 LIFT_OPENING 一致。
   * 展台因此不再是实心块，而是「四边围出开口」的框架。
   */
  readonly openingWidth: number;
  readonly openingDepth: number;
  /** 台面板厚：台面顶面 = height + topPlateThickness / 2 */
  readonly topPlateThickness: number;
  readonly color: string;
  readonly topColor: string;
  readonly edgeColor: string;
  readonly edgeIntensity: number;
}

/** 左右副屏：主屏两翼的辅助遥测屏，与主屏共用一条垂直中轴 */
export interface SideScreenConfig {
  readonly width: number;
  readonly height: number;
  /** 副屏与主屏屏幕边缘之间的水平净距 */
  readonly gap: number;
  /** 刷新间隔（秒）：副屏是实时遥测，比主屏刷新快一档 */
  readonly refreshSeconds: number;
  /** 上电延迟（秒）：主屏先亮，左右副屏再一起跟上，形成中心向外的层级 */
  readonly bootDelaySeconds: number;
}

/** 后墙三屏：中间是主视觉大屏，左右各一块辅助遥测屏 */
export interface RaceWallConfig extends PropPlacement {
  readonly width: number;
  readonly height: number;
  readonly frameColor: string;
  /** 屏幕相对背板往前凸出的距离，避免 z-fighting */
  readonly screenOffset: number;
  /**
   * 刷新间隔（秒）。
   * 回放每 1.5s 推进一圈，需要约 10 帧/圈才不显得跳格；
   * 具体值由 `RACE_REPLAY_CONFIG.screenRefreshSeconds` 统一给出。
   */
  readonly refreshSeconds: number;
  /** 主屏上电扫描时长（秒）：三块屏共用，保证出现方式统一 */
  readonly bootSeconds: number;
  readonly side: SideScreenConfig;
}

/**
 * 车头前墙视频大屏（+Z 墙面）：8.18 × 4.6，16:9 原生画幅。
 *
 * 需求是「视频铺满前墙、画面不被裁切」：前墙虽然是 13.6 × 5.2，
 * 但 16:9 视频若按墙宽铺满，必须裁掉约 32% 的上下画面；若按墙高铺满，
 * 左右又会各空出 2.18。这里选择保画面：屏幕按 16:9 取到前墙能容纳的
 * 最大高度，底边压住控制台、顶边接近墙顶，左右留出的深色墙面与机房背景
 * 融为一体；`观看视频` 模式再把相机推进到正对屏幕中心，整块画面占满视口。
 *
 * 屏幕贴墙安装，位于车、升降台、闸口和 DOM 全息层之后，不参与遮挡判断。
 * 屏幕下方是一块真实的 3D 控制台（不是悬浮 DOM），它的面板由
 * `ui/VideoScreen.vue` 按投影四边形逐帧贴上去，播放 / 进度 / 音量都在
 * 这块「装进墙里的控制台」上。未放文件 / 解码失败时由
 * `core/props/videoWall.ts` 回退静态海报，不阻塞车模加载和其他动画。
 */
export interface VideoWallConfig extends PropPlacement {
  readonly width: number;
  readonly height: number;
  /** 屏幕相对安装板往前凸出的距离，避免和墙面 z-fighting */
  readonly screenOffset: number;
  /** 屏幕下沿那块物理控制台的高度（场景单位） */
  readonly consoleHeight: number;
  /** 控制台向房间内凸出的深度；面板所在的前表面也用它算投影 */
  readonly consoleDepth: number;
  /** 控制台上沿压进屏幕底边的距离，避免出现一条缝像悬空 */
  readonly consoleOverlap: number;
  /** 控制台外壳颜色（比纯黑亮一档，侧边才看得出结构） */
  readonly consoleColor: string;
  /** 控制台端盖 / 侧板的金属色 */
  readonly consoleEndCapColor: string;
  /** 屏幕边框和台沿的 F1 红装饰线 */
  readonly accentColor: string;
}

/** 顶部灯桁架：造型用，真正照明靠 SpotLight */
export interface TrussConfig extends PropPlacement {
  readonly width: number;
  readonly depth: number;
  readonly beam: number;
  readonly color: string;
  readonly stripColor: string;
  readonly stripIntensity: number;
  /** 灯头从横梁往下吊的高度 */
  readonly lampDrop: number;
}

/** 轮胎墙：靠左墙的轮胎架 */
export interface TireWallConfig extends PropPlacement {
  readonly columns: number;
  readonly rows: number;
  readonly radius: number;
  readonly width: number;
  readonly spacingX: number;
  readonly spacingY: number;
  readonly rackColor: string;
  /** 胎圈色：F1 用颜色区分干胎 / 半雨胎 / 全雨胎 */
  readonly ringColors: readonly string[];
}

/** 工具墙：右前方的穿孔板 + F1 工位装备 */
export interface ToolWallConfig extends PropPlacement {
  readonly width: number;
  readonly height: number;
  /** 板子离地高度（下面留空，像真的工位） */
  readonly bottom: number;
  readonly frameColor: string;
  /** 工具主体：哑光黑 / 深灰 */
  readonly toolColor: string;
  /** 金属件（枪管、扳手头）：铬色 */
  readonly metalColor: string;
  /** 轮胎螺母、耳机罩这类点缀色 */
  readonly accentColor: string;
  /** 笔记本/计时器的屏幕色 */
  readonly screenColor: string;
}

/** 移动工具车：放在车右前方，用来填满默认机位右下角那一片空地 */
export interface ToolCartConfig extends PropPlacement {
  readonly width: number;
  readonly depth: number;
  readonly height: number;
  readonly bodyColor: string;
  readonly accentColor: string;
  readonly wheelColor: string;
}

export type PropKind =
  | 'plinth'
  | 'race-wall'
  | 'video-wall'
  | 'truss'
  | 'tire-wall'
  | 'tool-wall'
  | 'tool-cart';

export interface ShowroomConfig {
  readonly room: RoomConfig;
  readonly plinth: PlinthConfig;
  readonly raceWall: RaceWallConfig;
  readonly videoWall: VideoWallConfig;
  readonly truss: TrussConfig;
  readonly tireWall: TireWallConfig;
  readonly toolWall: ToolWallConfig;
  readonly toolCart: ToolCartConfig;
  /** 搭建顺序 = 数组顺序；加一件道具 = 加一个配置块 + 这里加一行 */
  readonly props: readonly PropKind[];
}

/** 后墙主屏的屏幕尺寸（场景单位）：6.4 × 3.2，2:1。 */
const MAIN_SCREEN_WIDTH = 6.4;
const MAIN_SCREEN_HEIGHT = 3.2;

export const SHOWROOM_CONFIG: ShowroomConfig = {
  room: {
    floor: {
      // 房间封顶之后地坪不用无穷大，比房间略大一点就够，避免边缘露出来
      size: 40,
      // 真实 P 房（围场车库）最常见的白色环氧地坪：偏暖的乳白，不是纸白
      color: '#d9d7d2',
      // 0.82：白色地面最怕高光糊成一片，宁可哑一点，只留灯带擦过时的柔光
      roughness: 0.82,
      metalness: 0.02,
      // 0.1：保留一点环境反射让它有「漆面」而不是粉笔墙，但不让它反出天花板
      envMapIntensity: 0.1,
      // 展台正下方挖开一块，升降台才能带着车沉下去；地面和展台共用 LIFT_OPENING
      opening: LIFT_OPENING,
      texture: {
        size: 1024,
        // 每片 20 单位：房间可见范围只有 13.6，一整块贴图就盖住了，
        // 连贴图接缝都落不到房间里面，自然不会有「拼接痕迹」
        repeat: 2,
        mottleCount: 26,
        noiseDots: 1400,
      },
    },
    walls: {
      // 13.6 × 13.6 的正方形房间：相机在半径 5.7 左右绕行，四面墙都还留有余量
      color: '#12161d',
      width: 13.6,
      height: 5.2,
      distance: 6.8,
      skirtingHeight: 0.12,
      skirtingColor: '#070a0f',
    },
    ceiling: {
      color: '#080b10',
      height: 5.2,
      stripColor: '#cfe3ff',
      // 1.6：只是让天花板「有结构」，太亮会把视线从车上拉走
      stripIntensity: 1.6,
    },
    led: {
      color: '#d7e6ff',
      thickness: 0.07,
      intensity: 2.2,
    },
    accent: {
      red: '#e10600',
      yellow: '#ffcf00',
    },
  },

  plinth: {
    position: [0, 0, 0],
    rotationY: 0,
    // 3.8 宽：开口 1.8 只占中间，左右各留 1.0 的台沿给舱门做侧向口袋
    width: 3.8,
    depth: 5.6,
    height: 0.1,
    // 开口 1.8 × 5.0：宽刚够过车（车宽 1.41），深留出车长 4.0 的前后余量
    openingWidth: LIFT_OPENING.width,
    openingDepth: LIFT_OPENING.depth,
    // 台面板厚 0.02，压在底座上：台面顶面在 0.11，车模落在 0.10（轮胎略陷进台面）
    topPlateThickness: 0.02,
    color: '#0e141c',
    topColor: '#16202c',
    edgeColor: '#e10600',
    edgeIntensity: 2.2,
  },

  raceWall: {
    // position 是三块屏共用的「屏幕组中轴」：x=0 让主屏水平居中，y=2.2 让三屏共用
    // 同一条垂直中轴。主屏 3.2 高，上沿 3.8 仍在桁架/墙顶灯带之下、下沿 0.6
    // 高于墙脚饰条；再往上抬就会把正文顶进桁架在屏幕上的投影里。
    position: [0, 2.2, -6.7],
    rotationY: 0,
    // 6.4 × 3.2 = 2:1，和 2048×1024 的贴图完全同比例，文字不被拉扁
    width: MAIN_SCREEN_WIDTH,
    height: MAIN_SCREEN_HEIGHT,
    frameColor: '#05080d',
    screenOffset: 0.05,
    // 与左右副屏共用回放刷新率：1.5s 一圈约 10 帧，圈数和播放头都跟得上
    refreshSeconds: RACE_REPLAY_CONFIG.screenRefreshSeconds,
    // 1.3s：和展示台灯带/扫描光的节奏接近，够看清从上到下「擦亮」的过程
    bootSeconds: 1.3,
    side: {
      // 主屏半宽 3.2 + 间隙 0.4 + 副屏半宽 1.2 = 4.8；
      // 外沿 6.0，离墙角还有 0.8，不会和左墙轮胎架 / 右墙工具墙的投影撞在一起
      width: 2.4,
      height: 1.8,
      gap: 0.4,
      // 副屏和主屏同频刷新：三块屏显示的是同一圈，刷新率不一致会看出错位
      refreshSeconds: RACE_REPLAY_CONFIG.screenRefreshSeconds,
      // 主屏先亮，左右副屏延后 0.12s 一起亮：对称展开，不抢主屏的开场
      bootDelaySeconds: 0.12,
    },
  },

  videoWall: {
    // 16:9 画幅：8.18 / 4.6 = 1.778，和 1280×720 的视频完全同比例，
    // 不会出现上下或左右裁切。屏幕组中心 y=2.9，屏幕范围 0.6–5.2；
    // 顶边贴住墙顶，底边让控制台上沿压进来 0.06，整块屏自然落在墙里。
    // z=6.76，屏幕面在 6.74，距墙面 0.06：近看不会露出悬浮缝，
    // 也不会被相机 maxDistance（6.4）挤到近裁剪面里。
    position: [0, 2.9, 6.76],
    // 前墙朝 -Z，屏幕法线也必须转向房间内部；后墙是 0，这里正好差 180°
    rotationY: Math.PI,
    width: 8.18,
    height: 4.6,
    screenOffset: 0.02,
    // 0.50 高：投影到 1600×900 视口约 46px，刚好放得下一整排播控；
    // 下沿落在 0.16，仍高于 0.12 的踢脚线，不会和墙脚打架。
    consoleHeight: 0.5,
    consoleDepth: 0.16,
    // 压进屏幕 0.06：DOM 面板和 3D 台面共用一条上沿，看起来是嵌进去的
    consoleOverlap: 0.06,
    consoleColor: '#0a0e14',
    consoleEndCapColor: '#1a2330',
    accentColor: '#e10600',
  },

  truss: {
    // 3.5 高、中心后移到 -1.2、纵深收窄到 4.6：
    // 桁架直接压在头顶时近端横梁会糊满画面顶部，往后挪一点才像「房间上方的结构」
    position: [0, 3.5, -1.2],
    rotationY: 0,
    width: 7.2,
    depth: 4.6,
    beam: 0.16,
    color: '#2b323d',
    stripColor: '#cfe3ff',
    stripIntensity: 2.6,
    lampDrop: 0.34,
  },

  tireWall: {
    position: [-6.65, 0, -3.3],
    rotationY: Math.PI / 2,
    columns: 4,
    rows: 3,
    radius: 0.45,
    width: 0.3,
    spacingX: 0.95,
    spacingY: 0.92,
    rackColor: '#242a33',
    ringColors: ['#e10600', '#ffcf00', '#2f6df6', '#f2f2f2'],
  },

  toolWall: {
    position: [6.65, 0, -2],
    rotationY: -Math.PI / 2,
    width: 2.8,
    height: 2,
    bottom: 0.4,
    frameColor: '#14181e',
    toolColor: '#1b1f26',
    metalColor: '#9aa5b1',
    accentColor: '#e10600',
    screenColor: '#7ad0ff',
  },

  toolCart: {
    // 原来在车右前方中景（1.75, -0.25），和车并排、正好挡住右侧车身。
    // 现在收进后墙右下角：默认机位不再挡车，绕到右后方时它又成了背景里的工位细节。
    position: [4.8, 0, -6.1],
    rotationY: -0.28,
    width: 0.9,
    depth: 0.58,
    height: 1,
    bodyColor: '#151a21',
    accentColor: '#e10600',
    wheelColor: '#0a0c0f',
  },

  /*
   * 搭建顺序 = 数组顺序。前墙视频屏放在后墙三屏之后：它自带视频元素和播放状态，
   * 由 VideoWallProp 自己管理生命周期，Showroom 只负责挂上去、每帧 update。
   */
  props: ['plinth', 'race-wall', 'video-wall', 'truss', 'tire-wall', 'tool-wall', 'tool-cart'],
};
