/**
 * 赛事大屏：整面墙的主视觉。
 *
 * 它同时干两件事：
 * 1. 当背景——自发光面板把深色车漆「衬」出轮廓，车才不会糊进墙里；
 * 2. 当信息源——场次、圈数、最快圈、分段、圈速榜、气象，F1 转播里该有的东西。
 *
 * 屏幕用 MeshBasicMaterial（不受光照、关掉 toneMapping）：
 * 它自己是光源，不该再被主光二次照亮，也不该被色调映射压暗。
 * 每 2 秒重画一次 canvas，圈速和圈数会有细微变化，看起来是「在跑」的。
 */
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry } from 'three';
import { SHOWROOM_CONFIG } from '../../config/showroom';
import { createRaceWallTexture } from '../ProceduralTextures';

export interface RaceWallProp {
  readonly object: Group;
  readonly update: (elapsedSeconds: number) => void;
}

export function createRaceWall(): RaceWallProp {
  const cfg = SHOWROOM_CONFIG.raceWall;
  const group = new Group();
  group.name = 'showroom-race-wall';
  group.position.set(...cfg.position);
  group.rotation.y = cfg.rotationY;

  // 背板：比屏幕大一圈形成边框，同时挡住墙上的接缝
  const backing = new Mesh(
    new BoxGeometry(cfg.width + 0.16, cfg.height + 0.16, 0.12),
    new MeshStandardMaterial({ color: cfg.frameColor, roughness: 0.8, metalness: 0.2 }),
  );
  backing.position.set(0, cfg.height / 2, -0.07);
  backing.receiveShadow = true;
  group.add(backing);

  const { texture, draw } = createRaceWallTexture();
  const screen = new Mesh(
    new PlaneGeometry(cfg.width, cfg.height),
    new MeshBasicMaterial({ map: texture, toneMapped: false }),
  );
  screen.position.set(0, cfg.height / 2, cfg.screenOffset);
  group.add(screen);

  let lastRefresh = -Infinity;
  const update = (elapsedSeconds: number): void => {
    if (elapsedSeconds - lastRefresh < cfg.refreshSeconds) return;
    lastRefresh = elapsedSeconds;
    draw(elapsedSeconds);
  };

  return { object: group, update };
}
