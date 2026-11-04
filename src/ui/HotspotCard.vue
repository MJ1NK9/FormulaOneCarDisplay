<script setup lang="ts">
/**
 * HotspotCard —— 热点信息浮窗。
 *
 * 只做 DOM：不 import three、不算投影。位置由 useHotspots 投影好之后通过 anchor 传进来，
 * 这里只负责「贴着锚点摆、贴边收、顶部放不下就翻到下方」。
 *
 * 视觉走 F1 官方那套语言：F1 红 + 近黑底、切角卡片、全大写窄字距标签、
 * 数字用 tabular-nums（规格值不跳动）；窄屏（≤ sheetBreakpoint）切成贴底抽屉，
 * 因为手机上跟着手指点走的浮窗很容易一半在屏幕外。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { HOTSPOT_VIEW_CONFIG } from '../config/hotspot';
import type { Hotspot, HotspotScreenAnchor } from '../types/hotspot';

interface Props {
  /** 当前热点；null 时整块不渲染 */
  hotspot: Hotspot | null;
  /** 圆点在屏幕上的位置；null 表示这次投影不可用 */
  anchor: HotspotScreenAnchor | null;
}

const props = defineProps<Props>();
const emit = defineEmits<{ close: [] }>();

const visible = computed(() => Boolean(props.hotspot && props.anchor));
const title = computed(() => props.hotspot?.title ?? '');
const label = computed(() => props.hotspot?.label ?? '');
const summary = computed(() => props.hotspot?.summary ?? '');
const specs = computed(() => props.hotspot?.specs ?? []);
const source = computed(() => props.hotspot?.source ?? null);

/** 窄屏吸附成抽屉：用 matchMedia 而不是 CSS 断点，因为定位样式也要跟着停用 */
const compact = ref(false);
let mediaQuery: MediaQueryList | null = null;

function syncCompact(): void {
  compact.value = mediaQuery?.matches ?? false;
}

onMounted(() => {
  mediaQuery = window.matchMedia(`(max-width: ${HOTSPOT_VIEW_CONFIG.card.sheetBreakpoint}px)`);
  syncCompact();
  mediaQuery.addEventListener('change', syncCompact);
});

onBeforeUnmount(() => {
  mediaQuery?.removeEventListener('change', syncCompact);
  mediaQuery = null;
});

/** 默认在圆点上方；上方连卡片最大高度都放不下时翻到下方 */
const placement = computed<'above' | 'below'>(() => {
  if (!props.anchor) return 'above';
  const { maxHeight, gap, viewportMargin } = HOTSPOT_VIEW_CONFIG.card;
  return props.anchor.y - maxHeight - gap < viewportMargin ? 'below' : 'above';
});

const cardStyle = computed<Record<string, string>>(() => {
  const { width, maxHeight, gap } = HOTSPOT_VIEW_CONFIG.card;
  const style: Record<string, string> = {
    '--hotspot-card-width': `${width}px`,
    '--hotspot-card-max-height': `${maxHeight}px`,
    '--hotspot-card-gap': `${gap}px`,
  };

  // 抽屉模式靠 CSS 定位，不能再写 left/top，否则会覆盖 bottom 定位
  if (!props.anchor || compact.value) return style;

  return { ...style, left: `${props.anchor.x}px`, top: `${props.anchor.y}px` };
});
</script>

<template>
  <aside
    v-if="visible"
    class="hotspot-card"
    :class="[`hotspot-card--${placement}`, { 'hotspot-card--sheet': compact }]"
    :style="cardStyle"
    role="dialog"
    aria-modal="false"
    :aria-label="title"
  >
    <header class="hotspot-card__head">
      <p class="hotspot-card__eyebrow">
        <span class="hotspot-card__brand">RB22</span>
        <span class="hotspot-card__sep" aria-hidden="true">/</span>
        <span class="hotspot-card__label">{{ label }}</span>
      </p>
      <button class="hotspot-card__close" type="button" aria-label="关闭信息" @click="emit('close')">
        <span class="hotspot-card__close-icon" aria-hidden="true"></span>
      </button>
    </header>

    <h2 class="hotspot-card__title">{{ title }}</h2>
    <p class="hotspot-card__summary">{{ summary }}</p>

    <dl v-if="specs.length" class="hotspot-card__specs">
      <div v-for="spec in specs" :key="spec.label" class="hotspot-card__spec">
        <dt>{{ spec.label }}</dt>
        <dd>{{ spec.value }}</dd>
      </div>
    </dl>

    <a
      v-if="source"
      class="hotspot-card__source"
      :href="source.url"
      target="_blank"
      rel="noopener noreferrer"
    >
      {{ source.label }}
      <span class="hotspot-card__source-arrow" aria-hidden="true">↗</span>
    </a>
  </aside>
</template>

