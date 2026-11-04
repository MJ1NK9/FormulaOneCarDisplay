/**
 * useHotspots —— Vue 与 Three 之间唯一的桥。
 *
 * 方向是单向的：Three 侧的 HotspotSystem 只抛「选中了哪个 id」，
 * 这里把它翻译成 Vue 的 activeId / 屏幕锚点，交给 ui/HotspotCard.vue 渲染。
 * 卡片位置每帧从相机投影算一次，所以拖拽旋转时浮窗会一直黏在圆点上。
 *
 * 生命周期：
 * - 组件 setup 时调用 useHotspots()，只声明状态，不碰 Three；
 * - 车模加载完成后由 App.vue 调 attach()，这时才创建 HotspotSystem；
 * - 组件卸载时自动 detach()，先于 SceneManager.dispose() 释放 DOM 与监听。
 */
import {
  computed,
  onBeforeUnmount,
  readonly,
  ref,
  shallowRef,
  type ComputedRef,
  type Ref,
  type ShallowRef,
} from 'vue';
import type { Object3D } from 'three';
import { HOTSPOT_VIEW_CONFIG } from '../config/hotspot';
import { HotspotSystem } from '../core/HotspotSystem';
import type { SceneManager } from '../core/SceneManager';
import type { Hotspot, HotspotScreenAnchor } from '../types/hotspot';

export interface HotspotBridgeOptions {
  readonly sceneManager: SceneManager;
  /** 车模根节点：热点坐标以它为基准 */
  readonly model: Object3D;
}

