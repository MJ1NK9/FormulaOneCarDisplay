<script setup lang="ts">
/**
 * 应用外壳：全屏画布 + 加载状态 + 换模状态机。
 *
 * 装配顺序（顺序不能换）：
 * 1. setup 阶段只声明 ref：此时模板还没挂载，ref 是 null，拿不到真实 DOM
 * 2. onMounted 先建 SceneManager，再搭展示间与升降舞台，最后异步加载车模
 * 3. 车模默认加载低精度（6.6 MB）；切高精度是一整段多阶段动画，见 SwapPhase
 */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import type { Group, Object3D } from 'three';
import { HOTSPOTS } from './config/hotspots';
import { LIFT_CONFIG } from './config/lift';
import { MODEL_VARIANTS, type ModelQuality } from './config/model';
import { SHOWROOM_CONFIG } from './config/showroom';
import { useHotspots } from './composables/useHotspots';
import { LiftStage } from './core/LiftStage';
import { ModelLoader, disposeModel, type LoadProgress, type LoadedModel } from './core/ModelLoader';
import { SceneManager } from './core/SceneManager';
import { createShowroom, type ShowroomHandle } from './core/Showroom';
import type { VideoWallProp } from './core/props/videoWall';
import HotspotCard from './ui/HotspotCard.vue';
import HotspotToggle from './ui/HotspotToggle.vue';
import LoadingBar from './ui/LoadingBar.vue';
import QualitySwitch from './ui/QualitySwitch.vue';
import SwapActions from './ui/SwapActions.vue';
import SwapHologram from './ui/SwapHologram.vue';
import VideoScreen from './ui/VideoScreen.vue';
import WatchVideoButton from './ui/WatchVideoButton.vue';

/**
 * 换模状态机。
 *
 * 低精度展示中 → 下降中（50% 淡入全息）→ 闸口关闭中 → 高精度加载中
 *              → 闸口打开中 → 升起中 → 切换成功提示 → 高精度展示中
 *
 * 硬约束：
 * - 只有 idle 允许发起新的切换（重复点击被锁在门外，不排队，避免两段动画抢同一个台面）；
 * - 全息在下降 50% 就淡入，闸口关闭后继续显示加载进度；
 * - 高精度没加载完、进度条没到 100%、全息没满 2s 之前，闸口不会打开；
 * - 升起完成先显示「切换成功」1s，淡出后才恢复热点；
 * - error 是唯一的"停靠态"，此时闸口关闭、车在井底，用户可以重试或返回上一档。
 */
type SwapPhase =
  | 'idle'
  | 'descending'
  | 'closing'
  | 'loading'
  | 'opening'
  | 'rising'
  | 'success'
  | 'error';

type HologramMode = 'hidden' | 'loading' | 'success';

type LoadResult =
  | { readonly ok: true; readonly model: LoadedModel }
  | { readonly ok: false; readonly error: unknown };

/** 模板引用：挂载后才会指向真实的宿主 div */
const sceneHost = ref<HTMLDivElement | null>(null);

const loadRatio = ref(0);
const loading = ref(true);
const loadError = ref<string | null>(null);
/** 失败层级：车模加载 / 场景初始化 / 显卡上下文，决定错误卡片的标题 */
const errorTitle = ref('车模加载失败');

// 热点桥：只声明状态，真正创建 HotspotSystem 要等车模落到台面上（坐标依赖模型矩阵）
const {
  activeHotspot,
  anchor,
  enabled: hotspotsEnabled,
  attach: attachHotspots,
  detach: detachHotspots,
  close: closeHotspot,
  setEnabled: setHotspotsEnabled,
  fade: fadeHotspots,
} = useHotspots(HOTSPOTS);

/** 取点模式下不显示操作提示，否则会和左下角的取点面板叠在一起 */
const pickingMode = ref(false);

/**
 * 画质档位：页面进入默认低精度。
 *
 * 不再读 localStorage：验收要求「进入页面默认低精度」，
 * 记住上次的选择会让第二次打开直接变成高精度，反而不符合预期；
 * 低精度 6.6 MB，首屏和切档都更快，高精度由用户主动按需加载。
 */
const quality = ref<ModelQuality>('lite');

const phase = ref<SwapPhase>('idle');
/** 正在切向哪一档；失败后仍指向这一档，重试就是再加载它 */
const pendingTarget = ref<ModelQuality>('high');
/** 切换前的那一档：加载失败时「返回上一档」要重新加载它 */
const previousQuality = ref<ModelQuality>('lite');
const swapError = ref<string | null>(null);

const switching = computed(() => phase.value !== 'idle');
const switchingLabel = computed(() => MODEL_VARIANTS[pendingTarget.value].label);
const previousLabel = computed(() => MODEL_VARIANTS[previousQuality.value].label);

/**
 * 「车辆切换中 / 切换成功」全息提示。
 *
 * 它是 DOM 覆盖层（ui/SwapHologram.vue）：固定在展台前端中心，
 * 不随相机、车模、升降台移动；层级永远在闸口 / 地板之上。
 */
const hologramMode = ref<HologramMode>('hidden');
/** 进度条上显示的进度（0~1）：真实加载 + 模拟推进，单调递增 */
const hologramProgress = ref(0);
/** 全息完全显示的时刻（毫秒）：最短 2s 展示从这一刻开始算 */
let hologramFullAt = 0;

/** 真实下载进度（0~1）：只喂给进度模拟，不直接显示 */
let pendingLoadRatio = 0;

