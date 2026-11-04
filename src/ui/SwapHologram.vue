<script setup lang="ts">
/**
 * 换模全息提示（DOM 层）。
 *
 * 为什么不做成 3D 面板：需求要求它固定在展示台前端中心、水平居中、不随相机
 * 透视歪斜、不被闸口和地板遮挡。3D 面板活在世界空间里，屏幕位置必然随相机
 * 移动，平贴在场景里也会被透视拉斜；DOM 覆盖层天然是屏幕空间锚定，
 * 层级永远在 canvas（闸口 / 地板）之上，改分辨率也不会错位。
 *
 * 只负责表现：模式、进度、目标档位、淡入淡出时长全部由 App.vue 传入。
 * 时长由配置驱动，App 会按同一组秒数等待「完全显示」后再开始计时。
 */
import { computed, ref, watch } from 'vue';

type HologramMode = 'hidden' | 'loading' | 'success';

interface Props {
  readonly mode: HologramMode;
  /** 已显示的进度 0~1；App 保证它单调递增，加载完成前不超过 0.9 */
  readonly progress: number;
  /** 目标画质名，如「高精度」 */
  readonly label: string;
  readonly fadeInSeconds: number;
  readonly fadeOutSeconds: number;
}

const props = defineProps<Props>();

/**
 * 内容态：淡出时 mode 已经是 hidden，但卡片还要保持淡出前的内容
 * （否则「切换成功」会在淡出的半秒里变回「车辆切换中」）。
 */
const displayMode = ref<Exclude<HologramMode, 'hidden'>>('loading');
watch(
  () => props.mode,
  (mode) => {
    if (mode !== 'hidden') displayMode.value = mode;
  },
  { immediate: true },
);

const visible = computed(() => props.mode !== 'hidden');
const success = computed(() => displayMode.value === 'success');
const percent = computed(() => Math.round(Math.min(1, Math.max(0, props.progress)) * 100));

/** 淡入淡出时长来自配置：App 用同一组数字等待过渡结束，两边不会各写一份 */
const style = computed(() => ({
  '--holo-fade-in': `${props.fadeInSeconds}s`,
  '--holo-fade-out': `${props.fadeOutSeconds}s`,
  '--holo-progress': `${percent.value}%`,
}));
</script>

<template>
  <div
    class="holo"
    :class="{ 'holo--visible': visible, 'holo--success': success }"
    :style="style"
    :aria-hidden="!visible"
  >
    <!-- 粒子 / 扫描线只是氛围：全部 aria-hidden，读屏器靠 App 的阶段播报 -->
    <div class="holo__fx" aria-hidden="true">
      <span class="holo__scan" />
      <span class="holo__particle" />
      <span class="holo__particle" />
      <span class="holo__particle" />
    </div>

    <div class="holo__frame">
      <p class="holo__eyebrow">
        {{ success ? 'MODEL EXCHANGE · READY' : 'MODEL EXCHANGE · LOADING' }}
      </p>

      <div class="holo__body">
        <div class="holo__text">
          <p class="holo__title">{{ success ? '切换成功' : '车辆切换中' }}</p>
          <p class="holo__subtitle">
            {{ success ? `${label}模型已就位 · RB22` : `正在装载${label}模型 · RB22` }}
          </p>
        </div>

        <p v-if="!success" class="holo__percent">
          {{ percent }}<span class="holo__unit">%</span>
        </p>
        <span v-else class="holo__check" aria-hidden="true">✓</span>
      </div>

      <div
        v-if="!success"
        class="holo__bar"
        role="progressbar"
        :aria-label="`正在装载${label}模型`"
        aria-valuemin="0"
        aria-valuemax="100"
        :aria-valuenow="percent"
      >
        <span class="holo__fill" />
        <span class="holo__sheen" />
      </div>

      <p v-if="!success" class="holo__foot">
        <span>LOADING</span>
        <span>{{ label }} MODEL</span>
      </p>
    </div>
  </div>
</template>

<style scoped>
/*
 * 屏幕空间锚定：left 50% + translateX(-50%)，与相机、车模旋转、升降台都无关。
 * bottom 让开底部居中的画质控件（约 98px 高），落在展台前沿上方这块空地上。
 */
.holo {
  position: absolute;
  bottom: 118px;
  left: 50%;
  z-index: 8;
  width: min(420px, calc(100vw - 32px));
  opacity: 0;
  transform: translate(-50%, 10px);
  /* 基态按「淡出」时长：移除 --visible 时读的就是这一条 */
  transition:
    opacity var(--holo-fade-out) ease,
    transform var(--holo-fade-out) ease;
  pointer-events: none;
  will-change: opacity, transform;
}

.holo--visible {
  opacity: 1;
  transform: translate(-50%, 0);
  transition-duration: var(--holo-fade-in);
}

.holo__frame {
  position: relative;
  padding: 13px 18px 12px;
  overflow: hidden;
  border: 1px solid rgb(124 236 255 / 32%);
  background:
    radial-gradient(120% 160% at 50% 0%, rgb(80 220 255 / 14%), transparent 62%),
    linear-gradient(180deg, rgb(6 20 28 / 76%), rgb(3 11 17 / 86%));
  box-shadow:
    0 18px 46px rgb(0 0 0 / 52%),
    0 0 34px rgb(80 220 255 / 16%),
    inset 0 0 28px rgb(80 220 255 / 7%),
    inset 0 1px 0 rgb(190 250 255 / 16%);
  clip-path: polygon(0 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%);
  backdrop-filter: blur(10px);
}

