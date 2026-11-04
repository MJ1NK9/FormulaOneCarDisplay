/**
 * Showroom —— 展示间的总装入口。
 *
 * 职责：
 * 1. 搭「房间」：地坪、四面墙、踢脚线、灯带、天花板；
 * 2. 按 SHOWROOM_CONFIG.props 的顺序把道具挂上去；
 * 3. 收集需要每帧更新的道具（赛事大屏），对外提供 update；
 * 4. 提供 dispose，切页 / HMR 时把 GPU 资源还回去。
 *
 * 房间是封闭的正方形：相机在房间里绕车转，四面墙 + 天花板保证
 * 任何一个角度都看不到「墙外」的虚空，这是它和早期「两面墙布景」最大的区别。
 * 相机沉到地面以下看车底时，地板和展台会被 SceneManager 的裁剪面切掉——
 * 这是唯一允许「穿出地面」的情况，否则地面会挡在镜头和车底之间。
 *
 * 不做的事：不打光（灯光在 SceneManager）、不认识车模、不碰相机。
 */
import {
  BoxGeometry,
  Color,
  Group,
  Mesh,
  MeshStandardMaterial,
  Plane,
  PlaneGeometry,
  Texture,
  type Object3D,
} from 'three';
import { SHOWROOM_CONFIG, type RoomConfig, type ShowroomConfig } from '../config/showroom';
import { createFloorTexture } from './ProceduralTextures';
import { buildProp } from './props';

export interface ShowroomHandle {
  /** 挂到 scene 上的根节点 */
  readonly root: Group;
  /** 每帧调用：deltaSeconds 由 SceneManager 的渲染循环给 */
  update(deltaSeconds: number): void;
  /** 释放几何 / 材质 / 贴图 */
  dispose(): void;
}

export interface ShowroomOptions {
  /**
   * 车底视角的水平裁剪面（世界坐标，法线朝下）。
   * 相机沉到地面以下时，把地板和展台切掉，镜头和车底之间就不会横着一块地面。
   * 平面对象由 SceneManager 持有并每帧更新高度；Showroom 只负责把它挂到材质上。
   */
  readonly floorClipPlane?: Plane;
}

