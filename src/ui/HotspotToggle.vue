<script setup lang="ts">
/**
 * 热点总开关 —— 页面右上角的常态控件。
 *
 * 只做 DOM：状态由 App.vue 持有，真正隐藏圆点 / 停止拾取由 useHotspots 转发给
 * HotspotSystem。这里不 import three，也不直接改 CSS2D 图层。
 *
 * 用 <button role="switch"> 而不是 checkbox：它是一整块可点的面板，
 * 键盘 Tab 能聚焦、Enter/Space 能切换，aria-checked 会把开关状态读给读屏软件。
 */
interface Props {
  /** 当前是否显示热点圆点 */
  enabled: boolean;
}

defineProps<Props>();

const emit = defineEmits<{ change: [enabled: boolean] }>();
</script>

<template>
  <button
    class="hotspot-toggle"
    :class="{ 'hotspot-toggle--on': enabled }"
    type="button"
    role="switch"
    :aria-checked="enabled"
    :aria-label="enabled ? '热点标记已开启，点击关闭' : '热点标记已关闭，点击开启'"
    @click="emit('change', !enabled)"
  >
    <span class="hotspot-toggle__copy">
      <span class="hotspot-toggle__eyebrow">HOTSPOT MARKERS</span>
      <span class="hotspot-toggle__title">热点标记</span>
    </span>

    <span class="hotspot-toggle__control" aria-hidden="true">
      <span class="hotspot-toggle__track">
        <span class="hotspot-toggle__thumb" />
      </span>
      <span class="hotspot-toggle__state">{{ enabled ? '开启' : '关闭' }}</span>
    </span>
  </button>
</template>

<style scoped>
.hotspot-toggle {
  position: absolute;
  top: 22px;
  right: 22px;
  z-index: 5;
  display: flex;
  gap: 18px;
  align-items: center;
  min-width: 238px;
  padding: 14px 16px 14px 18px;
  border: 1px solid rgb(255 255 255 / 14%);
  border-left: 3px solid rgb(255 255 255 / 22%);
  background:
    linear-gradient(135deg, rgb(225 6 0 / 12%), transparent 48%),
    rgb(12 13 18 / 84%);
  box-shadow:
    0 18px 44px rgb(0 0 0 / 42%),
    inset 0 1px 0 rgb(255 255 255 / 6%);
  color: #eef2f7;
  font: inherit;
  text-align: left;
  cursor: pointer;
  backdrop-filter: blur(14px);
  /* 和热点卡片同一套 F1 切角语言，右上角缺一小块 */
  clip-path: polygon(0 0, 100% 0, 100% calc(100% - 14px), calc(100% - 14px) 100%, 0 100%);
  transition:
    border-color 0.18s ease,
    background-color 0.18s ease;
  animation: hotspot-toggle-in 260ms ease-out;
}

/* 打开时左侧红条亮起，关掉后退回中性灰，状态一眼可读 */
.hotspot-toggle--on {
  border-left-color: var(--f1-red);
}

.hotspot-toggle:hover {
  border-color: rgb(255 255 255 / 28%);
}

.hotspot-toggle:hover.hotspot-toggle--on {
  border-left-color: var(--f1-red);
}

.hotspot-toggle:focus-visible {
  outline: 2px solid var(--f1-red);
  outline-offset: 3px;
}

.hotspot-toggle__copy {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 3px;
}

.hotspot-toggle__eyebrow {
  color: rgb(255 255 255 / 42%);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.22em;
  line-height: 1.2;
}

.hotspot-toggle__title {
  color: #fff;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.08em;
  line-height: 1.2;
}

.hotspot-toggle__control {
  display: flex;
  flex: none;
  flex-direction: column;
  gap: 5px;
  align-items: center;
}

.hotspot-toggle__track {
  position: relative;
  display: block;
  width: 62px;
  height: 32px;
  border: 1px solid rgb(255 255 255 / 16%);
  border-radius: 999px;
  background: rgb(255 255 255 / 8%);
  transition:
    background-color 0.18s ease,
    border-color 0.18s ease;
}

.hotspot-toggle--on .hotspot-toggle__track {
  border-color: var(--f1-red);
  background: var(--f1-red);
}

.hotspot-toggle__thumb {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 2px 8px rgb(0 0 0 / 42%);
  transition: transform 0.18s cubic-bezier(0.3, 0.7, 0.3, 1);
}

.hotspot-toggle--on .hotspot-toggle__thumb {
  transform: translateX(30px);
}

.hotspot-toggle__state {
  color: rgb(255 255 255 / 48%);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.16em;
  line-height: 1;
  transition: color 0.18s ease;
}

.hotspot-toggle--on .hotspot-toggle__state {
  color: #ff6b64;
}

@keyframes hotspot-toggle-in {
  from {
    opacity: 0;
    transform: translateY(-6px);
  }

  to {
    opacity: 1;
    transform: none;
  }
}

@media (max-width: 640px) {
  .hotspot-toggle {
    top: 12px;
    right: 12px;
    gap: 12px;
    min-width: 0;
    padding: 10px 12px 10px 14px;
  }

  .hotspot-toggle__title {
    font-size: 13px;
  }

  .hotspot-toggle__track {
    width: 52px;
    height: 28px;
  }

  .hotspot-toggle__thumb {
    top: 3px;
    width: 20px;
    height: 20px;
  }

  .hotspot-toggle--on .hotspot-toggle__thumb {
    transform: translateX(24px);
  }
}

@media (prefers-reduced-motion: reduce) {
  .hotspot-toggle {
    animation: none;
  }

  .hotspot-toggle__track,
  .hotspot-toggle__thumb,
  .hotspot-toggle__state {
    transition: none;
  }
}
</style>
