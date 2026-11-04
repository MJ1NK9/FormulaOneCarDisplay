/**
 * 发光展台：车的底座，同时是升降口的"井口"。
 *
 * 它不再是实心方块，而是四边围出中间开口的框架：
 * 升降台从开口里带着车沉下去，两扇滑动地板再从左右合拢把开口盖住。
 * 因此台面由「四块底板 + 四块台面板」拼成，开口尺寸必须和 LIFT_OPENING 一致。
 *
 * 三个作用：
 * 1. 把车抬高 0.10，阴影落在台面上而不是直接贴地，车才有「被展示」的重量感；
 * 2. 台面用高金属度 + 低粗糙度，灯带的颜色会映在上面；
 * 3. 台沿一圈自发光条，在暗环境里勾出底座轮廓。
 */
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, type Plane } from 'three';
import { SHOWROOM_CONFIG } from '../../config/showroom';

/**
 * @param floorClipPlane 车底视角的裁剪面：相机低于台面时把展台切掉，
 *   否则从下往上看车底时，台面会横在镜头和车之间。
 */
export function createPlinth(floorClipPlane?: Plane): Group {
  const cfg = SHOWROOM_CONFIG.plinth;
  const group = new Group();
  group.name = 'showroom-plinth';
  group.position.set(...cfg.position);
  group.rotation.y = cfg.rotationY;

  // 展台的所有材质共用同一个裁剪面；没有传入时保持默认「不裁剪」
  const clippingPlanes = floorClipPlane ? [floorClipPlane] : undefined;

  const bodyMaterial = new MeshStandardMaterial({
    color: cfg.color,
    roughness: 0.55,
    metalness: 0.35,
    clippingPlanes,
    clipShadows: true,
  });

  // 台面单独一块材质：比侧面更光、更金属，顶光打下来会有一条亮带。
  // 升降台的台面也用同一组参数（各自实例，方便各自释放），升起后材质不出现断层
  const topMaterial = new MeshStandardMaterial({
    color: cfg.topColor,
    // 0.45：更光滑会在台面上反出一大片高光，把展台变成一块发光的白板
    roughness: 0.45,
    metalness: 0.6,
    clippingPlanes,
    clipShadows: true,
  });

  const halfWidth = cfg.width / 2;
  const halfDepth = cfg.depth / 2;
  const halfOpeningWidth = cfg.openingWidth / 2;
  const halfOpeningDepth = cfg.openingDepth / 2;
  /** 左右台沿（X 方向）与前后台沿（Z 方向）的宽度 */
  const rimX = halfWidth - halfOpeningWidth;
  const rimZ = halfDepth - halfOpeningDepth;
  /** 台面板相对底座外沿的内缩量：留一条窄边，台面像嵌在底座里而不是浮在上面 */
  const topInset = 0.02;

  // ── 底座：左右两块通长板，前后两块补齐开口宽度 ──
  for (const sign of [-1, 1]) {
    const slab = new Mesh(new BoxGeometry(rimX, cfg.height, cfg.depth), bodyMaterial);
    slab.position.set(sign * (halfOpeningWidth + rimX / 2), cfg.height / 2, 0);
    slab.receiveShadow = true;
    group.add(slab);
  }

  for (const sign of [-1, 1]) {
    const slab = new Mesh(new BoxGeometry(cfg.openingWidth, cfg.height, rimZ), bodyMaterial);
    slab.position.set(0, cfg.height / 2, sign * (halfOpeningDepth + rimZ / 2));
    slab.receiveShadow = true;
    group.add(slab);
  }

  // ── 台面板：同样四块，内沿卡在开口边上，外沿内缩 0.02 ──
  const topWidth = rimX - topInset;
  const topDepth = rimZ - topInset;

  for (const sign of [-1, 1]) {
    const plate = new Mesh(
      new BoxGeometry(topWidth, cfg.topPlateThickness, cfg.depth - topInset * 2),
      topMaterial,
    );
    plate.position.set(sign * (halfOpeningWidth + topWidth / 2), cfg.height, 0);
    plate.receiveShadow = true;
    group.add(plate);
  }

  for (const sign of [-1, 1]) {
    const plate = new Mesh(
      new BoxGeometry(cfg.openingWidth, cfg.topPlateThickness, topDepth),
      topMaterial,
    );
    plate.position.set(0, cfg.height, sign * (halfOpeningDepth + topDepth / 2));
    plate.receiveShadow = true;
    group.add(plate);
  }

  // 台沿灯条：嵌在侧面上缘，四条拼成闭环
  const edgeMaterial = new MeshStandardMaterial({
    color: '#050505',
    emissive: cfg.edgeColor,
    emissiveIntensity: cfg.edgeIntensity,
    roughness: 1,
    metalness: 0,
    clippingPlanes,
    clipShadows: true,
  });
  const thickness = 0.022;
  const edgeY = cfg.height - thickness;

  const longZ = [halfDepth - thickness / 2, -(halfDepth - thickness / 2)];
  for (const z of longZ) {
    const bar = new Mesh(new BoxGeometry(cfg.width, thickness, thickness), edgeMaterial);
    bar.position.set(0, edgeY, z);
    group.add(bar);
  }

  const sideX = [halfWidth - thickness / 2, -(halfWidth - thickness / 2)];
  for (const x of sideX) {
    const bar = new Mesh(new BoxGeometry(thickness, thickness, cfg.depth), edgeMaterial);
    bar.position.set(x, edgeY, 0);
    group.add(bar);
  }

  return group;
}
