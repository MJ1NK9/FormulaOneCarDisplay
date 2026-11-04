/**
 * SceneManager —— 渲染骨架的唯一持有者。
 *
 * 职责：创建并持有 Scene / Camera / Renderer / OrbitControls，处理尺寸变化，
 *       运行全项目唯一的 requestAnimationFrame 循环，并提供统一的释放入口。
 *
 * 不做的事：不加载模型、不认识热点、不碰业务数据。外部通过 `scene` 往里挂对象，
 * 需要每帧联动（如动画、相机插值）时用 `onFrame` 注册回调。
 */
import {
  ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  HemisphereLight,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CAMERA_CONFIG, CONTROLS_CONFIG, LIGHT_CONFIG, RENDERER_CONFIG } from '../config/scene';

/** 每帧回调：参数为本帧耗时（秒），用于做与帧率无关的动画 */
export type FrameCallback = (deltaSeconds: number) => void;

export class SceneManager {
  /** 场景根：模型、灯光、热点对象都挂到这里 */
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly renderer: WebGLRenderer;
  readonly controls: OrbitControls;

  private readonly container: HTMLElement;
  private readonly resizeObserver: ResizeObserver;
  private readonly frameCallbacks = new Set<FrameCallback>();
  private previousTime = 0;
  private frameId: number | null = null;

  constructor(container: HTMLElement) {
    this.container = container;

    this.camera = new PerspectiveCamera(
      CAMERA_CONFIG.fov,
      1, // 真实宽高比在 handleResize 中统一设置，避免重复计算
      CAMERA_CONFIG.near,
      CAMERA_CONFIG.far,
    );
    this.camera.position.set(...CAMERA_CONFIG.position);
    this.camera.lookAt(...CAMERA_CONFIG.lookAt);

    this.renderer = new WebGLRenderer({ antialias: RENDERER_CONFIG.antialias });
    this.renderer.setClearColor(new Color(RENDERER_CONFIG.clearColor));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = RENDERER_CONFIG.toneMappingExposure;
    this.container.appendChild(this.renderer.domElement);

    this.addLights();

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = CONTROLS_CONFIG.enableDamping;
    this.controls.dampingFactor = CONTROLS_CONFIG.dampingFactor;
    this.controls.minDistance = CONTROLS_CONFIG.minDistance;
    this.controls.maxDistance = CONTROLS_CONFIG.maxDistance;
    this.controls.target.set(...CONTROLS_CONFIG.target);
    this.controls.update();

    // 用 ResizeObserver 而不是 window.resize：移动端地址栏收起、面板挤压容器时前者才准
    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(this.container);
    this.handleResize();
  }

  /** 注册每帧回调，返回取消函数 */
  onFrame(callback: FrameCallback): () => void {
    this.frameCallbacks.add(callback);
    return () => this.frameCallbacks.delete(callback);
  }

  /** 启动渲染循环（重复调用无副作用） */
  start(): void {
    if (this.frameId !== null) return;

    this.previousTime = performance.now();

    const tick = (now: number): void => {
      // 先排下一帧，保证回调里抛错也不会让整个循环停掉
      this.frameId = requestAnimationFrame(tick);

      const deltaSeconds = (now - this.previousTime) / 1000;
      this.previousTime = now;

      // 开启 damping 后必须每帧 update()，否则松开指针不会继续惯性衰减
      this.controls.update();

      for (const callback of this.frameCallbacks) {
        callback(deltaSeconds);
      }

      this.renderer.render(this.scene, this.camera);
    };

    this.frameId = requestAnimationFrame(tick);
  }

  /** 暂停渲染循环（页面隐藏时可调用，省电） */
  stop(): void {
    if (this.frameId === null) return;
    cancelAnimationFrame(this.frameId);
    this.frameId = null;
  }

  /** 释放 GPU 资源与 DOM；SPA 里切路由或热更新时调用 */
  dispose(): void {
    this.stop();
    this.frameCallbacks.clear();
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private addLights(): void {
    const { hemisphere, key, fill } = LIGHT_CONFIG;

    const ambient = new HemisphereLight(
      hemisphere.skyColor,
      hemisphere.groundColor,
      hemisphere.intensity,
    );
    this.scene.add(ambient);

    const keyLight = new DirectionalLight(key.color, key.intensity);
    keyLight.position.set(...key.position);
    this.scene.add(keyLight);

    const fillLight = new DirectionalLight(fill.color, fill.intensity);
    fillLight.position.set(...fill.position);
    this.scene.add(fillLight);
  }

  private handleResize(): void {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;

    // 容器被折叠成 0 尺寸时跳过，否则 aspect 会变成 NaN 并把画面渲染成空白
    if (width === 0 || height === 0) return;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    // 在 handleResize 里重设 pixelRatio，兼容窗口被拖到不同 DPI 显示器的情况
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, RENDERER_CONFIG.maxPixelRatio));
    this.renderer.setSize(width, height);
  }
}
