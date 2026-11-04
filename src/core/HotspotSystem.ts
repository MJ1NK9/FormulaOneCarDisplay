/**
 * HotspotSystem —— 热点标记与拾取的唯一实现。
 *
 * 职责：
 * 1. 把配置里的「车模局部坐标」换算成世界坐标，给每个热点建一个 CSS2D 圆点；
 * 2. 给每个热点建一个隐形代理球，用 Raycaster 做点击命中（不对车模网格做 raycast）；
 * 3. 处理「点击 vs 拖拽」的区分，避免转车时误弹卡片；
 * 4. 每帧按「法线是否背对镜头」淡出圆点，藏掉转到车身背面的标记。
 *
 * 不做的事：不认识 Vue、不读全局配置（热点数组由外部注入）、不决定卡片长什么样。
 * 选中结果通过 onSelect 回调抛给上层；圆点的「打开」状态由 setActive 同步，
 * 总显隐由 setEnabled 同步（页面右上角开关）。
 */
import {
  Group,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Raycaster,
  SphereGeometry,
  Vector2,
  Vector3,
  type Camera,
  type Object3D,
} from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { HOTSPOT_VIEW_CONFIG } from '../config/hotspot';
import type { Hotspot, HotspotScreenAnchor } from '../types/hotspot';

export interface HotspotSystemOptions {
  /** 热点数据（来自 config/hotspots.ts，由 App 注入） */
  readonly hotspots: readonly Hotspot[];
  /** 车模根节点：局部坐标、法线都以它为基准换算 */
  readonly model: Object3D;
  readonly camera: Camera;
  /** 拾取事件的来源：renderer.domElement（canvas） */
  readonly domElement: HTMLElement;
  /** 点中热点时给 id，点空白处给 null */
  readonly onSelect: (id: string | null) => void;
}

interface HotspotEntry {
  readonly hotspot: Hotspot;
  readonly worldPosition: Vector3;
  readonly worldNormal: Vector3;
  readonly element: HTMLButtonElement;
  readonly proxy: Mesh;
  readonly marker: CSS2DObject;
  /** 上一帧的透明度，用来跳过无变化的 DOM 写入 */
  lastOpacity: number;
}

/** 拖拽判定的起点快照 */
interface PointerStart {
  readonly id: number;
  readonly x: number;
  readonly y: number;
}

export class HotspotSystem {
  /** 挂到 scene 上的根节点；场景挪动时圆点会跟着走 */
  readonly root = new Group();

  private readonly options: HotspotSystemOptions;
  private readonly entries: HotspotEntry[] = [];
  private readonly proxies: Mesh[] = [];
  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();
  private readonly viewDirection = new Vector3();
  private readonly projected = new Vector3();
  private readonly modelPosition = new Vector3();
  private readonly modelQuaternion = new Quaternion();
  private readonly cleanups: (() => void)[] = [];
  private pointerStart: PointerStart | null = null;
  /** 总开关：关闭时圆点隐藏、代理球不参与拾取（对应页面右上角的开关） */
  private enabled = true;

  /**
   * 全局透明度包络（0~1）：换模动画开始时整体淡出、升起完成后整体淡入。
   * 它乘在「背向淡出」的结果上，所以不会破坏原有的法线淡出逻辑。
   */
  private fadeAlpha = 1;
  private fadeFrom = 1;
  private fadeTarget = 1;
  private fadeDuration = 0;
  private fadeElapsed = 0;

  constructor(options: HotspotSystemOptions) {
    this.options = options;
    this.root.name = 'hotspots';

    // localToWorld / getWorldQuaternion 读的是世界矩阵。模型刚 add 进场景时它还是单位矩阵，
    // 这里强制更新一次，否则所有热点会先聚在原点，等下一帧才跳到位。
    options.model.updateWorldMatrix(true, false);
    options.model.getWorldPosition(this.modelPosition);
    options.model.getWorldQuaternion(this.modelQuaternion);

    for (const hotspot of options.hotspots) {
      this.entries.push(this.createEntry(hotspot));
    }

    this.bindPointer();
  }

  /**
   * 把某个热点标成「打开」状态。
   * 只改 DOM 的 aria 与样式，不触发 onSelect——避免上层 open() 和回调互相打转。
   */
  setActive(id: string | null): void {
    for (const entry of this.entries) {
      entry.element.setAttribute('aria-expanded', String(entry.hotspot.id === id));
    }
  }

