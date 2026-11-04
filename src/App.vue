<script setup lang="ts">
/**
 * 应用外壳（root 组件）—— 这个文件由你来写。
 *
 * 目标：页面出现全屏画布 + 左下角角标 + 一个可以拖拽旋转的蓝色立方体。
 *
 * 两个关键背景：
 * 1. setup 顶层不能直接 new SceneManager —— 那时 <div ref="sceneHost"> 还没进 DOM，
 *    ref 的值是 null，WebGLRenderer 拿不到真实挂载点。
 * 2. 模板里 ref="sceneHost" 的字符串，和 <script> 里的 const sceneHost 是同一个变量，
 *    这种用法叫「模板引用（template ref）」，Vue 在挂载后自动把 DOM 元素赋给它。
 */
import { onBeforeUnmount, onMounted, ref, version as vueVersion } from 'vue';

// TODO(你) ① 导入两个模块（都是「具名导出」，所以要用 { } 包起来）
import { SceneManager } from './core/SceneManager';
import { createPlaceholderCube } from './dev/placeholderCube';

/** 模板引用：与模板里 ref="sceneHost" 的 div 绑定，挂载后才指向真实元素 */
const sceneHost = ref<HTMLDivElement | null>(null);

// TODO(你) ② 声明 3D 应用实例
//   - 名字用 appManager
//   - 用 let 而不是 const（为什么？见文末「思考题 A」）
//   - 类型标注为 SceneManager | null，初值 null（为什么？见文末「思考题 B」）
let appManager: SceneManager | null = null;

onMounted(() => {
  // TODO(你) ③ 类型守卫：如果 sceneHost.value 还是 null 就直接 return
  //   提示：不写这句，TypeScript 会拦住下面的传参，报「不能把 null 赋给 HTMLElement」
  if (!sceneHost.value) return;

  // TODO(你) ④ 创建 SceneManager，把 sceneHost.value 作为宿主传进去，赋给 appManager
  //   提示：new 之后 appManager 的类型就不再是 null 了，TS 会自动收窄
  appManager = new SceneManager(sceneHost.value);

  // TODO(你) ⑤ 往场景里挂占位立方体：appManager.scene.add(createPlaceholderCube())
  //   提示：这行是临时的，Phase 2 接入模型时会删掉
  appManager.scene.add(createPlaceholderCube());

  // TODO(你) ⑥ 启动渲染循环：appManager.start()
  appManager.start();
});

onBeforeUnmount(() => {
  // TODO(你) ⑦ 组件卸载时：释放 3D 资源，然后把 appManager 置回 null
  //   提示：appManager 可能还是 null，所以调用时要先判断（或可选链 ?.）
  //   为什么必须做？见文末「思考题 C」
  appManager?.dispose();
  appManager = null;
});

/**
 * ─────────── 思考题（不用改代码，在对话里答给我）───────────
 *
 * A. `appManager` 为什么用 let 而不是 const？
 *    提示：想想 setup 执行时它的值是什么，onMounted 里又对它做了什么。
 *
 * B. 为什么类型要写成 `SceneManager | null`，而不是 `SceneManager`？
 *    提示：如果只写 `let appManager: SceneManager = null;`，TS 会报 TS2322，
 *    想想为什么编译器认为这是错的。
 *
 * C. 如果 onBeforeUnmount 里什么都不做（注释掉两行），会发生什么？
 *    实验：注释掉 → 改 src/config/scene.ts 的 clearColor 触发热更新 →
 *    F12 里看 .scene__host 下面有几个 <canvas>。那就是内存泄漏的现场。
 */
</script>

<template>
  <div class="scene">
    <div ref="sceneHost" class="scene__host"></div>
    <p class="scene__badge">Vue {{ vueVersion }} · Three.js 骨架</p>
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

/* 临时角标：证明 Vue 已接管 DOM，Phase 2 接入模型后删除 */
.scene__badge {
  position: absolute;
  bottom: 16px;
  left: 16px;
  margin: 0;
  padding: 6px 10px;
  border-radius: 6px;
  background: rgb(255 255 255 / 8%);
  color: #9fb3c8;
  font-size: 12px;
  letter-spacing: 0.02em;
  pointer-events: none;
}
</style>