export interface HotspotBridge {
  /** 当前打开的热点；null 表示没有卡片 */
  readonly activeHotspot: ComputedRef<Hotspot | null>;
  /** 卡片锚点（屏幕 CSS 像素）；null 表示这次投影不可用（在相机背后等） */
  readonly anchor: ShallowRef<HotspotScreenAnchor | null>;
  /** 圆点总开关，默认开启；由页面右上角的开关同步 */
  readonly enabled: Readonly<Ref<boolean>>;
  attach(options: HotspotBridgeOptions): void;
  detach(): void;
  close(): void;
  setEnabled(value: boolean): void;
  /**
   * 整体淡入 / 淡出：换模动画开始时淡出、升起完成后淡入。
   * 新挂载的 HotspotSystem 会用它对齐初始透明度，所以先 fade 再 attach 也能生效。
   */
  fade(target: number, seconds: number): void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function useHotspots(hotspots: readonly Hotspot[]): HotspotBridge {
  const activeId = shallowRef<string | null>(null);
  const anchor = shallowRef<HotspotScreenAnchor | null>(null);
  // 默认开启：页面刷新 / 重新进站都回到「显示热点」的状态，不记忆上次的关闭
  const enabledState = ref(true);
  const enabled = readonly(enabledState);

  let system: HotspotSystem | null = null;
  let sceneManager: SceneManager | null = null;
  let stopFrame: (() => void) | null = null;
  let handleKeyDown: ((event: KeyboardEvent) => void) | null = null;
  /** 当前透明度包络的目标值：detach 之后仍要记住，重新 attach 才能接上 */
  let fadeAlpha = 1;

  const activeHotspot = computed<Hotspot | null>(
    () => hotspots.find((item) => item.id === activeId.value) ?? null,
  );

  // 上一帧投影结果：只有移动超过半个像素才写回 ref。
  // 相机停住时卡片不再每帧触发一次 Vue 渲染，静置页面是真正静止的。
  const lastAnchor = { x: Number.NaN, y: Number.NaN };

  function pushAnchor(x: number, y: number): void {
    if (Math.abs(lastAnchor.x - x) < 0.5 && Math.abs(lastAnchor.y - y) < 0.5) return;
    lastAnchor.x = x;
    lastAnchor.y = y;
    anchor.value = { x, y };
  }

  function clearAnchor(): void {
    lastAnchor.x = Number.NaN;
    lastAnchor.y = Number.NaN;
    anchor.value = null;
  }

  /** 把 3D 锚点投影成屏幕坐标，并做左右收边，避免卡片贴边被裁 */
  function updateAnchor(): void {
    if (!system || !sceneManager || !activeId.value) {
      clearAnchor();
      return;
    }

    const canvas = sceneManager.renderer.domElement;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const raw = system.getScreenAnchor(activeId.value, width, height);
    if (!raw) {
      clearAnchor();
      return;
    }

    // 卡片宽度的一半 + 留白是左右极限；窄屏下卡片切成贴底抽屉、不再用 x，
    // 所以这里的收边不会影响移动端
    const { width: cardWidth, viewportMargin } = HOTSPOT_VIEW_CONFIG.card;
    const half = cardWidth / 2;
    pushAnchor(
      clamp(raw.x, Math.min(half + viewportMargin, width / 2), Math.max(width - half - viewportMargin, width / 2)),
      raw.y,
    );
  }

  function open(id: string): void {
    if (!system || !enabledState.value) return;

    // 再点一次已经打开的热点 = 收起，符合「标记即开关」的直觉
    if (activeId.value === id) {
      close();
      return;
    }

    activeId.value = id;
    system.setActive(id);
    // 重新打开时锚点必须重新写一次，不能沿用上一次的「没移动」缓存
    lastAnchor.x = Number.NaN;
    lastAnchor.y = Number.NaN;
    updateAnchor();
  }

  function close(): void {
    activeId.value = null;
    system?.setActive(null);
    clearAnchor();
  }

  /**
   * 同步圆点开关。
   * 关闭时先让 HotspotSystem 停掉拾取/隐藏 DOM，再收掉已打开的卡片；
   * 重新打开不需要额外动作，下一帧 update() 会按视距重新计算淡出。
   */
  function setEnabled(value: boolean): void {
    if (enabledState.value === value) return;

    enabledState.value = value;
    system?.setEnabled(value);
    if (!value) close();
  }

  function fade(target: number, seconds: number): void {
    fadeAlpha = Math.min(1, Math.max(0, target));
    system?.setFade(fadeAlpha, seconds);
  }

  function attach(options: HotspotBridgeOptions): void {
    detach();

    sceneManager = options.sceneManager;
    system = new HotspotSystem({
      hotspots,
      model: options.model,
      camera: options.sceneManager.camera,
      domElement: options.sceneManager.renderer.domElement,
      onSelect: (id) => {
        if (id === null) {
          close();
          return;
        }
        open(id);
      },
    });
    options.sceneManager.scene.add(system.root);
    // 加载完成前用户可能已经关掉开关；创建系统后立刻补一次状态
    system.setEnabled(enabledState.value);
    // 换模流程里热点是先淡出再拆、升起后再挂：新系统必须从当前包络起步，不能先亮一帧
    system.setFade(fadeAlpha, 0);

    // 每帧两件轻活：圆点淡出 + 打开时投影一次锚点。
    // 关掉卡片后 updateAnchor 直接返回，不会留下无意义的 DOM 写入。
    stopFrame = options.sceneManager.onFrame((deltaSeconds) => {
      system?.update(deltaSeconds);
      if (activeId.value) updateAnchor();
    });

    // Esc 关闭是浮层的通用预期；监听放 window，焦点在圆点或关闭按钮上都能生效
    handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && activeId.value) close();
    };
    window.addEventListener('keydown', handleKeyDown);
  }

  function detach(): void {
    if (handleKeyDown) {
      window.removeEventListener('keydown', handleKeyDown);
      handleKeyDown = null;
    }
    stopFrame?.();
    stopFrame = null;
    system?.dispose();
    system = null;
    sceneManager = null;
    activeId.value = null;
    clearAnchor();
  }

  // 卸载顺序很关键：这个钩子在 setup 期间先注册，会早于 App.vue 自己的
  // onBeforeUnmount 执行，保证热点 DOM/监听在 SceneManager 释放之前清干净
  onBeforeUnmount(detach);

  return {
    activeHotspot,
    anchor,
    enabled,
    attach,
    detach,
    close,
    setEnabled,
    fade,
  };
}
