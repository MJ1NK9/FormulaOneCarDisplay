/**
 * 发光展台：车的底座。
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

  const body = new Mesh(
    new BoxGeometry(cfg.width, cfg.height, cfg.depth),
    new MeshStandardMaterial({
      color: cfg.color,
      roughness: 0.55,
      metalness: 0.35,
      clippingPlanes,
      clipShadows: true,
    }),
  );
  body.position.y = cfg.height / 2;
  body.receiveShadow = true;
  group.add(body);

  // 台面单独一块：比侧面更光、更金属，顶光打下来会有一条亮带
  const top = new Mesh(
    new BoxGeometry(cfg.width - 0.04, 0.02, cfg.depth - 0.04),
    new MeshStandardMaterial({
      color: cfg.topColor,
      // 0.45：更光滑会在台面上反出一大片高光，把展台变成一块发光的白板
      roughness: 0.45,
      metalness: 0.6,
      clippingPlanes,
      clipShadows: true,
    }),
  );
  top.position.y = cfg.height;
  top.receiveShadow = true;
  group.add(top);

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

  const longBars = [
    new BoxGeometry(cfg.width, thickness, thickness),
    new BoxGeometry(cfg.width, thickness, thickness),
  ];
  const longZ = [cfg.depth / 2 - thickness / 2, -(cfg.depth / 2 - thickness / 2)];
  for (const [index, geometry] of longBars.entries()) {
    const bar = new Mesh(geometry, edgeMaterial);
    bar.position.set(0, edgeY, longZ[index] ?? 0);
    group.add(bar);
  }

  const sideZ = [cfg.width / 2 - thickness / 2, -(cfg.width / 2 - thickness / 2)];
  for (const x of sideZ) {
    const bar = new Mesh(new BoxGeometry(thickness, thickness, cfg.depth), edgeMaterial);
    bar.position.set(x, edgeY, 0);
    group.add(bar);
  }

  return group;
}
