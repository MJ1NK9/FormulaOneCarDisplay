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
import { LiftStage } from '../core/LiftStage';
import { SceneManager } from '../core/SceneManager';
import { createShowroom } from '../core/Showroom';

const host = document.getElementById('app');
if (!host) throw new Error('找不到 #app');

const sceneManager = new SceneManager(host);

const showroom = createShowroom(SHOWROOM_CONFIG, {
  floorClipPlane: sceneManager.floorClipPlane,
  // 前墙视频屏用它把屏幕四角投到视口；预览页没有 DOM 播控层，但屏幕和视频
  // 本身是按可见性懒加载的，切到 ?view=video 就能看到真实播放画面
  camera: sceneManager.camera,
});
sceneManager.scene.add(showroom.root);
sceneManager.onFrame((deltaSeconds) => showroom.update(deltaSeconds));

// 升降舞台也要搭出来：地面和展台都挖了开口，没有它预览页会是一个对着黑洞的窟窿
const liftStage = new LiftStage({
  sceneManager,
  floorClipPlane: sceneManager.floorClipPlane,
});
sceneManager.scene.add(liftStage.root);

// 车模真实尺寸：长 4.0（Z）× 宽 1.41（X）× 高 0.89，放在台面上
const placeholder = new Group();
const car = new Mesh(
  new BoxGeometry(1.41, 0.89, 4),
  new MeshStandardMaterial({ color: '#1b2a4a', roughness: 0.35, metalness: 0.6 }),
);
car.position.y = 0.445;
car.castShadow = true;
placeholder.add(car);
liftStage.attachModel(placeholder);

// 固定到方案里的默认机位（frameObject 在没有真实模型时用不了）：
// 方位角约 22°、俯角约 16°，距离 = 包围球半径 2.14 × padding 0.96 / sin(45°/2) ≈ 5.37。
// 注视点 = 车心 0.545 + targetOffsetY 0.45，再按 targetOffsetX 右移 0.6。
sceneManager.camera.position.set(1.96, 2.05, 4.77);
sceneManager.controls.target.set(0.6, 0.995, 0);

// ?view=tools / ?view=tires / ?view=front / ?view=under / ?view=cart
const view = new URLSearchParams(window.location.search).get('view');
if (view === 'tools') {
  sceneManager.camera.position.set(2.6, 2.0, 1.2);
  sceneManager.controls.target.set(6.65, 1.3, -2);
} else if (view === 'tires') {
  sceneManager.camera.position.set(0.6, 2.0, 0.2);
  sceneManager.controls.target.set(-6.65, 1.4, -3.3);
} else if (view === 'front') {
  // 从车尾往车头看：检查前墙视频屏、灯带和天花板
  sceneManager.camera.position.set(-3.2, 2.15, -4.43);
  sceneManager.controls.target.set(0, 1.0, 0);
} else if (view === 'video') {
  // 正对前墙视频屏：检查屏幕尺寸、和墙面的层叠关系，以及视频是否正常出画。
  // 相机放到屏幕正前方，让它完整进入视锥（视频屏是可见才加载的）
  sceneManager.controls.maxDistance = 20;
  sceneManager.camera.position.set(0, 2.2, -2.8);
  sceneManager.controls.target.set(0, 2.2, 6.66);
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
} else if (view === 'wall') {
  // 正对后墙：检查主屏水平居中、左右副屏对称、三屏是否共用同一条中轴。
  // 预览页没有真实车模，相机不受 frameObject 的取景距离约束，这里临时放宽
  // OrbitControls 的 maxDistance，否则会被拉回 6.4，看不全 13.6 宽的后墙。
  sceneManager.controls.maxDistance = 20;
  sceneManager.camera.position.set(0, 2.2, 4.6);
  sceneManager.controls.target.set(0, 2.2, -6.8);
} else if (view === 'wall-low') {
  // 贴地看后墙右下：检查右副屏下沿和工具车之间有没有互相遮挡
  sceneManager.controls.maxDistance = 20;
  sceneManager.camera.position.set(3.2, 1.1, 1.4);
  sceneManager.controls.target.set(5.1, 1.9, -6.7);
}

sceneManager.controls.update();

sceneManager.start();
