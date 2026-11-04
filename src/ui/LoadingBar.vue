<script setup lang="ts">
/**
 * 加载进度条 —— 纯 DOM 组件，不 import three（架构约定：ui/ 只操作 DOM）。
 *
 * 两种状态：
 * 1. 有总量 → 显示真实百分比
 * 2. 没有总量（服务器没给 Content-Length）→ 显示来回流动的动画，避免假的百分比
 * 加载失败时整块变成错误提示，保证不会白屏（架构约定 §5.5）。
 */
import { computed } from 'vue';

interface Props {
  /** 0~1 的加载比例；0 表示还不知道总量 */
  ratio: number;
  /** 失败信息；为 null 时表示没出错 */
  error: string | null;
}

const props = defineProps<Props>();

const percent = computed(() => Math.round(props.ratio * 100));
const isIndeterminate = computed(() => props.ratio <= 0);
// 下载已满但模型还在解析（PNG 贴图解码、材质编译），这段时间要单独给个说法，
// 否则进度条会一直卡在 100%，看起来像卡死了
const isDecoding = computed(() => props.ratio >= 0.999);
</script>

<template>
  <div class="loading" role="status" aria-live="polite">
    <template v-if="props.error">
      <p class="loading__error">车模加载失败</p>
      <p class="loading__detail">{{ props.error }}</p>
      <p class="loading__detail">请刷新重试；若持续失败，看控制台里具体是哪个资源 404。</p>
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
</style>