<style scoped>
.hotspot-card {
  /* 品牌红 #e10600 在近黑底上做小字会偏暗，文字链接单独提亮一档；色条/边框仍用纯品牌红 */
  --hotspot-red-text: #ff5c52;

  position: absolute;
  z-index: 6;
  width: min(var(--hotspot-card-width), calc(100vw - 24px));
  max-height: min(var(--hotspot-card-max-height), 52vh);
  padding: 14px 16px 15px;
  overflow-y: auto;
  overscroll-behavior: contain;
  border: 1px solid rgb(255 255 255 / 12%);
  border-left: 3px solid var(--f1-red);
  background:
    linear-gradient(135deg, rgb(225 6 0 / 16%), transparent 42%),
    linear-gradient(180deg, rgb(24 24 32 / 97%), rgb(12 13 18 / 97%));
  box-shadow:
    0 22px 50px rgb(0 0 0 / 55%),
    inset 0 1px 0 rgb(255 255 255 / 6%);
  color: #e8ecf2;
  scrollbar-color: rgb(255 255 255 / 18%) transparent;
  scrollbar-width: thin;
  backdrop-filter: blur(14px);
  /* 右下切角是 F1 转播图形最常见的形状语言，比圆角更“赛车” */
  clip-path: polygon(0 0, 100% 0, 100% calc(100% - 18px), calc(100% - 18px) 100%, 0 100%);
  /* 同样不用 fill-mode：动画被节流时卡片也必须可见，不能停在起始的 opacity: 0 */
  animation: hotspot-card-in 160ms ease-out;
}

.hotspot-card--above {
  transform: translate(-50%, calc(-100% - var(--hotspot-card-gap)));
}

.hotspot-card--below {
  transform: translate(-50%, var(--hotspot-card-gap));
}

/* 窄屏：贴底抽屉。跟随圆点在手机上会把内容推出屏幕，不如固定在一块舒服的区域 */
.hotspot-card--sheet {
  position: fixed;
  top: auto;
  right: 12px;
  bottom: 12px;
  left: 12px;
  width: auto;
  max-height: 48vh;
  transform: none;
}

.hotspot-card__head {
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
}

.hotspot-card__eyebrow {
  display: flex;
  gap: 6px;
  align-items: center;
  margin: 0;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.22em;
  color: #fff;
}

.hotspot-card__brand {
  color: var(--f1-red);
}

.hotspot-card__sep {
  color: rgb(255 255 255 / 24%);
}

.hotspot-card__label {
  overflow: hidden;
  color: rgb(255 255 255 / 78%);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hotspot-card__close {
  position: relative;
  flex: none;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 1px solid rgb(255 255 255 / 14%);
  background: rgb(255 255 255 / 4%);
  cursor: pointer;
  transition:
    background-color 0.15s ease,
    border-color 0.15s ease;
}

.hotspot-card__close:hover {
  border-color: var(--f1-red);
  background: var(--f1-red);
}

.hotspot-card__close:focus-visible {
  outline: 2px solid var(--f1-red);
  outline-offset: 2px;
}

.hotspot-card__close-icon {
  position: absolute;
  inset: 0;
}

.hotspot-card__close-icon::before,
.hotspot-card__close-icon::after {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 11px;
  height: 1.5px;
  background: #fff;
  content: '';
}

.hotspot-card__close-icon::before {
  transform: translate(-50%, -50%) rotate(45deg);
}

.hotspot-card__close-icon::after {
  transform: translate(-50%, -50%) rotate(-45deg);
}

.hotspot-card__title {
  margin: 10px 0 0;
  font-size: 19px;
  font-weight: 700;
  line-height: 1.3;
  color: #fff;
  letter-spacing: 0.01em;
}

/* 标题下的一小段红色横条：F1 图形里“标题 + 色条”的信息层级 */
.hotspot-card__title::after {
  display: block;
  width: 26px;
  height: 2px;
  margin-top: 8px;
  background: var(--f1-red);
  content: '';
}

.hotspot-card__summary {
  margin: 10px 0 0;
  font-size: 12.5px;
  line-height: 1.75;
  color: #b7c1cd;
}

.hotspot-card__specs {
  margin: 14px 0 0;
  padding: 0;
  border-top: 1px solid rgb(255 255 255 / 8%);
}

.hotspot-card__spec {
  display: flex;
  gap: 12px;
  align-items: baseline;
  justify-content: space-between;
  padding: 6px 0;
  border-bottom: 1px solid rgb(255 255 255 / 6%);
}

.hotspot-card__spec dt {
  font-size: 9.5px;
  letter-spacing: 0.14em;
  color: #7c8796;
  text-transform: uppercase;
  white-space: nowrap;
}

.hotspot-card__spec dd {
  margin: 0;
  font-size: 11.5px;
  color: #f0f3f7;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.hotspot-card__source {
  display: inline-flex;
  gap: 5px;
  align-items: center;
  margin-top: 12px;
  padding-bottom: 2px;
  border-bottom: 1px solid rgb(225 6 0 / 35%);
  font-size: 10px;
  letter-spacing: 0.08em;
  color: var(--hotspot-red-text);
  text-decoration: none;
}

.hotspot-card__source:hover {
  border-bottom-color: var(--f1-red);
}

.hotspot-card__source:focus-visible {
  outline: 2px solid var(--f1-red);
  outline-offset: 3px;
}

.hotspot-card__source-arrow {
  font-size: 11px;
}

@keyframes hotspot-card-in {
  from {
    opacity: 0;
  }

  to {
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .hotspot-card {
    animation: none;
  }
}
</style>
