<script setup lang="ts">
/**
 * 换模失败操作条 —— 只在加载失败、闸口保持关闭时出现。
 *
 * 为什么要有这条 DOM 面板：这里是必须能点、能 Tab 聚焦、能被读屏器读到的按钮。
 * 失败时全息提示（ui/SwapHologram.vue）已经收起，失败信息和操作都集中在这一条上。
 */
interface Props {
  /** 「高精度模型切换失败」 */
  readonly title: string;
  /** 具体错误文本 */
  readonly detail: string;
  /** 返回按钮的文案，如「返回低精度」 */
  readonly backLabel: string;
}

const props = defineProps<Props>();
const emit = defineEmits<{ retry: []; back: [] }>();
</script>

<template>
  <div class="swap-fail" role="alert">
    <p class="swap-fail__eyebrow">MODEL EXCHANGE · FAULT</p>
    <p class="swap-fail__title">{{ props.title }}</p>
    <p class="swap-fail__detail" :title="props.detail">{{ props.detail }}</p>
    <div class="swap-fail__actions">
      <button type="button" class="swap-fail__action swap-fail__action--primary" @click="emit('retry')">
        重试
      </button>
      <button type="button" class="swap-fail__action" @click="emit('back')">
        {{ props.backLabel }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.swap-fail {
  position: absolute;
  bottom: 20px;
  left: 50%;
  z-index: 7;
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: center;
  width: min(460px, calc(100vw - 32px));
  padding: 14px 18px 16px;
  border: 1px solid rgb(255 107 94 / 34%);
  background:
    radial-gradient(120% 90% at 50% 0%, rgb(255 90 80 / 12%), transparent 70%),
    linear-gradient(180deg, rgb(22 16 18 / 92%), rgb(12 10 13 / 94%));
  box-shadow:
    0 18px 46px rgb(0 0 0 / 48%),
    inset 0 1px 0 rgb(255 255 255 / 6%),
    0 0 24px rgb(255 90 80 / 12%);
  clip-path: polygon(0 0, 100% 0, 100% calc(100% - 14px), calc(100% - 14px) 100%, 0 100%);
  transform: translateX(-50%);
  backdrop-filter: blur(14px);
  animation: swap-fail-in 240ms ease-out;
}

.swap-fail__eyebrow {
  margin: 0;
  color: rgb(255 150 140 / 62%);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.24em;
  line-height: 1;
}

.swap-fail__title {
  margin: 0;
  color: #fff;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.08em;
  line-height: 1.3;
  text-align: center;
}

/* -loader 的原始报错可能很长，最多两行，完整内容挂在 title 上 */
.swap-fail__detail {
  display: -webkit-box;
  margin: 0;
  overflow: hidden;
  color: rgb(255 186 178 / 78%);
  font-size: 10px;
  letter-spacing: 0.04em;
  line-height: 1.5;
  text-align: center;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.swap-fail__actions {
  display: flex;
  gap: 10px;
  margin-top: 4px;
}

.swap-fail__action {
  min-width: 108px;
  padding: 8px 16px;
  border: 1px solid rgb(255 255 255 / 18%);
  background: rgb(255 255 255 / 4%);
  color: rgb(255 255 255 / 78%);
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  cursor: pointer;
  transition:
    background-color 0.18s ease,
    color 0.18s ease,
    border-color 0.18s ease;
}

.swap-fail__action:hover,
.swap-fail__action:focus-visible {
  border-color: rgb(255 255 255 / 34%);
  background: rgb(255 255 255 / 10%);
  color: #fff;
  outline: none;
}

.swap-fail__action--primary {
  border-color: rgb(255 107 94 / 55%);
  background: rgb(225 6 0 / 26%);
  color: #fff;
}

.swap-fail__action--primary:hover,
.swap-fail__action--primary:focus-visible {
  border-color: rgb(255 140 130 / 80%);
  background: rgb(225 6 0 / 42%);
}

.swap-fail__action:focus-visible {
  outline: 2px solid rgb(255 150 140 / 80%);
  outline-offset: 2px;
}

@keyframes swap-fail-in {
  from {
    opacity: 0;
    transform: translate(-50%, 8px);
  }

  to {
    opacity: 1;
    transform: translateX(-50%);
  }
}

@media (max-width: 640px) {
  .swap-fail {
    bottom: 12px;
    padding: 12px 14px 14px;
  }

  .swap-fail__action {
    min-width: 92px;
    padding: 7px 12px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .swap-fail {
    animation: none;
  }
}
</style>
