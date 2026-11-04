/**
 * LiftStage —— 升降换模舞台：升降台 + 升降井 + 双开滑动地板 + 全息投影。
 *
 * 职责：
 * 1. 搭出「车可以沉下去」的那套机构：带开口的展台内衬、方井、能升降的台面、两扇滑动地板；
 * 2. 用统一的帧驱动跑分段动画（下降 / 关闸 / 开闸 / 升起），每段返回 Promise；
 * 3. 把台面上的灯、井壁导光条、扫描光一起调度，让整个动作像一个整体；
 * 4. 提供 dispose，把几何 / 材质都还回去。
 *
 * 不做的事：不知道画质档位、不加载模型、不决定什么时候开始动画、也不画全息提示——
 * 「车辆切换中」是 DOM 层（ui/SwapHologram.vue），只有屏幕空间锚定才能保证
 * 水平居中、不被闸口挡住；这里只负责升降与开合。
 */
import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Path,
  PlaneGeometry,
  Shape,
  ShapeGeometry,
  type Object3D,
  type Plane,
} from 'three';
import { LIFT_CONFIG } from '../config/lift';
import { LIFT_OPENING, SHOWROOM_CONFIG } from '../config/showroom';
import { disposeObject3D } from './dispose';
import type { SceneManager } from './SceneManager';

export interface LiftStageOptions {
  readonly sceneManager: SceneManager;
  /** 车底视角的地面裁剪面：和展台一样，相机沉到地面以下时整块舞台跟着消失 */
  readonly floorClipPlane?: Plane;
}

/** 一段动画：duration 秒内把 [0,1] 交给 step，结束后 resolve */
interface Tween {
  readonly duration: number;
  readonly ease: (progress: number) => number;
  readonly step: (progress: number) => void;
  readonly resolve: () => void;
  elapsed: number;
}

function easeInOutCubic(progress: number): number {
  return progress < 0.5
    ? 4 * progress * progress * progress
    : 1 - (-2 * progress + 2) ** 3 / 2;
}

function easeOutCubic(progress: number): number {
  return 1 - (1 - progress) ** 3;
}

/**
 * 开口四周的深色接缝贴条。
 *
 * 台面必须比开口小一点才落得下去，那条 6mm 的缝就是这里盖掉的：
 * 贴条内侧压住台面边缘、外侧压在展台台面上，中间正好是缝。
 * 贴条只抬起 1.2mm，视觉上像一道机加工接缝，不像一块浮在上面的板。
 */
function createSeamRing(surfaceY: number, clippingPlanes?: Plane[]): Mesh {
  const halfWidth = LIFT_OPENING.width / 2;
  const halfDepth = LIFT_OPENING.depth / 2;
  const outerWidth = halfWidth + LIFT_CONFIG.seamRing.outer;
  const outerDepth = halfDepth + LIFT_CONFIG.seamRing.outer;
  const innerWidth = halfWidth - LIFT_CONFIG.seamRing.inner;
  const innerDepth = halfDepth - LIFT_CONFIG.seamRing.inner;

  const shape = new Shape();
  shape.moveTo(-outerWidth, -outerDepth);
  shape.lineTo(outerWidth, -outerDepth);
  shape.lineTo(outerWidth, outerDepth);
  shape.lineTo(-outerWidth, outerDepth);
  shape.closePath();

  const hole = new Path();
  hole.moveTo(-innerWidth, -innerDepth);
  hole.lineTo(-innerWidth, innerDepth);
  hole.lineTo(innerWidth, innerDepth);
  hole.lineTo(innerWidth, -innerDepth);
  hole.closePath();
  shape.holes.push(hole);

  const mesh = new Mesh(
    new ShapeGeometry(shape),
    new MeshStandardMaterial({
      color: LIFT_CONFIG.seamRing.color,
      roughness: 0.38,
      metalness: 0.85,
      clippingPlanes,
    }),
  );
  mesh.name = 'lift-seam-ring';
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = surfaceY + LIFT_CONFIG.seamRing.lift;
  return mesh;
}

interface ShaftParts {
  readonly group: Group;
  readonly ribMaterial: MeshStandardMaterial;
  readonly floorMaterial: MeshStandardMaterial;
}

