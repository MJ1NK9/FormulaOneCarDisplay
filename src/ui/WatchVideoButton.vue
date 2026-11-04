<script setup lang="ts">
/**
 * 「观看视频」模式开关 —— 页面右上角的 F1 风格按钮。
 *
 * 只做 DOM：真正的相机锁定 / 隐藏遮挡物由 App.vue 处理，这里只抛 toggle。
 * 按钮在普通模式和观看模式共用，文案和图标随状态切换，保证用户随时能退出。
 */
defineProps<{
  /** 当前是否处于观看视频模式 */
  readonly watching: boolean;
  /** 车辆切换 / 场景未就绪时禁用，避免和升降动画抢相机 */
  readonly disabled?: boolean;
}>();

const emit = defineEmits<{ toggle: [] }>();
</script>

<template>
  <button
    class="watch-video"
    :class="{ 'watch-video--active': watching }"
    type="button"
    :disabled="disabled"
    :aria-pressed="watching"
    :aria-label="watching ? '退出观看视频，恢复原视角' : '观看视频：正对前墙视频'"
    @click="emit('toggle')"
  >
    <span class="watch-video__icon" aria-hidden="true">
      <svg v-if="watching" viewBox="0 0 24 24">
        <path class="watch-video__fill" d="M6 6h12v12H6z" />
      </svg>
      <svg v-else viewBox="0 0 24 24">
        <path class="watch-video__fill" d="M8 5v14l11-7z" />
      </svg>
    </span>

    <span class="watch-video__copy">
      <span class="watch-video__eyebrow">{{ watching ? 'EXIT VIDEO VIEW' : 'VIDEO WALL' }}</span>
      <span class="watch-video__title">{{ watching ? '退出观看' : '观看视频' }}</span>
    </span>

    <span class="watch-video__corner" aria-hidden="true" />
  </button>
</template>

<style scoped>
.watch-video {
  position: absolute;
  top: 22px;
  right: 280px;
  z-index: 5;
  display: flex;
  gap: 11px;
  align-items: center;
  min-width: 0;
  padding: 11px 18px 11px 14px;
  border: 1px solid rgb(255 255 255 / 16%);
  border-left: 3px solid var(--f1-red);
  background:
    linear-gradient(135deg, rgb(225 6 0 / 18%), transparent 52%),
    rgb(12 13 18 / 86%);
  box-shadow:
    0 18px 44px rgb(0 0 0 / 42%),
    inset 0 1px 0 rgb(255 255 255 / 6%);
  color: #eef2f7;
  font: inherit;
  text-align: left;
  cursor: pointer;
  backdrop-filter: blur(14px);
  clip-path: polygon(0 0, 100% 0, 100% calc(100% - 12px), calc(100% - 12px) 100%, 0 100%);
  transition:
    border-color 0.18s ease,
    background-color 0.18s ease,
    color 0.18s ease;
}

.watch-video:hover:not(:disabled) {
  border-color: rgb(255 255 255 / 32%);
  border-left-color: var(--f1-red);
  background:
    linear-gradient(135deg, rgb(225 6 0 / 28%), transparent 55%),
    rgb(18 20 27 / 92%);
}

.watch-video:focus-visible {
  outline: 2px solid var(--f1-red);
  outline-offset: 3px;
}

.watch-video:disabled {
  cursor: default;
  opacity: 0.5;
}

.watch-video--active {
  right: 22px;
  background: var(--f1-red);
  border-color: var(--f1-red);
  color: #fff;
}

.watch-video--active:hover:not(:disabled) {
  background: #ff2a1c;
  border-color: #ff2a1c;
}

.watch-video__icon {
  display: grid;
  flex: 0 0 auto;
  width: 30px;
  height: 30px;
  place-items: center;
  border: 1px solid rgb(255 255 255 / 24%);
  background: rgb(255 255 255 / 6%);
  clip-path: polygon(0 0, 100% 0, 100% calc(100% - 7px), calc(100% - 7px) 100%, 0 100%);
}

.watch-video--active .watch-video__icon {
  background: rgb(0 0 0 / 18%);
  border-color: rgb(255 255 255 / 45%);
}

.watch-video__icon svg {
  display: block;
  width: 18px;
  height: 18px;
}

.watch-video__fill {
  fill: currentColor;
}

.watch-video__copy {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.watch-video__eyebrow {
  color: rgb(255 255 255 / 46%);
  font-size: 8px;
  font-weight: 800;
  letter-spacing: 0.2em;
  line-height: 1;
  white-space: nowrap;
}

.watch-video__title {
  color: #fff;
  font-size: 14px;
  font-weight: 800;
  letter-spacing: 0.1em;
  line-height: 1.1;
  white-space: nowrap;
}

.watch-video--active .watch-video__eyebrow {
  color: rgb(255 255 255 / 72%);
}

.watch-video__corner {
  position: absolute;
  top: 0;
  right: 0;
  width: 46px;
  height: 2px;
  background: var(--f1-red);
}

.watch-video--active .watch-video__corner {
  display: none;
}

@media (max-width: 640px) {
  .watch-video {
    top: 80px;
    right: 12px;
    gap: 8px;
    padding: 8px 12px 8px 10px;
  }

  .watch-video__icon {
    width: 26px;
    height: 26px;
  }

  .watch-video__icon svg {
    width: 15px;
    height: 15px;
  }

  .watch-video__eyebrow {
    font-size: 7px;
  }

  .watch-video__title {
    font-size: 12px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .watch-video {
    transition: none;
  }
}
</style>