let progressRaf: number | null = null;
let progressLastTime = 0;
/** 全息出现后经过的秒数：时间保底曲线用它 */
let progressElapsed = 0;
let progressLoaded = false;
/** 本次加载是否已经成功：可能早于全息淡入（下降前半段就下完了） */
let progressLoadSucceeded = false;
/** 加载完成后的收尾是一个 Promise：正常流程与其它分支等的是同一个 */
let progressCompletion: Promise<void> | null = null;
let progressFinishResolve: (() => void) | null = null;

/** 切档失败、回退成功时的一句话提示；几秒后自己消失，不打断浏览 */
const qualityNotice = ref<string | null>(null);
let noticeTimer: number | null = null;

function showQualityNotice(message: string): void {
  qualityNotice.value = message;
  if (noticeTimer !== null) window.clearTimeout(noticeTimer);
  noticeTimer = window.setTimeout(() => {
    qualityNotice.value = null;
    noticeTimer = null;
  }, 4500);
}

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
    // 观看模式只保留视频和控制台，提示条会压住画面
    !watchingVideo.value &&
    // 开关关掉后圆点不显示，再提示「点击圆点」就是误导
    hotspotsEnabled.value &&
    // 换模动画期间不打扰
    phase.value === 'idle',
);

/** 屏幕阅读器播报当前阶段；视觉上由全息投影负责，这里只做无障碍 */
const phaseAnnouncement = computed(() => {
  switch (phase.value) {
    case 'descending':
      return '升降台下降中';
    case 'closing':
      return '闸口关闭中';
    case 'loading':
      return `正在载入${switchingLabel.value}模型`;
    case 'opening':
      return '闸口打开中';
    case 'rising':
      return '车辆升起中';
    case 'success':
      return `已切换到${switchingLabel.value}模型`;
    case 'error':
      return `模型切换失败，可重试或返回${previousLabel.value}`;
    default:
      return '';
  }
});

let sceneManager: SceneManager | null = null;
let modelLoader: ModelLoader | null = null;
/** 当前挂在台面上的车模；换模时要先释放它，否则两套贴图会同时占显存 */
let currentModel: Group | null = null;
let showroom: ShowroomHandle | null = null;
/**
 * 前墙视频屏控制器。
 *
 * 用 shallowRef 而不是普通 ref：VideoWallProp 是一个带方法的类实例，
 * 深层响应式代理会改写 this 指向 / 平白代理 video 相关闭包；
 * 组件只需要在「有 / 没有」时重新挂载，内部播放状态由控制器自己的快照给。
 */
const videoWall = shallowRef<VideoWallProp | null>(null);
let liftStage: LiftStage | null = null;
let stopShowroomFrames: (() => void) | null = null;
let devPicker: { dispose(): void } | null = null;

/**
 * 「观看视频」模式。
 *
 * 进入时把相机固定在正对前墙视频中心的位置、暂时隐藏车模 / 热点 / 周边 UI，
 * 退出时逐项还原。只操作可见性和相机，不碰升降台、闸口、全息和换模时序。
 */
const watchingVideo = ref(false);

interface WatchCameraState {
  readonly px: number;
  readonly py: number;
  readonly pz: number;
  readonly tx: number;
  readonly ty: number;
  readonly tz: number;
  readonly fov: number;
  readonly controlsEnabled: boolean;
  readonly damping: boolean;
  readonly minDistance: number;
  readonly maxDistance: number;
}

let watchCameraState: WatchCameraState | null = null;
let watchModelVisible: boolean | null = null;
let watchHotspotsEnabled = true;
/** 观看模式临时隐藏的展示间 / 升降舞台对象，退出时逐个还原可见性 */
let watchHiddenObjects: { object: Object3D; visible: boolean }[] = [];

const watchVideoDisabled = computed(
  () => !videoWall.value || switching.value || loading.value || loadError.value !== null,
);

/** 下载进度：直接写进 ref，LoadingBar 通过 props 读，Three 侧不认识 Vue */
function handleProgress(progress: LoadProgress): void {
  loadRatio.value = progress.ratio;
}