/** 方井：用 BackSide 的盒子，等于一个「只看得到内壁」的坑，不用拼五块面 */
function createShaft(surfaceY: number, clippingPlanes?: Plane[]): ShaftParts {
  const group = new Group();
  group.name = 'lift-shaft';

  const config = LIFT_CONFIG.shaft;
  const width = LIFT_OPENING.width + config.clearance * 2;
  const depth = LIFT_OPENING.depth + config.clearance * 2;
  const height = config.depth;

  const wall = new Mesh(
    new BoxGeometry(width, height, depth),
    new MeshStandardMaterial({
      color: config.wallColor,
      roughness: 0.86,
      metalness: 0.22,
      side: BackSide,
      clippingPlanes,
    }),
  );
  wall.position.y = surfaceY - height / 2;
  group.add(wall);

  // 井底的一块弱发光板：有它，往下看才有「深」的参照，不会像个无底洞
  const floorMaterial = new MeshStandardMaterial({
    color: '#05090d',
    emissive: config.floorGlowColor,
    emissiveIntensity: 0.4,
    roughness: 0.95,
    metalness: 0.1,
    clippingPlanes,
  });
  const floor = new Mesh(new BoxGeometry(width * 0.92, 0.02, depth * 0.92), floorMaterial);
  floor.position.y = surfaceY - height + 0.02;
  group.add(floor);

  // 四条竖向导光条：贴着井壁，下降/升起时亮起来，给运动一个速度参照
  const ribMaterial = new MeshStandardMaterial({
    color: '#050505',
    emissive: config.ribColor,
    emissiveIntensity: config.ribIdleIntensity,
    roughness: 1,
    metalness: 0,
    clippingPlanes,
  });
  const ribHeight = height * 0.8;
  const ribY = surfaceY - 0.06 - ribHeight / 2;
  // 导光条放在前后两面井壁上：左右井壁在开闸后贴着门扇，放那里会和门板穿插
  const ribX = width * 0.28;
  const ribZ = depth / 2 - 0.03;

  for (const x of [-ribX, ribX]) {
    for (const z of [-ribZ, ribZ]) {
      const rib = new Mesh(new BoxGeometry(0.05, ribHeight, 0.03), ribMaterial);
      rib.position.set(x, ribY, z);
      group.add(rib);
    }
  }

  return { group, ribMaterial, floorMaterial };
}

interface PlatformParts {
  readonly edgeMaterial: MeshStandardMaterial;
  readonly scanBar: Mesh;
  readonly scanMaterial: MeshBasicMaterial;
}

/**
 * 升降台：原点在台面顶面，往下才是台体。
 * 台面材质参数和展台台面完全一致（颜色 / 粗糙度 / 金属度），升起后拼成一张台面。
 */
function createPlatform(platform: Group, clippingPlanes?: Plane[]): PlatformParts {
  const config = LIFT_CONFIG.platform;
  const width = LIFT_OPENING.width - 0.012;
  const depth = LIFT_OPENING.depth - 0.012;
  const topThickness = 0.02;

  const topMaterial = new MeshStandardMaterial({
    color: config.topColor,
    roughness: 0.45,
    metalness: 0.6,
    clippingPlanes,
    clipShadows: true,
  });
  const sideMaterial = new MeshStandardMaterial({
    color: config.sideColor,
    roughness: 0.62,
    metalness: 0.32,
    clippingPlanes,
    clipShadows: true,
  });

  const top = new Mesh(new BoxGeometry(width, topThickness, depth), topMaterial);
  top.position.y = -topThickness / 2;
  top.receiveShadow = true;
  platform.add(top);

  // 台体比台面再收 0.02，侧面因此有一道很细的台阶，不像一整块砖
  const bodyHeight = config.thickness - topThickness;
  const body = new Mesh(
    new BoxGeometry(width - 0.02, bodyHeight, depth - 0.02),
    sideMaterial,
  );
  body.position.y = -topThickness - bodyHeight / 2;
  platform.add(body);

  // 台沿灯条：围在台面下沿一圈，静止时几乎不亮，动起来才拉出轮廓
  const edgeMaterial = new MeshStandardMaterial({
    color: '#050505',
    emissive: config.edgeColor,
    emissiveIntensity: config.edgeIdleIntensity,
    roughness: 1,
    metalness: 0,
    clippingPlanes,
  });
  const edgeY = -topThickness - 0.004;
  const edgeInset = 0.007;

  for (const z of [-1, 1]) {
    const bar = new Mesh(new BoxGeometry(width, 0.014, 0.014), edgeMaterial);
    bar.position.set(0, edgeY, z * (depth / 2 - edgeInset));
    platform.add(bar);
  }
  for (const x of [-1, 1]) {
    const bar = new Mesh(new BoxGeometry(0.014, 0.014, depth), edgeMaterial);
    bar.position.set(x * (width / 2 - edgeInset), edgeY, 0);
    platform.add(bar);
  }

  // 扫描光条：台面上一道横着扫过去的细光，随平台一起升降
  const scanMaterial = new MeshBasicMaterial({
    color: config.scanColor,
    transparent: true,
    opacity: 0,
    blending: AdditiveBlending,
    depthWrite: false,
    clippingPlanes,
  });
  const scanBar = new Mesh(new PlaneGeometry(width * 0.9, 0.085), scanMaterial);
  scanBar.rotation.x = -Math.PI / 2;
  scanBar.position.y = 0.004;
  scanBar.renderOrder = 3;
  scanBar.visible = false;
  platform.add(scanBar);

  return { edgeMaterial, scanBar, scanMaterial };
}

