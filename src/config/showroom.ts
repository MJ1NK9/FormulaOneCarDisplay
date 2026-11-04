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

/** 一件道具的摆放：位置 + 绕 Y 轴旋转（弧度） */
export interface PropPlacement {
  readonly position: Vec3Tuple;
  readonly rotationY: number;
}

/** 房间本体：地坪、墙、灯带、配色 */
export interface RoomConfig {
  readonly floor: {
    readonly size: number;
    readonly color: string;
    readonly roughness: number;
    readonly metalness: number;
    readonly envMapIntensity: number;
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
  readonly color: string;
  readonly topColor: string;
  readonly edgeColor: string;
  readonly edgeIntensity: number;
}

/** 赛事大屏：车后面的自发光整墙屏，既是背景也是「这是 F1 车库」的信息源 */
export interface RaceWallConfig extends PropPlacement {
  readonly width: number;
  readonly height: number;
  readonly frameColor: string;
  /** 屏幕相对背板往前凸出的距离，避免 z-fighting */
  readonly screenOffset: number;
  /** 刷新间隔（秒）：圈速/圈数微动即可，太快反而晃眼 */
  readonly refreshSeconds: number;
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
  | 'truss'
  | 'tire-wall'
  | 'tool-wall'
  | 'tool-cart';

export interface ShowroomConfig {
  readonly room: RoomConfig;
  readonly plinth: PlinthConfig;
  readonly raceWall: RaceWallConfig;
  readonly truss: TrussConfig;
  readonly tireWall: TireWallConfig;
  readonly toolWall: ToolWallConfig;
  readonly toolCart: ToolCartConfig;
  /** 搭建顺序 = 数组顺序；加一件道具 = 加一个配置块 + 这里加一行 */
  readonly props: readonly PropKind[];
}

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
    width: 3.2,
    depth: 5.6,
    height: 0.1,
    color: '#0e141c',
    topColor: '#16202c',
    edgeColor: '#e10600',
    edgeIntensity: 2.2,
  },

  raceWall: {
    // 向左让一点：相机在右前方 36° 看过来，墙上的内容会整体偏右，
    // 不补偿的话右侧的圈速榜会被画面右边缘裁掉
    position: [-1.0, 0.55, -6.7],
    rotationY: 0,
    width: 7,
    height: 3.3,
    frameColor: '#05080d',
    screenOffset: 0.05,
    refreshSeconds: 2,
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

  props: ['plinth', 'race-wall', 'truss', 'tire-wall', 'tool-wall', 'tool-cart'],
};
