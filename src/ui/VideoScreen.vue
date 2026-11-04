<script setup lang="ts">
/**
 * 车头前墙视频大屏的「墙装控制台」。
 *
 * 视频画面本身完全在 3D 屏幕贴图里（`core/props/videoWall.ts`），
 * 屏幕上不再叠任何标题条 / ticker / 车手条 / 信号条——这样整块画面不被遮挡。
 * 本组件只做控制台 DOM，不 import three：
 *
 * 1. 每帧向控制器要「控制台前表面」的投影四边形，用单应矩阵把 DOM 层贴上去，
 *    四条边和 3D 台面严格重合，所以播放键、进度条是「装在墙上的控制台」，
 *    不是浮在屏幕下面的 HUD；
 * 2. 播放 / 暂停 / 拖动进度 / 音量全部直接转成 `VideoWallProp` 的指令，
 *    读写的是真实 `<video>` 元素，不存在 iframe 那种「父页面拿不到状态」的问题；
 * 3. `z-index: 1`：在 canvas 之上、CSS2D 热点层（2）之下，
 *    热点圆点、信息卡、全息提示和画质控件始终盖在它上面。
 *
 * 为什么不用 Canvas 画控制台：真实 DOM 才有原生 `<input type="range">`
 * 的点击 / 拖动 / 键盘 / 触屏行为，也才能被读屏器识别；画进 3D 贴图会把这些
 * 全部丢掉。DOM 层唯一需要补的是「控制台离视口 / 被侧视时要收起」——这一步由
 * 控制器返回 null 完成。
 */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import { VIDEO_SCREEN_CONFIG } from '../config/videoScreen';
import { computeQuadTransform } from './projectedQuad';
import type {
  VideoScreenStatus,
  VideoWallProp,
  VideoWallQuad,
} from '../core/props/videoWall';

const props = defineProps<{
  /** 前墙视频屏控制器（Showroom 创建）；由 App.vue 在场景就绪后传入 */
  readonly wall: VideoWallProp;
  /**
   * 注册到 SceneManager 唯一渲染循环的回调，返回取消函数。
   *
   * 面板每帧都要跟着 3D 投影走，但项目约定只有一条 rAF（§5.4），
   * 所以这里不自己起循环，而是把回调挂到 SceneManager.onFrame 上。
   */
  readonly registerFrame: (callback: (deltaSeconds: number) => void) => () => void;
}>();

const config = VIDEO_SCREEN_CONFIG;

/**
 * 控制台画布的虚拟尺寸。
 *
 * 真实台面是「屏幕宽 + 0.18」× 0.50 = 8.36 × 0.50 ≈ 16.72:1，
 * 这里用 1270 × 76 保持同比例；如果现场微调台面尺寸，矩阵会自动把面板
 * 拉回台面，不需要改这里。
 */
const CONSOLE_STAGE_WIDTH = 1270;
const CONSOLE_STAGE_HEIGHT = 76;

type VolumeIcon = 'muted' | 'low' | 'high';

/** 控制台面的投影四边形，null = 当前视角下不显示 */
const consoleQuad = shallowRef<VideoWallQuad | null>(null);
const status = ref<VideoScreenStatus>('standby');
const playing = ref(false);
const muted = ref(config.defaultMuted);
const volume = ref(config.defaultVolume);
const duration = ref(config.durationSeconds);
const position = ref(0);
const buffered = ref(0);
/** 拖动进度条期间不让 10Hz 的快照把滑块位置拽回去 */
const scrubbing = ref(false);
const scrubValue = ref(0);

/**
 * 上一次写入 DOM 的投影：变化小于 0.25px 就不触发 Vue 重渲染。
 * 相机完全静止时组件是静止的，不会每帧都做一次矩阵字符串拼接。
 */
const lastConsole = [Number.NaN, Number.NaN, Number.NaN, Number.NaN, Number.NaN, Number.NaN, Number.NaN, Number.NaN];