interface HatchParts {
  readonly left: Group;
  readonly right: Group;
  readonly seamMaterial: MeshStandardMaterial;
}

/**
 * 两扇滑动地板：各占开口的一半，合拢时在中线拼缝，
 * 打开时朝左右滑进台沿下面的「口袋」，把井口完整让出来。
 *
 * 为什么不是上翻门：开口只有 1.8 宽、车长 5 的台面，上翻门要往井里立 0.9 高，
 * 下降的台面必须绕开它，视觉上还要多一层竖向遮挡；
 * 而展台左右各有 1.0 的台沿，正好能当滑门口袋，滑动是这块尺寸下最自然的机构。
 */
function createHatch(surfaceY: number, clippingPlanes?: Plane[]): HatchParts {
  const config = LIFT_CONFIG.hatch;
  const leafWidth = LIFT_OPENING.width / 2;
  const leafDepth = LIFT_OPENING.depth - 0.004;
  /** 合拢时每扇门中心到中线的距离 */
  const closedX = leafWidth / 2;
  const leafY = surfaceY - config.topGap - config.thickness / 2;

  const topMaterial = new MeshStandardMaterial({
    color: config.topColor,
    roughness: 0.45,
    metalness: 0.6,
    clippingPlanes,
    clipShadows: true,
  });
  const seamMaterial = new MeshStandardMaterial({
    color: '#050505',
    emissive: config.seamColor,
    emissiveIntensity: config.edgeIdleIntensity,
    roughness: 1,
    metalness: 0,
    clippingPlanes,
  });
  const grooveMaterial = new MeshStandardMaterial({
    color: '#0a1017',
    roughness: 0.35,
    metalness: 0.75,
    clippingPlanes,
  });

  const buildLeaf = (sign: 1 | -1): Group => {
    const leafGroup = new Group();
    leafGroup.position.set(sign * closedX, leafY, 0);

    const leaf = new Mesh(new BoxGeometry(leafWidth, config.thickness, leafDepth), topMaterial);
    leaf.receiveShadow = true;
    leafGroup.add(leaf);

    // 中缝发光条：贴在靠中线的那条边上，合拢时两块拼成一条完整的光缝。
    // 用平面而不是凸起的条：滑开时整块门板钻进台面板下面，任何凸起都会从台面
    // 顶出来变成一条多余的红线，平面只要比台面低一点就会被完全遮住。
    const seam = new Mesh(new PlaneGeometry(0.016, leafDepth * 0.96), seamMaterial);
    seam.rotation.x = -Math.PI / 2;
    seam.position.set(-sign * (leafWidth / 2 - 0.008), config.thickness / 2 + 0.0006, 0);
    leafGroup.add(seam);

    // 两条纵向分件线：大面积同色，加两条暗线才有金属板的分件感
    for (const ratio of [0.3, 0.7]) {
      const groove = new Mesh(new PlaneGeometry(0.008, leafDepth * 0.9), grooveMaterial);
      groove.rotation.x = -Math.PI / 2;
      groove.position.set(-sign * leafWidth * (0.5 - ratio), config.thickness / 2 + 0.0004, 0);
      leafGroup.add(groove);
    }

    return leafGroup;
  };

  return { left: buildLeaf(-1), right: buildLeaf(1), seamMaterial };
}

export class LiftStage {
  /** 挂到 scene 上的根节点 */
  readonly root = new Group();

