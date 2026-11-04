/**
 * 车头前墙视频大屏 —— 贴在前墙（+Z）上、正对车头的 8.18 × 4.6 视频屏。
 *
 * 画幅严格保持 16:9（8.18 / 4.6 ≈ 1280 / 720），视频不再像旧版 2:1 屏那样
 * 裁掉上下画面；屏幕底边让控制台上沿压进来 0.06，顶边接近墙顶，左右留出的
 * 深色墙面与机房背景融为一体。屏幕本身没有边框 / 安装板 / 螺钉 / 灯条，
 * 只保留一整块画面，避免任何东西压在视频上方。
 *
 * 本模块负责两件事：
 * 1. 按配置搭「屏幕面 + 屏幕下方物理控制台」，用 HTMLVideoElement +
 *    VideoTexture 播本地 MP4；
 * 2. 把「真实视频状态」和「屏幕面 / 控制台面的视口投影四边形」暴露给 DOM 播控层
 *    （`ui/VideoScreen.vue`）：播放 / 暂停 / 拖动 / 音量直接读写 video 元素，
 *    不经过 iframe；播控按钮通过单应矩阵贴在 3D 投影上，
 *    看起来是装在墙上的转播控制台，而不是悬浮 HUD。
 *
 * 生命周期与性能：
 * - 默认机位背对前墙，所以视频是懒加载的：屏幕第一次进入视锥 0.25s 后才开始拉流；
 * - 离开视野立即暂停解码（保留进度），回到视野时按用户的播放意图恢复；
 * - 页面隐藏时暂停；dispose 里把 video、VideoTexture、海报贴图一次收干净。
 */
import {
  BoxGeometry,
  ClampToEdgeWrapping,
  Group,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  Vector3,
  VideoTexture,
  type PerspectiveCamera,
} from 'three';
import { VIDEO_SCREEN_CONFIG } from '../../config/videoScreen';
import { SHOWROOM_CONFIG } from '../../config/showroom';
import { createVideoWallPoster, type VideoWallStatus as PosterStatus } from '../ProceduralTextures';

/** 屏幕状态：standby 待载入 → loading 缓冲中 → ready 视频纹理已接管；error 海报兜底 */
export type VideoScreenStatus = 'standby' | 'loading' | 'ready' | 'error';

/** 播控层每帧（约 10Hz）读取的快照；全部是 video 元素的真实值 */
export interface VideoWallSnapshot {
  readonly status: VideoScreenStatus;
  readonly playing: boolean;
  readonly muted: boolean;
  /** 0~1，静音时仍保留原音量，方便取消静音时恢复 */
  readonly volume: number;
  readonly currentTime: number;
  /** 元数据未到时回退到配置里的总时长 */
  readonly duration: number;
  /** 已缓冲比例 0~1 */
  readonly buffered: number;
  /** 失败原因；正常播放时为 null */
  readonly error: string | null;
}

/** 视口坐标里的一个点，单位 CSS 像素 */
export interface VideoWallPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * 屏幕 / 控制台在视口里的投影四边形，顺序固定为左上、右上、右下、左下。
 *
 * 为什么不用「中心点 + 宽高 + 倾角」：屏幕是 3D 平面，斜看时四条边并不平行，
 * 用矩形近似会让 DOM 面板的四角离开屏幕边缘。DOM 层拿这四个点做单应变换，
 * 四条边才会和 3D 物体严格重合。
 */
export interface VideoWallQuad {
  readonly topLeft: VideoWallPoint;
  readonly topRight: VideoWallPoint;
  readonly bottomRight: VideoWallPoint;
  readonly bottomLeft: VideoWallPoint;
  /** 平均边宽，只用于可见性判断 / 窄屏布局，不参与投影 */
  readonly width: number;
  /** 平均边高，只用于可见性判断 */
  readonly height: number;
  /** 底边倾角（度），用于判断侧视角度 */
  readonly tilt: number;
}

