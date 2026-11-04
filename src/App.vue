<script setup lang="ts">
/**
 * 应用外壳：全屏画布 + 加载状态。
 *
 * 装配顺序（顺序不能换）：
 * 1. setup 阶段只声明 ref：此时模板还没挂载，ref 是 null，拿不到真实 DOM
 * 2. onMounted 先建 SceneManager（它负责 renderer / resize / 渲染循环），再异步加载模型
 * 3. 模型到位后再 frameObject：相机必须按「实际模型」的包围球来摆，不能凭常量猜
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { HOTSPOTS } from './config/hotspots';
import { SHOWROOM_CONFIG } from './config/showroom';
import { useHotspots } from './composables/useHotspots';
import { ModelLoader, type LoadProgress } from './core/ModelLoader';
import { SceneManager } from './core/SceneManager';
import { createShowroom, type ShowroomHandle } from './core/Showroom';
import HotspotCard from './ui/HotspotCard.vue';
import HotspotToggle from './ui/HotspotToggle.vue';
import LoadingBar from './ui/LoadingBar.vue';

/** 模板引用：挂载后才会指向真实的宿主 div */
const sceneHost = ref<HTMLDivElement | null>(null);

const loadRatio = ref(0);
const loading = ref(true);
const loadError = ref<string | null>(null);
// 热点桥：只声明状态，真正创建 HotspotSystem 要等车模加载完（坐标依赖模型矩阵）
const {
  activeHotspot,
  anchor,
  enabled: hotspotsEnabled,
  attach: attachHotspots,
  detach: detachHotspots,
  close: closeHotspot,
  setEnabled: setHotspotsEnabled,
} = useHotspots(HOTSPOTS);

/** 取点模式下不显示操作提示，否则会和左下角的取点面板叠在一起 */
const pickingMode = ref(false);

/** 第一次打开卡片后永久收起提示：之后用户已经知道怎么用了，再出现就是干扰 */
const hintDismissed = ref(false);
watch(activeHotspot, (hotspot) => {
  if (hotspot) hintDismissed.value = true;
});

const showHint = computed(
  () =>
    !hintDismissed.value &&
    !loading.value &&
    loadError.value === null &&
    !pickingMode.value &&
    // 开关关掉后圆点不显示，再提示「点击圆点」就是误导
    hotspotsEnabled.value,
);

let sceneManager: SceneManager | null = null;
let modelLoader: ModelLoader | null = null;
let showroom: ShowroomHandle | null = null;
let stopShowroomFrames: (() => void) | null = null;
let devPicker: { dispose(): void } | null = null;

/** 下载进度：直接写进 ref，LoadingBar 通过 props 读，Three 侧不认识 Vue */
function handleProgress(progress: LoadProgress): void {
  loadRatio.value = progress.ratio;
}

onMounted(async () => {
  if (!sceneHost.value) return;

  sceneManager = new SceneManager(sceneHost.value);

  // 展示间先于模型入场景：模型加载期间背景已经是工房，不会先看到黑屏再突然换景
  // 把 SceneManager 的地面裁剪面传进去：相机沉到车底时地板/展台自动让开
  showroom = createShowroom(SHOWROOM_CONFIG, {
    floorClipPlane: sceneManager.floorClipPlane,
  });
  sceneManager.scene.add(showroom.root);

  // 计时屏这类会动的道具挂在 SceneManager 的单一渲染循环上，不再另起 RAF
  stopShowroomFrames = sceneManager.onFrame((deltaSeconds) => {
    showroom?.update(deltaSeconds);
  });

  sceneManager.start();

  modelLoader = new ModelLoader(sceneManager.renderer);

  try {
    const { object } = await modelLoader.load(handleProgress);

    // 加载期间组件可能已被卸载（快速切页 / HMR），此时 sceneManager 已被置空
    if (!sceneManager) return;

    // 后面还有一次 await（动态 import 取点工具），先抓住当前实例；
    // 卸载时它会被 dispose，所以用完再和 sceneManager 比对一次
    const manager = sceneManager;

    // 车抬到展台面上：模型自己的底面在 y=0，展台顶面在 height，不加这一行车会陷进台子里
    object.position.y = SHOWROOM_CONFIG.plinth.height;

    manager.scene.add(object);
    manager.frameObject(object);

    // ?pick 是作者采坐标的开发模式：这时不挂热点，避免 [0,0,0] 占位圆点挡镜头、
    // 点击也被取点工具抢走；去掉参数刷新后回到正常的热点交互。
    // 条件直接内联写 import.meta.env.DEV，生产构建会把整个分支连同动态 import 一起摇掉
    if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('pick')) {
      const { createHotspotPicker } = await import('./dev/hotspotPicker');
      if (sceneManager !== manager) return;

      pickingMode.value = true;
      devPicker = createHotspotPicker({
        model: object,
        camera: manager.camera,
        domElement: manager.renderer.domElement,
      });
    } else {
      // 热点必须晚于 scene.add + frameObject：坐标要读模型的世界矩阵，早挂会全挤在原点
      attachHotspots({ sceneManager: manager, model: object });
    }
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : String(error);
  } finally {
    loading.value = false;
  }
});

