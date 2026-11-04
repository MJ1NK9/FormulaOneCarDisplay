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
  Box3,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  PCFShadowMap,
  Plane,
  PMREMGenerator,
  PerspectiveCamera,
  PointLight,
  Scene,
  Sphere,
  SpotLight,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  type Object3D,
  type WebGLRenderTarget,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import {
  ATMOSPHERE_CONFIG,
  CAMERA_CONFIG,
  CAMERA_FIT_CONFIG,
  CONTROLS_CONFIG,
  LIGHT_CONFIG,
  RENDERER_CONFIG,
  SHADOW_CONFIG,
  UNDERBODY_CLIP_CONFIG,
} from '../config/scene';

/** 每帧回调：参数为本帧耗时（秒），用于做与帧率无关的动画 */
export type FrameCallback = (deltaSeconds: number) => void;

export class SceneManager {
  /** 场景根：模型、灯光、热点对象都挂到这里 */
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly renderer: WebGLRenderer;
  /**
   * HTML 标记图层：热点圆点是真实 DOM（可聚焦、可 hover、带 aria），
   * 由 CSS2DRenderer 每帧按 3D 位置摆到屏幕上。它不是一个 3D 对象。
   */
  readonly css2dRenderer: CSS2DRenderer;
  readonly controls: OrbitControls;

  /**
   * 车底视角的地面裁剪面（法线朝下，世界坐标）。
   * 它的 constant 每帧跟着相机高度走：相机在地面上方时什么也不裁；
   * 相机沉到地面以下时，地板和展台被切掉，镜头和车底之间不会横着一块地面。
   */
  readonly floorClipPlane = new Plane(new Vector3(0, -1, 0), 1000);

  private readonly container: HTMLElement;
  private readonly resizeObserver: ResizeObserver;
  private readonly environmentTarget: WebGLRenderTarget;
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

    // 车影是「贴地」的关键：主光投一张 2048 的软阴影到地坪上
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    // 材质上的 clippingPlanes 只有开了 localClippingEnabled 才会生效
    this.renderer.localClippingEnabled = true;

    this.container.appendChild(this.renderer.domElement);

    // HTML 标记层压在 canvas 上方：CSS2DRenderer 只负责 translate，不接管点击。
    // 图层本身 pointer-events: none（three 默认如此），只有热点按钮自己开 auto，
    // 这样拖拽旋转仍然能穿过空白区域生效。
    this.css2dRenderer = new CSS2DRenderer();
    this.css2dRenderer.domElement.className = 'css2d-layer';
    this.container.appendChild(this.css2dRenderer.domElement);

    // 背景与雾同色：地坪和墙往远处自然融进背景色，看起来像车间深处没有尽头
    const atmosphere = new Color(RENDERER_CONFIG.clearColor);
    this.scene.background = atmosphere;
    this.scene.fog = new Fog(atmosphere, ATMOSPHERE_CONFIG.fogNear, ATMOSPHERE_CONFIG.fogFar);

    // 车漆、碳纤维这类 PBR 材质靠环境反射出质感，没有 environment 会暗成一片。
    // RoomEnvironment 是程序生成的室内光照，不需要外部 HDRI 文件；
    // PMREM 把光照预过滤成不同粗糙度对应的 mip，材质才能正确采样。
    const pmremGenerator = new PMREMGenerator(this.renderer);
    this.environmentTarget = pmremGenerator.fromScene(new RoomEnvironment(), 0.04);
    pmremGenerator.dispose();
    this.scene.environment = this.environmentTarget.texture;
    // 环境光强度压到 0.75：车漆还能反射，但墙不会跟着一起被照亮，主光的光池才立得住
    this.scene.environmentIntensity = LIGHT_CONFIG.environmentIntensity;

    this.addLights();

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = CONTROLS_CONFIG.enableDamping;
    this.controls.dampingFactor = CONTROLS_CONFIG.dampingFactor;
    this.controls.minDistance = CONTROLS_CONFIG.minDistance;
    this.controls.maxDistance = CONTROLS_CONFIG.maxDistance;
    // 方位角不再限位：四面墙 + 天花板是封闭的，360° 转也不会看到房间外。
    // 只保留俯仰限位：上限越过水平线，允许镜头沉到地面以下看车底。
    this.controls.minPolarAngle = CONTROLS_CONFIG.minPolarAngle;
    this.controls.maxPolarAngle = CONTROLS_CONFIG.maxPolarAngle;
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

      // 裁掉「相机视线以下」的地面/展台：相机在地面上方时等于不裁，
      // 沉到车底时地面自动消失，不会挡住车底
      this.floorClipPlane.constant = this.camera.position.y - UNDERBODY_CLIP_CONFIG.margin;

      for (const callback of this.frameCallbacks) {
        callback(deltaSeconds);
      }

      this.renderer.render(this.scene, this.camera);

