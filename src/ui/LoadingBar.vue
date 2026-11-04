<script setup lang="ts">
/**
 * 加载进度条 —— 纯 DOM 组件，不 import three（架构约定：ui/ 只操作 DOM）。
 *
 * 三种状态：
 * 1. 有总量 → 显示真实百分比
 * 2. 没有总量（服务器没给 Content-Length）→ 显示来回流动的动画，避免假的百分比
 * 3. 失败 → 显示错误标题、原因和「重新加载」按钮，保证不会白屏（架构约定 §5.5）
 */
import { computed } from 'vue';

interface Props {
  /** 0~1 的加载比例；0 表示还不知道总量 */
  ratio: number;
  /** 失败信息；为 null 时表示没出错 */
  error: string | null;
  /** 失败标题，按失败层级区分（车模加载 / 场景初始化 / 显卡上下文） */
  errorTitle?: string;
}

const props = withDefaults(defineProps<Props>(), {
  errorTitle: '车模加载失败',
});
const emit = defineEmits<{ retry: [] }>();

const percent = computed(() => Math.round(props.ratio * 100));
const isIndeterminate = computed(() => props.ratio <= 0);
// 下载已满但模型还在解析（PNG 贴图解码、材质编译），这段时间要单独给个说法，
// 否则进度条会一直卡在 100%，看起来像卡死了
const isDecoding = computed(() => props.ratio >= 0.999);
</script>

<template>
  <div class="loading" role="status" aria-live="polite">
    <template v-if="props.error">
      <p class="loading__error">{{ props.errorTitle }}</p>
      <p class="loading__detail">{{ props.error }}</p>
      <button class="loading__retry" type="button" @click="emit('retry')">重新加载</button>
      <p class="loading__detail">
        若仍失败，请换用新版 Chrome / Edge，并确认设备支持 WebGL 2。
      </p>
    </template>

    <template v-else>
      <div class="loading__bar">
        <div
          class="loading__fill"
          :class="{ 'loading__fill--indeterminate': isIndeterminate }"
          :style="isIndeterminate ? undefined : { width: `${percent}%` }"
        />
      </div>
      <p class="loading__text">
        {{
          isIndeterminate
            ? '正在加载车模…'
            : isDecoding
              ? '正在解析车模（几何与贴图解码）…'
              : `正在加载车模 ${percent}%`
        }}
      </p>
    </template>
  </div>
</template>

<style scoped>
.loading {
  position: absolute;
  /* 压过热点卡片与 CSS2D 图层：加载失败/进度期间它是唯一该被看到的东西 */
  z-index: 7;
  left: 50%;
  bottom: 48px;
  width: min(380px, 74vw);
  padding: 14px 18px;
  border: 1px solid rgb(255 255 255 / 10%);
  border-radius: 12px;
  background: rgb(16 20 26 / 78%);
  box-shadow: 0 8px 32px rgb(0 0 0 / 35%);
  color: #d7e0ea;
  font-size: 13px;
  letter-spacing: 0.02em;
  transform: translateX(-50%);
  backdrop-filter: blur(10px);
}

.loading__bar {
  height: 4px;
  overflow: hidden;
  border-radius: 999px;
  background: rgb(255 255 255 / 12%);
}

.loading__fill {
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #2f6bff, #7aa2ff);
  transition: width 0.2s ease-out;
}

/* 总量未知时：固定宽度来回扫，配合 1.2s 循环看起来像「还在动」 */
.loading__fill--indeterminate {
  width: 42%;
  animation: loading-sweep 1.2s ease-in-out infinite;
}

@keyframes loading-sweep {
  0% {
    transform: translateX(-110%);
  }

  100% {
    transform: translateX(250%);
  }
}

.loading__text {
  margin: 10px 0 0;
  color: #9fb3c8;
  font-variant-numeric: tabular-nums;
}

.loading__error {
  margin: 0 0 6px;
  color: #ff8f8f;
  font-weight: 600;
}

.loading__detail {
  margin: 4px 0 0;
  color: #9fb3c8;
  font-size: 12px;
  line-height: 1.6;
  word-break: break-word;
}

.loading__retry {
  margin-top: 10px;
  padding: 6px 14px;
  border: 1px solid rgb(225 6 0 / 55%);
  border-radius: 4px;
  background: rgb(225 6 0 / 14%);
  color: #ffd7d5;
  font: inherit;
  font-size: 12px;
  letter-spacing: 0.08em;
  cursor: pointer;
}

.loading__retry:hover,
.loading__retry:focus-visible {
  border-color: var(--f1-red, #e10600);
  background: rgb(225 6 0 / 26%);
  outline: none;
}
</style>