/** 房间本体：地坪 + 四面墙 + 踢脚线 + 灯带 + 天花板 */
function createRoom(room: RoomConfig, floorClipPlane?: Plane): Group {
  const group = new Group();
  group.name = 'showroom-room';

  const { width, height, distance, skirtingHeight, skirtingColor } = room.walls;
  const half = distance;

  const floor = new Mesh(
    new PlaneGeometry(room.floor.size, room.floor.size),
    new MeshStandardMaterial({
      // 底色画在贴图里，这里用白色避免二次乘算把地面压暗
      color: new Color('#ffffff'),
      map: createFloorTexture(room.floor),
      roughness: room.floor.roughness,
      metalness: room.floor.metalness,
      envMapIntensity: room.floor.envMapIntensity,
      // 相机到地面以下时，地板跟着「消失」在镜头之下，而不是挡在车底前面
      clippingPlanes: floorClipPlane ? [floorClipPlane] : undefined,
      clipShadows: true,
    }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

  const wallMaterial = new MeshStandardMaterial({
    color: new Color(room.walls.color),
    roughness: 0.92,
    metalness: 0,
  });

  // 四面墙：PlaneGeometry 默认法线朝 +Z，靠 rotationY 把它转向房间内部
  const walls: { x: number; z: number; rotationY: number }[] = [
    { x: 0, z: -half, rotationY: 0 }, // 后墙，朝 +Z
    { x: 0, z: half, rotationY: Math.PI }, // 前墙，朝 -Z
    { x: -half, z: 0, rotationY: Math.PI / 2 }, // 左墙，朝 +X
    { x: half, z: 0, rotationY: -Math.PI / 2 }, // 右墙，朝 -X
  ];

  for (const wall of walls) {
    const mesh = new Mesh(new PlaneGeometry(width, height), wallMaterial);
    mesh.position.set(wall.x, height / 2, wall.z);
    mesh.rotation.y = wall.rotationY;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // 踢脚线：一条深色窄带，让墙和地坪「接住」，不然像两块片插在一起
  const skirtingMaterial = new MeshStandardMaterial({
    color: new Color(skirtingColor),
    roughness: 0.7,
    metalness: 0.15,
  });

  const skirting: { x: number; z: number; rotationY: number }[] = [
    { x: 0, z: -half + 0.025, rotationY: 0 },
    { x: 0, z: half - 0.025, rotationY: 0 },
    { x: -half + 0.025, z: 0, rotationY: Math.PI / 2 },
    { x: half - 0.025, z: 0, rotationY: Math.PI / 2 },
  ];

  for (const item of skirting) {
    const mesh = new Mesh(new BoxGeometry(width, skirtingHeight, 0.05), skirtingMaterial);
    mesh.position.set(item.x, skirtingHeight / 2, item.z);
    mesh.rotation.y = item.rotationY;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // 灯带：只发光不照明（真正的照明由 SpotLight 和两盏点光负责）
  const ledMaterial = new MeshStandardMaterial({
    color: new Color('#05070a'),
    emissive: new Color(room.led.color),
    emissiveIntensity: room.led.intensity,
    roughness: 1,
    metalness: 0,
  });
  const accentMaterial = (hex: string, intensity: number): MeshStandardMaterial =>
    new MeshStandardMaterial({
      color: new Color('#05070a'),
      emissive: new Color(hex),
      emissiveIntensity: intensity,
      roughness: 1,
      metalness: 0,
    });

  const led = room.led.thickness;
  const ledY = 4.05;
  const ledLength = width * 0.56;

  const ledBars: { x: number; z: number; rotationY: number }[] = [
    { x: 0, z: -half + 0.04, rotationY: 0 },
    { x: 0, z: half - 0.04, rotationY: 0 },
    { x: -half + 0.04, z: 0, rotationY: Math.PI / 2 },
    { x: half - 0.04, z: 0, rotationY: Math.PI / 2 },
  ];

  for (const item of ledBars) {
    const mesh = new Mesh(new BoxGeometry(ledLength, led, led), ledMaterial);
    mesh.position.set(item.x, ledY, item.z);
    mesh.rotation.y = item.rotationY;
    group.add(mesh);
  }

  // 墙脚的车队色：后墙红、左右墙黄，前墙红
  const accents: { x: number; z: number; rotationY: number; color: string }[] = [
    { x: 0, z: -half + 0.05, rotationY: 0, color: room.accent.red },
    { x: 0, z: half - 0.05, rotationY: 0, color: room.accent.red },
    { x: -half + 0.05, z: 0, rotationY: Math.PI / 2, color: room.accent.yellow },
    { x: half - 0.05, z: 0, rotationY: Math.PI / 2, color: room.accent.yellow },
  ];

  for (const item of accents) {
    const mesh = new Mesh(
      new BoxGeometry(width * 0.56, 0.05, 0.05),
      accentMaterial(item.color, 1.4),
    );
    mesh.position.set(item.x, 0.18, item.z);
    mesh.rotation.y = item.rotationY;
    group.add(mesh);
  }

  // 天花板：没有它，相机往上抬一点就能看到墙外的虚空
  const ceiling = new Mesh(
    new PlaneGeometry(width, width),
    new MeshStandardMaterial({ color: new Color(room.ceiling.color), roughness: 0.9, metalness: 0.05 }),
  );
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = room.ceiling.height;
  group.add(ceiling);

  // 天花板灯带：三根横条，给顶部一点结构
  const ceilingStripMaterial = new MeshStandardMaterial({
    color: new Color('#05070a'),
    emissive: new Color(room.ceiling.stripColor),
    emissiveIntensity: room.ceiling.stripIntensity,
    roughness: 1,
    metalness: 0,
  });

  for (const z of [-3.4, 0, 3.4]) {
    const strip = new Mesh(new BoxGeometry(width * 0.46, 0.04, 0.08), ceilingStripMaterial);
    strip.position.set(0, room.ceiling.height - 0.03, z);
    group.add(strip);
  }

  return group;
}

/** 递归释放几何、材质和贴图（贴图挂在材质的某个字段上，只能反射着找） */
function disposeTree(root: Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;

    object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];

    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (value instanceof Texture) value.dispose();
      }
      material.dispose();
    }
  });
}

export function createShowroom(
  config: ShowroomConfig = SHOWROOM_CONFIG,
  options: ShowroomOptions = {},
): ShowroomHandle {
  const root = new Group();
  root.name = 'showroom';
  root.add(createRoom(config.room, options.floorClipPlane));

  const updaters: ((elapsedSeconds: number) => void)[] = [];
  for (const kind of config.props) {
    const built = buildProp(kind, { floorClipPlane: options.floorClipPlane });
    root.add(built.object);
    if (built.update) updaters.push(built.update);
  }

  let elapsed = 0;

  return {
    root,
    update(deltaSeconds: number): void {
      elapsed += deltaSeconds;
      for (const update of updaters) update(elapsed);
    },
    dispose(): void {
      disposeTree(root);
      root.removeFromParent();
    },
  };
}