onBeforeUnmount(() => {
  // 先拆热点与取点面板：它们持有 DOM 与 canvas 事件，必须早于 SceneManager.dispose()
  devPicker?.dispose();
  devPicker = null;
  detachHotspots();

  modelLoader = null;
  stopShowroomFrames?.();
  stopShowroomFrames = null;
  showroom?.dispose();
  showroom = null;
  sceneManager?.dispose();
  sceneManager = null;
});
</script>

<template>
  <div class="scene">
    <div ref="sceneHost" class="scene__host" />
    <p v-if="showHint" class="scene__hint">
      <span class="scene__hint-icon" aria-hidden="true">i</span>
      点击车身圆点，查看部件官方信息
    </p>
    <HotspotToggle
      v-if="!loading && !loadError"
      :enabled="hotspotsEnabled"
      @change="setHotspotsEnabled"
    />
    <HotspotCard :hotspot="activeHotspot" :anchor="anchor" @close="closeHotspot" />
    <LoadingBar v-if="loading || loadError" :ratio="loadRatio" :error="loadError" />
  </div>
</template>

<style scoped>
.scene {
  position: relative;
  height: 100%;
}

.scene__host {
  position: absolute;
  inset: 0;
}

/* 首屏操作提示：F1 风格的左下角小条，第一次打开卡片后就消失 */
.scene__hint {
  position: absolute;
  bottom: 20px;
  left: 20px;
  z-index: 5;
  display: flex;
  gap: 8px;
  align-items: center;
  margin: 0;
  padding: 8px 12px 8px 8px;
  border: 1px solid rgb(255 255 255 / 10%);
  border-left: 2px solid var(--f1-red);
  background: rgb(12 13 18 / 72%);
  color: #cfd8e3;
  font-size: 11px;
  letter-spacing: 0.06em;
  backdrop-filter: blur(8px);
  /*
   * 不加 fill-mode、不加 delay：动画只是入场淡入，跑不起来时元素默认就是可见的。
   * 之前用 `both` + delay，浏览器在窗口失焦时可能把动画节流在起始帧，
   * 提示条会一直停在 opacity: 0（实际截图里就是这个现象）。
   */
  animation: scene-hint-in 500ms ease-out;
}

.scene__hint-icon {
  display: grid;
  width: 17px;
  height: 17px;
  place-items: center;
  border: 1px solid var(--f1-red);
  border-radius: 50%;
  color: var(--f1-red);
  font-size: 10px;
  font-style: italic;
  font-weight: 700;
}

@keyframes scene-hint-in {
  from {
    opacity: 0;
    transform: translateY(6px);
  }

  to {
    opacity: 1;
    transform: none;
  }
}

@media (max-width: 640px) {
  .scene__hint {
    right: 14px;
    bottom: 14px;
    left: 14px;
    justify-content: center;
  }
}

@media (prefers-reduced-motion: reduce) {
  .scene__hint {
    animation: none;
  }
}
</style>
