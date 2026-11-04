/**
 * 轮胎墙：靠左墙的轮胎架，画面里最缺的「彩色」就靠它。
 *
 * - 12 只轮胎用 InstancedMesh：几何和材质只上传一次，12 个实例一次 draw call；
 * - 胎圈颜色按 F1 规则区分干胎 / 半雨胎 / 全雨胎（红 / 黄 / 蓝 / 白），
 *   这是整间屋里除了品牌墙之外唯一的高饱和色块；
 * - 胎圈单独做成 RingGeometry 贴在胎侧，因为同一只轮胎只该有一个颜色，
 *   直接改实例颜色会把整只胎染色。
 */
import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  RingGeometry,
} from 'three';
import { SHOWROOM_CONFIG } from '../../config/showroom';

export function createTireWall(): Group {
  const cfg = SHOWROOM_CONFIG.tireWall;
  const group = new Group();
  group.name = 'showroom-tire-wall';
  group.position.set(...cfg.position);
  group.rotation.y = cfg.rotationY;

  const { columns, rows, radius, width, spacingX, spacingY } = cfg;
  const boardWidth = (columns - 1) * spacingX + radius * 2;
  const boardHeight = (rows - 1) * spacingY + radius * 2;

  const rackMaterial = new MeshStandardMaterial({
    color: cfg.rackColor,
    roughness: 0.5,
    metalness: 0.7,
  });

  // 立柱
  const postHeight = boardHeight + 0.4;
  for (const x of [boardWidth / 2 + 0.12, -(boardWidth / 2 + 0.12)]) {
    const post = new Mesh(new BoxGeometry(0.09, postHeight, 0.44), rackMaterial);
    post.position.set(x, postHeight / 2, 0);
    post.castShadow = true;
    group.add(post);
  }

  // 横梁：每排的上沿一根，顶上再封一根
  for (let row = 1; row < rows; row++) {
    const beam = new Mesh(new BoxGeometry(boardWidth + 0.24, 0.06, 0.46), rackMaterial);
    beam.position.set(0, row * spacingY, 0);
    beam.castShadow = true;
    group.add(beam);
  }

  const topBeam = new Mesh(new BoxGeometry(boardWidth + 0.24, 0.06, 0.46), rackMaterial);
  topBeam.position.set(0, boardHeight, 0);
  topBeam.castShadow = true;
  group.add(topBeam);

  // 轮胎本体：一次实例化
  const tireMaterial = new MeshStandardMaterial({
    // 比纯黑亮一档：全黑时轮胎会和背景糊成一片，只剩胎圈在飘
    color: '#15171b',
    roughness: 0.9,
    metalness: 0.05,
  });
  const tireGeometry = new CylinderGeometry(radius, radius, width, 32);
  const count = columns * rows;
  const tires = new InstancedMesh(tireGeometry, tireMaterial, count);
  tires.castShadow = true;
  tires.receiveShadow = true;

  const dummy = new Object3D();
  const centers: { x: number; y: number }[] = [];

  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const x = (column - (columns - 1) / 2) * spacingX;
      const y = radius + row * spacingY;
      centers.push({ x, y });

      // 圆柱默认轴向 Y，绕 X 转 90° 后轴向变 Z，正面朝向房间
      dummy.position.set(x, y, 0);
      dummy.rotation.set(Math.PI / 2, 0, 0);
      dummy.updateMatrix();
      tires.setMatrixAt(centers.length - 1, dummy.matrix);
    }
  }
  tires.instanceMatrix.needsUpdate = true;
  group.add(tires);

  // 胎圈：按顺序循环四种颜色，每种颜色共用一份材质
  const ringGeometry = new RingGeometry(radius * 0.5, radius * 0.68, 64);
  const ringMaterials = new Map<string, MeshStandardMaterial>();
  for (const hex of cfg.ringColors) {
    ringMaterials.set(
      hex,
      new MeshStandardMaterial({
        color: new Color(hex),
        emissive: new Color(hex),
        // 胎圈在背光侧也要能认出来，所以给一点自发光，不能全靠环境光
        emissiveIntensity: 0.35,
        roughness: 0.6,
        metalness: 0.1,
      }),
    );
  }

  for (const [index, center] of centers.entries()) {
    const hex = cfg.ringColors[index % cfg.ringColors.length];
    if (!hex) continue;
    const material = ringMaterials.get(hex);
    if (!material) continue;

    const ring = new Mesh(ringGeometry, material);
    ring.position.set(center.x, center.y, width / 2 + 0.005);
    group.add(ring);
  }

  return group;
}