  /**
   * 总开关：关闭后圆点立即隐藏，代理球也不再参与拾取。
   *
   * root.visible 让 CSS2DRenderer 在下一帧统一隐藏（它会给整棵子树设 display:none）；
   * DOM 在这里先同步藏掉，避免点击开关到下一帧之间闪一下。
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.root.visible = enabled;

    for (const entry of this.entries) {
      if (enabled) {
        // 强制下一帧重算 opacity / pointerEvents（关闭时曾把它们改成 none）
        entry.lastOpacity = -1;
        entry.element.style.display = '';
      } else {
        entry.element.style.display = 'none';
        entry.element.style.pointerEvents = 'none';
        entry.element.tabIndex = -1;
      }
    }
  }

  /**
   * 整体淡入淡出（换模动画专用）。
   *
   * seconds = 0 表示立刻生效：新挂载的 HotspotSystem 用它把初始透明度对齐到
   * "当前应该隐藏还是显示"，否则新车升起后会先闪一下再淡入。
   */
  setFade(target: number, seconds: number): void {
    const clamped = Math.min(1, Math.max(0, target));
    this.fadeFrom = this.fadeAlpha;
    this.fadeTarget = clamped;
    this.fadeDuration = Math.max(seconds, 0);
    this.fadeElapsed = 0;

    if (this.fadeDuration === 0) {
      this.fadeAlpha = clamped;
      for (const entry of this.entries) entry.lastOpacity = -1;
    }
  }

  /** 每帧调用：按「热点法线 vs 镜头方向」淡出圆点 */
  update(deltaSeconds = 0): void {
    // 关闭时连淡出计算都不用跑；重新打开时 setEnabled 会把 lastOpacity 清成 -1
    if (!this.enabled) return;

    if (this.fadeElapsed < this.fadeDuration) {
      this.fadeElapsed = Math.min(this.fadeElapsed + deltaSeconds, this.fadeDuration);
      const ratio = this.fadeElapsed / this.fadeDuration;
      this.fadeAlpha = this.fadeFrom + (this.fadeTarget - this.fadeFrom) * ratio;
    } else if (this.fadeAlpha !== this.fadeTarget) {
      this.fadeAlpha = this.fadeTarget;
    }

    const cameraPosition = this.options.camera.position;
    const fadeStart = HOTSPOT_VIEW_CONFIG.markerFadeStart;
    const fadeSpan = HOTSPOT_VIEW_CONFIG.markerFadeEnd - fadeStart;

    for (const entry of this.entries) {
      this.viewDirection.subVectors(cameraPosition, entry.worldPosition).normalize();
      const facing = entry.worldNormal.dot(this.viewDirection);
      const facingOpacity = Math.min(1, Math.max(0, (facing - fadeStart) / fadeSpan));
      const opacity = facingOpacity * this.fadeAlpha;

      if (Math.abs(opacity - entry.lastOpacity) < 0.01) continue;
      entry.lastOpacity = opacity;

      entry.element.style.opacity = opacity.toFixed(2);
      // 看不到的圆点不该继续抢点击和 Tab 焦点
      const clickable = opacity > 0.05;
      entry.element.style.pointerEvents = clickable ? 'auto' : 'none';
      entry.element.tabIndex = clickable ? 0 : -1;
    }
  }

  /**
   * 把热点投影成屏幕坐标（CSS 像素）。
   * 公式与 CSS2DRenderer 内部的换算完全一致，卡片才能严丝合缝地贴在圆点上。
   */
  getScreenAnchor(id: string, width: number, height: number): HotspotScreenAnchor | null {
    if (!this.enabled) return null;

    const entry = this.entries.find((item) => item.hotspot.id === id);
    if (!entry) return null;

    // 帧回调发生在 renderer.render 之前，相机矩阵还停在上一帧（OrbitControls 刚改完
    // 位置，matrixWorldInverse 还没重算）。不补这一次更新，卡片会慢圆点一帧，
    // 快速拖拽时能看出「卡片追不上点」。
    this.options.camera.updateMatrixWorld();

    this.projected.copy(entry.worldPosition).project(this.options.camera);
    // CSS2DRenderer 的可见范围就是 NDC z ∈ [-1, 1]；
    // 超出去说明这个点跑到了相机背后或远裁剪面之外，卡片必须一起隐藏
    if (this.projected.z < -1 || this.projected.z > 1) return null;

    return {
      x: (this.projected.x * 0.5 + 0.5) * width,
      y: (-this.projected.y * 0.5 + 0.5) * height,
    };
  }

  dispose(): void {
    for (const cleanup of this.cleanups) cleanup();
    this.cleanups.length = 0;

    for (const entry of this.entries) {
      entry.proxy.geometry.dispose();
      const material = entry.proxy.material;
      if (Array.isArray(material)) material.forEach((item) => item.dispose());
      else material.dispose();
    }

    this.entries.length = 0;
    this.proxies.length = 0;
    this.root.removeFromParent();
    this.root.clear();
  }