  /** 车模挂载点：原点在台面顶面，升降动画只改它的 y */
  private readonly platform = new Group();
  private readonly surfaceY: number;
  private readonly edgeMaterial: MeshStandardMaterial;
  private readonly hatchSeamMaterial: MeshStandardMaterial;
  private readonly ribMaterial: MeshStandardMaterial;
  private readonly shaftFloorMaterial: MeshStandardMaterial;
  private readonly scanBar: Mesh;
  private readonly scanMaterial: MeshBasicMaterial;
  private readonly hatchLeft: Group;
  private readonly hatchRight: Group;
  /** 合拢时每扇门中心到中线的距离（= 开口半宽 / 2） */
  private readonly hatchClosedX: number;
  /** 每扇门往侧面滑出的距离 */
  private readonly hatchSlide: number;
  private readonly stopFrame: () => void;
  private readonly tweens: Tween[] = [];

  private deckOffset = 0;
  /** 舱门开度：0 = 合拢，1 = 完全滑开 */
  private hatchProgress: number;
  private glow = 0;
  private glowGeneration = 0;
  private scanProgress = 0;
  private disposed = false;

  constructor(options: LiftStageOptions) {
    const clippingPlanes = options.floorClipPlane ? [options.floorClipPlane] : undefined;
    const plinth = SHOWROOM_CONFIG.plinth;

    // 台面顶面 = 底座高度 + 台面板厚的一半（台面板向下压进底座）
    this.surfaceY = plinth.height + plinth.topPlateThickness / 2;
    this.hatchClosedX = LIFT_OPENING.width / 4;
    this.hatchSlide = LIFT_CONFIG.hatch.slide;
    // 初始状态是「低精度展示中」：台面齐平、两扇地板完全滑进台沿口袋
    this.hatchProgress = 1;

    this.root.name = 'lift-stage';
    this.root.add(createSeamRing(this.surfaceY, clippingPlanes));

    const shaft = createShaft(this.surfaceY, clippingPlanes);
    this.root.add(shaft.group);
    this.ribMaterial = shaft.ribMaterial;
    this.shaftFloorMaterial = shaft.floorMaterial;

    this.platform.name = 'lift-platform';
    this.platform.position.y = this.surfaceY;
    const platformParts = createPlatform(this.platform, clippingPlanes);
    this.root.add(this.platform);
    this.edgeMaterial = platformParts.edgeMaterial;
    this.scanBar = platformParts.scanBar;
    this.scanMaterial = platformParts.scanMaterial;

    const hatch = createHatch(this.surfaceY, clippingPlanes);
    this.hatchLeft = hatch.left;
    this.hatchRight = hatch.right;
    this.hatchSeamMaterial = hatch.seamMaterial;
    this.root.add(this.hatchLeft, this.hatchRight);
    this.applyHatch();

    this.stopFrame = options.sceneManager.onFrame((deltaSeconds) => this.update(deltaSeconds));
  }

  /**
   * 把车模放上台面。
   * 车模的 y 用「展台高度 - 台面顶面」（-0.01）：和原来的展台一样，
   * 轮胎略微陷进台面 0.01，看起来是压在上面而不是飘着。
   */
  attachModel(model: Object3D): void {
    model.position.set(0, SHOWROOM_CONFIG.plinth.height - this.surfaceY, 0);
    this.platform.add(model);
  }

  /**
   * 下降：台面载着车沉到井底。
   *
   * onProgress 每帧给出缓动后的行程比例（0~1），App 用它判断
   * 「下到 50% 时全息开始淡入」——按行程比例而不是时间，
   * 掉帧或动画时长调整都不会让触发时机跑偏。
   */
  playDescent(onProgress?: (progress: number) => void): Promise<void> {
    this.glowTo(1, 0.25);
    return this.animate(LIFT_CONFIG.timing.descendSeconds, easeInOutCubic, (progress) => {
      this.deckOffset = -LIFT_CONFIG.travel * progress;
      this.applyDeck();
      onProgress?.(progress);
    });
  }

  /** 合闸：两扇地板从两侧滑回中线，合缝盖住井口 */
  playGateClose(): Promise<void> {
    this.glowTo(1, 0.2);
    return this.animate(LIFT_CONFIG.timing.gateCloseSeconds, easeInOutCubic, (progress) => {
      this.hatchProgress = 1 - progress;
      this.applyHatch();
    });
  }

  /** 开闸：两扇地板朝左右滑进台沿口袋 */
  playGateOpen(): Promise<void> {
    return this.animate(LIFT_CONFIG.timing.gateOpenSeconds, easeOutCubic, (progress) => {
      this.hatchProgress = progress;
      this.applyHatch();
    });
  }

  /** 升起：台面载着新车回到齐平位置，结束时严格吸附到 0，不留接缝误差 */
  playRise(): Promise<void> {
    this.glowTo(1, 0.3);
    return this
      .animate(LIFT_CONFIG.timing.riseSeconds, easeInOutCubic, (progress) => {
        this.deckOffset = -LIFT_CONFIG.travel * (1 - progress);
        this.applyDeck();
      })
      .then(() => {
        if (this.disposed) return;
        this.snapRaised();
        this.glowTo(0, 0.9);
      });
  }

