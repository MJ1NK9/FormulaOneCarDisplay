/**
 * 热点（Hotspot）的类型合同。
 *
 * 这份文件只描述「一条热点数据长什么样」，不含任何坐标、文案或渲染逻辑：
 * 数据在 `config/hotspots.ts`，渲染在 `core/HotspotSystem.ts`，UI 在 `ui/HotspotCard.vue`。
 *
 * 坐标为什么是「车模局部坐标」而不是场景坐标：
 * 车模加载后会被缩放、抬到展台上，如果热点写死场景坐标，换个展台高度就全错位；
 * 写成车模局部坐标后，由 HotspotSystem 用模型的世界矩阵换算，模型怎么摆都不影响数据。
 * 单位是 GLB 原始单位（车长约 5.4），不是场景单位（车长约 4）——用 ?pick 采集后直接粘贴，
 * 不要手算，两种单位混用是这套配置最容易踩的坑。
 */

/** 一条规格：左标签、右值，例如「引入 / 2018 赛季」 */
export interface HotspotSpec {
  readonly label: string;
  readonly value: string;
}

/** 信息来源：只在卡片底部显示一行链接，保持内容可信度 */
export interface HotspotSource {
  readonly label: string;
  readonly url: string;
}

export interface Hotspot {
  /** 唯一标识，kebab-case，同时用于 DOM 的 data-hotspot-id 与打开状态 */
  readonly id: string;

  /** 圆点 hover 时显示的名字（英文缩写，跟 F1 转播图形一致） */
  readonly label: string;

  /** 车模局部坐标（GLB 单位，车头朝 +Z），由 ?pick 工具采集后粘贴 */
  readonly position: readonly [x: number, y: number, z: number];

  /**
   * 车模局部坐标下的「朝外法线」，只用于判断这个面是否背对镜头。
   * 不填时用「热点位置 - 车模原点」兜底；?pick 工具会把命中面的法线一起打印出来。
   */
  readonly normal?: readonly [x: number, y: number, z: number];

  /** 代理球半径（场景单位），决定鼠标/手指的容错范围；不填用默认值 */
  readonly hitRadius?: number;

  /** 卡片标题，中文 */
  readonly title: string;

  /** 一句话说明：这是什么 + 为什么重要，控制在 80~150 字 */
  readonly summary: string;

  /** 2~4 条关键信息，没有就省略整块 */
  readonly specs?: readonly HotspotSpec[];

  /** 规则 / 官方出处，没有就省略整行 */
  readonly source?: HotspotSource;
}

/** 卡片相对圆点的位置：默认在上方，顶部空间不足时翻到下方 */
export type HotspotCardPlacement = 'above' | 'below';

/** 圆点投影到屏幕后的锚点（CSS 像素，相对画布左上角） */
export interface HotspotScreenAnchor {
  readonly x: number;
  readonly y: number;
}