const consoleVisible = computed(() => consoleQuad.value !== null);
const compact = computed(() => (consoleQuad.value?.width ?? 0) < 440);
const isReady = computed(() => status.value === 'ready');
const busy = computed(() => status.value === 'loading' || status.value === 'standby');
const effectiveMuted = computed(() => muted.value || volume.value <= 0.001);
const volumePercent = computed(() =>
  effectiveMuted.value ? 0 : Math.round(volume.value * 100),
);
const volumeLabel = computed(() =>
  effectiveMuted.value ? '静音' : `${Math.round(volume.value * 100)}%`,
);
const volumeIcon = computed<VolumeIcon>(() => {
  if (effectiveMuted.value) return 'muted';
  return volume.value < 0.5 ? 'low' : 'high';
});
const playLabel = computed(() => {
  if (status.value === 'error') return '重新载入视频';
  if (busy.value) return '视频载入中';
  return playing.value ? '暂停视频' : '播放视频';
});
const muteLabel = computed(() => (effectiveMuted.value ? '开启声音' : '静音'));

const statusHint = computed(() => {
  switch (status.value) {
    case 'ready':
      return '视频信号已锁定';
    case 'error':
      return '视频信号不可用，点击播放键重试';
    case 'loading':
      return '正在接入 2024 圣保罗大奖赛信号…';
    default:
      return '等待接入视频信号';
  }
});
const statusAnnouncement = computed(() => {
  switch (status.value) {
    case 'ready':
      return '视频信号已锁定';
    case 'error':
      return '视频信号不可用，可点击重新载入';
    case 'loading':
      return '正在载入视频';
    default:
      return '视频待载入';
  }
});

const displayTime = computed(() => (scrubbing.value ? scrubValue.value : position.value));
const currentLabel = computed(() => formatTime(displayTime.value));
const durationLabel = computed(() => formatTime(duration.value));
const progressPercent = computed(() => {
  if (!Number.isFinite(duration.value) || duration.value <= 0) return 0;
  return Math.min(100, Math.max(0, (displayTime.value / duration.value) * 100));
});
const bufferedPercent = computed(() =>
  Math.min(100, Math.max(0, buffered.value * 100)),
);
const rangeValue = computed(() =>
  Math.min(duration.value || 0, Math.max(0, displayTime.value)),
);