export interface VideoWallProp {
  readonly object: Group;
  readonly update: (elapsedSeconds: number, deltaSeconds: number) => void;
  readonly dispose: () => void;
  /** 供 DOM 播控层读取真实播放状态 */
  readonly snapshot: () => VideoWallSnapshot;
  /** 播放 / 暂停切换；error 状态下等价于重试 */
  readonly togglePlay: () => void;
  /** 跳转到指定秒数；拖动进度条时每次 input 都会调用 */
  readonly seek: (seconds: number) => void;
  /** 设置音量 0~1；大于 0 会自动取消静音 */
  readonly setVolume: (value: number) => void;
  /** 静音 / 取消静音（取消时恢复上一次的非零音量） */
  readonly toggleMuted: () => void;
  /** 失败后重新拉流 */
  readonly retry: () => void;
  /**
   * 视频屏面的投影四边形。
   * 返回 null 表示屏幕不在视口内 / 太偏 / 太远，屏幕上的赛事图形应当收起。
   */
  readonly getQuad: (viewportWidth: number, viewportHeight: number) => VideoWallQuad | null;
  /**
   * 屏幕下方物理控制台前表面的投影四边形。
   * 播控按钮按这个四边形贴上去，和 3D 台面共用一条边，不会悬浮。
   */
  readonly getConsoleQuad: (
    viewportWidth: number,
    viewportHeight: number,
  ) => VideoWallQuad | null;
}

/**
 * 视锥检测间隔（秒）。
 * 相机有阻尼，每帧都算一次投影没有必要；0.2s 的粒度对「开始加载 / 暂停」完全够用，
 * 离开视野后最多晚 0.2s 暂停，不会产生可感知的浪费。
 */
const VISIBILITY_CHECK_SECONDS = 0.2;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clamp01(value: number): number {
  return clamp(Number.isFinite(value) ? value : 0, 0, 1);
}

/** 把 MediaError 的数字码翻译成给用户看的一句话（不把英文原文直接丢到 UI 上） */
function describeMediaError(element: HTMLVideoElement): string {
  switch (element.error?.code) {
    case 1:
      return '视频加载被中断';
    case 2:
      return '视频读取失败（文件不可访问）';
    case 3:
      return '视频解码失败（编码格式不受支持）';
    case 4:
      return '视频格式不支持';
    default:
      return '视频加载失败';
  }
}