  /** 把台面对到齐平位置并强制刷新世界矩阵（热点要在这一刻按世界坐标重建） */
  snapRaised(): void {
    this.deckOffset = 0;
    this.applyDeck();
    this.platform.updateMatrixWorld(true);
  }

  dispose(): void {
    this.disposed = true;
    // 先放行所有等待中的 Promise，App 那边的异步链会看到 disposed / null 自行退出
    for (const tween of this.tweens) tween.resolve();
    this.tweens.length = 0;
    this.stopFrame();
    disposeObject3D(this.root);
  }

  private update(deltaSeconds: number): void {
    if (this.disposed) return;

    // 标签页切回来时 delta 可能是好几秒，钳一下，动画不会瞬间跳完
    const delta = Math.min(deltaSeconds, 0.1);

    this.stepTweens(delta);
    this.updateEffects(delta);
  }

  private stepTweens(delta: number): void {
    for (let index = this.tweens.length - 1; index >= 0; index -= 1) {
      const tween = this.tweens[index];
      if (!tween) continue;

      tween.elapsed += delta;
      const progress = Math.min(tween.elapsed / tween.duration, 1);
      tween.step(tween.ease(progress));

      if (progress >= 1) {
        this.tweens.splice(index, 1);
        tween.resolve();
      }
    }
  }

  /** 灯效 / 扫描光：全部由 glow 一个 0~1 的包络驱动，状态机不用逐盏灯去控制 */
  private updateEffects(delta: number): void {
    const platform = LIFT_CONFIG.platform;
    const hatch = LIFT_CONFIG.hatch;
    const shaft = LIFT_CONFIG.shaft;

    this.edgeMaterial.emissiveIntensity =
      platform.edgeIdleIntensity +
      (platform.edgeActiveIntensity - platform.edgeIdleIntensity) * this.glow;
    this.hatchSeamMaterial.emissiveIntensity =
      hatch.edgeIdleIntensity + (hatch.edgeActiveIntensity - hatch.edgeIdleIntensity) * this.glow;
    this.ribMaterial.emissiveIntensity =
      shaft.ribIdleIntensity + (shaft.ribActiveIntensity - shaft.ribIdleIntensity) * this.glow;
    this.shaftFloorMaterial.emissiveIntensity = 0.4 + this.glow * 1.6;

    const scanning = this.glow > 0.02;
    this.scanBar.visible = scanning;
    if (!scanning) return;

    this.scanProgress = (this.scanProgress + delta * 0.5) % 1;
    const depth = LIFT_OPENING.depth;
    this.scanBar.position.z = -depth / 2 + this.scanProgress * depth;
    // 两端淡、中间亮：光条像在台面上扫过一段，而不是一块贴纸
    this.scanMaterial.opacity = Math.sin(this.scanProgress * Math.PI) * 0.85 * this.glow;
  }

  private applyDeck(): void {
    this.platform.position.y = this.surfaceY + this.deckOffset;
  }

  private applyHatch(): void {
    const offset = this.hatchClosedX + this.hatchSlide * this.hatchProgress;
    this.hatchLeft.position.x = -offset;
    this.hatchRight.position.x = offset;
  }

  /**
   * 运行一段动画。
   * 用回调而不是 CSS / tween 库：整个项目只有 SceneManager 一个 RAF，
   * 所有动画都从那里走，页签切到后台时不会出现两套时钟。
   */
  private animate(
    duration: number,
    ease: (progress: number) => number,
    step: (progress: number) => void,
  ): Promise<void> {
    const safeDuration = Math.max(duration, 1 / 240);
    return new Promise((resolve) => {
      const tween: Tween = { duration: safeDuration, ease, step, resolve, elapsed: 0 };
      // 立刻落到起点：避免第一帧渲染时还停在上一段动画的终点
      step(ease(0));
      this.tweens.push(tween);
    });
  }

  /** 灯光包络：后发起的覆盖先发起的（用代际号让旧 tween 空转，不用手动取消） */
  private glowTo(target: number, duration: number): void {
    this.glowGeneration += 1;
    const generation = this.glowGeneration;
    const from = this.glow;

    void this.animate(duration, easeInOutCubic, (progress) => {
      if (generation !== this.glowGeneration) return;
      this.glow = from + (target - from) * progress;
    });
  }
}
