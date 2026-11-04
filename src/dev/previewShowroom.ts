/**
 * 开发用预览页：只渲染「展示间」，不加载 35.8 MB 的车模。
 *
 * 为什么需要它：
 * 这台机器没法用 headless 浏览器渲染完整页面——车模 26 张 4096² 贴图在
 * 软件渲染（swiftshader）下会把 renderer 撑崩。去掉车，单看布景和灯光，
 * 就能在软件渲染里出图，用来核对构图、明暗、道具位置。
 *
 * 车的位置放了一个同尺寸的深蓝色方块占位，方便判断取景是否合理。
 * 这个页面不参与构建（vite build 只认 index.html），只在 /preview.html 手动打开。
 */
import '../style.css';
import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from 'three';
import { SHOWROOM_CONFIG } from '../config/showroom';
import { SceneManager } from '../core/SceneManager';
import { createShowroom } from '../core/Showroom';

const host = document.getElementById('app');
if (!host) throw new Error('找不到 #app');

const sceneManager = new SceneManager(host);

const showroom = createShowroom(SHOWROOM_CONFIG, {
  floorClipPlane: sceneManager.floorClipPlane,
});
sceneManager.scene.add(showroom.root);
sceneManager.onFrame((deltaSeconds) => showroom.update(deltaSeconds));

// 车模真实尺寸：长 4.0（Z）× 宽 1.41（X）× 高 0.89，放在展台面上
const placeholder = new Group();
const car = new Mesh(
  new BoxGeometry(1.41, 0.89, 4),
  new MeshStandardMaterial({ color: '#1b2a4a', roughness: 0.35, metalness: 0.6 }),
);
car.position.y = 0.445;
car.castShadow = true;
placeholder.add(car);
placeholder.position.y = SHOWROOM_CONFIG.plinth.height;
sceneManager.scene.add(placeholder);

// 固定到方案里的默认机位（frameObject 在没有真实模型时用不了）
// 距离 = 包围球半径 2.14 × padding 0.88 / sin(fov45°/2) ≈ 4.93
sceneManager.camera.position.set(2.77, 1.93, 3.83);
// 注视点 = 车心 0.545 + CAMERA_FIT_CONFIG.targetOffsetY 0.45
sceneManager.controls.target.set(0, 0.995, 0);

// ?view=tools / ?view=tires / ?view=front / ?view=under / ?view=cart
const view = new URLSearchParams(window.location.search).get('view');
if (view === 'tools') {
  sceneManager.camera.position.set(2.6, 2.0, 1.2);
  sceneManager.controls.target.set(6.65, 1.3, -2);
} else if (view === 'tires') {
  sceneManager.camera.position.set(0.6, 2.0, 0.2);
  sceneManager.controls.target.set(-6.65, 1.4, -3.3);
} else if (view === 'front') {
  // 从车尾往车头看，检查前墙和天花板
  sceneManager.camera.position.set(-3.2, 2.15, -4.43);
  sceneManager.controls.target.set(0, 1.0, 0);
} else if (view === 'under') {
  // 车底视角：相机沉到地面以下，验证地板/展台是否被裁剪面让开
  sceneManager.camera.position.set(1.2, -0.85, 3.6);
  sceneManager.controls.target.set(0, 0.65, 0);
} else if (view === 'low') {
  // 贴近地面的低角度：检查裁剪面从台面高度切过时有没有突兀的断层
  sceneManager.camera.position.set(1.2, 0.09, 4.2);
  sceneManager.controls.target.set(0, 0.55, 0);
} else if (view === 'cart') {
  // 后墙右下角：验证工具车挪位后的构图
  sceneManager.camera.position.set(1.4, 1.6, -1.2);
  sceneManager.controls.target.set(4.8, 0.55, -6.1);
}

sceneManager.controls.update();

sceneManager.start();
