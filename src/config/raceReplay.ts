/**
 * 2024 圣保罗正赛后墙回放的时间轴 —— 唯一数据源。
 *
 * 三块屏都从 `SceneManager` 的同一个 elapsedSeconds 出发，再读同一份常量，
 * 所以圈数、播放头、完赛定格天然同步，不需要额外的事件总线或状态机。
 *
 * 2024 圣保罗正赛官方分类 69 圈，回放也按 69 圈播；跑完定格 5s 再循环。
 */
export const RACE_REPLAY_CONFIG = {
  /** 上电扫描结束后再发车，避免第 1 圈被扫描线盖住 */
  startDelaySeconds: 1.5,
  /** 每圈展示时长：69 圈真实数据 */
  lapSeconds: 4,
  /** 完赛定格：让最后的名次 / 成绩停得住，再从头循环 */
  finishHoldSeconds: 5,
  /**
   * 三屏 canvas 刷新间隔。
   * 4s 一圈约 26 帧，圈数跳动和播放头都够顺；
   * 低端机如果卡顿，调到 0.2（5fps）即可，其他逻辑不用动。
   */
  screenRefreshSeconds: 0.15,
} as const;
