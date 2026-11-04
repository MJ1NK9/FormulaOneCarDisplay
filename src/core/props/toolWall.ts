/**
 * 工具墙：右前方的穿孔板 + F1 工位装备。
 *
 * 为什么不用网上下的模型：
 * 免费可直连的模型库里没有 F1 工位装备（轮枪、千斤顶、枪架），Poly Haven 那批
 * 扳手/工具箱又都是复古工业风，放进车队车库会像道具间。所以这里按 F1 官方
 * 工位的视觉语言自己搭：哑光黑 + 铬件 + 一点点车队红，形体用圆柱和倒角盒拼，
 * 远看是「一排专业装备」，近看能认出哪件是什么。
 *
 * 结构：穿孔背板 + 两根立柱 + 9 件装备（2 把轮枪、扭矩扳手、螺母排、枪架、
 * 耳机、灭火器、墙挂小屏、软管盘）。
 */
import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  TorusGeometry,
} from 'three';
import { SHOWROOM_CONFIG } from '../../config/showroom';
import { createPegboardTexture } from '../ProceduralTextures';

export function createToolWall(): Group {
  const cfg = SHOWROOM_CONFIG.toolWall;
  const group = new Group();
  group.name = 'showroom-tool-wall';
  group.position.set(...cfg.position);
  group.rotation.y = cfg.rotationY;

  const frameMaterial = new MeshStandardMaterial({
    color: cfg.frameColor,
    roughness: 0.55,
    metalness: 0.6,
  });
  // 装备主体：哑光黑阳极氧化，F1 工位最常见的表面
  const toolMaterial = new MeshStandardMaterial({
    color: cfg.toolColor,
    roughness: 0.42,
    metalness: 0.45,
  });
  // 金属件：枪管、扳手、螺母
  const metalMaterial = new MeshStandardMaterial({
    color: cfg.metalColor,
    roughness: 0.22,
    metalness: 0.95,
  });
  const accentMaterial = new MeshStandardMaterial({
    color: cfg.accentColor,
    roughness: 0.38,
    metalness: 0.35,
  });
  const screenMaterial = new MeshStandardMaterial({
    color: '#070b11',
    emissive: cfg.screenColor,
    // 0.5：工位终端是「亮着」而不是「发光体」，1.1 会亮成一块贴纸
    emissiveIntensity: 0.5,
    roughness: 0.5,
    metalness: 0.1,
  });

  const boardCenterY = cfg.bottom + cfg.height / 2;
  const postHeight = cfg.bottom + cfg.height + 0.2;

  // 立柱
  for (const x of [cfg.width / 2 + 0.12, -(cfg.width / 2 + 0.12)]) {
    const post = new Mesh(new BoxGeometry(0.1, postHeight, 0.12), frameMaterial);
    post.position.set(x, postHeight / 2, -0.02);
    post.castShadow = true;
    post.receiveShadow = true;
    group.add(post);
  }

  // 背板 + 穿孔板
  const backing = new Mesh(
    new BoxGeometry(cfg.width + 0.1, cfg.height + 0.1, 0.08),
    frameMaterial,
  );
  backing.position.set(0, boardCenterY, -0.03);
  backing.castShadow = true;
  backing.receiveShadow = true;
  group.add(backing);

  const board = new Mesh(
    new PlaneGeometry(cfg.width, cfg.height),
    new MeshStandardMaterial({
      map: createPegboardTexture(),
      roughness: 0.72,
      metalness: 0.28,
    }),
  );
  board.position.set(0, boardCenterY, 0.02);
  board.receiveShadow = true;
  group.add(board);

  // 板顶一条红色饰条，呼应车队色
  const stripe = new Mesh(new BoxGeometry(cfg.width, 0.03, 0.02), accentMaterial);
  stripe.position.set(0, boardCenterY + cfg.height / 2 - 0.02, 0.04);
  group.add(stripe);

  /** 把零件放到板面坐标（x, dy），默认悬在板前 9cm */
  const place = (mesh: Mesh, x: number, dy: number, z = 0.09): Mesh => {
    mesh.position.set(x, boardCenterY + dy, z);
    mesh.castShadow = true;
    group.add(mesh);
    return mesh;
  };

  /** 轮枪：横置的电机筒 + 枪管 + 套筒 + 握把 */
  const addWheelGun = (x: number, dy: number, tilt: number): void => {
    const motor = new Mesh(new CylinderGeometry(0.085, 0.085, 0.34, 20), toolMaterial);
    motor.rotation.z = Math.PI / 2;
    motor.rotation.y = tilt;
    place(motor, x, dy, 0.12);

    const barrel = new Mesh(new CylinderGeometry(0.055, 0.055, 0.12, 18), metalMaterial);
    barrel.rotation.z = Math.PI / 2;
    place(barrel, x + 0.22, dy, 0.12);

    const socket = new Mesh(new CylinderGeometry(0.08, 0.075, 0.09, 6), toolMaterial);
    socket.rotation.z = Math.PI / 2;
    place(socket, x + 0.31, dy, 0.12);

    const grip = new Mesh(new BoxGeometry(0.09, 0.26, 0.1), toolMaterial);
    grip.rotation.z = 0.12;
    place(grip, x - 0.02, dy - 0.19, 0.12);

    const trigger = new Mesh(new BoxGeometry(0.04, 0.07, 0.04), accentMaterial);
    place(trigger, x + 0.06, dy - 0.12, 0.12);
  };

  addWheelGun(-1.02, 0.46, 0);
  addWheelGun(-0.62, 0.44, 0.08);

  // 扭矩扳手：长杆 + 数显段 + 头部
  const wrenchBar = new Mesh(new BoxGeometry(0.05, 0.72, 0.035), metalMaterial);
  wrenchBar.rotation.z = 0.03;
  place(wrenchBar, -0.16, 0.46, 0.09);

  const wrenchHead = new Mesh(new BoxGeometry(0.17, 0.11, 0.07), metalMaterial);
  place(wrenchHead, -0.19, 0.83, 0.09);

  const wrenchDisplay = new Mesh(new BoxGeometry(0.11, 0.07, 0.05), toolMaterial);
  place(wrenchDisplay, -0.16, 0.2, 0.09);

  const displayFace = new Mesh(new PlaneGeometry(0.08, 0.04), screenMaterial);
  place(displayFace, -0.16, 0.2, 0.118);

  // 轮胎螺母排：一根导轨 + 四颗六角螺母
  const nutRail = new Mesh(new BoxGeometry(0.62, 0.05, 0.09), toolMaterial);
  place(nutRail, 0.68, 0.6, 0.1);

  for (let i = 0; i < 4; i++) {
    const nut = new Mesh(new CylinderGeometry(0.07, 0.07, 0.09, 6), metalMaterial);
    nut.rotation.x = Math.PI / 2;
    place(nut, 0.45 + i * 0.15, 0.6, 0.16);
  }

  // 枪架：两层小平台，给「这里放轮枪」一个结构依据
  for (const y of [0.12, -0.02]) {
    const shelf = new Mesh(new BoxGeometry(0.5, 0.03, 0.16), frameMaterial);
    place(shelf, 1.02, y, 0.12);
  }
  for (const x of [0.8, 1.24]) {
    const upright = new Mesh(new BoxGeometry(0.03, 0.26, 0.03), frameMaterial);
    place(upright, x, 0.05, 0.18);
  }

  // 耳机：半圆头梁 + 两个耳罩
  const headband = new Mesh(new TorusGeometry(0.14, 0.018, 8, 24, Math.PI), toolMaterial);
  headband.position.set(-1.02, boardCenterY - 0.28, 0.1);
  headband.rotation.z = Math.PI;
  group.add(headband);

  for (const x of [-1.16, -0.88]) {
    const cup = new Mesh(new CylinderGeometry(0.055, 0.055, 0.05, 16), accentMaterial);
    cup.rotation.x = Math.PI / 2;
    place(cup, x, -0.28, 0.1);
  }

  // 灭火器：罐体 + 颈 + 压把
  const tank = new Mesh(new CylinderGeometry(0.072, 0.072, 0.4, 18), accentMaterial);
  place(tank, -0.5, -0.35, 0.12);

  const neck = new Mesh(new CylinderGeometry(0.028, 0.028, 0.09, 12), metalMaterial);
  place(neck, -0.5, -0.1, 0.12);

  const handle = new Mesh(new BoxGeometry(0.12, 0.035, 0.05), toolMaterial);
  place(handle, -0.5, -0.04, 0.12);

  // 墙挂小屏：工位上的计时/遥测终端
  const monitor = new Mesh(new BoxGeometry(0.46, 0.3, 0.04), toolMaterial);
  place(monitor, 0.3, -0.32, 0.1);

  const monitorFace = new Mesh(new PlaneGeometry(0.4, 0.24), screenMaterial);
  place(monitorFace, 0.3, -0.32, 0.125);

  // 软管盘：一个圆环，远看就是一个「圈」
  const hose = new Mesh(new TorusGeometry(0.12, 0.035, 12, 28), toolMaterial);
  place(hose, 0.98, -0.42, 0.11);

  return group;
}