  private createEntry(hotspot: Hotspot): HotspotEntry {
    const worldPosition = new Vector3(...hotspot.position);
    this.options.model.localToWorld(worldPosition);

    // 法线缺省时用「热点位置 - 车模原点」兜底；热点恰好在原点上时退回 +Y
    const worldNormal = hotspot.normal
      ? new Vector3(...hotspot.normal).applyQuaternion(this.modelQuaternion).normalize()
      : worldPosition.clone().sub(this.modelPosition).normalize();
    if (worldNormal.lengthSq() < 1e-6) worldNormal.set(0, 1, 0);

    const radius = hotspot.hitRadius ?? HOTSPOT_VIEW_CONFIG.defaultHitRadius;
    const proxy = new Mesh(
      new SphereGeometry(radius, 12, 8),
      new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
    );
    // colorWrite = false：不写颜色也不写深度，纯粹是「看不见但 exists」的拾取体。
    // 注意不能用 visible = false —— Raycaster 会直接跳过不可见对象。
    const proxyMaterial = proxy.material as MeshBasicMaterial;
    proxyMaterial.colorWrite = false;
    proxy.position.copy(worldPosition);
    proxy.name = `hotspot-proxy-${hotspot.id}`;
    this.root.add(proxy);
    this.proxies.push(proxy);

    const element = document.createElement('button');
    element.type = 'button';
    element.className = 'hotspot';
    element.dataset.hotspotId = hotspot.id;
    element.setAttribute('aria-label', `${hotspot.label} · ${hotspot.title}`);
    element.setAttribute('aria-expanded', 'false');

    const dot = document.createElement('span');
    dot.className = 'hotspot__dot';
    const label = document.createElement('span');
    label.className = 'hotspot__label';
    label.textContent = hotspot.label;
    element.append(dot, label);

    const handleClick = (event: MouseEvent): void => {
      // 按钮是 CSS2D 图层里的独立 DOM，不会冒泡到 canvas，拖拽不受影响；
      // 这里只负责把选中结果交给上层
      event.preventDefault();
      this.handleSelect(hotspot.id);
    };
    element.addEventListener('click', handleClick);
    this.cleanups.push(() => {
      element.removeEventListener('click', handleClick);
      // CSS2DObject 被移除时 three 不会帮忙删 DOM，必须自己清理，否则热更新会叠出一堆圆点
      element.remove();
    });

    const marker = new CSS2DObject(element);
    marker.position.copy(worldPosition);
    marker.name = `hotspot-marker-${hotspot.id}`;
    this.root.add(marker);

    return {
      hotspot,
      worldPosition,
      worldNormal,
      element,
      proxy,
      marker,
      lastOpacity: -1,
    };
  }

  private bindPointer(): void {
    const element = this.options.domElement;

    const handleDown = (event: PointerEvent): void => {
      // 鼠标只认左键；触摸事件的 button 固定是 0
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      this.pointerStart = { id: event.pointerId, x: event.clientX, y: event.clientY };
    };

    const handleUp = (event: PointerEvent): void => {
      const start = this.pointerStart;
      if (!start || start.id !== event.pointerId) return;
      this.pointerStart = null;

      const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y);
      // 位移超过阈值 = 用户想转车，这次 pointerup 不算点击
      if (moved > HOTSPOT_VIEW_CONFIG.dragThresholdPx) return;

      const entry = this.pick(event);
      this.handleSelect(entry ? entry.hotspot.id : null);
    };

    const handleCancel = (): void => {
      this.pointerStart = null;
    };

    element.addEventListener('pointerdown', handleDown, { passive: true });
    element.addEventListener('pointerup', handleUp, { passive: true });
    element.addEventListener('pointercancel', handleCancel, { passive: true });

    this.cleanups.push(() => {
      element.removeEventListener('pointerdown', handleDown);
      element.removeEventListener('pointerup', handleUp);
      element.removeEventListener('pointercancel', handleCancel);
    });
  }

  /** 只对代理球做 raycast，返回最近的那个热点 */
  private pick(event: PointerEvent): HotspotEntry | null {
    if (!this.enabled) return null;

    const element = this.options.domElement;
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;

    this.pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.options.camera);

    // 只让「当前面向镜头」的代理球参与拾取：背面圆点虽然看不见，但代理球还在，
    // 不筛掉的话点车尾会命中车头那几个已经淡出的点
    const candidates = this.entries
      .filter((entry) => entry.lastOpacity > 0.05)
      .map((entry) => entry.proxy);
    const hits = this.raycaster.intersectObjects(candidates, false);
    const hit = hits[0];
    if (!hit) return null;

    return this.entries.find((entry) => entry.proxy === hit.object) ?? null;
  }

  private handleSelect(id: string | null): void {
    this.setActive(id);
    this.options.onSelect(id);
  }
}
