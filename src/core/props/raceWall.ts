/**
 * 后墙三屏：中间一块主视觉大屏，左右各一块辅助遥测屏。
 *
 * 布局约束：
 * 1. 三块屏共用 config 里的屏幕组中轴：group.position.x = 0 让主屏水平居中，
 *    group.position.y = 2.2 让左右副屏和主屏在同一条水平中轴上；
 * 2. 副屏尺寸和间距由配置算出，左右严格镜像，任何一块都不伸出后墙；
 * 3. 所有屏幕都贴在后墙（z ≈ -6.7），在车、升降台、闸口和 DOM 全息层之后，
 *    既不占中景，也不会改变现有换模动画的层级。
 *
 * 材质用 MeshBasicMaterial（不受光照、关掉 toneMapping）：
 * 屏幕自己是光源，不该再被主光二次照亮，也不该被色调映射压暗。
 *
 * 刷新与上电：
 * - 主屏 2s、副屏 0.9s 重画一次 canvas，数值和图表持续变化；
 * - 启动时三块屏各做一次 1.15s 的自上而下扫描上电，主屏先亮、左右副屏延后
 *   0.12s 一起亮。上电完全在贴图里完成，不新增 DOM / 渲染层级，也不参与
 *   LiftStage 的换模时序。
 */
import {
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  type CanvasTexture,
} from 'three';
import { SHOWROOM_CONFIG } from '../../config/showroom';
import { createRaceWallTexture, createTelemetryScreenTexture } from '../ProceduralTextures';

export interface RaceWallProp {
  readonly object: Group;
  readonly update: (elapsedSeconds: number) => void;
}

/** 一块屏的刷新状态：上电期间按固定间隔重画，稳定后按各自的 refreshSeconds 重画 */
interface ScreenRuntime {
  readonly draw: (elapsedSeconds: number, bootProgress: number) => void;
  readonly refreshSeconds: number;
  readonly bootDelaySeconds: number;
  readonly bootSeconds: number;
  lastRefresh: number;
  lastBootDraw: number;
  booted: boolean;
}

/** 上电扫描按 30fps 重画就够了：再快也只是让扫描线更顺，CPU 成本却翻倍 */
const BOOT_DRAW_INTERVAL = 1 / 30;

interface ScreenPanelOptions {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  /** 相对屏幕组中轴的 X：主屏 0，左右副屏 ±sideCenterX */
  readonly x: number;
  readonly frameColor: string;
  readonly screenOffset: number;
  readonly texture: CanvasTexture;
  readonly draw: (elapsedSeconds: number, bootProgress: number) => void;
  readonly refreshSeconds: number;
  readonly bootDelaySeconds: number;
  readonly bootSeconds: number;
}

/** 一块屏 = 背板（形成边框、挡住墙缝）+ 自发光屏幕面，位置相对屏幕组中轴 */
function addScreenPanel(
  parent: Group,
  options: ScreenPanelOptions,
  runtimes: ScreenRuntime[],
): void {
  const panel = new Group();
  panel.name = options.name;
  panel.position.set(options.x, 0, 0);

  const bezel = new Mesh(
    new BoxGeometry(options.width + 0.16, options.height + 0.16, 0.12),
    new MeshStandardMaterial({
      color: options.frameColor,
      roughness: 0.8,
      metalness: 0.2,
    }),
  );
  // 背板中心在屏幕面之后：z 轴上是「墙 → 背板 → 屏幕」，屏幕只比背板凸出 0.05
  bezel.position.z = -0.07;
  // 屏幕不投影也不接影：换模时车/桁架的阴影不会突然扫过画面，层级保持稳定
  bezel.castShadow = false;
  bezel.receiveShadow = false;
  panel.add(bezel);

  const screen = new Mesh(
    new PlaneGeometry(options.width, options.height),
    new MeshBasicMaterial({ map: options.texture, toneMapped: false }),
  );
  screen.name = `${options.name}-screen`;
  screen.position.z = options.screenOffset;
  panel.add(screen);

  parent.add(panel);

  runtimes.push({
    draw: options.draw,
    refreshSeconds: options.refreshSeconds,
    bootDelaySeconds: options.bootDelaySeconds,
    bootSeconds: options.bootSeconds,
    lastRefresh: -Infinity,
    lastBootDraw: -Infinity,
    booted: false,
  });
}