/** 把 unknown 异常转成可读文案，避免把 [object Object] 直接印到页面上 */
function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 场景是否还在（组件卸载 / HMR 会把这两个置空，异步链靠它提前退出） */
function isSceneAlive(): boolean {
  return sceneManager !== null && liftStage !== null;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

/**
 * 等若干个渲染帧。
 *
 * 新模型挂进场景后，贴图上传和着色器编译发生在「第一次被渲染」的那一帧；
 * 如果这一帧正好是开闸帧，开门瞬间会卡一下、车像"加载出来"的。
 * 所以先让它在闸口关着的时候渲染几帧，等一切就绪再开门。
 */
function nextFrames(count: number): Promise<void> {
  return new Promise((resolve) => {
    let remaining = count;
    const tick = (): void => {
      remaining -= 1;
      if (remaining <= 0) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/**
 * 进入「车辆切换中」：淡入全息、进度从 0 开始。
 * 每次新切换 / 重试都重置进度，2s 最短展示也从这次淡入重新计时。
 */
function showHologramLoading(): void {
  hologramMode.value = 'loading';
  hologramProgress.value = 0;
  progressElapsed = 0;
  progressLoaded = false;
  progressCompletion = null;
  progressFinishResolve = null;
  hologramFullAt = performance.now() + LIFT_CONFIG.timing.hologramFadeInSeconds * 1000;
  startProgressLoop();

  // 模型在全息出现之前就已经加载完：直接进收尾，
  // 条子从 0 一路平滑推到 100%，不会先假装爬一段再停
  if (progressLoadSucceeded) void completeProgress();
}

/**
 * 盯住一次加载：模型真正到手的那一刻就把进度条切到收尾目标（100%）。
 *
 * 不等闸口关完才开始收尾——否则网络快的时候条子会先爬到一个数、在关闸期间
 * 停住，再单独跳一段；现在收尾从加载完成的那一刻就开始，和前面的推进连成一条线。
 */
function trackLoadCompletion(task: Promise<LoadResult>): void {
  void task.then((result) => {
    if (!result.ok || !isSceneAlive()) return;
    progressLoadSucceeded = true;
    // 全息还没亮（下降前半段就下完了）：等 showHologramLoading 再收尾
    if (hologramMode.value === 'loading') void completeProgress();
  });
}

/** 启动进度条的帧循环：真实进度推进 + 时间保底，保证任何时候都不像卡死 */
function startProgressLoop(): void {
  if (progressRaf !== null) return;
  progressLastTime = performance.now();
  progressRaf = requestAnimationFrame(stepProgress);
}

function stopProgressLoop(): void {
  if (progressRaf !== null) cancelAnimationFrame(progressRaf);
  progressRaf = null;
}

/**
 * 每帧推进进度条。
 *
 * 速度模型而不是关键帧：每帧朝「当前目标」走，速度 = min(上限, 剩余差距 / 响应时间)。
 * 目标本身是连续的（真实进度 + 时间保底），加载完成时只是把目标从软上限换成 100%，
 * 位置和速度都接得上，所以看不到「90% 停住 → 突然跳到 100%」。
 */
function stepProgress(now: number): void {
  progressRaf = null;
  const delta = Math.min(Math.max(now - progressLastTime, 0) / 1000, 0.1);
  progressLastTime = now;

  const progressConfig = LIFT_CONFIG.timing.progress;

  if (progressLoaded) {
    const gap = 1 - hologramProgress.value;
    if (gap <= 0.0008) {
      hologramProgress.value = 1;
      const resolve = progressFinishResolve;
      progressFinishResolve = null;
      resolve?.();
      return;
    }

    // 收尾：越接近 100% 越慢，速度不会在最后一帧突变
    const speed = Math.min(
      progressConfig.finishSpeed,
      gap / progressConfig.responseSeconds,
    );
    hologramProgress.value = Math.min(1, hologramProgress.value + speed * delta);
  } else {
    progressElapsed += delta;

    // 目标 = 软上限 × max(真实下载进度, 时间保底曲线)。
    // 两路输入都持续增长，所以条子不会卡在某个固定数值上
    const goal =
      progressConfig.cap *
      Math.max(
        pendingLoadRatio,
        1 - Math.exp(-progressElapsed / progressConfig.floorSeconds),
      );
    const gap = goal - hologramProgress.value;

    // 真实进度突然变快时也有限速，条子不会一帧冲顶；离目标越近走得越慢
    const speed = Math.min(
      progressConfig.loadingSpeed,
      Math.max(0, gap) / progressConfig.responseSeconds,
    );
    hologramProgress.value = Math.min(goal, hologramProgress.value + speed * delta);
  }

  progressRaf = requestAnimationFrame(stepProgress);
}

/** 加载完成：目标切到 100%，用同一套速度模型继续走到满 */
function completeProgress(): Promise<void> {
  if (progressCompletion) return progressCompletion;

  progressLoaded = true;
  progressCompletion = new Promise((resolve) => {
    progressFinishResolve = resolve;
    startProgressLoop();
  });
  return progressCompletion;
}

/** 从全息「完全显示」起至少停留 2s：加载再快也要让切换过程被看见 */
function waitHologramMinimum(): Promise<void> {
  const remaining =
    hologramFullAt + LIFT_CONFIG.timing.hologramMinSeconds * 1000 - performance.now();
  return remaining > 0 ? delay(remaining) : Promise.resolve();
}

/** 淡出全息并等过渡结束：闸口在提示收干净之后才开 */
async function fadeOutHologram(seconds: number): Promise<void> {
  hologramMode.value = 'hidden';
  await delay(seconds * 1000);
}

/** 进度模拟的收尾：失败 / 卸载时停表，避免 rAF 在后台空转 */
function haltProgress(): void {
  stopProgressLoop();
  progressFinishResolve = null;
  progressCompletion = null;
  progressLoaded = false;
}

/**
 * WebGL 2 能力预检。
 * Three r187 的 WebGLRenderer 只支持 WebGL 2：旧设备、关闭硬件加速、远程桌面里
 * 直接 new 会抛错，而那时页面还没有任何 UI，用户只会看到白屏 + 假进度。
 * 先探测再创建，才能给出可读的失败原因。
 */
function supportsWebGL2(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (!gl) return false;
    // 主动释放这次探测创建的上下文，避免占用浏览器的 WebGL 上下文配额
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

/** 场景级失败：统一收起加载态并展示错误卡片 */
function setSceneError(title: string, detail: string): void {
  errorTitle.value = title;
  loadError.value = detail;
  loading.value = false;
}

/**
 * 显卡上下文丢失：标签页长时间后台、显存不足或驱动重置都会触发。
 * 阻止默认行为可以让浏览器有机会恢复，但恢复后 Three 的显存资源需要重建；
 * 这里直接停掉渲染循环并提示重新加载，避免控制台刷屏和画面冻结。
 */
function handleContextLost(event: Event): void {
  event.preventDefault();
  sceneManager?.stop();
  setSceneError(
    '显卡上下文中断',
    '浏览器回收了 WebGL 上下文（常见于显存不足或标签页长时间后台）。重新加载即可恢复。',
  );
}

/** 所有失败都走整页重载：车模与场景资源需要完整重建，比局部重试更可靠 */
function handleRetry(): void {
  window.location.reload();
}

/**
 * 把 SceneManager 的唯一渲染循环借给 DOM 播控层。
 *
 * 前墙播控层需要每帧跟随 3D 屏幕 / 控制台的投影，但项目约定只有一条 rAF（§5.4）。
 * UI 层不能 import three，所以这里只暴露一个「注册回调 / 返回取消」的函数，
 * 组件挂到 `SceneManager.onFrame` 上，和渲染循环共用同一条时间线。
 */
function registerSceneFrame(callback: (deltaSeconds: number) => void): () => void {
  const manager = sceneManager;
  if (!manager) return () => {};
  return manager.onFrame(callback);
}

/**
 * 把相机放到正对视频中心的位置。
 *
 * 相机放在屏幕正前方、x=0 的垂直中轴上；距离同时满足「整块 16:9 画面」和
 * 「下方控制台」的取景。竖屏 / 窄窗口水平视野不够时临时放宽 fov，
 * 保证整块画面仍然完整可见；退出时由 watchCameraState 还原。
 */
function applyWatchCamera(): void {
  if (!watchingVideo.value) return;
  const manager = sceneManager;
  if (!manager) return;

  const wall = SHOWROOM_CONFIG.videoWall;
  const screenZ = wall.position[2] - wall.screenOffset;
  const videoTop = wall.position[1] + wall.height / 2;
  // 控制台比视频底边还低：取景要连它一起框进去，观看模式下播放 / 音量仍然可点
  const consoleBottom =
    wall.position[1] - wall.height / 2 + wall.consoleOverlap - wall.consoleHeight;
  const contentTop = videoTop;
  const contentBottom = consoleBottom;
  const contentHeight = contentTop - contentBottom;
  const contentWidth = wall.width + 0.18;
  const centerY = (contentTop + contentBottom) / 2;

  const camera = manager.camera;
  const canvas = manager.renderer.domElement;
  const width = canvas.clientWidth || window.innerWidth;
  const height = canvas.clientHeight || window.innerHeight;
  const aspect = width / Math.max(1, height);
  const padding = 1.06;
  const baseFov = watchCameraState?.fov ?? camera.fov;
  // 相机不能退到后墙外面；房间后墙在 z=-6.8，留 0.1 的余量
  const maxDistance = Math.max(6, screenZ + 6.7);

  const fitDistance = (fov: number): number => {
    const tanV = Math.tan((fov * Math.PI) / 360);
    const tanH = tanV * aspect;
    return (
      Math.max((contentHeight / 2) / tanV, (contentWidth / 2) / tanH) * padding
    );
  };

  let fov = baseFov;
  let distance = fitDistance(fov);
  if (distance > maxDistance) {
    // 竖屏时水平方向才是瓶颈：在相机贴到后墙前把 fov 放宽到刚好装下
    const requiredTan = Math.max(
      (contentHeight / 2) / (maxDistance / padding),
      (contentWidth / 2) / ((aspect * maxDistance) / padding),
    );
    fov = Math.min(78, (Math.atan(requiredTan) * 360) / Math.PI);
    distance = fitDistance(fov);
  }
  distance = Math.min(distance, maxDistance);

  camera.aspect = aspect;
  camera.fov = fov;
  camera.updateProjectionMatrix();
  camera.position.set(0, centerY, screenZ - distance);
  manager.controls.target.set(0, centerY, screenZ);
  camera.lookAt(0, centerY, screenZ);
  manager.controls.update();
}

/**
 * 观看模式只留下视频屏与控制台：展示间、升降舞台连同车模一起暂时隐藏。
 * 展示间里的地板是白色环氧，竖屏下会在视频下方露出一大片亮面，
 * 把背景收成纯黑之后，画面无论横屏 / 竖屏都是干净的「放映厅」。
 */
function hideSceneForVideo(): void {
  watchHiddenObjects = [];

  const root = showroom?.root;
  if (root) {
    for (const child of root.children) {
      // 视频屏（含它下面的 3D 控制台）是唯一要保留的对象
      if (child.name === 'showroom-video-wall') continue;
      watchHiddenObjects.push({ object: child, visible: child.visible });
      child.visible = false;
    }
  }

  if (liftStage) {
    watchHiddenObjects.push({ object: liftStage.root, visible: liftStage.root.visible });
    liftStage.root.visible = false;
  }
}

function restoreSceneAfterVideo(): void {
  for (const item of watchHiddenObjects) item.object.visible = item.visible;
  watchHiddenObjects = [];
}

function enterWatchVideo(): void {
  if (watchingVideo.value || watchVideoDisabled.value) return;
  const manager = sceneManager;
  if (!manager) return;

  watchingVideo.value = true;
  closeHotspot();
  hideSceneForVideo();

  // 热点圆点 / 卡片会浮在屏幕上，先整体关掉；退出时按进入前的开关状态恢复
  watchHotspotsEnabled = hotspotsEnabled.value;
  if (watchHotspotsEnabled) setHotspotsEnabled(false);

  // 相机会停在车身上方、车与屏幕之间；车模必须暂时隐藏，否则会挡住画面下半部
  watchModelVisible = currentModel ? currentModel.visible : null;
  if (currentModel) currentModel.visible = false;

  const camera = manager.camera;
  const controls = manager.controls;
  watchCameraState = {
    px: camera.position.x,
    py: camera.position.y,
    pz: camera.position.z,
    tx: controls.target.x,
    ty: controls.target.y,
    tz: controls.target.z,
    fov: camera.fov,
    controlsEnabled: controls.enabled,
    damping: controls.enableDamping,
    minDistance: controls.minDistance,
    maxDistance: controls.maxDistance,
  };

  // 观看期间相机固定：关掉拖拽和惯性，避免用户误拖后画面偏离中心。
  // OrbitControls 每帧 update() 都会按 min / maxDistance 夹相机距离；
  // 观看机位通常比默认的 maxDistance（6.4）更远，必须先放开限位，
  // 否则相机会被硬拉回 6.4，整块视频反而看不全。
  controls.enabled = false;
  controls.enableDamping = false;
  controls.minDistance = 0.1;
  controls.maxDistance = 1000;
  applyWatchCamera();
  window.addEventListener('resize', applyWatchCamera);
}

function exitWatchVideo(): void {
  if (!watchingVideo.value) return;
  window.removeEventListener('resize', applyWatchCamera);

  const manager = sceneManager;
  const state = watchCameraState;
  if (manager && state) {
    const camera = manager.camera;
    const controls = manager.controls;
    camera.position.set(state.px, state.py, state.pz);
    camera.fov = state.fov;
    camera.updateProjectionMatrix();
    controls.target.set(state.tx, state.ty, state.tz);
    controls.minDistance = state.minDistance;
    controls.maxDistance = state.maxDistance;
    controls.enabled = state.controlsEnabled;
    controls.enableDamping = state.damping;
    controls.update();
  }

  if (currentModel && watchModelVisible !== null) currentModel.visible = watchModelVisible;
  restoreSceneAfterVideo();
  if (watchHotspotsEnabled) setHotspotsEnabled(true);

  watchCameraState = null;
  watchModelVisible = null;
  watchingVideo.value = false;
}

function toggleWatchVideo(): void {
  if (watchingVideo.value) exitWatchVideo();
  else enterWatchVideo();
}

function disposeCurrentModel(): void {
  if (!currentModel) return;
  disposeModel(currentModel);
  currentModel = null;
}

/** 车模加载：与场景初始化分开，失败时场景仍在，错误卡片能压在画面上 */
async function loadModel(): Promise<void> {
  const manager = sceneManager;
  const stage = liftStage;
  if (!manager || !stage) return;

  modelLoader = new ModelLoader(manager.renderer);

  try {
    const { object } = await modelLoader.load(quality.value, handleProgress);

    // 加载期间组件可能已被卸载（快速切页 / HMR），或显卡上下文已丢失；
    // 两种情况都不该再把车加进场景，但已经解析出来的资源必须自己释放
    if (sceneManager !== manager || liftStage !== stage || loadError.value) {
      disposeModel(object);
      return;
    }

    // 车放到升降台上：台面现在是齐平的，车模的世界坐标和改造前完全一致
    stage.attachModel(object);
    // 相机必须按「实际模型」的包围球来摆，不能凭常量猜
    manager.frameObject(object);
    currentModel = object;

    // 开发预览：?view=video 把相机放到车尾斜后方，正对前墙视频屏。
    // 只用于本地核对屏幕位置 / 播控层投影；生产构建会整段摇掉（import.meta.env.DEV）。
    // 机位同时保证整车在画面内：屏幕顶在 17° 仰角内，车底落在画质控件上方。
    if (import.meta.env.DEV) {
      const preview = new URLSearchParams(window.location.search).get('view');
      if (preview === 'video') {
        manager.camera.position.set(0.8, 1.3, -6.0);
        manager.controls.target.set(0.15, 1.5, 0);
        manager.controls.update();
      }
    }

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
      // 热点必须晚于 attachModel + frameObject：坐标要读模型的世界矩阵，早挂会全挤在原点
      attachHotspots({ sceneManager: manager, model: object });
    }
  } catch (error) {
    errorTitle.value = '车模加载失败';
    loadError.value = toErrorMessage(error);
  } finally {
    loading.value = false;
  }
}

/**
 * 起一个加载任务，失败也包装成 LoadResult 返回。
 *
 * 为什么不等闸口关上再开始：2.2 秒的下降正好用来铺网络，
 * 用户看着台子往下走、全息亮起来的时候，36 MB 已经在下了。
 */
function beginLoad(target: ModelQuality): Promise<LoadResult> {
  const loader = modelLoader;
  if (!loader) {
    return Promise.resolve({ ok: false, error: new Error('3D 场景尚未就绪') });
  }

  // 真实进度只喂给全息面板的进度模拟（0→90%），不直接显示
  pendingLoadRatio = 0;

  return loader
    .load(target, (progress) => {
      pendingLoadRatio = progress.ratio;
    })
    .then(
      (model): LoadResult => ({ ok: true, model }),
      (error: unknown): LoadResult => ({ ok: false, error }),
    );
}

/** 场景已经销毁、这条加载结果没人要了：自己收拾干净，别让贴图留在显存里 */
function discardLoad(task: Promise<LoadResult>): void {
  void task.then((result) => {
    if (result.ok) disposeModel(result.model.object);
  });
}

/**
 * 等待加载完成。
 * 失败时立刻把状态机推进 error：闸口保持关闭、台面留在井底，交给用户选择；
 * 全息收起，失败提示交给可点击的 SwapActions。
 */
async function waitForLoad(task: Promise<LoadResult>): Promise<LoadedModel | null> {
  const result = await task;

  if (!result.ok) {
    haltProgress();
    if (!isSceneAlive()) return null;
    swapError.value = toErrorMessage(result.error);
    phase.value = 'error';
    hologramMode.value = 'hidden';
    return null;
  }

  if (!isSceneAlive()) {
    disposeModel(result.model.object);
    return null;
  }

  return result.model;
}

/**
 * 装车 → 开闸 → 升起 → 成功提示 → 恢复热点。
 *
 * 顺序是硬要求：车模必须在闸口还关着的时候就挂到井底的台面上，
 * 并先渲染两帧完成贴图上传 / 着色器编译；然后门才慢慢滑开，
 * 门完全让开后停一拍，台面再把车托上来。
 * 这样开门那一刻井底已经有一台完整的车，不会出现「门开了才加载出来」。
 */
async function openAndRaise(target: ModelQuality, model: LoadedModel): Promise<void> {
  const stage = liftStage;
  const manager = sceneManager;
  if (!stage || !manager) {
    disposeModel(model.object);
    return;
  }

  // 新车挂到井底的同一位置，旧车在同一帧里释放：两档模型包围盒一致，
  // 渲染上等价于「原地换精度」，不会出现空井，也不会看到车模凭空消失。
  // 即使相机沉到地面以下（门被裁剪面裁掉）也是无缝的
  const previous = currentModel;
  stage.attachModel(model.object);
  currentModel = model.object;
  if (previous) disposeModel(previous);

  // 让新车在门后渲染两帧：首次上传 / 编译都发生在闸口关着的时候
  await nextFrames(2);
  if (!isSceneAlive()) return;

  phase.value = 'opening';
  await stage.playGateOpen();
  if (!isSceneAlive()) return;

  // 门完全让开后再起升：先看到空出来的井口，再由台面把车托上来
  await delay(LIFT_CONFIG.timing.riseDelaySeconds * 1000);
  if (!isSceneAlive()) return;

  phase.value = 'rising';
  await stage.playRise();
  if (!isSceneAlive()) return;

  // 严格吸附：台面顶面必须回到 surfaceY，否则接缝会差几毫米
  stage.snapRaised();
  quality.value = target;

  // 「切换成功」：完全出现后固定留存 1s，再淡出；淡出后才恢复热点
  phase.value = 'success';
  hologramMode.value = 'success';
  await delay(LIFT_CONFIG.timing.hologramFadeInSeconds * 1000);
  await delay(LIFT_CONFIG.timing.successHoldSeconds * 1000);
  if (!isSceneAlive()) return;
  await fadeOutHologram(LIFT_CONFIG.timing.hologramFadeOutSeconds);
  if (!isSceneAlive()) return;

  // 车已完全升起、提示也收干净，这时才按世界坐标重建热点；
  // 新系统的透明度从当前包络（0）起步，再淡入，动画途中没有悬浮错位的圆点
  attachHotspots({ sceneManager: manager, model: model.object });
  fadeHotspots(1, LIFT_CONFIG.timing.hotspotFadeInSeconds);
  phase.value = 'idle';
}

/**
 * 加载完成 → 进度条收尾到 100% → 全息满 2s → 收起全息 → 开闸升起。
 * 正常切换、失败重试、返回上一档三条路共用这一段，时序不会三处各写一份。
 */
async function finishHologramAndOpen(target: ModelQuality, model: LoadedModel): Promise<void> {
  await completeProgress();
  await waitHologramMinimum();
  await fadeOutHologram(LIFT_CONFIG.timing.hologramFadeOutSeconds);
  if (!isSceneAlive()) {
    disposeModel(model.object);
    return;
  }

  await openAndRaise(target, model);
}

/** 完整的换模流程：下降（50% 淡入全息）→ 合闸 → 加载 → 开闸 → 升起 → 成功 */
async function runSwap(target: ModelQuality): Promise<void> {
  const stage = liftStage;
  if (!stage) return;

  phase.value = 'descending';
  hologramMode.value = 'hidden';
  hologramProgress.value = 0;
  progressLoadSucceeded = false;
  const loadTask = beginLoad(target);
  trackLoadCompletion(loadTask);
  /** 加载结果是否已经被消费（成功或失败都已经有主），避免 catch 里误释放已上车的模型 */
  let loadConsumed = false;
  let hologramShown = false;

  try {
    // 下降：行程走到 50% 时全息开始淡入，不等车辆完全到底
    await stage.playDescent((progress) => {
      if (hologramShown || progress < LIFT_CONFIG.timing.hologramShowAtProgress) return;
      hologramShown = true;
      showHologramLoading();
    });
    if (!isSceneAlive()) {
      discardLoad(loadTask);
      return;
    }
    // 极端掉帧下一帧跨过 50% 也不会漏掉全息
    if (!hologramShown) showHologramLoading();

    // 车已经完全沉底，闸口才从两侧伸出合拢
    phase.value = 'closing';
    await stage.playGateClose();
    if (!isSceneAlive()) {
      discardLoad(loadTask);
      return;
    }

    // 旧车继续留在井底：正常视角被闸口遮住，车底视角也不会看到空井。
    // 它会一直留到新车挂上、在同一帧里被替换（见 openAndRaise）
    phase.value = 'loading';
    const model = await waitForLoad(loadTask);
    loadConsumed = true;
    if (!model) return;

    await finishHologramAndOpen(target, model);
  } catch (error) {
    haltProgress();
    if (!isSceneAlive()) return;
    phase.value = 'error';
    swapError.value = toErrorMessage(error);
    hologramMode.value = 'hidden';
    if (!loadConsumed) discardLoad(loadTask);
  }
}

/**
 * 用户点画质控件。
 *
 * 只有 idle 能进入；动画过程中重复点击直接忽略（控件本身也是 disabled 的），
 * 不排队：两段动画抢同一个台面只会互相打断。
 */
function switchQuality(next: ModelQuality): void {
  if (phase.value !== 'idle') return;
  if (next === quality.value) return;
  // 取点模式下车模归取点工具所有，换掉它等于把工具手里的对象释放掉
  if (pickingMode.value) return;
  if (!sceneManager || !liftStage || !modelLoader) return;

  previousQuality.value = quality.value;
  pendingTarget.value = next;
  swapError.value = null;
  qualityNotice.value = null;

  // 卡片立刻收起；圆点在下降开始的同时淡出（需求要求同步隐藏）
  closeHotspot();
  fadeHotspots(0, LIFT_CONFIG.timing.hotspotFadeOutSeconds);

  void runSwap(next);
}

/** 加载失败后重试：闸口已经是关的，重新显示全息、从头走加载与开闸 */
async function retrySwap(): Promise<void> {
  if (phase.value !== 'error' || !liftStage) return;

  swapError.value = null;
  phase.value = 'loading';
  progressLoadSucceeded = false;
  showHologramLoading();

  const loadTask = beginLoad(pendingTarget.value);
  trackLoadCompletion(loadTask);
  const model = await waitForLoad(loadTask);
  if (!model) return;

  await finishHologramAndOpen(pendingTarget.value, model);
}

/** 加载失败后返回上一档：按反向流程重新载入原档，再开闸升起 */
async function returnToPrevious(): Promise<void> {
  if (phase.value !== 'error' || !liftStage) return;

  const target = previousQuality.value;
  // 全息标签 / 失败卡片标题都跟着回退档位走，不会显示成失败的那一档
  pendingTarget.value = target;
  swapError.value = null;
  phase.value = 'loading';
  progressLoadSucceeded = false;
  showHologramLoading();

  const loadTask = beginLoad(target);
  trackLoadCompletion(loadTask);
  const model = await waitForLoad(loadTask);
  if (!model) return;

  await finishHologramAndOpen(target, model);
  showQualityNotice(`已返回${MODEL_VARIANTS[target].label}模型`);
}

onMounted(async () => {
  const host = sceneHost.value;
  if (!host) return;

  if (!supportsWebGL2()) {
    setSceneError(
      '无法启动 3D 场景',
      '当前浏览器或设备不支持 WebGL 2。请换用新版 Chrome / Edge，并在系统设置中开启硬件加速。',
    );
    return;
  }

  let manager: SceneManager;
  try {
    manager = new SceneManager(host);
  } catch (error) {
    setSceneError('3D 场景初始化失败', toErrorMessage(error));
    return;
  }
  sceneManager = manager;

  try {
    // 展示间先于模型入场景：模型加载期间背景已经是工房，不会先看到黑屏再突然换景
    // 把 SceneManager 的地面裁剪面传进去：相机沉到车底时地板/展台自动让开
    // 相机也传给前墙视频屏：它用投影判断可见性 / 给 DOM 播控层算投影
    showroom = createShowroom(SHOWROOM_CONFIG, {
      floorClipPlane: manager.floorClipPlane,
      camera: manager.camera,
    });
    manager.scene.add(showroom.root);
    // 视频屏控制器转交给 DOM 播控层：屏幕是 3D 物体，播放 / 跳转 / 音量 / 投影
    // 都要通过它来读写；showroom 还没有 dispose 之前这个引用一直有效
    videoWall.value = showroom.videoWall;

    // 后墙三屏这类会动的道具挂在 SceneManager 的单一渲染循环上，不再另起 RAF
    stopShowroomFrames = manager.onFrame((deltaSeconds) => {
      showroom?.update(deltaSeconds);
    });

    // 升降舞台先建出来：车还在下载时，展台中央就已经是一套完整的升降机构，
    // 台面与展台齐平，看不到"这里以后要挖个洞"的痕迹
    liftStage = new LiftStage({
      sceneManager: manager,
      floorClipPlane: manager.floorClipPlane,
    });
    manager.scene.add(liftStage.root);

    manager.start();
  } catch (error) {
    setSceneError('3D 场景初始化失败', toErrorMessage(error));
    return;
  }

  manager.renderer.domElement.addEventListener('webglcontextlost', handleContextLost);

  await loadModel();
});

onBeforeUnmount(() => {
  // 观看模式可能还挂着窗口 resize 监听；组件卸载后不能继续回调已销毁的场景
  window.removeEventListener('resize', applyWatchCamera);
  watchingVideo.value = false;

  // 先拆热点与取点面板：它们持有 DOM 与 canvas 事件，必须早于 SceneManager.dispose()
  devPicker?.dispose();
  devPicker = null;
  detachHotspots();

  // 进度模拟的 rAF 也要停：组件卸载后没有宿主，留着只会空转
  haltProgress();
  hologramMode.value = 'hidden';

  // 车模的几何体/贴图不在 SceneManager.dispose() 的释放范围内，必须自己收，
  // 否则 SPA 里来回切页会一点点把显存吃光
  disposeCurrentModel();
  if (noticeTimer !== null) {
    window.clearTimeout(noticeTimer);
    noticeTimer = null;
  }

  sceneManager?.renderer.domElement.removeEventListener('webglcontextlost', handleContextLost);
  modelLoader = null;
  stopShowroomFrames?.();
  stopShowroomFrames = null;
  // 先断开 DOM 播控层对控制器的引用，让组件在 showroom.dispose() 释放视频前卸载
  videoWall.value = null;
  showroom?.dispose();
  showroom = null;

  // 升降舞台自己停帧、释放几何与材质；放在 sceneManager 之前
  liftStage?.dispose();
  liftStage = null;

  sceneManager?.dispose();
  sceneManager = null;
});
</script>

<template>
  <div class="scene">
    <div ref="sceneHost" class="scene__host" />
    <!--
      素材署名：
      1) 车模是 CC BY 4.0，展示时必须保留作者与协议链接；
      2) 前墙视频来自 B 站 UP 主，非本项目原创，同样在页面上标出来。
      放在左上角，避开左下角操作提示、右上角热点开关和底部信息卡。
    -->
    <div v-if="!watchingVideo" class="scene__credit">
      <p class="scene__credit-row">
        <span>车模</span>
        <a
          href="https://sketchfab.com/3d-models/2026-redbull-rb22-0a3d24a58e0549d591a5a48c22eec383"
          target="_blank"
          rel="noopener noreferrer"
          title="在 Sketchfab 查看原模型"
          >Tyler_Dave</a
        >
        <span aria-hidden="true">·</span>
        <a
          href="https://creativecommons.org/licenses/by/4.0/"
          target="_blank"
          rel="noopener noreferrer"
          title="Creative Commons Attribution 4.0"
          >CC BY 4.0</a
        >
      </p>
      <p class="scene__credit-row">
        <span>前墙视频</span>
        <a
          href="https://www.bilibili.com/video/BV1AJgP6GEPo/"
          target="_blank"
          rel="noopener noreferrer"
          title="在哔哩哔哩查看原始投稿"
          >一只萌萌哒chara</a
        >
        <span aria-hidden="true">·</span>
        <a
          href="https://www.bilibili.com/video/BV1AJgP6GEPo/"
          target="_blank"
          rel="noopener noreferrer"
          title="哔哩哔哩 BV1AJgP6GEPo"
          >bilibili</a
        >
      </p>
    </div>
    <p v-if="showHint" class="scene__hint">
      <span class="scene__hint-icon" aria-hidden="true">i</span>
      点击车身圆点，查看部件官方信息
    </p>
    <HotspotToggle
      v-if="!watchingVideo && !loading && !loadError"
      :enabled="hotspotsEnabled"
      @change="setHotspotsEnabled"
    />
    <QualitySwitch
      v-if="!watchingVideo && !loading && !loadError && !pickingMode && phase !== 'error'"
      :quality="quality"
      :busy="switching"
      :notice="qualityNotice"
      @change="switchQuality"
    />
    <!--
      观看视频：右上角常驻按钮。进入后相机锁在正对视频中心的位置，
      App 同时隐藏车模 / 热点 / 周边 UI；再次点击恢复进入前的视角与显示状态。
    -->
    <WatchVideoButton
      v-if="!loading && !loadError && !pickingMode"
      :watching="watchingVideo"
      :disabled="watchVideoDisabled"
      @toggle="toggleWatchVideo"
    />
    <!--
      车头前墙大屏的播控层：只有屏幕下方的控制台是 DOM（core/props/videoWall.ts）。
      VideoScreen 每帧拿控制台前表面的投影四边形，用单应矩阵贴上去——控制台是
      钉在墙上的，不是悬浮 HUD。z-index 1 在 canvas 之上、CSS2D 热点层（2）之下。
      车模加载中、场景失败和取点模式下不挂载：没有场景就没有可控制的屏幕。
    -->
    <VideoScreen
      v-if="!loading && !loadError && !pickingMode && videoWall"
      :wall="videoWall"
      :register-frame="registerSceneFrame"
    />
    <!--
      全息提示：DOM 覆盖层，屏幕空间固定在展台前端中心。
      不随相机 / 车模 / 升降台移动，层级始终高于 canvas 里的闸口与地板。
    -->
    <SwapHologram
      :mode="hologramMode"
      :progress="hologramProgress"
      :label="switchingLabel"
      :fade-in-seconds="LIFT_CONFIG.timing.hologramFadeInSeconds"
      :fade-out-seconds="LIFT_CONFIG.timing.hologramFadeOutSeconds"
    />
    <!--
      换模失败：闸口保持关闭、车停在井底，由用户决定重试还是返回上一档。
      全息此时已收起，失败提示与可点击操作都由这条面板承担。
    -->
    <SwapActions
      v-if="!loading && !loadError && phase === 'error'"
      :title="`${switchingLabel}模型切换失败`"
      :detail="swapError ?? '资源加载中断'"
      :back-label="`返回${previousLabel}`"
      @retry="retrySwap"
      @back="returnToPrevious"
    />
    <!-- 换模阶段播报：视觉上由全息投影承担，这里只给读屏器 -->
    <p class="scene__status" role="status" aria-live="polite">{{ phaseAnnouncement }}</p>
    <HotspotCard :hotspot="activeHotspot" :anchor="anchor" @close="closeHotspot" />
    <LoadingBar
      v-if="loading || loadError"
      :ratio="loadRatio"
      :error="loadError"
      :error-title="errorTitle"
      @retry="handleRetry"
    />
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

/* 素材署名：车模 CC BY 4.0 + 前墙视频来源，低调叠在左上角，两行竖排 */
.scene__credit {
  position: absolute;
  top: 16px;
  left: 18px;
  z-index: 4;
  display: flex;
  flex-direction: column;
  gap: 3px;
  align-items: flex-start;
  max-width: 42vw;
  margin: 0;
  color: rgb(207 216 227 / 62%);
  font-size: 10px;
  letter-spacing: 0.06em;
  line-height: 1.4;
  pointer-events: none;
}

.scene__credit-row {
  display: flex;
  gap: 5px;
  align-items: center;
  margin: 0;
}

.scene__credit a {
  color: inherit;
  text-decoration: none;
  border-bottom: 1px solid rgb(255 255 255 / 16%);
  pointer-events: auto;
}

.scene__credit a:hover,
.scene__credit a:focus-visible {
  color: #ffd7d5;
  border-color: var(--f1-red);
  outline: none;
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

/* 只给读屏器看的阶段播报：不占位、不参与布局 */
.scene__status {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
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
  .scene__credit {
    top: 12px;
    left: 12px;
    max-width: 42vw;
    font-size: 9px;
  }

  /* 窄屏优先保住作者与协议，省掉「车模」「前墙视频」这两个前缀 */
  .scene__credit-row > span:first-child {
    display: none;
  }

  .scene__hint {
    right: 14px;
    /* 让开底部居中的画质控件（约 90px 高 + 12px 边距），否则两者会叠在一起 */
    bottom: 112px;
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
