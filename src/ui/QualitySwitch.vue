<script setup lang="ts">
/**
 * 画质切换 —— 页面底部居中的分段控件。
 *
 * 为什么是「底部居中」而不是页面正中：正中就是车身，浮在那里的控件会同时压住车头
 * 和热点圆点，窄屏上还会和贴底抽屉式的信息卡抢同一块地方。横向仍然居中，纵向落在
 * 车前地面这块空地上，既显眼又不挡模型。
 *
 * 只做 DOM：换来换去由 App.vue 负责（要拆热点、释放显存），这里只抛 change 事件，
 * 并在等待期间禁用按钮、显示下载进度——用户点完没反应是最糟的反馈。
 */
import { computed } from 'vue';
import { MODEL_QUALITIES, MODEL_VARIANTS, type ModelQuality } from '../config/model';

interface Props {
  /** 当前生效的档位 */
  readonly quality: ModelQuality;
  /** 正在加载另一档：期间禁用点击，避免同时跑两份解码 */
  readonly busy: boolean;
  /** 切换失败、已回退时的一句话提示；null 表示没有 */
  readonly notice?: string | null;
}

const props = defineProps<Props>();
const emit = defineEmits<{ change: [quality: ModelQuality] }>();

const options = computed(() =>
  MODEL_QUALITIES.map((value) => ({
    value,
    label: MODEL_VARIANTS[value].label,
    size: `${Math.round(MODEL_VARIANTS[value].bytes / (1024 * 1024))} MB`,
  })),
);
</script>

<template>
  <div class="quality" role="group" aria-label="模型画质">
    <span class="quality__eyebrow">模型画质</span>

    <div class="quality__options">
      <button
        v-for="option in options"
        :key="option.value"
        type="button"
        class="quality__option"
        :class="{ 'quality__option--active': option.value === props.quality }"
        :aria-pressed="option.value === props.quality"
        :disabled="props.busy"
        @click="emit('change', option.value)"
      >
        <span class="quality__label">{{ option.label }}</span>
        <span class="quality__size">{{ option.size }}</span>
      </button>
    </div>

    <p v-if="props.notice" class="quality__notice" role="status" aria-live="polite">
      {{ props.notice }}
    </p>
  </div>
</template>

<style scoped>
.quality {
  position: absolute;
  bottom: 20px;
  left: 50%;
  z-index: 5;
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: center;
  padding: 10px 14px 12px;
  border: 1px solid rgb(255 255 255 / 12%);
  background: linear-gradient(180deg, rgb(20 22 28 / 82%), rgb(12 13 18 / 88%));
  box-shadow:
    0 18px 44px rgb(0 0 0 / 42%),
    inset 0 1px 0 rgb(255 255 255 / 6%);
  /* 和热点开关、信息卡同一套 F1 切角语言，右下角缺一小块 */
  clip-path: polygon(0 0, 100% 0, 100% calc(100% - 12px), calc(100% - 12px) 100%, 0 100%);
  transform: translateX(-50%);
  backdrop-filter: blur(14px);
  animation: quality-in 260ms ease-out;
}

.quality__eyebrow {
  color: rgb(255 255 255 / 38%);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.22em;
  line-height: 1;
}

.quality__options {
  display: flex;
  border: 1px solid rgb(255 255 255 / 12%);
}

.quality__option {
  display: flex;
  flex-direction: column;
  gap: 2px;
  align-items: flex-start;
  min-width: 92px;
  padding: 7px 14px;
  border: 0;
  border-left: 1px solid rgb(255 255 255 / 8%);
  background: transparent;
  color: rgb(255 255 255 / 58%);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition:
    background-color 0.18s ease,
    color 0.18s ease;
}

.quality__option:first-child {
  border-left: 0;
}

.quality__option:hover:not(:disabled) {
  background: rgb(255 255 255 / 6%);
  color: #fff;
}

/* 选中档：底色透红 + 底部一条红边，不看色也能靠位置分辨 */
.quality__option--active {
  background: rgb(225 6 0 / 16%);
  color: #fff;
  box-shadow: inset 0 -2px 0 var(--f1-red);
}

.quality__option:disabled {
  cursor: progress;
  opacity: 0.55;
}

.quality__option:focus-visible {
  outline: 2px solid var(--f1-red);
  outline-offset: 2px;
}

.quality__label {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  line-height: 1.2;
}

.quality__size {
  color: rgb(255 255 255 / 42%);
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.12em;
  line-height: 1;
}

/* 回退提示用琥珀色：和「选中档」的红色区分开，一眼能看出这是结果而不是进度 */
.quality__notice {
  margin: 0;
  color: #ffcf70;
  font-size: 10px;
  letter-spacing: 0.08em;
  line-height: 1;
}

@keyframes quality-in {
  from {
    opacity: 0;
    transform: translate(-50%, 6px);
  }

  to {
    opacity: 1;
    transform: translateX(-50%);
  }
}

@media (max-width: 640px) {
  .quality {
    bottom: 12px;
    padding: 8px 10px 10px;
  }

  .quality__option {
    min-width: 78px;
    padding: 6px 10px;
  }

  .quality__label {
    font-size: 11px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .quality {
    animation: none;
  }
}
</style>