export function createRaceWall(): RaceWallProp {
  const cfg = SHOWROOM_CONFIG.raceWall;
  const group = new Group();
  group.name = 'showroom-race-wall';
  // 组原点 = 三块屏共用的垂直中轴；主屏和副屏都以 y=0 挂在组里
  group.position.set(...cfg.position);
  group.rotation.y = cfg.rotationY;

  const runtimes: ScreenRuntime[] = [];

  // ── 主屏：6.4 × 3.2（和 2048×1024 贴图同比例），信息密度最高，是后墙的视觉主导 ──
  const main = createRaceWallTexture();
  addScreenPanel(
    group,
    {
      name: 'race-wall-main',
      width: cfg.width,
      height: cfg.height,
      x: 0,
      frameColor: cfg.frameColor,
      screenOffset: cfg.screenOffset,
      texture: main.texture,
      draw: main.draw,
      refreshSeconds: cfg.refreshSeconds,
      // 主屏先亮，不延迟
      bootDelaySeconds: 0,
      bootSeconds: cfg.bootSeconds,
    },
    runtimes,
  );

  // ── 左右副屏：以主屏为中心镜像展开，尺寸/间距/中轴全部来自配置 ──
  const sideCenterX = cfg.width / 2 + cfg.side.gap + cfg.side.width / 2;
  const left = createTelemetryScreenTexture('energy');
  addScreenPanel(
    group,
    {
      name: 'race-wall-side-left',
      width: cfg.side.width,
      height: cfg.side.height,
      x: -sideCenterX,
      frameColor: cfg.frameColor,
      screenOffset: cfg.screenOffset,
      texture: left.texture,
      draw: left.draw,
      refreshSeconds: cfg.side.refreshSeconds,
      bootDelaySeconds: cfg.side.bootDelaySeconds,
      bootSeconds: cfg.bootSeconds,
    },
    runtimes,
  );

  const right = createTelemetryScreenTexture('aero');
  addScreenPanel(
    group,
    {
      name: 'race-wall-side-right',
      width: cfg.side.width,
      height: cfg.side.height,
      x: sideCenterX,
      frameColor: cfg.frameColor,
      screenOffset: cfg.screenOffset,
      texture: right.texture,
      draw: right.draw,
      refreshSeconds: cfg.side.refreshSeconds,
      bootDelaySeconds: cfg.side.bootDelaySeconds,
      bootSeconds: cfg.bootSeconds,
    },
    runtimes,
  );

  const update = (elapsedSeconds: number): void => {
    for (const runtime of runtimes) {
      const bootProgress = Math.min(
        1,
        Math.max(0, (elapsedSeconds - runtime.bootDelaySeconds) / runtime.bootSeconds),
      );

      if (bootProgress < 1) {
        // 还没到这块屏的上电时刻：保持创建时画好的全黑遮罩，不必每帧重画
        if (bootProgress <= 0) continue;
        if (elapsedSeconds - runtime.lastBootDraw < BOOT_DRAW_INTERVAL) continue;
        runtime.lastBootDraw = elapsedSeconds;
        runtime.draw(elapsedSeconds, bootProgress);
        continue;
      }

      // 刚扫完：补一帧「完全点亮」，同时把刷新计时从这一刻重新起算
      if (!runtime.booted) {
        runtime.booted = true;
        runtime.lastRefresh = elapsedSeconds;
        runtime.draw(elapsedSeconds, 1);
        continue;
      }

      if (elapsedSeconds - runtime.lastRefresh < runtime.refreshSeconds) continue;
      runtime.lastRefresh = elapsedSeconds;
      runtime.draw(elapsedSeconds, 1);
    }
  };

  return { object: group, update };
}