/* 四角括号：只有边角，不画完整外框，比一圈描边更像投影 */
.holo__frame::before,
.holo__frame::after {
  position: absolute;
  width: 16px;
  height: 16px;
  content: '';
  border-color: rgb(190 250 255 / 78%);
  pointer-events: none;
}

.holo__frame::before {
  top: 5px;
  left: 5px;
  border-top: 2px solid;
  border-left: 2px solid;
}

.holo__frame::after {
  right: 5px;
  bottom: 5px;
  border-right: 2px solid;
  border-bottom: 2px solid;
}

/* 氛围层：扫描线 + 上升粒子，全部裁在面板内，不干扰文字 */
.holo__fx {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
}

.holo__scan {
  position: absolute;
  top: -45%;
  left: 0;
  width: 100%;
  height: 45%;
  background: linear-gradient(180deg, transparent, rgb(140 245 255 / 12%), transparent);
  animation: holo-scan 3.4s linear infinite;
}

.holo__particle {
  position: absolute;
  bottom: 8%;
  width: 2px;
  height: 7px;
  background: #9af3ff;
  box-shadow: 0 0 6px rgb(124 236 255 / 80%);
  opacity: 0;
  animation: holo-rise 3.8s linear infinite;
}

.holo__particle:nth-child(2) {
  left: 18%;
  animation-delay: 0.9s;
}

.holo__particle:nth-child(3) {
  left: 52%;
  height: 5px;
  animation-delay: 2.1s;
}

.holo__particle:nth-child(4) {
  left: 81%;
  animation-delay: 3s;
}

/* 眉标 / 标题 / 副标题 */
.holo__eyebrow {
  margin: 0 0 9px;
  color: rgb(124 236 255 / 58%);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.24em;
  line-height: 1;
}

.holo__body {
  display: flex;
  gap: 14px;
  align-items: flex-end;
  justify-content: space-between;
}

.holo__text {
  min-width: 0;
}

.holo__title {
  margin: 0;
  color: #eafdff;
  font-size: 18px;
  font-weight: 700;
  letter-spacing: 0.14em;
  line-height: 1.2;
  text-shadow: 0 0 18px rgb(124 236 255 / 42%);
}

.holo__subtitle {
  margin: 6px 0 0;
  overflow: hidden;
  color: rgb(190 244 255 / 66%);
  font-size: 10px;
  letter-spacing: 0.08em;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.holo__percent {
  margin: 0;
  color: #cdfbff;
  font-size: 34px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
  line-height: 0.9;
  text-shadow: 0 0 20px rgb(124 236 255 / 50%);
}

.holo__unit {
  margin-left: 2px;
  font-size: 15px;
  font-weight: 700;
  color: rgb(190 244 255 / 68%);
}

/* 成功态：一个发光对勾取代百分比，宽度和位置都不变，不会「跳一下」 */
.holo__check {
  display: grid;
  width: 40px;
  height: 40px;
  place-items: center;
  border: 1px solid rgb(141 255 208 / 52%);
  border-radius: 50%;
  color: #a5ffdc;
  font-size: 20px;
  font-weight: 700;
  text-shadow: 0 0 16px rgb(141 255 208 / 65%);
  box-shadow:
    0 0 18px rgb(141 255 208 / 22%),
    inset 0 0 12px rgb(141 255 208 / 12%);
}

/* 进度条：填充宽度直接用 App 每帧推进的百分比，肉眼看不到台阶 */
.holo__bar {
  position: relative;
  height: 6px;
  margin-top: 11px;
  overflow: hidden;
  background: rgb(124 236 255 / 10%);
  box-shadow: inset 0 0 0 1px rgb(124 236 255 / 12%);
}

.holo__fill {
  position: absolute;
  inset: 0 auto 0 0;
  width: var(--holo-progress);
  background: linear-gradient(90deg, #3fd6f5, #7cecff 68%, #e6feff);
  box-shadow: 0 0 12px rgb(124 236 255 / 62%);
}

.holo__sheen {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 34%;
  background: linear-gradient(90deg, transparent, rgb(255 255 255 / 42%), transparent);
  animation: holo-sheen 1.5s linear infinite;
}

.holo__foot {
  display: flex;
  justify-content: space-between;
  margin: 8px 0 0;
  color: rgb(124 236 255 / 42%);
  font-size: 8px;
  font-weight: 700;
  letter-spacing: 0.2em;
  line-height: 1;
}

.holo--success .holo__subtitle {
  color: rgb(165 255 220 / 72%);
}

.holo--success .holo__eyebrow {
  color: rgb(165 255 220 / 55%);
}

.holo--success .holo__frame {
  border-color: rgb(141 255 208 / 34%);
}

@keyframes holo-scan {
  from {
    top: -45%;
  }

  to {
    top: 105%;
  }
}

@keyframes holo-sheen {
  from {
    left: -38%;
  }

  to {
    left: 104%;
  }
}

@keyframes holo-rise {
  0% {
    opacity: 0;
    transform: translateY(0);
  }

  18% {
    opacity: 0.7;
  }

  100% {
    opacity: 0;
    transform: translateY(-72px);
  }
}

@media (max-width: 640px) {
  .holo {
    /* 让开底部更矮的画质控件 */
    bottom: 96px;
    width: calc(100vw - 24px);
  }

  .holo__frame {
    padding: 11px 14px 10px;
  }

  .holo__title {
    font-size: 16px;
  }

  .holo__percent {
    font-size: 28px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .holo__scan,
  .holo__particle,
  .holo__sheen {
    animation: none;
  }

  .holo__particle {
    display: none;
  }

  .holo {
    transition-duration: 0.01s;
  }
}
</style>