const consoleStyle = computed<Record<string, string>>(() => {
  const style: Record<string, string> = {
    width: `${CONSOLE_STAGE_WIDTH}px`,
    height: `${CONSOLE_STAGE_HEIGHT}px`,
  };
  const current = consoleQuad.value;
  style.transform = current
    ? computeQuadTransform(CONSOLE_STAGE_WIDTH, CONSOLE_STAGE_HEIGHT, current)
    : 'none';
  return style;
});
const rangeStyle = computed<Record<string, string>>(() => ({
  '--progress': `${progressPercent.value}%`,
}));
const volumeStyle = computed<Record<string, string>>(() => ({
  '--volume': `${volumePercent.value}%`,
}));

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  const secondsLabel = String(rest).padStart(2, '0');
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${secondsLabel}`;
  return `${minutes}:${secondsLabel}`;
}

/** 把四边形摊平成 8 个数字，做「变化是否值得重渲染」的比较 */
function quadValues(quad: VideoWallQuad): readonly number[] {
  return [
    quad.topLeft.x,
    quad.topLeft.y,
    quad.topRight.x,
    quad.topRight.y,
    quad.bottomRight.x,
    quad.bottomRight.y,
    quad.bottomLeft.x,
    quad.bottomLeft.y,
  ];
}

function readQuad(next: VideoWallQuad, cache: number[]): boolean {
  const values = quadValues(next);
  let changed = false;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index] ?? Number.NaN;
    if (!Number.isFinite(cache[index]) || Math.abs(value - (cache[index] ?? 0)) > 0.25) {
      changed = true;
    }
    cache[index] = value;
  }
  return changed;
}

function resetQuad(cache: number[]): void {
  for (let index = 0; index < cache.length; index += 1) cache[index] = Number.NaN;
}

/**
 * 投影到 CSS 像素时用的是画布自身的尺寸，而不是 window.innerWidth。
 * 移动端布局视口（visual viewport / 地址栏）和 canvas 尺寸偶尔不一致，
 * 用 window 会把控制台按错误宽度贴出去（手机上一眼就能看到横向溢出）。
 */
let surface: HTMLCanvasElement | null = null;

function syncPlacement(): void {
  const width = surface?.clientWidth || window.innerWidth;
  const height = surface?.clientHeight || window.innerHeight;
  const nextConsole = props.wall.getConsoleQuad(width, height);
  if (!nextConsole) {
    consoleQuad.value = null;
    resetQuad(lastConsole);
  } else if (readQuad(nextConsole, lastConsole)) {
    consoleQuad.value = nextConsole;
  }
}

/**
 * 每帧只做投影跟随，约 10Hz 读一次播放状态。
 * 回调由 SceneManager 的渲染循环调度，页面隐藏时直接跳过。
 */
let stateTimer = 0;

function tick(deltaSeconds: number): void {
  if (document.hidden) return;

  syncPlacement();
  if (!consoleVisible.value) return;

  stateTimer += deltaSeconds;
  if (stateTimer < 0.09) return;
  stateTimer = 0;

  const snapshot = props.wall.snapshot();
  status.value = snapshot.status;
  playing.value = snapshot.playing;
  muted.value = snapshot.muted;
  volume.value = snapshot.volume;
  duration.value = snapshot.duration;
  buffered.value = snapshot.buffered;

  if (!scrubbing.value) {
    position.value = snapshot.currentTime;
    scrubValue.value = snapshot.currentTime;
  }
}

function handleTogglePlay(): void {
  // 先乐观切换图标：真实 video 状态会在下一个 90ms 快照里校正
  if (status.value === 'ready') playing.value = !playing.value;
  props.wall.togglePlay();
}

function handleSkip(seconds: number): void {
  if (status.value !== 'ready') return;
  const next = Math.min(duration.value || 0, Math.max(0, position.value + seconds));
  position.value = next;
  scrubValue.value = next;
  props.wall.seek(next);
}

function handleScrubStart(event: PointerEvent): void {
  const input = event.currentTarget as HTMLInputElement | null;
  scrubbing.value = true;
  scrubValue.value = Number(input?.value ?? position.value);
  position.value = scrubValue.value;
  // 指针拖出滑块后仍要收到 pointerup，否则 scrubbing 永远为 true
  input?.setPointerCapture?.(event.pointerId);
}

/**
 * 拖动时每次 input 都直接 seek：
 * 视频画面和当前时间跟着手指实时走，松手才跳转的设计这里不需要。
 */
function handleScrubInput(event: Event): void {
  const input = event.target as HTMLInputElement;
  const next = Number(input.value);
  if (!Number.isFinite(next)) return;
  const clamped = Math.min(duration.value || 0, Math.max(0, next));
  scrubValue.value = clamped;
  position.value = clamped;
  props.wall.seek(clamped);
}

function handleScrubEnd(): void {
  scrubbing.value = false;
}

function handleToggleMuted(): void {
  // 同上：先让图标 / 文案立刻响应，快照随后把真实状态写回来
  muted.value = !muted.value;
  props.wall.toggleMuted();
}

function handleVolumeInput(event: Event): void {
  const input = event.target as HTMLInputElement;
  const next = Number(input.value);
  if (!Number.isFinite(next)) return;
  const normalized = Math.min(1, Math.max(0, next / 100));
  // 拖动音量条等于「要听声音」：本地状态同步取消静音，和控制器行为一致
  volume.value = normalized;
  if (normalized > 0) muted.value = false;
  props.wall.setVolume(normalized);
}

let cancelFrame: (() => void) | null = null;

onMounted(() => {
  // 控制台 DOM 的坐标必须和 WebGL 画布的 CSS 尺寸一致；缓存一次，
  // resize 时 clientWidth / clientHeight 会自然更新。
  surface = document.querySelector<HTMLCanvasElement>('.scene__host canvas');
  cancelFrame = props.registerFrame(tick);
});

onBeforeUnmount(() => {
  cancelFrame?.();
  cancelFrame = null;
});

/** 失败态 / 播放键共用的图标路径 */
const retryPath = 'M20 12a8 8 0 1 1-2.4-5.7M20 4v6h-6';
</script>

<template>
  <div
    class="wall-console"
    :class="{
      'wall-console--visible': consoleVisible,
      'wall-console--compact': compact,
      'wall-console--error': status === 'error',
    }"
    :style="consoleStyle"
    :aria-hidden="!consoleVisible"
    :inert="!consoleVisible"
    role="group"
    aria-label="2024 圣保罗大奖赛官方回放控制台"
  >
    <div class="console-face">
      <div class="console-face__head">
        <span class="console-face__now">
          <i aria-hidden="true" /> NOW PLAYING
          <b>{{ config.title }}</b>
        </span>
        <span class="console-face__hint">{{ statusHint }}</span>
        <span class="console-face__system">{{ config.event.shortName }} · CONSOLE 01</span>
      </div>

      <div class="console-face__row">
        <button
          type="button"
          class="transport transport--play"
          :disabled="busy"
          :aria-label="playLabel"
          :title="playLabel"
          @click="handleTogglePlay"
        >
          <span v-if="busy" class="transport__spinner" aria-hidden="true" />
          <svg
            v-else-if="status === 'error'"
            class="transport__icon transport__icon--stroke"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path :d="retryPath" />
          </svg>
          <svg
            v-else-if="playing"
            class="transport__icon"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path class="transport__solid" d="M7 5h3.6v14H7zM13.4 5H17v14h-3.6z" />
          </svg>
          <svg v-else class="transport__icon" viewBox="0 0 24 24" aria-hidden="true">
            <path class="transport__solid" d="M8 5v14l11-7z" />
          </svg>
        </button>

        <button
          type="button"
          class="transport transport--skip"
          :disabled="!isReady"
          aria-label="后退 10 秒"
          title="后退 10 秒"
          @click="handleSkip(-10)"
        >
          <svg viewBox="0 0 24 24" class="transport__icon transport__icon--stroke" aria-hidden="true">
            <path d="M12 5a7 7 0 1 1-6.3 4" />
            <path d="M4.6 3.7v5.5h5.5" />
            <text x="12.4" y="15.6" class="skip-number">10</text>
          </svg>
        </button>

        <button
          type="button"
          class="transport transport--skip"
          :disabled="!isReady"
          aria-label="前进 10 秒"
          title="前进 10 秒"
          @click="handleSkip(10)"
        >
          <svg viewBox="0 0 24 24" class="transport__icon transport__icon--stroke" aria-hidden="true">
            <path d="M12 5a7 7 0 1 0 6.3 4" />
            <path d="M19.4 3.7v5.5h-5.5" />
            <text x="11.6" y="15.6" class="skip-number">10</text>
          </svg>
        </button>

        <div class="timecode" aria-live="off">
          <span class="timecode__now">{{ currentLabel }}</span>
          <span class="timecode__sep">/</span>
          <span class="timecode__total">{{ durationLabel }}</span>
        </div>

        <div class="scrub">
          <div class="scrub__track" aria-hidden="true">
            <span class="scrub__buffer" :style="{ width: `${bufferedPercent}%` }" />
            <span class="scrub__fill" :style="{ width: `${progressPercent}%` }" />
            <i class="scrub__thumb" :style="{ left: `${progressPercent}%` }" />
          </div>
          <input
            class="scrub__input"
            type="range"
            min="0"
            :max="duration"
            step="0.05"
            :value="rangeValue"
            :style="rangeStyle"
            :disabled="!isReady"
            :aria-label="`播放进度 ${currentLabel}，共 ${durationLabel}`"
            @pointerdown="handleScrubStart"
            @pointerup="handleScrubEnd"
            @pointercancel="handleScrubEnd"
            @blur="handleScrubEnd"
            @input="handleScrubInput"
          />
        </div>

        <div class="console-volume">
          <button
            type="button"
            class="transport transport--mute"
            :aria-label="muteLabel"
            :title="muteLabel"
            @click="handleToggleMuted"
          >
            <svg
              class="transport__icon transport__icon--stroke"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path class="transport__speaker" d="M4 9h3.4L12 5.2v13.6L7.4 15H4z" />
              <path v-if="volumeIcon !== 'muted'" d="M15.2 8.4a5 5 0 0 1 0 7.2" />
              <path v-if="volumeIcon === 'high'" d="M17.9 6a8.6 8.6 0 0 1 0 12" />
              <path v-if="volumeIcon === 'muted'" d="M15 9l6 6M21 9l-6 6" />
            </svg>
          </button>
          <input
            class="volume-range"
            type="range"
            min="0"
            max="100"
            step="1"
            :value="volumePercent"
            :style="volumeStyle"
            :aria-label="`音量 ${volumePercent}%`"
            @input="handleVolumeInput"
          />
          <span class="console-volume__value">{{ volumeLabel }}</span>
        </div>

        <span class="format-chip">HD</span>
      </div>

      <i class="console-screw console-screw--tl" aria-hidden="true" />
      <i class="console-screw console-screw--tr" aria-hidden="true" />
      <i class="console-screw console-screw--bl" aria-hidden="true" />
      <i class="console-screw console-screw--br" aria-hidden="true" />
    </div>

    <p class="sr-only" aria-live="polite">{{ statusAnnouncement }}</p>
  </div>
</template>

<style scoped>
/*
 * 视觉语言：F1 官方转播图形 + 机房硬件。
 * - 近黑底、F1 红压边、等宽时间码、斜切角；
 * - 所有面板都带内阴影 / 螺钉 / 接缝，不做外投影的「悬浮卡片」；
 * - 字号用虚拟画布 px，整体由矩阵缩放，远近都是同一套版式。
 */
.wall-console {
  /*
   * 必须是 fixed，不能用 absolute。
   *
   * 这块面板的虚拟画布固定 1270×76（见 CONSOLE_STAGE_WIDTH），收起时
   * `opacity: 0` 并不会把它从布局里拿掉。absolute 定位下它仍参与文档的
   * 可滚动溢出计算：手机浏览器（Safari / Chrome 移动端）会把布局视口
   * 撑到 1270px 宽，window.innerWidth / innerHeight 跟着变成 1270×2749。
   * 于是所有 position: fixed 的 UI——最典型的就是热点信息卡在窄屏下的
   * 贴底抽屉——会被摆到 2700px 之外的视口底部，用户点热点看起来“没反应”。
   * fixed 元素不产生文档溢出，1270px 的收起态就不再影响视口尺寸。
   */
  position: fixed;
  top: 0;
  left: 0;
  z-index: 1;
  transform-origin: 0 0;
  opacity: 0;
  pointer-events: none;
  user-select: none;
  transition: opacity 160ms ease;
  will-change: transform;
}

.wall-console--visible {
  opacity: 1;
  pointer-events: auto;
}

/* ── 控制台：贴在 3D 台面上的实体面板 ── */
.console-face {
  position: relative;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  overflow: hidden;
  color: #e8eef6;
  background:
    linear-gradient(180deg, #1a222d 0%, #0d131b 10%, #080b10 58%, #05080c 100%);
  border: 1px solid rgb(255 255 255 / 18%);
  border-top: 2px solid var(--f1-red);
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 16%),
    inset 0 -4px 9px rgb(0 0 0 / 82%),
    inset 0 0 0 1px rgb(0 0 0 / 70%);
  clip-path: polygon(0 0, 100% 0, 100% calc(100% - 7px), calc(100% - 7px) 100%, 0 100%);
}

.console-face::before {
  position: absolute;
  inset: 0;
  background:
    repeating-linear-gradient(115deg, rgb(255 255 255 / 2.2%) 0 1px, transparent 1px 8px);
  content: '';
  opacity: 0.65;
  pointer-events: none;
}

.console-face__head {
  position: relative;
  z-index: 1;
  display: flex;
  flex: 0 0 20px;
  gap: 12px;
  align-items: center;
  box-sizing: border-box;
  padding: 0 14px;
  border-bottom: 1px solid rgb(255 255 255 / 7%);
  color: #8294a8;
  font-size: 7.5px;
  letter-spacing: 0.1em;
  line-height: 1;
  white-space: nowrap;
}

.console-face__now {
  display: flex;
  gap: 6px;
  align-items: center;
  color: #b8c6d6;
  font-weight: 700;
}

.console-face__now i {
  width: 4px;
  height: 4px;
  background: var(--f1-red);
  border-radius: 50%;
  box-shadow: 0 0 5px rgb(225 6 0 / 90%);
}

.console-face__now b {
  overflow: hidden;
  max-width: 240px;
  color: #fff;
  font-size: 8px;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-overflow: ellipsis;
}

.console-face__hint {
  flex: 1 1 auto;
  overflow: hidden;
  color: #72859a;
  font-size: 7px;
  text-align: center;
  text-overflow: ellipsis;
}

.console-face__system {
  flex: 0 0 auto;
  color: #5f7084;
  font-family: 'Consolas', 'Courier New', monospace;
  font-size: 6.5px;
  letter-spacing: 0.14em;
}

.console-face__row {
  position: relative;
  z-index: 1;
  display: flex;
  flex: 1 1 auto;
  gap: 9px;
  align-items: center;
  box-sizing: border-box;
  min-height: 0;
  padding: 0 14px;
}

/* ── 按键 ── */
.transport {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  padding: 0;
  color: #d7e1ec;
  background: transparent;
  border: 0;
  cursor: pointer;
}

.transport:focus-visible {
  outline: 2px solid #fff;
  outline-offset: 2px;
}

.transport:disabled {
  cursor: default;
  opacity: 0.4;
}

.transport--play {
  width: 50px;
  height: 50px;
  color: #fff;
  background: var(--f1-red);
  clip-path: polygon(0 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%);
  transition: background-color 120ms ease, transform 120ms ease;
}

.transport--play:hover:not(:disabled),
.transport--play:focus-visible {
  background: #ff2a1c;
}

.transport--play:active:not(:disabled) {
  transform: scale(0.94);
}

.transport--play:disabled {
  background: rgb(225 6 0 / 45%);
  opacity: 1;
}

.transport__icon {
  display: block;
  width: 20px;
  height: 20px;
}

.transport--play .transport__icon {
  width: 25px;
  height: 25px;
}

.transport__icon--stroke path {
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.transport__icon--stroke .transport__speaker {
  fill: currentColor;
  stroke: none;
}

.transport__solid {
  fill: currentColor;
  stroke: none;
}

.transport--skip {
  width: 29px;
  height: 34px;
  color: #c9d5e2;
}

.transport--skip:hover:not(:disabled),
.transport--skip:focus-visible {
  color: #fff;
}

.transport--skip .transport__icon {
  width: 26px;
  height: 26px;
}

.skip-number {
  fill: currentColor;
  stroke: none;
  font-family: 'Consolas', 'Courier New', monospace;
  font-size: 7px;
  font-weight: 700;
  text-anchor: middle;
}

.transport--mute {
  width: 24px;
  height: 32px;
  color: #cfd8e3;
}

.transport--mute:hover,
.transport--mute:focus-visible {
  color: #fff;
}

.transport--mute .transport__icon {
  width: 18px;
  height: 18px;
}

.transport__spinner {
  width: 15px;
  height: 15px;
  border: 2px solid rgb(255 255 255 / 30%);
  border-top-color: #fff;
  border-radius: 50%;
  animation: transport-spin 0.85s linear infinite;
}

/* ── 时间码 ── */
.timecode {
  display: flex;
  flex: 0 0 auto;
  gap: 3px;
  align-items: baseline;
  min-width: 92px;
  font-family: 'Consolas', 'Courier New', monospace;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.timecode__now {
  color: #fff;
  font-size: 20px;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.timecode__sep,
.timecode__total {
  color: rgb(207 216 227 / 52%);
  font-size: 9.5px;
}

/* ── 进度条 ── */
.scrub {
  position: relative;
  flex: 1 1 auto;
  height: 22px;
  min-width: 70px;
}

.scrub__track {
  position: absolute;
  top: 50%;
  right: 0;
  left: 0;
  height: 4px;
  overflow: hidden;
  background: rgb(255 255 255 / 14%);
  transform: translateY(-50%);
}

.scrub__buffer {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  background: rgb(255 255 255 / 24%);
}

.scrub__fill {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  background: var(--f1-red);
  box-shadow: 0 0 8px rgb(225 6 0 / 55%);
}

.scrub__thumb {
  position: absolute;
  top: 50%;
  width: 8px;
  height: 8px;
  background: #fff;
  border: 2px solid var(--f1-red);
  border-radius: 1px;
  box-shadow: 0 0 0 2px rgb(0 0 0 / 38%);
  transform: translate(-50%, -50%) rotate(45deg);
  transition: transform 120ms ease;
}

.scrub:hover .scrub__thumb,
.scrub:focus-within .scrub__thumb {
  transform: translate(-50%, -50%) rotate(45deg) scale(1.35);
}

.scrub__input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  background: transparent;
  cursor: pointer;
  opacity: 0;
  appearance: none;
}

.scrub__input:disabled {
  cursor: default;
}

.scrub:focus-within .scrub__track {
  box-shadow: 0 0 0 1px rgb(255 255 255 / 55%);
}

/* ── 音量 ── */
.console-volume {
  display: flex;
  flex: 0 0 auto;
  gap: 4px;
  align-items: center;
}

.volume-range {
  width: 84px;
  height: 18px;
  margin: 0;
  background: transparent;
  cursor: pointer;
  appearance: none;
}

.volume-range::-webkit-slider-runnable-track {
  height: 3px;
  background: linear-gradient(
    90deg,
    #cfd8e3 0 var(--volume, 0%),
    rgb(255 255 255 / 16%) var(--volume, 0%) 100%
  );
}

.volume-range::-moz-range-track {
  height: 3px;
  background: linear-gradient(
    90deg,
    #cfd8e3 0 var(--volume, 0%),
    rgb(255 255 255 / 16%) var(--volume, 0%) 100%
  );
}

.volume-range::-webkit-slider-thumb {
  width: 8px;
  height: 8px;
  margin-top: -2.5px;
  background: #fff;
  border: 0;
  border-radius: 50%;
  appearance: none;
}

.volume-range::-moz-range-thumb {
  width: 8px;
  height: 8px;
  background: #fff;
  border: 0;
  border-radius: 50%;
}

.volume-range:focus-visible {
  outline: 1px solid rgb(255 255 255 / 60%);
  outline-offset: 2px;
}

.console-volume__value {
  min-width: 28px;
  color: rgb(207 216 227 / 62%);
  font-family: 'Consolas', 'Courier New', monospace;
  font-size: 8px;
  font-variant-numeric: tabular-nums;
  text-align: right;
}

/* ── 格式徽标 ── */
.format-chip {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 27px;
  height: 18px;
  color: #7fe7ff;
  border: 1px solid rgb(127 231 255 / 45%);
  font-family: 'Consolas', 'Courier New', monospace;
  font-size: 7px;
  font-weight: 700;
  letter-spacing: 0.1em;
}

/* ── 控制台螺钉 ── */
.console-screw {
  position: absolute;
  z-index: 2;
  width: 6px;
  height: 6px;
  background: radial-gradient(circle at 35% 30%, #a8b6c6 0 16%, #46515f 55%, #090d13 100%);
  border: 1px solid rgb(255 255 255 / 14%);
  border-radius: 50%;
  box-shadow: inset 0 0 0 1px rgb(0 0 0 / 55%);
}

.console-screw--tl { top: 5px; left: 5px; }
.console-screw--tr { top: 5px; right: 5px; }
.console-screw--bl { bottom: 5px; left: 5px; }
.console-screw--br { right: 5px; bottom: 5px; }

.wall-console--compact .console-face__head {
  flex-basis: 16px;
  padding: 0 10px;
}

.wall-console--compact .console-face__hint,
.wall-console--compact .console-face__system,
.wall-console--compact .console-volume__value,
.wall-console--compact .format-chip {
  display: none;
}

.wall-console--compact .console-face__row {
  gap: 6px;
  padding: 0 10px;
}

.wall-console--compact .transport--play {
  width: 38px;
  height: 38px;
}

.wall-console--compact .volume-range {
  width: 42px;
}

.wall-console--compact .timecode {
  min-width: 78px;
}

.wall-console--compact .timecode__now {
  font-size: 15px;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

@keyframes transport-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .wall-console {
    transition: none;
  }

  .transport__spinner {
    animation: none;
  }

  .scrub__thumb {
    transition: none;
  }
}
</style>