export function createVideoWall(camera?: PerspectiveCamera): VideoWallProp {
  const cfg = SHOWROOM_CONFIG.videoWall;
  const media = VIDEO_SCREEN_CONFIG;

  const group = new Group();
  group.name = 'showroom-video-wall';
  group.position.set(...cfg.position);
  group.rotation.y = cfg.rotationY;

  const halfWidth = cfg.width / 2;
  const halfHeight = cfg.height / 2;

  // 整块屏只保留 F1 红装饰线给下方的控制台；屏幕本体是裸画面，
  // 没有安装板 / 边框 / 螺钉 / 灯条，视频上方不会出现任何白色或悬浮结构。
  const accentMaterial = new MeshBasicMaterial({ color: cfg.accentColor, toneMapped: false });

  // 屏幕下方的物理控制台：这是「钉在墙上」的关键——
  // DOM 播控层最后会精确贴在这块台面的前表面上，而不是悬浮在屏幕下方。
  const consoleWidth = cfg.width + 0.18;
  const consoleTopY = -halfHeight + cfg.consoleOverlap;
  const consoleBottomY = consoleTopY - cfg.consoleHeight;
  const consoleCenterY = (consoleTopY + consoleBottomY) / 2;
  const consoleCenterZ = 0.1;
  const consoleFrontZ = consoleCenterZ + cfg.consoleDepth / 2;

  const consoleShell = new Mesh(
    new BoxGeometry(consoleWidth, cfg.consoleHeight, cfg.consoleDepth),
    new MeshStandardMaterial({
      color: cfg.consoleColor,
      roughness: 0.4,
      metalness: 0.58,
    }),
  );
  consoleShell.name = 'video-wall-console';
  consoleShell.position.set(0, consoleCenterY, consoleCenterZ);
  consoleShell.castShadow = false;
  consoleShell.receiveShadow = false;
  group.add(consoleShell);

  // 两端加金属端盖：从侧面看能读到台面的厚度，而不是一张贴片
  const endCapMaterial = new MeshStandardMaterial({
    color: cfg.consoleEndCapColor,
    roughness: 0.34,
    metalness: 0.7,
  });
  for (const x of [-consoleWidth / 2, consoleWidth / 2]) {
    const endCap = new Mesh(
      new BoxGeometry(0.06, cfg.consoleHeight + 0.02, cfg.consoleDepth + 0.03),
      endCapMaterial,
    );
    endCap.position.set(x, consoleCenterY, consoleCenterZ);
    endCap.castShadow = false;
    endCap.receiveShadow = false;
    group.add(endCap);
  }

  // 台面上沿的红色灯条：和屏幕边框同一条 F1 红，视觉上把屏幕和台面锁在一起
  const consoleLip = new Mesh(
    new BoxGeometry(consoleWidth, 0.02, 0.016),
    accentMaterial,
  );
  consoleLip.position.set(0, consoleTopY - 0.01, consoleFrontZ + 0.002);
  group.add(consoleLip);

  // 台面下沿的一条细红灯，像设备的工作状态灯
  const consoleLed = new Mesh(
    new BoxGeometry(consoleWidth - 0.08, 0.012, 0.01),
    accentMaterial,
  );
  consoleLed.position.set(0, consoleBottomY + 0.035, consoleFrontZ + 0.002);
  group.add(consoleLed);

  // 海报 / 加载遮罩：屏幕真正的首帧之前一直显示它。
  // MeshBasicMaterial + toneMapped:false 和后墙三块屏一致：屏幕是光源，
  // 不该被主光二次照亮，也不该被色调映射压暗。
  const poster = createVideoWallPoster(
    cfg.width / cfg.height,
    `${import.meta.env.BASE_URL}${media.posterUrl}`,
  );
  // fog:false —— 观看模式相机会退到后墙附近，距离超过雾起点；
  // 视频是自发光的屏幕，不能被雾洗灰。
  const screenMaterial = new MeshBasicMaterial({
    map: poster.texture,
    toneMapped: false,
    fog: false,
  });
  const screen = new Mesh(new PlaneGeometry(cfg.width, cfg.height), screenMaterial);
  screen.name = 'video-wall-screen';
  screen.position.z = cfg.screenOffset;
  group.add(screen);

  // 屏幕四角（相对组原点）：用于视口投影，顺序是 左下 / 右下 / 左上 / 右上
  const corners: readonly [Vector3, Vector3, Vector3, Vector3] = [
    new Vector3(-halfWidth, -halfHeight, cfg.screenOffset),
    new Vector3(halfWidth, -halfHeight, cfg.screenOffset),
    new Vector3(-halfWidth, halfHeight, cfg.screenOffset),
    new Vector3(halfWidth, halfHeight, cfg.screenOffset),
  ];

  // 控制台前表面的四角：顺序是 左上 / 右上 / 右下 / 左下，和 DOM 面板一致
  const consoleCorners: readonly [Vector3, Vector3, Vector3, Vector3] = [
    new Vector3(-consoleWidth / 2, consoleTopY, consoleFrontZ),
    new Vector3(consoleWidth / 2, consoleTopY, consoleFrontZ),
    new Vector3(consoleWidth / 2, consoleBottomY, consoleFrontZ),
    new Vector3(-consoleWidth / 2, consoleBottomY, consoleFrontZ),
  ];
  const worldPoint = new Vector3();
  const viewPoint = new Vector3();
  const ndcPoint = new Vector3();

  let status: VideoScreenStatus = 'standby';
  /** 用户的播放意图：离开视野被自动暂停不影响它，回来时据此恢复 */
  let desiredPlaying = media.defaultPlaying;
  let muted = media.defaultMuted;
  let volume = clamp01(media.defaultVolume);
  let lastNonZeroVolume = volume > 0 ? volume : 0.8;
  let errorMessage: string | null = null;

  let video: HTMLVideoElement | null = null;
  let videoTexture: VideoTexture | null = null;
  let started = false;
  let visible = false;
  let visibleSeconds = 0;
  let visibilityTimer = VISIBILITY_CHECK_SECONDS;
  let posterTimer = 0;
  let loadTimer: number | null = null;
  let disposed = false;

  function applyAudio(): void {
    const element = video;
    if (!element) return;
    element.volume = volume;
    element.muted = muted;
    if (muted) element.setAttribute('muted', '');
    else element.removeAttribute('muted');
  }

  function clearLoadTimer(): void {
    if (loadTimer !== null) {
      window.clearTimeout(loadTimer);
      loadTimer = null;
    }
  }

  /**
   * 重新计时「多久没有新数据」。
   *
   * 66 MB 的本地文件在慢网 / 远端部署上可能十几秒还没出首帧，按固定 30s
   * 一刀切会误判成失败；改成每次 progress 都续一次，progress 停住才超时，
   * 语义是「卡死超时」而不是「总时长超时」。
   */
  function refreshLoadTimer(): void {
    if (media.loadTimeoutSeconds <= 0 || disposed) return;
    clearLoadTimer();
    loadTimer = window.setTimeout(() => {
      loadTimer = null;
      failToPoster('视频加载超时');
    }, media.loadTimeoutSeconds * 1000);
  }

  /**
   * 屏幕是否在视口里：用投影后四角的包围盒与视口求交。
   *
   * 不能只判断「任一角点在视口内」：观看模式或近距离看大屏时，屏幕可能
   * 比视口还大、四个角全在视口外，但画面正占满屏幕；旧逻辑会误判成不可见，
   * 结果视频永远不加载。包围盒相交同时覆盖「整块屏比视口大」和「只露出一角」。
   */
  function isScreenVisible(): boolean {
    if (!camera) return true;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    if (viewportWidth <= 0 || viewportHeight <= 0) return true;

    group.updateWorldMatrix(true, false);
    camera.updateMatrixWorld();
    const marginX = viewportWidth * 0.05;
    const marginY = viewportHeight * 0.05;

    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    let projectedCount = 0;

    for (const corner of corners) {
      const projected = projectLocal(corner, viewportWidth, viewportHeight);
      if (!projected) continue;
      projectedCount += 1;
      minX = Math.min(minX, projected.x);
      maxX = Math.max(maxX, projected.x);
      minY = Math.min(minY, projected.y);
      maxY = Math.max(maxY, projected.y);
    }

    if (projectedCount === 0) return false;
    return (
      maxX > -marginX &&
      minX < viewportWidth + marginX &&
      maxY > -marginY &&
      minY < viewportHeight + marginY
    );
  }

  /** 把一个组内局部坐标投到 CSS 像素；在相机背后 / 远裁剪面外时返回 null */
  function projectLocal(
    local: Vector3,
    viewportWidth: number,
    viewportHeight: number,
  ): VideoWallPoint | null {
    if (!camera) return null;

    worldPoint.copy(local).applyMatrix4(group.matrixWorld);
    viewPoint.copy(worldPoint).applyMatrix4(camera.matrixWorldInverse);
    // 相机空间里 z 为负才是镜头前方；near 之外的点投影会翻转，必须剔除
    if (viewPoint.z > -camera.near) return null;

    ndcPoint.copy(worldPoint).project(camera);
    if (ndcPoint.z > 1) return null;
    return {
      x: (ndcPoint.x * 0.5 + 0.5) * viewportWidth,
      y: (-ndcPoint.y * 0.5 + 0.5) * viewportHeight,
    };
  }

  /**
   * 把一个投影四边形收成可用的面板位置。
   *
   * 这里同时做三件事：
   * 1. 算平均边宽 / 边高，太远太小就收起（按钮点不中）；
   * 2. 算底边倾角，侧视超过阈值就收起（透视太强，文字会糊成一条）；
   * 3. 四个角都得在视口内，半截面板比没有更糟。
   */
  function buildQuad(
    topLeft: VideoWallPoint,
    topRight: VideoWallPoint,
    bottomRight: VideoWallPoint,
    bottomLeft: VideoWallPoint,
    viewportWidth: number,
    viewportHeight: number,
    minWidth: number,
    minHeight: number,
    maxTilt: number,
  ): VideoWallQuad | null {
    const width =
      (Math.hypot(topRight.x - topLeft.x, topRight.y - topLeft.y) +
        Math.hypot(bottomRight.x - bottomLeft.x, bottomRight.y - bottomLeft.y)) /
      2;
    const height =
      (Math.hypot(bottomLeft.x - topLeft.x, bottomLeft.y - topLeft.y) +
        Math.hypot(bottomRight.x - topRight.x, bottomRight.y - topRight.y)) /
      2;

    if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
    if (width < minWidth || height < minHeight) return null;

    const tilt = (Math.atan2(bottomRight.y - bottomLeft.y, bottomRight.x - bottomLeft.x) * 180) / Math.PI;
    if (Math.abs(tilt) > maxTilt) return null;

    const margin = 4;
    const points = [topLeft, topRight, bottomRight, bottomLeft];
    for (const point of points) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
      if (
        point.x < -margin ||
        point.x > viewportWidth + margin ||
        point.y < -margin ||
        point.y > viewportHeight + margin
      ) {
        return null;
      }
    }

    return { topLeft, topRight, bottomRight, bottomLeft, width, height, tilt };
  }

  /** 视频屏面的投影四边形；屏幕上的赛事标题 / ticker 按它贴上去 */
  function getQuad(viewportWidth: number, viewportHeight: number): VideoWallQuad | null {
    if (!camera || disposed || viewportWidth <= 0 || viewportHeight <= 0) return null;

    group.updateWorldMatrix(true, false);
    camera.updateMatrixWorld();

    const bottomLeft = projectLocal(corners[0], viewportWidth, viewportHeight);
    const bottomRight = projectLocal(corners[1], viewportWidth, viewportHeight);
    const topLeft = projectLocal(corners[2], viewportWidth, viewportHeight);
    const topRight = projectLocal(corners[3], viewportWidth, viewportHeight);
    if (!bottomLeft || !bottomRight || !topLeft || !topRight) return null;

    return buildQuad(
      topLeft,
      topRight,
      bottomRight,
      bottomLeft,
      viewportWidth,
      viewportHeight,
      media.overlay.minScreenWidthPx,
      media.overlay.minScreenHeightPx,
      media.overlay.maxTiltDegrees,
    );
  }

  /** 物理控制台前表面的投影四边形；DOM 播控按钮按它贴上去 */
  function getConsoleQuad(
    viewportWidth: number,
    viewportHeight: number,
  ): VideoWallQuad | null {
    if (!camera || disposed || viewportWidth <= 0 || viewportHeight <= 0) return null;

    group.updateWorldMatrix(true, false);
    camera.updateMatrixWorld();

    const topLeft = projectLocal(consoleCorners[0], viewportWidth, viewportHeight);
    const topRight = projectLocal(consoleCorners[1], viewportWidth, viewportHeight);
    const bottomRight = projectLocal(consoleCorners[2], viewportWidth, viewportHeight);
    const bottomLeft = projectLocal(consoleCorners[3], viewportWidth, viewportHeight);
    if (!topLeft || !topRight || !bottomRight || !bottomLeft) return null;

    return buildQuad(
      topLeft,
      topRight,
      bottomRight,
      bottomLeft,
      viewportWidth,
      viewportHeight,
      media.overlay.minConsoleWidthPx,
      media.overlay.minConsoleHeightPx,
      media.overlay.maxConsoleTiltDegrees,
    );
  }

  function drawPoster(nextStatus: PosterStatus, progress: number, elapsedSeconds: number): void {
    poster.draw(nextStatus, progress, elapsedSeconds);
    // canvas 内容变了必须显式标记：首次创建时会自动上传，之后不置 needsUpdate
    // 贴图就永远停在第一帧（加载动画 / 失败文案都不会刷新）
    poster.texture.needsUpdate = true;
    if (screenMaterial.map !== poster.texture) {
      screenMaterial.map = poster.texture;
      screenMaterial.needsUpdate = true;
    }
  }

  function readBufferedProgress(): number {
    const element = video;
    if (!element) return 0;
    try {
      const duration = element.duration;
      if (!Number.isFinite(duration) || duration <= 0) return 0;
      const ranges = element.buffered;
      if (ranges.length === 0) return 0;
      return Math.min(1, ranges.end(ranges.length - 1) / duration);
    } catch {
      // 元数据还没到时访问 buffered 会抛 InvalidStateError；加载态继续走不确定进度即可
      return 0;
    }
  }

  /**
   * 屏幕与视频同为 16:9（8.18 × 4.6 对应 1280 × 720），这里仍按 cover 做
   * 等比映射：真实比例几乎一致，不会出现上下 / 左右裁切；若将来换成
   * 别的画幅，至少能保证不拉伸变形。
   */
  function applyCover(texture: VideoTexture): void {
    const element = video;
    if (!element) return;
    const videoWidth = element.videoWidth;
    const videoHeight = element.videoHeight;
    if (videoWidth <= 0 || videoHeight <= 0) return;

    const screenAspect = cfg.width / cfg.height;
    const videoAspect = videoWidth / videoHeight;
    if (videoAspect >= screenAspect) {
      const repeatX = screenAspect / videoAspect;
      texture.repeat.set(repeatX, 1);
      texture.offset.set((1 - repeatX) / 2, 0);
    } else {
      const repeatY = videoAspect / screenAspect;
      texture.repeat.set(1, repeatY);
      texture.offset.set(0, (1 - repeatY) / 2);
    }
  }

  function attachVideoTexture(): void {
    const element = video;
    if (!element) return;
    if (!videoTexture) {
      videoTexture = new VideoTexture(element);
      videoTexture.colorSpace = SRGBColorSpace;
      // 视频尺寸通常不是 2 的幂：关掉 mipmap，用线性过滤，避免黑边和额外显存
      videoTexture.minFilter = LinearFilter;
      videoTexture.magFilter = LinearFilter;
      videoTexture.generateMipmaps = false;
      videoTexture.wrapS = ClampToEdgeWrapping;
      videoTexture.wrapT = ClampToEdgeWrapping;
    }
    applyCover(videoTexture);
    screenMaterial.map = videoTexture;
    screenMaterial.needsUpdate = true;
  }

  function playVideo(): void {
    const element = video;
    // 屏幕不在视野里 / 页面隐藏时都不播：加载完成但用户已经转走了，不该继续解码
    if (!element || disposed || status !== 'ready' || !visible || document.hidden) return;

    void element.play().catch((error: unknown) => {
      if (disposed) return;
      // pause() / 切源打断 play() 会抛 AbortError，这不是播放策略问题，
      // 不能把用户的「播放」意图改掉，否则转回视角时就不会自动续播了。
      if (error instanceof DOMException && error.name === 'AbortError') return;
      // 真被自动播放策略拦下：保留当前帧，按钮仍可再点一次
      // （用户手势一定能播），不弹 UI、不打断主流程。
      desiredPlaying = false;
    });
  }

  function releaseVideo(): void {
    if (video) {
      const element = video;
      // 先把引用置空再卸载：removeAttribute + load 会异步触发一次 error/emptied，
      // 留着引用会让那边的 handler 又走一遍失败流程
      video = null;
      element.pause();
      element.removeEventListener('loadeddata', handleFirstFrame);
      element.removeEventListener('canplay', handleFirstFrame);
      element.removeEventListener('playing', handleFirstFrame);
      element.removeEventListener('progress', handleLoadProgress);
      element.removeEventListener('seeked', handleVideoSeeked);
      element.removeEventListener('error', handleMediaError);
      element.removeEventListener('ended', handleEnded);
      element.removeEventListener('resize', handleVideoResize);
      element.removeAttribute('src');
      element.load();
      element.remove();
    }
    if (videoTexture) {
      videoTexture.dispose();
      videoTexture = null;
    }
  }

  function failToPoster(reason: string): void {
    if (disposed || status === 'error') return;
    clearLoadTimer();
    status = 'error';
    errorMessage = reason;
    releaseVideo();
    drawPoster('error', 0, 0);
  }

  function handleFirstFrame(): void {
    const element = video;
    if (!element || disposed || status === 'error' || status === 'ready') return;
    // canplay 可能早于首帧解码完成，readyState >= 2 才拿得到有效尺寸
    if (element.readyState < 2 || element.videoWidth <= 0) return;

    clearLoadTimer();
    attachVideoTexture();
    status = 'ready';
    errorMessage = null;
    if (visible && desiredPlaying && !document.hidden) playVideo();
  }

  function handleMediaError(): void {
    const element = video;
    failToPoster(element ? describeMediaError(element) : '视频加载失败');
  }

  /** 还有数据进来就续一次超时；真正卡死时 progress 不再触发，计时器才会到点 */
  function handleLoadProgress(): void {
    if (status === 'loading') refreshLoadTimer();
  }

  function handleEnded(): void {
    if (media.loop) return;
    desiredPlaying = false;
  }

  // 自适应码率 / 分辨率切换时重新按 cover 计算裁切，避免画面比例突然变形
  function handleVideoResize(): void {
    if (videoTexture) applyCover(videoTexture);
  }

  /**
   * 暂停态拖动进度条时，视频不会产生新的播放帧；显式标记纹理，
   * 保证画面跟着 currentTime 实时跳转，而不是等下一次播放才刷新。
   */
  function handleVideoSeeked(): void {
    if (videoTexture) videoTexture.needsUpdate = true;
  }

  function ensureVideo(): void {
    if (video || disposed) return;

    const element = document.createElement('video');
    element.className = 'video-wall-source';
    element.muted = muted;
    element.volume = volume;
    if (muted) element.setAttribute('muted', '');
    element.loop = media.loop;
    element.playsInline = true;
    element.setAttribute('playsinline', '');
    element.preload = 'auto';
    element.setAttribute('aria-hidden', 'true');
    element.tabIndex = -1;

    element.addEventListener('loadeddata', handleFirstFrame);
    element.addEventListener('canplay', handleFirstFrame);
    element.addEventListener('playing', handleFirstFrame);
    element.addEventListener('progress', handleLoadProgress);
    element.addEventListener('seeked', handleVideoSeeked);
    element.addEventListener('error', handleMediaError);
    element.addEventListener('ended', handleEnded);
    element.addEventListener('resize', handleVideoResize);

    // 先设 muted / playsinline 再挂 src：移动端才不会拦自动播放
    element.src = `${import.meta.env.BASE_URL}${media.src}`;
    document.body.appendChild(element);
    video = element;

    // 超时还没有首帧就回退海报：文件缺失 / 解码失败都不会让屏幕无限转圈。
    // 这是「卡死超时」：每次 progress 都会把它续上，见 refreshLoadTimer。
    refreshLoadTimer();

    element.load();
  }

  function startLoading(): void {
    if (started || disposed) return;
    started = true;
    status = 'loading';
    errorMessage = null;
    drawPoster('loading', 0, 0);
    ensureVideo();
  }

  function updateVisibility(): void {
    const onScreen = !document.hidden && isScreenVisible();

    if (onScreen) {
      if (!visible) {
        visible = true;
        visibleSeconds = 0;
      }
      // 每 0.2s 记一次连续可见时间，够 loadAfterVisibleSeconds 才真正拉流
      visibleSeconds += VISIBILITY_CHECK_SECONDS;

      if (!started && visibleSeconds >= media.loadAfterVisibleSeconds) {
        startLoading();
      } else if (status === 'ready' && desiredPlaying && video?.paused && !video.ended) {
        playVideo();
      }
    } else {
      visible = false;
      visibleSeconds = 0;
      // 只暂停、不改变播放意图：转回来时还能接着播
      if (video && !video.paused) video.pause();
    }
  }

  const handleDocumentVisibility = (): void => {
    if (document.hidden) {
      video?.pause();
      return;
    }
    // 回到前台立即重算一次，不必等下一个 0.2s 周期
    visibilityTimer = VISIBILITY_CHECK_SECONDS;
    updateVisibility();
  };

  document.addEventListener('visibilitychange', handleDocumentVisibility);

  // ───────────────────────── 对 DOM 播控层暴露的 API ─────────────────────────

  const snapshot = (): VideoWallSnapshot => {
    const element = video;
    const duration =
      element && Number.isFinite(element.duration) && element.duration > 0
        ? element.duration
        : media.durationSeconds;
    const currentTime =
      element && Number.isFinite(element.currentTime)
        ? clamp(element.currentTime, 0, duration)
        : 0;

    return {
      status,
      playing: element !== null && !element.paused && !element.ended,
      muted,
      volume,
      currentTime,
      duration,
      buffered: readBufferedProgress(),
      error: errorMessage,
    };
  };

  const togglePlay = (): void => {
    if (disposed) return;
    if (status === 'error') {
      retry();
      return;
    }
    if (status === 'standby') {
      desiredPlaying = true;
      startLoading();
      return;
    }
    if (status === 'loading') {
      // 加载中按钮是禁用的；这里仍记录意图，首帧到了再播
      desiredPlaying = true;
      return;
    }

    const element = video;
    if (!element) return;
    if (element.paused || element.ended) {
      desiredPlaying = true;
      if (element.ended) element.currentTime = 0;
      playVideo();
    } else {
      desiredPlaying = false;
      element.pause();
    }
  };

  const seek = (seconds: number): void => {
    const element = video;
    if (!element || status !== 'ready') return;
    const total = element.duration;
    if (!Number.isFinite(total) || total <= 0) return;
    try {
      // 留 0.02s 余量：正好落在 duration 上有些浏览器会立刻触发 ended
      element.currentTime = clamp(seconds, 0, Math.max(0, total - 0.02));
    } catch {
      // 元数据尚未就绪时赋 currentTime 会抛 InvalidStateError；忽略即可
    }
  };

  const setVolume = (value: number): void => {
    volume = clamp01(value);
    if (volume > 0) {
      // 拖动音量条本身就是一个「我要听声音」的动作
      muted = false;
      lastNonZeroVolume = volume;
    }
    applyAudio();
  };

  const toggleMuted = (): void => {
    if (muted || volume === 0) {
      muted = false;
      if (volume === 0) volume = lastNonZeroVolume;
    } else {
      lastNonZeroVolume = volume;
      muted = true;
    }
    applyAudio();
  };

  const retry = (): void => {
    if (disposed) return;
    clearLoadTimer();
    releaseVideo();
    started = false;
    status = 'standby';
    errorMessage = null;
    desiredPlaying = true;
    startLoading();
  };

  const update = (elapsedSeconds: number, deltaSeconds: number): void => {
    if (disposed) return;

    visibilityTimer += deltaSeconds;
    if (visibilityTimer >= VISIBILITY_CHECK_SECONDS) {
      visibilityTimer = 0;
      updateVisibility();
    }

    // 加载态只在屏幕真的可见时重画：默认机位背对前墙，这块 canvas 就完全不工作
    if (status === 'loading' && visible && !document.hidden) {
      posterTimer += deltaSeconds;
      if (posterTimer >= media.posterRefreshSeconds) {
        posterTimer = 0;
        drawPoster('loading', readBufferedProgress(), elapsedSeconds);
      }
    }
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    clearLoadTimer();
    document.removeEventListener('visibilitychange', handleDocumentVisibility);
    releaseVideo();
    poster.dispose();
  };

  drawPoster('standby', 0, 0);

  return {
    object: group,
    update,
    dispose,
    snapshot,
    togglePlay,
    seek,
    setVolume,
    toggleMuted,
    retry,
    getQuad,
    getConsoleQuad,
  };
}
