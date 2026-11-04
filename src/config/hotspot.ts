/**
 * 热点系统的「表现与交互」常量。
 *
 * 和 `hotspots.ts` 的分工：
 * - `hotspots.ts` 是内容数据（哪几个部件、文案、坐标）；
 * - 本文件是行为参数（点多近算点中、卡片多大、什么时候淡出）。
 *
 * 把这两个分开，是为了让「加一个热点」只动数据文件，不碰任何调参；
 * 反过来调手感（比如圆点太难点）也只改这里，不会误改文案。
 */

/** 卡片布局：投影定位、防溢出、响应式断点 */
export interface HotspotCardConfig {
  /** 桌面端卡片宽度（CSS 像素）。定位时要按它的一半做左右收边 */
  readonly width: number;

  /** 卡片最大高度。超过后内容内部滚动，同时用它判断上方空间够不够 */
  readonly maxHeight: number;

  /** 卡片与圆点之间的间距，避免卡片压住圆点 */
  readonly gap: number;

  /** 卡片与画布边缘的最小留白 */
  readonly viewportMargin: number;

  /** 小于等于这个宽度时，卡片改成贴底抽屉，不再跟随圆点 */
  readonly sheetBreakpoint: number;
}

export interface HotspotViewConfig {
  /**
   * 点击判定阈值（CSS 像素）。
   * pointerdown 到 pointerup 的位移超过它就算「拖拽旋转」，不弹卡片——
   * 这是热点功能最容易出的 bug：想转车，结果每次都弹窗。
   */
  readonly dragThresholdPx: number;

  /**
   * 代理球默认半径（场景单位）。
   * 车长 4 个场景单位时，0.09 大约相当于屏幕半径 20px，
   * 也就是移动端也能点中的 40px 触控热区；个别部件可以按条目覆盖。
   */
  readonly defaultHitRadius: number;

  /**
   * 圆点的「背向淡出」区间：dot(法线, 视线) 小于 start 完全透明，大于 end 完全显示。
   * 用一个点积做这件事，而不是每帧朝模型 raycast（28 万三角形会直接把拖拽拖卡）。
   * 留一段渐变区间是为了转到侧面时圆点平滑消失，不会「啪」一下闪没。
   */
  readonly markerFadeStart: number;
  readonly markerFadeEnd: number;

  readonly card: HotspotCardConfig;
}

export const HOTSPOT_VIEW_CONFIG: HotspotViewConfig = {
  dragThresholdPx: 5,
  defaultHitRadius: 0.09,
  markerFadeStart: -0.1,
  markerFadeEnd: 0.25,
  card: {
    width: 320,
    maxHeight: 336,
    gap: 16,
    viewportMargin: 12,
    sheetBreakpoint: 640,
  },
};
