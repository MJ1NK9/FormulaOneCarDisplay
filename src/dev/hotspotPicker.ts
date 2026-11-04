/**
 * 开发期热点取点工具（只在 `?pick` + DEV 下加载，不进生产包）。
 *
 * 为什么需要它：热点坐标必须由作者在真实模型上点出来，靠肉眼试 [x, y, z] 会把时间全耗在
 * 反复刷新上。这里对车模做一次 raycast，把命中点换算成「车模局部坐标 + 法线」，
 * 直接给出能粘进 `config/hotspots.ts` 的两行。
 *
 * 它和线上拾取的区别：拾取只打代理球（性能考虑），取点工具打真实网格——
 * 但只在你点一下的时候算一次，而且只在 dev 环境存在，不影响线上。
 */
import {
  Matrix3,
  Quaternion,
  Raycaster,
  Vector2,
  type Camera,
  type Object3D,
} from 'three';
import { HOTSPOT_VIEW_CONFIG } from '../config/hotspot';
import './hotspotPicker.css';

export interface HotspotPickerOptions {
  readonly model: Object3D;
  readonly camera: Camera;
  /** 拾取事件的来源：canvas */
  readonly domElement: HTMLElement;
}

export interface HotspotPickerHandle {
  dispose(): void;
}

interface PointerStart {
  readonly id: number;
  readonly x: number;
  readonly y: number;
}

/** 坐标保留 3 位小数：再精细对贴点没有意义，还会让配置文件变脏 */
function round(value: number): number {
  return Number(value.toFixed(3));
}

export function createHotspotPicker(options: HotspotPickerOptions): HotspotPickerHandle {
  const canvas = options.domElement;
  const previousCursor = canvas.style.cursor;
  canvas.style.cursor = 'crosshair';
  document.body.classList.add('is-picking');

  const panel = document.createElement('aside');
  panel.className = 'picker';
  // 纯静态模板，不拼接任何外部内容
  panel.innerHTML = `
    <p class="picker__head"><span class="picker__tag">DEV</span>HOTSPOT PICKER</p>
    <p class="picker__hint">点击车身取点，按住拖动仍然可以旋转；Esc 退出。</p>
    <pre class="picker__code" data-role="code">点击车身任意位置…</pre>
    <div class="picker__actions">
      <button type="button" class="picker__button" data-role="copy">复制参数</button>
      <button type="button" class="picker__button picker__button--ghost" data-role="clear">清空</button>
    </div>
    <p class="picker__count" data-role="count"></p>
  `;
  document.body.appendChild(panel);

  const codeElement = panel.querySelector<HTMLElement>('[data-role="code"]');
  const copyButton = panel.querySelector<HTMLButtonElement>('[data-role="copy"]');
  const clearButton = panel.querySelector<HTMLButtonElement>('[data-role="clear"]');
  const countElement = panel.querySelector<HTMLElement>('[data-role="count"]');
  if (!codeElement || !copyButton || !clearButton || !countElement) {
    throw new Error('取点面板结构不完整');
  }

  const raycaster = new Raycaster();
  const pointer = new Vector2();
  const inverseQuaternion = new Quaternion();
  let pointerStart: PointerStart | null = null;
  let snippet = '';
  let pickedCount = 0;
  let copyTimer: number | null = null;

  const handlePointerDown = (event: PointerEvent): void => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    pointerStart = { id: event.pointerId, x: event.clientX, y: event.clientY };
  };

  const handlePointerUp = (event: PointerEvent): void => {
    const start = pointerStart;
    if (!start || start.id !== event.pointerId) return;
    pointerStart = null;

    // 与线上拾取用同一个阈值：拖动旋转时不要误取点
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > HOTSPOT_VIEW_CONFIG.dragThresholdPx) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, options.camera);

    const hit = raycaster.intersectObject(options.model, true)[0];
    if (!hit || !hit.face) {
      codeElement.textContent = '没有命中车身，换个位置再点';
      return;
    }

    // 命中点是世界坐标，配置需要车模局部坐标；模型被缩放过，必须用 localToWorld 的逆变换
    const localPoint = options.model.worldToLocal(hit.point.clone());

    // 面法线在网格自己的坐标系里，先转到世界，再转到车模根节点的局部坐标系
    const worldNormal = hit.face.normal
      .clone()
      .applyNormalMatrix(new Matrix3().getNormalMatrix(hit.object.matrixWorld))
      .normalize();
    const localNormal = worldNormal
      .applyQuaternion(options.model.getWorldQuaternion(inverseQuaternion).invert())
      .normalize();

    snippet = [
      `position: [${round(localPoint.x)}, ${round(localPoint.y)}, ${round(localPoint.z)}],`,
      `normal: [${round(localNormal.x)}, ${round(localNormal.y)}, ${round(localNormal.z)}]`,
    ].join('\n');

    codeElement.textContent = snippet;
    pickedCount += 1;
    countElement.textContent = `已取 ${pickedCount} 个点 · 粘到 src/config/hotspots.ts 对应条目`;
  };

  const handlePointerCancel = (): void => {
    pointerStart = null;
  };

  const handleCopy = async (): Promise<void> => {
    if (!snippet) return;

    try {
      await navigator.clipboard.writeText(snippet);
      copyButton.textContent = '已复制';
      if (copyTimer !== null) window.clearTimeout(copyTimer);
      copyTimer = window.setTimeout(() => {
        copyButton.textContent = '复制参数';
        copyTimer = null;
      }, 1400);
    } catch {
      // 剪贴板权限被拦时退回「选中文本」，用户按 Ctrl+C 也能走通
      const range = document.createRange();
      range.selectNodeContents(codeElement);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      copyButton.textContent = '已选中，按 Ctrl+C';
    }
  };

  const handleClear = (): void => {
    snippet = '';
    pickedCount = 0;
    codeElement.textContent = '点击车身任意位置…';
    countElement.textContent = '';
  };

  const handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') dispose();
  };

  const onCopyClick = (): void => {
    void handleCopy();
  };

  canvas.addEventListener('pointerdown', handlePointerDown, { passive: true });
  canvas.addEventListener('pointerup', handlePointerUp, { passive: true });
  canvas.addEventListener('pointercancel', handlePointerCancel, { passive: true });
  window.addEventListener('keydown', handleKeyDown);
  copyButton.addEventListener('click', onCopyClick);
  clearButton.addEventListener('click', handleClear);

  let disposed = false;

  function dispose(): void {
    if (disposed) return;
    disposed = true;

    canvas.removeEventListener('pointerdown', handlePointerDown);
    canvas.removeEventListener('pointerup', handlePointerUp);
    canvas.removeEventListener('pointercancel', handlePointerCancel);
    window.removeEventListener('keydown', handleKeyDown);
    copyButton?.removeEventListener('click', onCopyClick);
    clearButton?.removeEventListener('click', handleClear);
    if (copyTimer !== null) window.clearTimeout(copyTimer);

    panel.remove();
    document.body.classList.remove('is-picking');
    canvas.style.cursor = previousCursor;
  }

  return { dispose };
}