      // 两个 renderer 共用同一台相机：WebGL 画车身，CSS2D 把圆点摆到投影位置
      this.css2dRenderer.render(this.scene, this.camera);
    };

    this.frameId = requestAnimationFrame(tick);
  }

  /** 暂停渲染循环（页面隐藏时可调用，省电） */
  stop(): void {
    if (this.frameId === null) return;
    cancelAnimationFrame(this.frameId);
    this.frameId = null;
  }

  /**
   * 让相机自动框住一个对象：按包围球算「刚好装下」的距离，并把控制器旋转中心移到球心。
   *
   * 用包围球而不是包围盒：球半径不随观察角度变化，用户拖拽旋转时模型大小稳定，
   * 不会出现转到某个角度突然变局促或变空的情况。
   */
  frameObject(object: Object3D): void {
    const sphere = new Box3().setFromObject(object).getBoundingSphere(new Sphere());

    // 同时算竖直和水平视野：手机竖屏时水平视野更窄，只按竖直算会让车超出左右边界。
    // 取两者中较小的那个（限制更强的一侧）来决定距离，横屏/桌面结果与原来一致。
    const vFov = (this.camera.fov * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect);
    const limitingHalfFov = Math.min(vFov, hFov) / 2;

    // 限制视野恰好装下包围球所需的距离；padding > 1 让画面留出边距
    const distance = (sphere.radius * CAMERA_FIT_CONFIG.padding) / Math.sin(limitingHalfFov);

    // 方向沿用固定机位（斜 45° 俯视），只把长度换成按模型算出来的距离
    const direction = new Vector3(...CAMERA_CONFIG.position).normalize();

    // 注视点比车心略高：车落到画面下半部，上方才留得出背墙和桁架；
    // 再向右偏一点：后墙三屏整体偏画面右侧，右移后主屏才能完整入画
    const target = sphere.center.clone();
    target.y += CAMERA_FIT_CONFIG.targetOffsetY;
    target.x += CAMERA_FIT_CONFIG.targetOffsetX;

    this.camera.position.copy(sphere.center).addScaledVector(direction, distance);
    this.camera.lookAt(target);

    this.controls.target.copy(target);
    this.controls.minDistance = sphere.radius * CAMERA_FIT_CONFIG.minDistanceRatio;
    this.controls.maxDistance = sphere.radius * CAMERA_FIT_CONFIG.maxDistanceRatio;
    this.controls.update();
  }

  /** 释放 GPU 资源与 DOM；SPA 里切路由或热更新时调用 */
  dispose(): void {
    this.stop();
    this.frameCallbacks.clear();
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.scene.environment = null;
    this.environmentTarget.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.css2dRenderer.domElement.remove();
  }

  private addLights(): void {
    const { hemisphere, key, fill, rim } = LIGHT_CONFIG;

    const ambient = new HemisphereLight(
      hemisphere.skyColor,
      hemisphere.groundColor,
      hemisphere.intensity,
    );
    this.scene.add(ambient);

    // 主光：聚光灯，只照亮车所在的圆，四周自然压暗（光池）
    const keyLight = new SpotLight(
      key.color,
      key.intensity,
      key.distance,
      key.angle,
      key.penumbra,
      key.decay,
    );
    keyLight.position.set(...key.position);
    // 聚光灯的 target 是一个独立对象，必须也加进场景，否则世界矩阵不更新、灯会照向原点
    keyLight.target.position.set(...key.target);
    this.scene.add(keyLight.target);

    // 只有主光投影：补光和轮廓光再投一次影，除了多算一张阴影图没有收益
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(SHADOW_CONFIG.mapSize, SHADOW_CONFIG.mapSize);
    keyLight.shadow.camera.near = SHADOW_CONFIG.near;
    keyLight.shadow.camera.far = SHADOW_CONFIG.far;
    keyLight.shadow.bias = SHADOW_CONFIG.bias;
    keyLight.shadow.normalBias = SHADOW_CONFIG.normalBias;
    keyLight.shadow.radius = SHADOW_CONFIG.radius;
    this.scene.add(keyLight);

    // 实用光：灯带本身只是 emissive 面片，靠这两盏点光把「溢光」补出来
    for (const practical of LIGHT_CONFIG.practical) {
      const light = new PointLight(practical.color, practical.intensity, practical.distance, 2);
      light.position.set(...practical.position);
      this.scene.add(light);
    }

    const fillLight = new DirectionalLight(fill.color, fill.intensity);
    fillLight.position.set(...fill.position);
    this.scene.add(fillLight);

    // 轮廓光从车后斜上方压过来：深色车漆靠它把边缘从墙面上分出来
    const rimLight = new DirectionalLight(rim.color, rim.intensity);
    rimLight.position.set(...rim.position);
    this.scene.add(rimLight);
  }

  private handleResize(): void {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;

    // 容器被折叠成 0 尺寸时跳过，否则 aspect 会变成 NaN 并把画面渲染成空白
    if (width === 0 || height === 0) return;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    // 在 handleResize 里重设 pixelRatio，兼容窗口被拖到不同 DPI 显示器的情况；
    // renderScale 是可选超采样：1x 屏上贴图细节有锯齿时可以调大
    const pixelRatio = window.devicePixelRatio * RENDERER_CONFIG.renderScale;
    this.renderer.setPixelRatio(Math.min(pixelRatio, RENDERER_CONFIG.maxPixelRatio));
    this.renderer.setSize(width, height);

    // CSS2D 是 DOM，只按 CSS 像素设尺寸，不要跟着 devicePixelRatio 放大
    this.css2dRenderer.setSize(width, height);
  }
}
